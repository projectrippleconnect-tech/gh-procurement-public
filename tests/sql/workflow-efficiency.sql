-- Transactional fixtures only. Every item, PO and receipt is rolled back.
begin;
set local statement_timeout='30s';
create temporary table efficiency_results(check_name text,passed boolean);
grant insert,select on efficiency_results to authenticated;
do $test$
<<workflow_efficiency>>
declare admin_id uuid; item_id uuid:=gen_random_uuid(); supplier_id uuid:=gen_random_uuid(); req_id uuid; po_id uuid; line_id uuid; case_id uuid; loc uuid; failure text; result jsonb; i integer;
begin
 select id into strict admin_id from public.proc_profiles where active and role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 loc:=private.proc_default_location_id();
 insert into public.proc_items(id,item_code,category,description,uom,max_stock,reorder_level,movement) values(item_id,'EFF-'||item_id,'GENERAL','Efficiency fixture','PCS',100,50,'FAST');
 insert into public.proc_suppliers(id,supplier_code,name,phone) values(supplier_id,'EFF-'||supplier_id,'Efficiency fixture supplier','+94770000000');
 for i in 1..2 loop
  insert into public.proc_requirements(requirement_no,item_id,location_id,required_qty,adjusted_qty,ordered_qty,status,approval_status,created_by,source_type) values('EFF-'||gen_random_uuid(),item_id,loc,100,100,100,'ordered','approved',admin_id,'manual') returning id into req_id;
  insert into public.proc_purchase_orders(po_no,supplier_id,status,subtotal,total,created_by) values('EFF-'||gen_random_uuid(),supplier_id,'sent',10000,10000,admin_id) returning id into po_id;
  insert into public.proc_po_lines(po_id,requirement_id,item_id,qty,unit_price) values(po_id,req_id,item_id,100,100) returning id into line_id;
  execute 'set local role authenticated';
  result:=public.proc_receive_po_v3(po_id,gen_random_uuid(),jsonb_build_array(jsonb_build_object('po_line_id',line_id,'received_qty',60,'accepted_qty',55,'rejected_qty',5,'rejection_reason','Damage')));
  select c.id into strict case_id from public.proc_rejection_cases c where c.po_id=workflow_efficiency.po_id;
  failure:=null;
  begin perform public.proc_release_po_balance_v1(line_id,'buy_elsewhere','Supplier shortage');exception when others then failure:=sqlerrm;end;
  if failure is null or failure not like '%Resolve rejected goods%' then raise exception 'Unresolved rejection balance released: %',failure;end if;
  perform public.proc_resolve_rejection_case_v1(case_id,'replacement_received',null,'EFF-REPLACEMENT');
  if (select received_qty from public.proc_requirements where id=req_id)<>60 then raise exception 'Replacement did not update requirement';end if;
  if (select count(*) from public.proc_grns where receipt_key=case_id and status='posted')<>1 then raise exception 'Replacement missing its receipt';end if;
  failure:=null;
  begin perform public.proc_resolve_rejection_case_v1(case_id,'replacement_received');exception when others then failure:=sqlerrm;end;
  if failure is null then raise exception 'Replacement posted twice';end if;
  result:=public.proc_release_po_balance_v1(line_id,case when i=1 then 'buy_elsewhere' else 'cancel' end,'Supplier cannot fulfil remaining balance');
  if (result->>'released_qty')::numeric<>40 then raise exception 'Wrong release quantity';end if;
  if (select qty from public.proc_po_lines where id=line_id)<>100 or (select total from public.proc_purchase_orders where id=po_id)<>10000 then raise exception 'Original order values overwritten';end if;
  if (select cancelled_qty from public.proc_po_lines where id=line_id)<>40 then raise exception 'Cancelled balance missing';end if;
  if (select ordered_qty from public.proc_requirements where id=req_id)<>60 then raise exception 'Purchase commitment not released';end if;
  if (select remaining_to_order from public.proc_v_requirements where id=req_id)<>(case when i=1 then 40 else 0 end) then raise exception 'Wrong remaining purchase need';end if;
  if (select ordered_not_received from public.proc_v_requirements where id=req_id)<>0 then raise exception 'Released order still awaits delivery';end if;
  if (select status from public.proc_purchase_orders where id=po_id)<>'closed' then raise exception 'Fulfilled/released PO not closed';end if;
  failure:=null;
  begin update public.proc_po_lines set cancelled_qty=0 where id=line_id;exception when others then failure:=sqlerrm;end;
  if failure is null then raise exception 'Direct cancelled balance edit bypassed audit';end if;
  insert into efficiency_results values(case when i=1 then 'Replacement receipt, duplicate protection, audited rebuy and preserved PO' else 'Cancel balance completes need without phantom deliveries' end,true);
  execute 'reset role';
 end loop;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 execute 'set local role authenticated';
 failure:=null;
 begin perform public.proc_release_po_balance_v1(line_id,'buy_elsewhere','Unauthorized');exception when others then failure:=sqlerrm;end;
 if failure is null or failure not like '%Permission denied%' then raise exception 'Missing profile released balance';end if;
 if exists(select 1 from public.proc_po_balance_actions) then raise exception 'Missing profile read balance history';end if;
 insert into efficiency_results values('Unauthorized release and audit reads denied',true);
 execute 'reset role';
end $test$;
select * from efficiency_results;
rollback;
