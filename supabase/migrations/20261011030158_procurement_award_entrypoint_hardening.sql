-- Keep expiry and configured role permissions mandatory at every award entry point.
CREATE OR REPLACE FUNCTION public.proc_finalize_award_plan_v2(p_rfq_id uuid, p_allocations jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Asia/Colombo'
AS $function$
declare
  caller uuid:=auth.uid(); caller_role text;
  preferred integer; ri record; eligible integer; required_q integer; received integer;
  exception_reason text; x jsonb; qid uuid; q_valid date; result jsonb;
begin
  perform private.proc_assert_permission('procurement.orders.create');
  if caller is null then raise exception 'Not authenticated'; end if;
  select role into caller_role from public.proc_profiles where id=caller and active=true;
  if caller_role is null or caller_role not in ('admin','procurement') then raise exception 'Not authorized'; end if;

  preferred:=1;
  for ri in
    select i.id rfq_item_id,r.item_id
    from public.proc_rfq_items i join public.proc_requirements r on r.id=i.requirement_id
    where i.rfq_id=p_rfq_id and i.selected_for_po=true
  loop
    select count(*) into eligible
    from public.proc_rfq_suppliers rs
    where rs.rfq_id=p_rfq_id
      and rs.status<>'declined'
      and private.proc_supplier_covers_item_v1(rs.supplier_id,ri.item_id);
    required_q:=least(preferred,greatest(eligible,1));

    select count(distinct q.supplier_id) into received
    from public.proc_quote_lines ql
    join public.proc_quotes q on q.id=ql.quote_id
    where q.rfq_id=p_rfq_id and ql.rfq_item_id=ri.rfq_item_id
      and q.status in ('received','reviewed','selected')
      and (q.valid_until is null or q.valid_until>=current_date);

    if received<1 then
      raise exception 'A valid supplier quotation is required for item %.', ri.rfq_item_id;
    end if;
  end loop;

  for x in select * from jsonb_array_elements(p_allocations) loop
    select q.id,q.valid_until into qid,q_valid
    from public.proc_quote_lines ql join public.proc_quotes q on q.id=ql.quote_id
    where ql.id=(x->>'quote_line_id')::uuid and q.rfq_id=p_rfq_id;
    if qid is null then raise exception 'Award quote line does not belong to this RFQ'; end if;
    if q_valid is not null and q_valid<current_date then raise exception 'Expired quotation cannot be awarded'; end if;
  end loop;

  result:=public.proc_finalize_award_plan_v1(p_rfq_id,p_allocations);
  return result;
end $function$;

revoke execute on function public.proc_finalize_award_plan_v1(uuid,jsonb) from public,anon,authenticated;

-- Preserve the legacy automation signature through the current guarded implementation.
create or replace function public.proc_try_auto_award_v1(p_rfq_id uuid)
returns jsonb language sql security invoker set search_path='' as $function$
  select public.proc_try_auto_award_v2(p_rfq_id)
$function$;
revoke execute on function public.proc_try_auto_award_v1(uuid) from public,anon;
grant execute on function public.proc_try_auto_award_v1(uuid) to authenticated;
