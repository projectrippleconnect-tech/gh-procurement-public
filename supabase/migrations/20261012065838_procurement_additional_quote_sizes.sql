-- Explicitly requested additional sizes use ordinary item/requirement/RFQ/quote
-- records, so award review, PO exports, receiving and invoices retain the size.
create function public.proc_save_quote_with_sizes_v1(
 p_rfq_id uuid,p_supplier_id uuid,p_quote_ref text,p_lines jsonb,p_additional_sizes jsonb,
 p_valid_until date default null,p_attachment_path text default null,p_notes text default null,
 p_freight_total numeric default 0,p_minimum_order_value numeric default 0
) returns jsonb language plpgsql security invoker set search_path='' set timezone='Asia/Colombo' as $fn$
declare
 caller uuid:=auth.uid(); caller_role text; rfq_status text; x jsonb;
 parent public.proc_items; req public.proc_requirements; ri public.proc_rfq_items;
 item_uuid uuid; req_uuid uuid; ri_uuid uuid; new_uuid uuid;
 size_v text; qty_v numeric; price_v numeric; key_v text; found_count integer;
 lines_v jsonb:=p_lines; added integer:=0;
begin
 if caller is null then raise exception 'Not authenticated'; end if;
 select role into caller_role from public.proc_profiles where id=caller and active;
 if caller_role is null or caller_role not in ('admin','procurement') then raise exception 'Not authorized'; end if;
 perform private.proc_assert_permission('procurement.rfq.manage');
 perform private.proc_assert_permission('procurement.requirements.manage');
 select status into rfq_status from public.proc_rfqs where id=p_rfq_id for update;
 if rfq_status is null or rfq_status not in ('draft','prepared','sent','partially_quoted','quoted') then raise exception 'Cannot add sizes to a missing, awarded or closed RFQ'; end if;
 if not exists(select 1 from public.proc_rfq_suppliers where rfq_id=p_rfq_id and supplier_id=p_supplier_id and status<>'declined') then raise exception 'Supplier is not invited to this RFQ'; end if;
 if p_additional_sizes is null or jsonb_typeof(p_additional_sizes)<>'array' or jsonb_array_length(p_additional_sizes) not between 1 and 120 then raise exception 'Provide 1 to 120 additional size lines'; end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' then raise exception 'Quote lines must be an array'; end if;
 for x in select * from jsonb_array_elements(p_additional_sizes) loop
  size_v:=trim(coalesce(x->>'size','')); qty_v:=(x->>'qty')::numeric; price_v:=(x->>'unit_price')::numeric;
  if size_v='' or length(size_v)>100 or length(coalesce(x->>'remarks',''))>300 then raise exception 'Each size needs a valid size and remarks of at most 300 characters'; end if;
  if qty_v is null or qty_v::text in ('NaN','Infinity','-Infinity') or qty_v<=0 or price_v is null or price_v::text in ('NaN','Infinity','-Infinity') or price_v<0 then raise exception 'Size quantity must be positive and price must be zero or positive'; end if;
  select * into ri from public.proc_rfq_items where id=(x->>'source_rfq_item_id')::uuid and rfq_id=p_rfq_id;
  if ri.id is null then raise exception 'Additional size source does not belong to this RFQ'; end if;
  select * into req from public.proc_requirements where id=ri.requirement_id;
  select * into parent from public.proc_items where id=req.item_id and active;
  if parent.id is null then raise exception 'Source item is not active'; end if;
  if lower(trim(coalesce(parent.size,'')))=lower(size_v) then raise exception 'This is the existing size. Edit its quantity in order review instead'; end if;
  -- Serialize catalogue lookups across RFQs. Reuse exact existing identities.
  key_v:=parent.category||'|'||lower(trim(parent.description))||'|'||lower(size_v)||'|'||parent.uom||'|'||lower(trim(coalesce(parent.brand,'')));
  perform pg_advisory_xact_lock(hashtextextended(key_v,0));
  select count(*) into found_count from public.proc_items i where i.active and i.category=parent.category and lower(trim(i.description))=lower(trim(parent.description)) and lower(trim(coalesce(i.size,'')))=lower(size_v) and i.uom=parent.uom and lower(trim(coalesce(i.brand,'')))=lower(trim(coalesce(parent.brand,'')));
  if found_count>1 then raise exception 'More than one existing item matches this size. Resolve duplicate catalogue items first'; end if;
  item_uuid:=null;
  select i.id into item_uuid from public.proc_items i where i.active and i.category=parent.category and lower(trim(i.description))=lower(trim(parent.description)) and lower(trim(coalesce(i.size,'')))=lower(size_v) and i.uom=parent.uom and lower(trim(coalesce(i.brand,'')))=lower(trim(coalesce(parent.brand,'')));
  if item_uuid is null then
   perform private.proc_assert_permission('items.edit');
   new_uuid:=gen_random_uuid();
   insert into public.proc_items(id,item_code,category,description,main_group,subgroup,size,uom,movement,brand,source)
   values(new_uuid,'SIZE-'||replace(new_uuid::text,'-',''),parent.category,parent.description,parent.main_group,parent.subgroup,size_v,parent.uom,parent.movement,parent.brand,'Additional RFQ size');
   item_uuid:=new_uuid;
  end if;
  ri_uuid:=null;
  select i.id into ri_uuid from public.proc_rfq_items i join public.proc_requirements r on r.id=i.requirement_id where i.rfq_id=p_rfq_id and r.item_id=item_uuid;
  if ri_uuid is null then
   req_uuid:=gen_random_uuid();
   insert into public.proc_requirements(id,requirement_no,item_id,location_id,required_qty,adjusted_qty,status,source_type,request_reason,notes,created_by)
   values(req_uuid,'REQ-SIZE-'||replace(req_uuid::text,'-',''),item_uuid,req.location_id,qty_v,qty_v,'quoting','manual','manual_extra',nullif(x->>'remarks',''),caller);
   -- Use the existing permission-checked review operation, preserving audit logs.
   perform public.proc_review_requirements(array[req_uuid],'approve',true,'Additional size selected during supplier price entry');
   insert into public.proc_rfq_items(rfq_id,requirement_id,requested_qty) values(p_rfq_id,req_uuid,qty_v) returning id into ri_uuid;
  elsif not exists(select 1 from public.proc_rfq_items i join public.proc_requirements r on r.id=i.requirement_id where i.id=ri_uuid and i.requested_qty=qty_v and r.ordered_qty=0 and r.received_qty=0) then
   raise exception 'This size already has a different required quantity. Edit the existing line instead of adding it again';
  end if;
  if exists(select 1 from jsonb_array_elements(lines_v) a where (a->>'rfq_item_id')::uuid=ri_uuid) then raise exception 'This size already has a price line. Edit the existing line instead of adding it again'; end if;
  lines_v:=lines_v||jsonb_build_array(jsonb_build_object('rfq_item_id',ri_uuid,'unit_price',price_v,'notes',nullif(x->>'remarks',''),'order_multiple',case when mod(qty_v,1)=0 then 1 else 0.001 end));
  added:=added+1;
 end loop;
 -- The existing save operation remains responsible for quotes, status and guards.
 -- Any failure rolls back all added items/requirements and the quote together.
 return public.proc_save_quote_v3(p_rfq_id,p_supplier_id,p_quote_ref,lines_v,p_valid_until,p_attachment_path,p_notes,p_freight_total,p_minimum_order_value)||jsonb_build_object('additional_size_count',added);
end $fn$;
revoke all on function public.proc_save_quote_with_sizes_v1(uuid,uuid,text,jsonb,jsonb,date,text,text,numeric,numeric) from public,anon;
grant execute on function public.proc_save_quote_with_sizes_v1(uuid,uuid,text,jsonb,jsonb,date,text,text,numeric,numeric) to authenticated;
