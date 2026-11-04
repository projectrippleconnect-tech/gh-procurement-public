begin;
do $test$
declare principal uuid; item uuid:=gen_random_uuid(); supplier uuid:=gen_random_uuid(); po uuid:=gen_random_uuid(); old_po uuid:=gen_random_uuid(); req uuid:=gen_random_uuid();
begin
 select id into strict principal from public.proc_profiles where role_key='admin' and active limit 1;
 perform set_config('request.jwt.claim.sub',principal::text,true);
 insert into public.proc_items(id,item_code,category,description,uom,max_stock,reorder_level,movement) values(item,'RECENCY-'||item,'GENERAL','Recency QA','PCS',10,5,'FAST');
 insert into public.proc_suppliers(id,supplier_code,name) values(supplier,'RECENCY-'||supplier,'Recency QA supplier');
 insert into public.proc_purchase_orders(id,po_no,supplier_id,status,po_date) values(po,'RECENCY-'||po,supplier,'approved',current_date),(old_po,'RECENCY-'||old_po,supplier,'sent',(now() AT TIME ZONE 'Asia/Colombo')::date-100);
 insert into public.proc_requirements(id,requirement_no,item_id,location_id,required_qty,adjusted_qty,source_type,status,approval_status) values(req,'RECENCY-'||req,item,private.proc_default_location_id(),10,10,'manual','open','approved');
 insert into public.proc_po_lines(po_id,requirement_id,item_id,qty,unit_price) values(po,req,item,1,100);
 assert (select never_ordered from public.proc_v_item_order_recency where item_id=item),'Approved unsent PO counted as actual order';
 insert into public.proc_po_lines(po_id,requirement_id,item_id,qty,unit_price) values(old_po,req,item,1,100);
 assert (select days_since_order=100 from public.proc_v_item_order_recency where item_id=item),'Historic sent order date missing';
 update public.proc_purchase_orders set status='cancelled' where id=old_po;
 assert (select never_ordered from public.proc_v_item_order_recency where item_id=item),'Cancelled PO counted as actual order';
 assert (select reloptions @> array['security_invoker=true'] from pg_class where oid='public.proc_v_item_order_recency'::regclass),'View bypasses caller RLS';
 assert not has_table_privilege('anon','public.proc_v_item_order_recency','select'),'Anonymous report exposed';
 -- A stock handler cannot see procurement history through the report.
 perform set_config('request.jwt.claim.role','service_role',true);
 update public.proc_profiles set role_key='stock_handler',role='stock_handler' where id=principal;
 perform set_config('request.jwt.claim.role','authenticated',true);
 execute 'set local role authenticated';
 assert not exists(select 1 from public.proc_v_item_order_recency),'Stock handler can read order history';
end $test$;
reset role;
rollback;
