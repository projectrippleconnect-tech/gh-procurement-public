begin;
-- Bounded, permission-aware work lists. Detail documents are fetched on demand.
create or replace function public.proc_work_brief(public.proc_v_requirements)
returns jsonb language sql stable security invoker set search_path=''
as $$ select jsonb_build_object(
 'still_receive',greatest(coalesce((select sum(l.qty-l.cancelled_qty) from public.proc_po_lines l join public.proc_purchase_orders p on p.id=l.po_id where l.requirement_id=($1).id and p.status in ('sent','partially_received','received','closed')),0)-($1).received_qty,0),
 'rfqs',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'status',q.status,'due_date',q.due_date) order by q.created_at,q.id)
 from public.proc_rfqs q where q.status in ('draft','prepared','sent','partially_quoted','quoted') and exists(select 1 from public.proc_rfq_items ri where ri.rfq_id=q.id and ri.requirement_id=($1).id)),'[]'::jsonb),
 'orders',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'line_id',l.id,'status',p.status,'quantity_only',p.quantity_only,'expected_date',p.expected_date,
 'remaining',greatest(l.qty-l.cancelled_qty-coalesce((select sum(g.accepted_qty) from public.proc_grn_lines g join public.proc_grns h on h.id=g.grn_id where g.po_line_id=l.id and h.status='posted'),0),0)) order by p.created_at,l.id)
 from public.proc_po_lines l join public.proc_purchase_orders p on p.id=l.po_id where l.requirement_id=($1).id and p.status not in ('received','closed','cancelled')),'[]'::jsonb)
) $$;

create or replace function public.proc_work_bucket(p_row public.proc_v_requirements,p_views text[])
returns text language plpgsql stable security invoker set search_path=''
as $$
declare brief jsonb; live_orders jsonb; permissions text[];
begin
 brief:=public.proc_work_brief(p_row);
 select coalesce(jsonb_agg(o),'[]'::jsonb) into live_orders from jsonb_array_elements(brief->'orders') o where (o->>'remaining')::numeric>0;
 if (p_row.status in ('received','closed','cancelled') or p_row.approval_status='rejected') and jsonb_array_length(live_orders)=0 then return 'History';end if;
 select coalesce(array_agg(permission_key),array[]::text[]) into permissions from public.proc_my_permissions_v1();
 if ('requirements'=any(p_views) and 'procurement.requirements.manage'=any(permissions)
  and (p_row.approval_status in ('pending_review','held') or (p_row.remaining_to_order>0 and jsonb_array_length(brief->'rfqs')=0)))
 or ('rfq'=any(p_views) and 'procurement.rfq.manage'=any(permissions) and p_row.approval_status='approved' and p_row.remaining_to_order>0 and jsonb_array_length(brief->'rfqs')>0)
 or exists(select 1 from jsonb_array_elements(live_orders) o where
  (p_row.approval_status='approved' and 'po'=any(p_views) and
   ((o->>'status'='pending_approval' and 'procurement.orders.approve'=any(permissions)) or (o->>'status' in ('draft','approved') and 'procurement.orders.edit'=any(permissions))))
  or (o->>'status' in ('sent','partially_received') and 'receiving'=any(p_views) and 'receiving.manage'=any(permissions)))
 then return 'Needs me';end if;
 return 'In progress';
end $$;

create or replace function public.proc_work_page_v1(p_scope text default 'all',p_tab text default 'Needs me',p_page integer default 0,p_views text[] default array[]::text[])
returns jsonb language plpgsql stable security invoker set search_path=''
as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_scope is null or p_scope not in ('all','general','company') or p_tab is null or p_tab not in ('Needs me','In progress','History') or p_page is null or p_page<0 or p_page>100000 then raise exception 'Invalid work filters' using errcode='22023';end if;
 -- The permission predicate narrows access; invoker table policies still apply.
 if not exists(select 1 from public.proc_my_permissions_v1() where permission_key='procurement.requirements.view') then raise exception 'Requirement access required' using errcode='42501';end if;
 with scoped as materialized (
  select r, public.proc_work_bucket(r,p_views) as bucket,
   case when r.priority='urgent' or r.customer_paid or r.urgency_reason='zero_stock' then 0 when r.priority='high' then 1 else 2 end as urgency
  from public.proc_v_requirements r
  where p_scope='all' or public.proc_requirement_is_company(r)=(p_scope='company')
 ), page_rows as (
  select (s.r).id,(s.r).created_at,urgency, jsonb_build_object(
   'id',(s.r).id,'requirement_no',(s.r).requirement_no,'description',(s.r).description,'size',(s.r).size,'uom',(s.r).uom,
   'status',(s.r).status,'approval_status',(s.r).approval_status,'hold_reason',(s.r).hold_reason,
   'remaining_to_order',(s.r).remaining_to_order,'priority',(s.r).priority,'customer_paid',(s.r).customer_paid,'urgency_reason',(s.r).urgency_reason,
   'source_count_no',(s.r).source_count_no,'proc_requirement_is_company',public.proc_requirement_is_company(s.r),
   'proc_work_documents',case when p_tab='History' then '{"rfqs":[],"orders":[]}'::jsonb else public.proc_work_brief(s.r) end
  ) as row_data from scoped s where bucket=p_tab
  order by case when p_tab='History' then 0 else urgency end,(s.r).created_at desc,(s.r).id
  limit 25 offset p_page*25
 ) select jsonb_build_object(
  'counts',(select jsonb_object_agg(t, (select count(*) from scoped where bucket=t)) from unnest(array['Needs me','In progress','History']) t),
  'rows',coalesce((select jsonb_agg(row_data order by case when p_tab='History' then 0 else urgency end,created_at desc,id) from page_rows),'[]'::jsonb)
 ) into result;
 return result;
end $$;
revoke all on function public.proc_work_brief(public.proc_v_requirements) from public,anon;
revoke all on function public.proc_work_bucket(public.proc_v_requirements,text[]) from public,anon;
revoke all on function public.proc_work_page_v1(text,text,integer,text[]) from public,anon;
grant execute on function public.proc_work_brief(public.proc_v_requirements) to authenticated;
grant execute on function public.proc_work_bucket(public.proc_v_requirements,text[]) to authenticated;
grant execute on function public.proc_work_page_v1(text,text,integer,text[]) to authenticated;
notify pgrst,'reload schema';
commit;
