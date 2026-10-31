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

-- The newest active RFQ owns a remaining requirement in the default Quotes list.
-- Older/finished documents remain available in history; no business rows are changed.
create or replace function public.proc_rfq_work_pending(public.proc_rfqs)
returns boolean language sql stable security invoker set search_path=''
as $$ select coalesce(($1).status in ('draft','prepared','sent','partially_quoted','quoted') and exists(
 select 1 from public.proc_rfq_items ri
 join public.proc_requirements r on r.id=ri.requirement_id
 where ri.rfq_id=($1).id and r.adjusted_qty>r.ordered_qty
 and r.status not in ('received','closed','cancelled') and r.approval_status<>'rejected'
 and not exists(
  select 1 from public.proc_rfq_items newer_item
  join public.proc_rfqs newer on newer.id=newer_item.rfq_id
  where newer_item.requirement_id=r.id
  and newer.status in ('draft','prepared','sent','partially_quoted','quoted')
  and (newer.created_at,newer.id)>(($1).created_at,($1).id)
 )
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
notify pgrst,'reload schema';
commit;
