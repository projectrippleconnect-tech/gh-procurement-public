-- Synthetic fixtures for disposable QA only; this file is never a migration.
create function private.qa_portal_fixture(p_daily numeric default 1000000,p_available numeric default 10) returns jsonb language plpgsql as $$
declare admin_v uuid:='00000000-0000-4000-8000-000000000111'; item_v uuid:=gen_random_uuid(); supplier_v uuid:=gen_random_uuid(); req_v uuid:=gen_random_uuid(); rfq_v uuid:=gen_random_uuid(); ri_v uuid:=gen_random_uuid(); inv_v uuid:=gen_random_uuid(); round_v uuid; token_v text:=encode(extensions.gen_random_bytes(32),'hex'); payload jsonb;
begin
 perform set_config('request.jwt.claim.sub',admin_v::text,true);perform set_config('request.jwt.claim.role','authenticated',true);
 insert into public.proc_items(id,item_code,category,description,uom,max_stock,reorder_level,movement) values(item_v,'QA-'||item_v,'GENERAL','Isolated concurrency item','PCS',20,10,'FAST');
 insert into public.proc_suppliers(id,supplier_code,name,whatsapp,active) values(supplier_v,'QA-'||supplier_v,'Isolated QA supplier','0771234567',true);
 insert into public.proc_requirements(id,requirement_no,item_id,location_id,required_qty,adjusted_qty,created_by,source_type) values(req_v,'QA-'||req_v,item_v,private.proc_default_location_id(),10,10,admin_v,'manual');
 update public.proc_requirements set approval_status='approved',selected_for_order=true,approved_by=admin_v,approved_at=now() where id=req_v;
 insert into public.proc_rfqs(id,rfq_no,status,created_by) values(rfq_v,'QA-'||rfq_v,'prepared',admin_v);
 insert into public.proc_rfq_items(id,rfq_id,requirement_id,requested_qty) values(ri_v,rfq_v,req_v,10);
 insert into public.proc_rfq_suppliers(id,rfq_id,supplier_id,requested_item_ids) values(inv_v,rfq_v,supplier_v,array[ri_v]);
 round_v:=public.proc_portal_start_round_v1(rfq_v,least(10000,p_daily),p_daily,1000,14);
 perform public.proc_portal_issue_link_v1(inv_v,encode(extensions.digest(token_v,'sha256'),'hex'),6);
 payload:=jsonb_build_array(jsonb_build_object('id',ri_v,'status','in_stock','price','50','quantity',p_available::text,'variations','[]'::jsonb,'discount','0','tax','0','freight_unit','0','moq','0','multiple','1','lead_days','2','valid_until',(clock_timestamp() at time zone 'Asia/Colombo')::date+2,'uom','PCS','terms_confirmed',true));
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claim.role','anon',true);
 perform public.proc_portal_submit_v1(token_v,payload,0,true);
 return jsonb_build_object('round',round_v,'rfq',rfq_v,'requirement',req_v,'item',ri_v,'token',token_v,'payload',payload);
end $$;
