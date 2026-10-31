begin;

-- Read-only computed fields. SECURITY INVOKER retains existing row-level access.
-- Unnamed composite arguments keep these helpers off the standalone RPC surface.
create or replace function public.proc_requirement_is_company(public.proc_v_requirements)
returns boolean language sql stable security invoker set search_path=''
as $$ select exists(select 1 from public.proc_requirements r where r.id=($1).id and r.company_id is not null) $$;

create or replace function public.proc_review_work_pending(public.proc_v_requirements)
returns boolean language sql stable security invoker set search_path=''
as $$ select coalesce(
 ($1).status in ('open','quoting','partially_ordered','ordered','partially_received')
 and ($1).approval_status in ('pending_review','approved','held')
 and ($1).remaining_to_order>0 and not ($1).has_active_rfq,false) $$;

create or replace function public.proc_rfq_is_company(public.proc_rfqs)
returns boolean language sql stable security invoker set search_path=''
as $$ select exists(select 1 from public.proc_rfq_items ri join public.proc_requirements r on r.id=ri.requirement_id where ri.rfq_id=($1).id and r.company_id is not null) $$;

-- Keep every active RFQ available until explicitly closed or cancelled.
create or replace function public.proc_rfq_work_pending(public.proc_rfqs)
returns boolean language sql stable security invoker set search_path=''
as $$ select coalesce(($1).status in ('draft','prepared','sent','partially_quoted','quoted') and exists(
 select 1 from public.proc_rfq_items ri
 join public.proc_requirements r on r.id=ri.requirement_id
 where ri.rfq_id=($1).id and r.adjusted_qty>r.ordered_qty
 and r.status not in ('received','closed','cancelled') and r.approval_status<>'rejected'

),false) $$;

create or replace function public.proc_rfq_attention(public.proc_rfqs)
returns text language sql stable security invoker set search_path=''
as $$ select case when exists(
 select 1 from public.proc_rfq_items ri join public.proc_requirements r on r.id=ri.requirement_id
 where ri.rfq_id=($1).id and r.approval_status='held'
) then 'A linked requirement is on hold. Review the hold before further purchasing.' else '' end $$;

revoke all on function public.proc_requirement_is_company(public.proc_v_requirements) from public,anon;
revoke all on function public.proc_review_work_pending(public.proc_v_requirements) from public,anon;
revoke all on function public.proc_rfq_is_company(public.proc_rfqs) from public,anon;
revoke all on function public.proc_rfq_work_pending(public.proc_rfqs) from public,anon;
revoke all on function public.proc_rfq_attention(public.proc_rfqs) from public,anon;
grant execute on function public.proc_requirement_is_company(public.proc_v_requirements) to authenticated;
grant execute on function public.proc_review_work_pending(public.proc_v_requirements) to authenticated;
grant execute on function public.proc_rfq_is_company(public.proc_rfqs) to authenticated;
grant execute on function public.proc_rfq_work_pending(public.proc_rfqs) to authenticated;
grant execute on function public.proc_rfq_attention(public.proc_rfqs) to authenticated;
-- A requirement is the stable purchasing case. Document links follow foreign keys,
-- never item-name matching. Invoker access also applies to all linked documents.
create or replace function public.proc_work_documents(public.proc_v_requirements)
returns jsonb language sql stable security invoker set search_path=''
as $$ select jsonb_build_object(
 'rfqs',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'number',q.rfq_no,'status',q.status) order by q.created_at,q.id)
 from public.proc_rfqs q where exists(select 1 from public.proc_rfq_items ri where ri.rfq_id=q.id and ri.requirement_id=($1).id)),'[]'::jsonb),
 'orders',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'line_id',l.id,'number',p.po_no,'status',p.status,'quantity_only',p.quantity_only,
 'remaining',greatest(l.qty-l.cancelled_qty-coalesce((select sum(g.accepted_qty) from public.proc_grn_lines g join public.proc_grns h on h.id=g.grn_id where g.po_line_id=l.id and h.status='posted'),0),0)) order by p.created_at,l.id)
 from public.proc_po_lines l join public.proc_purchase_orders p on p.id=l.po_id where l.requirement_id=($1).id),'[]'::jsonb),
 'receipts',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'number',h.grn_no,'status',h.status,'po_id',h.po_id,'accepted',g.accepted_qty) order by h.created_at,g.id)
 from public.proc_grn_lines g join public.proc_grns h on h.id=g.grn_id join public.proc_po_lines l on l.id=g.po_line_id where l.requirement_id=($1).id),'[]'::jsonb)
) $$;
revoke all on function public.proc_work_documents(public.proc_v_requirements) from public,anon;
grant execute on function public.proc_work_documents(public.proc_v_requirements) to authenticated;
notify pgrst,'reload schema';
commit;
