-- Run through the Supabase SQL connector. All fixtures and writes are rolled back.
-- Claims use an existing active administrator; no credentials or users are created.
begin;
set local statement_timeout='30s';
create temporary table certification_results(check_name text,passed boolean);
grant insert,select on certification_results to authenticated;
do $test$
declare
 admin_id uuid; a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid();
 sa uuid:=gen_random_uuid(); sb uuid:=gen_random_uuid(); result jsonb;
 count_id uuid; ra uuid; rb uuid; test_rfq_id uuid; ria uuid; rib uuid;
 qa uuid; qb uuid; test_po_id uuid; line_id uuid; receipt_key uuid; replay jsonb; dispatch_id uuid;
 test_item_id uuid; accepted numeric; req_qty numeric; failure text; row_po record;
begin
 select id into strict admin_id from public.proc_profiles where active and role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 insert into public.proc_items(id,item_code,category,description,uom,max_stock,reorder_level,movement)
 values(a,'CERT-'||a,'GENERAL','Certification fixture A','PCS',20,10,'FAST'),
       (b,'CERT-'||b,'GENERAL','Certification fixture B','PCS',20,10,'FAST');
 insert into public.proc_suppliers(id,supplier_code,name,phone,whatsapp)
 values(sa,'CERT-'||sa,'Certification Supplier A','+94779792078','+94779792078'),
       (sb,'CERT-'||sb,'Certification Supplier B','+94779792078','+94779792078');

 execute 'set local role authenticated';
 result:=public.proc_submit_stock_and_continue_v3('GENERAL',jsonb_build_array(
  jsonb_build_object('item_id',a,'current_stock',10),jsonb_build_object('item_id',b,'current_stock',10)));
 count_id:=(result->>'count_id')::uuid;
 if result#>>'{automation,status}'<>'review_required' then raise exception 'Stock did not stop for review'; end if;
 select id into strict ra from public.proc_requirements where item_id=a;
 select id into strict rb from public.proc_requirements where item_id=b;
 if (select count(*) from public.proc_requirements where id in (ra,rb) and adjusted_qty=10 and approval_status='pending_review')<>2 then
  raise exception 'Incorrect shortage quantity or review state';
 end if;
 insert into certification_results values('1: stock count computes shortages and preserves review',true);
 failure:=null;
 begin perform public.proc_create_rfq_v4(array[ra,rb],array[sa,sb]); exception when others then failure:=sqlerrm; end;
 if failure is null or failure not like '%approved%' then raise exception 'Unapproved requirement accepted: %',failure; end if;
 perform public.proc_review_requirements(array[ra,rb],'approve');
 result:=public.proc_create_rfq_v4(array[ra,rb],array[sa,sb],current_date+7);
 test_rfq_id:=(result->>'rfq_id')::uuid;
 if result->>'status'<>'prepared' then raise exception 'RFQ prematurely sent'; end if;
 select id into strict ria from public.proc_rfq_items where rfq_id=test_rfq_id and requirement_id=ra;
 select id into strict rib from public.proc_rfq_items where rfq_id=test_rfq_id and requirement_id=rb;
 result:=public.proc_set_rfq_supplier_items_v1(test_rfq_id,sa,array[ria]);
 if result->'requested_item_ids'<>jsonb_build_array(ria) then raise exception 'Request selection not saved'; end if;
 failure:=null;
 begin perform public.proc_set_rfq_supplier_items_v1(test_rfq_id,sa,array[gen_random_uuid()]); exception when others then failure:=sqlerrm; end;
 if failure is null or failure not like '%does not belong%' then raise exception 'Foreign RFQ item accepted'; end if;
 failure:=null;
 begin perform public.proc_set_rfq_supplier_items_v1(test_rfq_id,sa,'{}'::uuid[]); exception when others then failure:=sqlerrm; end;
 if failure is null then raise exception 'Empty supplier request accepted'; end if;
 insert into certification_results values('supplier requests: selected items saved; foreign and empty selections blocked',true);
 dispatch_id:=public.proc_whatsapp_claim_dispatch(test_rfq_id,sa,'default',repeat('a',64),'Certification fixture; no gateway called');
 failure:=null;
 begin perform public.proc_whatsapp_claim_dispatch(test_rfq_id,sa,'default',repeat('a',64),'Duplicate fixture');
 exception when unique_violation then failure:=sqlerrm; end;
 if failure is null then raise exception 'Duplicate dispatch claim allowed'; end if;
 if not public.proc_whatsapp_finish_dispatch(dispatch_id,'accepted','fixture-message',null) then raise exception 'Dispatch audit did not finish'; end if;
 if public.proc_whatsapp_finish_dispatch(dispatch_id,'accepted','fixture-message',null) then raise exception 'Completed dispatch overwritten'; end if;
 insert into certification_results values('security: atomic dispatch claim, duplicate block and immutable completion',true);
 perform public.proc_mark_rfq_supplier_sent_v1(test_rfq_id,sa);
 perform public.proc_mark_rfq_supplier_sent_v1(test_rfq_id,sb);
 failure:=null;
 begin perform public.proc_set_rfq_supplier_items_v1(test_rfq_id,sa,array[rib]); exception when others then failure:=sqlerrm; end;
 if failure is null or failure not like '%already sent%' then raise exception 'Sent request changed'; end if;
 insert into certification_results values('2: approval, prepared RFQ and explicit sent confirmation',true);

 execute 'reset role';
 update public.proc_rfqs set status='cancelled' where id=test_rfq_id;
 execute 'set local role authenticated';
 failure:=null;
 begin perform public.proc_save_quote_v3(test_rfq_id,sa,'CANCELLED',jsonb_build_array(jsonb_build_object('rfq_item_id',ria,'unit_price',100,'available_qty',10)));
 exception when others then failure:=sqlerrm; end;
 if failure is null or failure not like '%Cannot edit quotations%' then raise exception 'Cancelled RFQ reopened: %',failure; end if;
 execute 'reset role';
 update public.proc_rfqs set status='sent' where id=test_rfq_id;
 execute 'set local role authenticated';
 failure:=null;
 begin perform public.proc_save_quote_v3(test_rfq_id,sa,'NAN',jsonb_build_array(jsonb_build_object('rfq_item_id',ria,'unit_price','NaN','available_qty',10)));
 exception when numeric_value_out_of_range then failure:=sqlerrm; end;
 if failure is null then raise exception 'NaN quotation accepted'; end if;
 insert into certification_results values('security: cancelled RFQ stays closed and non-finite quotes are rejected',true);

 failure:=null;
 begin perform public.proc_finalize_award_plan_v2(test_rfq_id,jsonb_build_array(jsonb_build_object('rfq_item_id',ria,'quote_line_id',gen_random_uuid(),'qty',10))); exception when others then failure:=sqlerrm; end;
 if failure is null or failure not like '%valid supplier quotation is required%' then raise exception 'Unpriced item reached award: %',failure; end if;
 perform public.proc_save_quote_v3(test_rfq_id,sa,'CERT-A',jsonb_build_array(
  jsonb_build_object('rfq_item_id',ria,'unit_price',100,'available_qty',10),
  jsonb_build_object('rfq_item_id',rib,'unit_price',210,'available_qty',10)));
 perform public.proc_save_quote_v3(test_rfq_id,sb,'CERT-B',jsonb_build_array(
  jsonb_build_object('rfq_item_id',rib,'unit_price',200,'available_qty',10)));
 select quote_line_id into strict qa from public.proc_v_quote_comparison where rfq_item_id=ria and landed_rank=1;
 select quote_line_id into strict qb from public.proc_v_quote_comparison where rfq_item_id=rib and landed_rank=1;
 result:=public.proc_finalize_award_plan_v2(test_rfq_id,jsonb_build_array(
  jsonb_build_object('rfq_item_id',ria,'quote_line_id',qa,'qty',10),
  jsonb_build_object('rfq_item_id',rib,'quote_line_id',qb,'qty',10)));
 if jsonb_array_length(result)<>2 then raise exception 'Supplier-wise PO split failed'; end if;
 if (select sum(total) from public.proc_purchase_orders where id in (select (x->>'po_id')::uuid from jsonb_array_elements(result) x))<>3000 then
  raise exception 'Wrong PO totals';
 end if;
 failure:=null;
 begin perform public.proc_finalize_award_plan_v2(test_rfq_id,jsonb_build_array(jsonb_build_object('rfq_item_id',ria,'quote_line_id',qa,'qty',10)));
 exception when others then failure:=sqlerrm; end;
 if failure is null then raise exception 'RFQ awarded twice'; end if;
 if (select open_pos from public.proc_v_dashboard)<>(select count(*) from public.proc_purchase_orders where status in ('pending_approval','approved','sent','partially_received')) then raise exception 'Dashboard open PO count mismatch'; end if;
 failure:=null;
 begin perform public.proc_save_quote_v3(test_rfq_id,sa,'AWARDED',jsonb_build_array(jsonb_build_object('rfq_item_id',ria,'unit_price',1,'available_qty',10)));
 exception when others then failure:=sqlerrm; end;
 if failure is null or failure not like '%Cannot edit quotations%' then raise exception 'Awarded RFQ quotation edit accepted'; end if;
 if (select quote_exception_reason from public.proc_rfqs where id=test_rfq_id) is not null then raise exception 'Single quote required fabricated exception'; end if;
 insert into certification_results values('3: one quote sufficient, partial supplier quotes, best prices, supplier POs, totals and duplicate award blocked',true);

 for row_po in select (x->>'po_id')::uuid as id from jsonb_array_elements(result) x loop
  test_po_id:=row_po.id;
  failure:=null;
  begin perform public.proc_whatsapp_claim_po_dispatch(test_po_id,'default',repeat('b',64),'Unapproved PO fixture');exception when others then failure:=sqlerrm;end;
  if failure is null then raise exception 'Unapproved PO dispatch accepted';end if;
  perform public.proc_approve_po_v2(test_po_id);
  dispatch_id:=public.proc_whatsapp_claim_po_dispatch(test_po_id,'default',repeat('b',64),'PO fixture; no gateway contacted');
  if (select supplier_id from public.proc_whatsapp_po_dispatches where id=dispatch_id)<>(select supplier_id from public.proc_purchase_orders where id=test_po_id)then raise exception 'PO recipient mismatch';end if;
  failure:=null;
  begin perform public.proc_whatsapp_claim_po_dispatch(test_po_id,'default',repeat('b',64),'Duplicate PO fixture');exception when unique_violation then failure:=sqlerrm;end;
  if failure is null then raise exception 'Duplicate PO dispatch accepted';end if;
  if not public.proc_whatsapp_finish_po_dispatch(dispatch_id,'accepted','fixture-po-message',null)then raise exception 'PO audit finish failed';end if;
  if public.proc_whatsapp_finish_po_dispatch(dispatch_id,'unknown',null,'rewrite')then raise exception 'Completed PO audit overwritten';end if;
  insert into certification_results values('PO dispatch: approved-only, saved recipient, unique claim and immutable finish',true);
  perform public.proc_mark_po_sent_v2(test_po_id);
  select id,item_id into strict line_id,test_item_id from public.proc_po_lines where po_id=test_po_id;
  failure:=null;
  begin perform public.proc_receive_po_v3(test_po_id,gen_random_uuid(),jsonb_build_array(
   jsonb_build_object('po_line_id',line_id,'received_qty',1,'accepted_qty',0,'rejected_qty',1)));
  exception when others then failure:=sqlerrm; end;
  if failure is null or failure not like '%rejection reason%' then raise exception 'Unexplained rejection accepted: %',failure; end if;
  failure:=null;
  begin perform public.proc_receive_po_v3(test_po_id,gen_random_uuid(),jsonb_build_array(jsonb_build_object('po_line_id',line_id,'received_qty','NaN','accepted_qty',0,'rejected_qty',0)));
  exception when numeric_value_out_of_range then failure:=sqlerrm; end;
  if failure is null then raise exception 'NaN receiving accepted'; end if;
  failure:=null;
  begin perform public.proc_receive_po_v3(test_po_id,gen_random_uuid(),jsonb_build_array(
   jsonb_build_object('po_line_id',line_id,'received_qty',10,'accepted_qty',10),
   jsonb_build_object('po_line_id',line_id,'received_qty',10,'accepted_qty',10)));
  exception when others then failure:=sqlerrm; end;
  if failure is distinct from 'Each purchase order line may appear only once per receipt' then raise exception 'Duplicate receiving line accepted'; end if;
  failure:=null;
  begin perform public.proc_receive_po_v3(test_po_id,gen_random_uuid(),jsonb_build_array(jsonb_build_object('po_line_id',line_id,'received_qty',11,'accepted_qty',11)));
  exception when others then failure:=sqlerrm; end;
  if failure is null or failure not like '%outstanding ordered%' then raise exception 'Excess receipt accepted'; end if;
  receipt_key:=gen_random_uuid();
  replay:=public.proc_receive_po_v3(test_po_id,receipt_key,jsonb_build_array(
   jsonb_build_object('po_line_id',line_id,'received_qty',10,'accepted_qty',10,'rejected_qty',0)));
  replay:=public.proc_receive_po_v3(test_po_id,receipt_key,jsonb_build_array(
   jsonb_build_object('po_line_id',line_id,'received_qty',10,'accepted_qty',10,'rejected_qty',0)));
  if replay->>'replayed'<>'true' then raise exception 'Receiving replay not idempotent'; end if;
  select qty into strict accepted from public.proc_stock_balances where item_id=test_item_id;
  if accepted<>20 then raise exception 'Stock posted incorrectly: %',accepted; end if;
  failure:=null;
  begin perform public.proc_create_invoice_v4(test_po_id,'DUP-'||test_po_id,jsonb_build_array(
   jsonb_build_object('po_line_id',line_id,'qty',10,'unit_price',100),
   jsonb_build_object('po_line_id',line_id,'qty',10,'unit_price',100)));
  exception when others then failure:=sqlerrm; end;
  if failure is distinct from 'Each purchase order line may appear only once per invoice' then raise exception 'Duplicate invoice line accepted'; end if;
  failure:=null;
  begin perform public.proc_create_invoice_v4(test_po_id,'NAN-'||test_po_id,jsonb_build_array(jsonb_build_object('po_line_id',line_id,'qty',1,'unit_price','NaN')));
  exception when numeric_value_out_of_range then failure:=sqlerrm; end;
  if failure is null then raise exception 'NaN invoice accepted'; end if;
  replay:=public.proc_create_invoice_v4(test_po_id,'CERT-'||test_po_id,jsonb_build_array(
   jsonb_build_object('po_line_id',line_id,'qty',10,'unit_price',case when test_item_id=a then 100 else 200 end)));
  if replay->>'status'<>'matched' then raise exception 'Three-way match failed: %',replay; end if;
 end loop;
 if (select count(*) from public.proc_requirements where id in (ra,rb) and received_qty=10)<>2 then
  raise exception 'Requirements not updated after receiving';
 end if;
 insert into certification_results values('4: approved/sent POs, receiving, stock, replay protection and invoice match',true);

 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 failure:=null;
 begin perform public.proc_create_rfq_v3('{}'::uuid[],'{}'::uuid[]);
 exception when others then failure:=sqlerrm; end;
 if failure is distinct from 'Not authorized' then raise exception 'Missing profile bypassed guard: %',failure; end if;
 if exists(select 1 from public.proc_requirements) then raise exception 'Missing profile bypassed RLS'; end if;
 insert into certification_results values('security: missing profile cannot call privileged RPC or read requirements',true);
 execute 'reset role';
end
$test$;
select * from certification_results order by check_name;
rollback;
