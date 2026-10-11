-- Run only after the migration. Every change is rolled back, including the reset.
begin;
set local statement_timeout='30s';
do $test$
<<admin_data_management>>
declare admin_id uuid; preview jsonb; after_preview jsonb; original_items bigint; denied boolean:=false; item_id uuid:=gen_random_uuid(); item_code text:='RESET-TEST-'||gen_random_uuid(); supplier_id uuid:=gen_random_uuid(); loc uuid; req_id uuid:=gen_random_uuid(); po_id uuid:=gen_random_uuid(); po_no text:='RESET-PO-'||gen_random_uuid();
begin
 select id into strict admin_id from public.proc_profiles where active and role_key='admin' limit 1;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 select count(*) into original_items from public.proc_items;
 preview:=public.proc_admin_reset_preview_v1('full');
 begin
  perform public.proc_admin_reset_data_v1('full',preview->>'token','WRONG','Transactional test');
 exception when others then denied:=true;end;
 if not denied then raise exception 'Wrong confirmation accepted';end if;
 begin
  perform public.proc_admin_reset_data_v1('full',preview->>'token','CLEAR FULL','Transactional rollback test');
  after_preview:=public.proc_admin_reset_preview_v1('full');
  if exists(select 1 from jsonb_each_text(after_preview->'counts') c where c.value::bigint<>0) then raise exception 'Full reset left operational rows';end if;
  if (select count(*) from public.proc_items)<>original_items then raise exception 'Reset removed item catalogue';end if;
  raise exception using errcode='P1001',message='Rollback successful test reset';
 exception when sqlstate 'P1001' then null;end;
 if public.proc_admin_reset_preview_v1('full')<>preview then raise exception 'Rollback did not restore records';end if;
 insert into public.proc_items(id,item_code,category,description,uom,max_stock,movement) values(item_id,item_code,'GENERAL','Reset deletion test','PCS',0,'SLOW');
 loc:=private.proc_default_location_id();
 insert into public.proc_stock_balances(item_id,location_id,qty) values(item_id,loc,5);
 denied:=false;
 begin perform public.proc_admin_delete_item_v1(item_id,item_code);exception when others then denied:=true;end;
 if not denied then raise exception 'Nonzero-stock item deleted';end if;
 preview:=public.proc_admin_reset_preview_v1('stock');
 begin
  perform public.proc_admin_reset_data_v1('stock',preview->>'token','CLEAR STOCK','Transactional stock test');
  if exists(select 1 from public.proc_stock_balances where qty<>0) then raise exception 'Stock reset left quantities';end if;
  if not exists(select 1 from public.proc_stock_ledger sl where sl.item_id=admin_data_management.item_id and txn_type='ADJUSTMENT' and qty_delta=-5) then raise exception 'Stock adjustment not recorded';end if;
  raise exception using errcode='P1001',message='Rollback stock test';
 exception when sqlstate 'P1001' then null;end;
 delete from public.proc_stock_balances b where b.item_id=admin_data_management.item_id;
 insert into public.proc_suppliers(id,supplier_code,name) values(supplier_id,'RESET-SUP-'||supplier_id,'Reset test supplier');
 insert into public.proc_requirements(id,requirement_no,item_id,location_id,required_qty,adjusted_qty,ordered_qty,status,approval_status,created_by,source_type) values(req_id,'RESET-REQ-'||req_id,item_id,loc,10,10,10,'ordered','approved',admin_id,'manual');
 insert into public.proc_purchase_orders(id,po_no,supplier_id,status,subtotal,total,created_by) values(po_id,po_no,supplier_id,'sent',100,100,admin_id);
 insert into public.proc_po_lines(po_id,requirement_id,item_id,qty,unit_price) values(po_id,req_id,item_id,10,10);
 denied:=false;
 begin perform public.proc_admin_delete_item_v1(item_id,item_code);exception when others then denied:=true;end;
 if not denied then raise exception 'Referenced item deleted';end if;
 perform public.proc_admin_clear_po_v1(po_id,po_no,'Transactional order test');
 if exists(select 1 from public.proc_purchase_orders where id=admin_data_management.po_id) then raise exception 'Order not cleared';end if;
 if (select ordered_qty from public.proc_requirements where id=req_id)<>0 then raise exception 'Order commitment not released';end if;
 delete from public.proc_requirements where id=req_id;
 perform public.proc_admin_delete_item_v1(item_id,item_code);
 if exists(select 1 from public.proc_items where id=item_id) then raise exception 'Unused item deletion failed';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 denied:=false;
 begin perform public.proc_admin_reset_preview_v1('full');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Non-admin can preview reset';end if;
 raise notice 'PASS confirmation, full reset, item preservation, rollback, item deletion and non-admin boundary';
end $test$;
rollback;
