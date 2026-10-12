-- Explicitly reviewed additional sizes are separate requirements and PO lines.
create or replace function private.proc_finalize_award_with_variations_v1(p_rfq_id uuid,p_allocations jsonb,p_variations jsonb default '[]')
returns jsonb language plpgsql security definer set search_path='' set timezone='Asia/Colombo' as $$
declare result jsonb; x jsonb; v jsonb; ql public.proc_quote_lines; q public.proc_quotes;
 base public.proc_items; req public.proc_requirements; iid uuid; rid uuid; pid uuid; n numeric; price numeric; size_v text; idx integer; po_rec record; seen text[]:='{}'; key_v text;
begin
 perform private.proc_assert_permission('procurement.orders.create');
 if auth.uid() is null then raise exception 'Not authenticated'; end if;
 if jsonb_typeof(p_variations)<>'array' or jsonb_array_length(p_variations)>1200 then raise exception 'Invalid variations'; end if;
 -- Lock quote notes before award; quantities and prices come from the saved quote, never the client.
 for x in select * from jsonb_array_elements(p_variations) loop
  select l.* into ql from public.proc_quote_lines l join public.proc_quotes quote_rec on quote_rec.id=l.quote_id where l.id=(x->>'quote_line_id')::uuid and quote_rec.rfq_id=p_rfq_id for update of l;
  if ql.id is null or not exists(select 1 from jsonb_array_elements(p_allocations) a where a->>'quote_line_id'=ql.id::text) then raise exception 'Variation must belong to an awarded quotation'; end if;
  idx:=(x->>'variant_index')::integer;
  key_v:=ql.id::text||':'||idx;
  if idx is null or idx<0 or idx>=12 or key_v=any(seen) then raise exception 'Invalid or duplicate variation'; end if;
  seen:=array_append(seen,key_v);
  if left(coalesce(ql.notes,''),18)<>'GH_QUOTE_NOTES_V1:' then raise exception 'Saved size variation required'; end if;
  v:=substring(ql.notes from 19)::jsonb->'variants'->idx;
  n:=(v->>'quantity')::numeric; price:=(v->>'price')::numeric; size_v:=trim(v->>'size');
  if n is null or n<=0 or n::text in ('NaN','Infinity','-Infinity') or price is null or price<0 or price::text in ('NaN','Infinity','-Infinity') or coalesce(length(size_v),0)=0 or length(size_v)>100 then raise exception 'Variation needs size, positive quantity and valid price'; end if;
 end loop;
 result:=public.proc_finalize_award_plan_v2(p_rfq_id,p_allocations);
 for x in select * from jsonb_array_elements(p_variations) loop
  select * into ql from public.proc_quote_lines where id=(x->>'quote_line_id')::uuid;
  select * into q from public.proc_quotes where id=ql.quote_id;
  select r.* into req from public.proc_requirements r join public.proc_rfq_items i on i.requirement_id=r.id where i.id=ql.rfq_item_id;
  select * into base from public.proc_items where id=req.item_id;
  v:=substring(ql.notes from 19)::jsonb->'variants'->((x->>'variant_index')::integer);
  n:=(v->>'quantity')::numeric; price:=(v->>'price')::numeric; size_v:=trim(v->>'size');
  select (a->>'po_id')::uuid into pid from jsonb_array_elements(result) a where a->>'supplier_id'=q.supplier_id::text;
  if pid is null then raise exception 'Supplier PO not found'; end if;
  -- Reuse an exact existing size to preserve stock and receiving identity.
  select id into iid from public.proc_items where active and description=base.description and category=base.category and uom=base.uom and coalesce(brand,'')=coalesce(base.brand,'') and lower(trim(coalesce(size,'')))=lower(size_v) order by id limit 1;
  if iid is null then
   iid:=gen_random_uuid();
   insert into public.proc_items(id,item_code,category,description,size,uom,brand,main_group,subgroup,source)
   values(iid,'VAR-'||iid,base.category,base.description,size_v,base.uom,base.brand,base.main_group,base.subgroup,'Supplier size variation');
  end if;
  rid:=gen_random_uuid();
  insert into public.proc_requirements(id,requirement_no,item_id,location_id,required_qty,adjusted_qty,ordered_qty,status,approval_status,selected_for_order,approved_by,approved_at,created_by,source_type,request_reason,notes)
  values(rid,'VAR-'||rid,iid,req.location_id,n,n,n,'ordered','approved',true,auth.uid(),now(),auth.uid(),'manual','manual_extra','Additional size from RFQ '||p_rfq_id||'; supplier quote '||ql.id||'; '||coalesce(v->>'remarks',''));
  insert into public.proc_po_lines(po_id,requirement_id,item_id,qty,unit_price,landed_unit_cost)
  values(pid,rid,iid,n,price,price);
 end loop;
 for po_rec in select (a->>'po_id')::uuid id from jsonb_array_elements(result) a loop
  update public.proc_purchase_orders p set subtotal=t.subtotal,tax_total=t.tax,total=t.goods+coalesce(p.freight_total,0),updated_at=now()
  from (select sum(round(qty*unit_price*(1-discount_percent/100),2)) subtotal,sum(round(qty*unit_price*(1-discount_percent/100)*tax_percent/100,2)) tax,sum(line_total) goods from public.proc_po_lines where po_id=po_rec.id) t where p.id=po_rec.id;
 end loop;
 return (select jsonb_agg(jsonb_build_object('po_id',p.id,'po_no',p.po_no,'supplier_id',p.supplier_id,'subtotal',p.subtotal,'tax_total',p.tax_total,'freight_total',p.freight_total,'total',p.total)) from public.proc_purchase_orders p where p.id in (select (a->>'po_id')::uuid from jsonb_array_elements(result) a));
end $$;
revoke all on function private.proc_finalize_award_with_variations_v1(uuid,jsonb,jsonb) from public,anon;
grant execute on function private.proc_finalize_award_with_variations_v1(uuid,jsonb,jsonb) to authenticated;
create or replace function public.proc_finalize_award_with_variations_v1(p_rfq_id uuid,p_allocations jsonb,p_variations jsonb default '[]')
returns jsonb language sql security invoker set search_path='' as $$ select private.proc_finalize_award_with_variations_v1(p_rfq_id,p_allocations,p_variations) $$;
revoke all on function public.proc_finalize_award_with_variations_v1(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.proc_finalize_award_with_variations_v1(uuid,jsonb,jsonb) to authenticated;
do $settings$ declare admin_id uuid; prior text:=current_setting('request.jwt.claim.sub',true); begin
 select id into admin_id from public.proc_profiles where active and role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 insert into public.proc_field_settings(module_key,field_key,label,enabled,sort_order,required_core) values
 ('rfq','remarks','Remarks',true,18,false),('rfq','size_variations','Additional sizes',true,19,false)
on conflict(module_key,field_key) do nothing;

 perform set_config('request.jwt.claim.sub',coalesce(prior,''),true);
end $settings$;
