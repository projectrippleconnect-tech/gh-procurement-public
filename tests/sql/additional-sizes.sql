-- Fully rolled back: no fixture records, POs, stock or audit rows are retained.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.proc_profiles where active and role='admin' order by created_at limit 1),true);
select set_config('request.jwt.claim.role','authenticated',true);
do $test$
declare
 item_id_v uuid:=gen_random_uuid(); req_id_v uuid:=gen_random_uuid(); rfq_id_v uuid:=gen_random_uuid(); ri_id_v uuid:=gen_random_uuid(); supplier_v uuid;
 result jsonb; sizes jsonb; base_lines jsonb; added_id uuid; count_before integer; plan jsonb; orders jsonb;
begin
 select id into supplier_v from public.proc_suppliers where active limit 1;
 if supplier_v is null then
  supplier_v:=gen_random_uuid();
  insert into public.proc_suppliers(id,supplier_code,name) values(supplier_v,'QA-SIZE-'||supplier_v,'Isolated size supplier');
 end if;
 insert into public.proc_items(id,item_code,description,size,category,uom,source) values(item_id_v,'TEST-'||item_id_v::text,'Rolled-back cycle lock test '||item_id_v::text,'1.5 ft','GENERAL','PCS','TEST');
 insert into public.proc_requirements(id,requirement_no,item_id,location_id,required_qty,adjusted_qty) values(req_id_v,'TEST-'||req_id_v::text,item_id_v,(select id from public.proc_locations where active limit 1),12,12);
 perform public.proc_review_requirements(array[req_id_v],'approve',true,null);
 insert into public.proc_rfqs(id,rfq_no,status,due_date) values(rfq_id_v,'TEST-'||rfq_id_v::text,'prepared',current_date+10);
 insert into public.proc_rfq_items(id,rfq_id,requirement_id,requested_qty) values(ri_id_v,rfq_id_v,req_id_v,12);
 insert into public.proc_rfq_suppliers(rfq_id,supplier_id) values(rfq_id_v,supplier_v);
 execute 'set local role authenticated';
 sizes:=jsonb_build_array(jsonb_build_object('source_rfq_item_id',ri_id_v,'size','2 ft','unit_price',40,'qty',6));
 base_lines:=jsonb_build_array(jsonb_build_object('rfq_item_id',ri_id_v,'unit_price',36));
 result:=public.proc_save_quote_with_sizes_v1(rfq_id_v,supplier_v,null,base_lines,sizes);
 assert (result->>'additional_size_count')::integer=1,'Must add one size';
 select ri.id into added_id from public.proc_rfq_items ri join public.proc_requirements r on r.id=ri.requirement_id join public.proc_items i on i.id=r.item_id where ri.rfq_id=rfq_id_v and i.size='2 ft';
 assert added_id is not null,'New size needs its own RFQ item';
 assert exists(select 1 from public.proc_v_quote_comparison where rfq_item_id=added_id and unit_price=40),'Additional size needs comparison price';
 assert (select count(*) from public.proc_rfq_items where rfq_id=rfq_id_v)=2,'Original and added size separate';
 result:=public.proc_save_quote_with_sizes_v1(rfq_id_v,supplier_v,null,base_lines,sizes);
 assert (select count(*) from public.proc_rfq_items where rfq_id=rfq_id_v)=2,'Repeat save must not duplicate size';
 select count(*) into count_before from public.proc_items;
 begin
  perform public.proc_save_quote_with_sizes_v1(rfq_id_v,supplier_v,null,base_lines,jsonb_build_array(jsonb_build_object('source_rfq_item_id',ri_id_v,'size','3 ft','unit_price',50,'qty',6),jsonb_build_object('source_rfq_item_id',ri_id_v,'size','4 ft','unit_price',50,'qty',0)));
  raise exception 'TEST: invalid quantity unexpectedly accepted';
 exception when others then
  if sqlerrm like 'TEST:%' then raise; end if;
 end;
 assert (select count(*) from public.proc_items)=count_before,'Failure must roll back first added size';
 select jsonb_agg(jsonb_build_object('rfq_item_id',v.rfq_item_id,'quote_line_id',v.quote_line_id,'qty',ri.requested_qty)) into plan from public.proc_v_quote_comparison v join public.proc_rfq_items ri on ri.id=v.rfq_item_id where v.rfq_id=rfq_id_v;
 orders:=public.proc_finalize_award_plan_v2(rfq_id_v,plan);
 assert exists(select 1 from public.proc_po_lines pl join public.proc_items i on i.id=pl.item_id where pl.po_id=(orders->0->>'po_id')::uuid and i.size='2 ft' and pl.qty=6 and pl.unit_price=40 and pl.line_total=240),'PO must contain 2 ft, six pieces, Rs 40 = Rs 240';
 assert (select count(*) from public.proc_po_lines where po_id=(orders->0->>'po_id')::uuid)=2,'Both original and added size on supplier PO';
 begin
  perform public.proc_save_quote_with_sizes_v1(rfq_id_v,supplier_v,null,base_lines,sizes);
  raise exception 'TEST: awarded RFQ unexpectedly editable';
 exception when others then if sqlerrm like 'TEST:%' then raise; end if; end;
end $test$;
rollback;
select 'PASS: authenticated save, repeat-save dedupe, atomic rollback, actual PO size/quantity/price/total and awarded guard' result;
