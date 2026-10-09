-- Attach a supplier explicitly without recreating the RFQ or altering its quotes.
create or replace function public.proc_add_rfq_supplier_v1(
 p_rfq_id uuid, p_supplier_id uuid, p_scope_override_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $function$
declare
 rfq public.proc_rfqs;
 invitation public.proc_rfq_suppliers;
 reason text:=nullif(btrim(p_scope_override_reason),'');
begin
 if auth.uid() is null then raise exception 'Not authenticated' using errcode='42501'; end if;
 if not private.proc_has_permission('procurement.rfq.manage') then
  raise exception 'Permission denied: procurement.rfq.manage' using errcode='42501';
 end if;
 if length(reason)>500 then raise exception 'Coverage override reason must be 500 characters or less'; end if;

 -- Serialize with awards and other additions to this RFQ.
 select * into rfq from public.proc_rfqs where id=p_rfq_id for update;
 if rfq.id is null then raise exception 'RFQ not found'; end if;
 if rfq.status not in ('draft','prepared','sent','partially_quoted','quoted') then
  raise exception 'Cannot add suppliers to an awarded, closed or cancelled RFQ';
 end if;
 perform 1 from public.proc_suppliers where id=p_supplier_id and active=true for share;
 if not found then raise exception 'Invalid or inactive supplier'; end if;

 select * into invitation from public.proc_rfq_suppliers
 where rfq_id=p_rfq_id and supplier_id=p_supplier_id;
 if invitation.id is not null then
  return jsonb_build_object('invitation',to_jsonb(invitation),'rfq_status',rfq.status,'added',false);
 end if;
 if not exists(select 1 from public.proc_rfq_items where rfq_id=p_rfq_id) then
  raise exception 'RFQ has no items';
 end if;
 if exists(select 1 from public.proc_supplier_scopes where supplier_id=p_supplier_id)
 and not exists(
  select 1 from public.proc_rfq_items ri
  join public.proc_requirements rr on rr.id=ri.requirement_id
  join public.proc_items i on i.id=rr.item_id
  join public.proc_supplier_scopes sc on sc.supplier_id=p_supplier_id
  where ri.rfq_id=p_rfq_id and (
   (sc.scope_type='item' and sc.item_id=i.id)
   or (sc.scope_type='category' and sc.scope_value=i.category)
   or (sc.scope_type='main_group' and sc.scope_value=i.main_group)
   or (sc.scope_type='subgroup' and sc.scope_value=i.subgroup)
  )
 ) and reason is null then
  raise exception 'Supplier does not cover any RFQ item. Enter a coverage override reason or choose another supplier.';
 end if;

 insert into public.proc_rfq_suppliers(rfq_id,supplier_id,status,scope_override_reason)
 values(p_rfq_id,p_supplier_id,'pending',reason) returning * into invitation;
 update public.proc_rfqs set status=case when status='quoted' then 'partially_quoted' else status end,
 updated_at=now() where id=p_rfq_id returning * into rfq;
 return jsonb_build_object('invitation',to_jsonb(invitation),'rfq_status',rfq.status,'added',true);
end
$function$;
revoke all on function public.proc_add_rfq_supplier_v1(uuid,uuid,text) from public,anon;
grant execute on function public.proc_add_rfq_supplier_v1(uuid,uuid,text) to authenticated;
