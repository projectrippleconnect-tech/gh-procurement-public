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

 perform public.proc_mark_rfq_supplier_sent_v1(test_rfq_id,sa);
 perform public.proc_save_quote_v3(test_rfq_id,sa,'VAR-TEST',jsonb_build_array(
  jsonb_build_object('rfq_item_id',ria,'unit_price',100,'available_qty',10,'notes','GH_QUOTE_NOTES_V1:{"remarks":"","variants":[{"size":"2 feet","price":"40","quantity":"6","remarks":"extra size"}]}'),
  jsonb_build_object('rfq_item_id',rib,'unit_price',200,'available_qty',10)));
 select l.id into qa from public.proc_quote_lines l join public.proc_quotes q on q.id=l.quote_id where q.rfq_id=test_rfq_id and q.supplier_id=sa and l.rfq_item_id=ria;
 select l.id into qb from public.proc_quote_lines l join public.proc_quotes q on q.id=l.quote_id where q.rfq_id=test_rfq_id and q.supplier_id=sa and l.rfq_item_id=rib;
 failure:=null;
 begin perform public.proc_finalize_award_with_variations_v1(test_rfq_id,jsonb_build_array(jsonb_build_object('rfq_item_id',ria,'quote_line_id',qa,'qty',10),jsonb_build_object('rfq_item_id',rib,'quote_line_id',qb,'qty',10)),jsonb_build_array(jsonb_build_object('quote_line_id',qa,'variant_index',9))); exception when others then failure:=sqlerrm; end;
 if failure is null then raise exception 'Invalid variation accepted'; end if;
 if exists(select 1 from public.proc_purchase_orders where supplier_id=sa) then raise exception 'Invalid variation left a partial PO'; end if;
 result:=public.proc_finalize_award_with_variations_v1(test_rfq_id,jsonb_build_array(jsonb_build_object('rfq_item_id',ria,'quote_line_id',qa,'qty',10),jsonb_build_object('rfq_item_id',rib,'quote_line_id',qb,'qty',10)),jsonb_build_array(jsonb_build_object('quote_line_id',qa,'variant_index',0)));
 test_po_id:=(result->0->>'po_id')::uuid;
 if (select count(*) from public.proc_po_lines where po_id=test_po_id)<>3 then raise exception 'Expected 3 separate PO lines'; end if;
 if not exists(select 1 from public.proc_po_lines l join public.proc_items i on i.id=l.item_id join public.proc_requirements r on r.id=l.requirement_id where l.po_id=test_po_id and i.size='2 feet' and l.qty=6 and l.unit_price=40 and l.line_total=240 and r.ordered_qty=6) then raise exception 'Variation lost size, price, quantity or receiving identity'; end if;
 if (select total from public.proc_purchase_orders where id=test_po_id)<>3240 then raise exception 'PO total incorrect'; end if;
 insert into certification_results values('Variation 2 feet: 6 pieces × Rs.40, separate PO/receiving line, correct total; invalid input leaves no partial order',true);
end $test$;
select * from certification_results;
rollback;
