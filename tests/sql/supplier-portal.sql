begin;
do $test$
declare
 admin_id uuid:='00000000-0000-4000-8000-000000000111'; sid uuid:=gen_random_uuid(); sid2 uuid:=gen_random_uuid();
 iid uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); rfq uuid:=gen_random_uuid(); ri uuid:=gen_random_uuid(); inv uuid:=gen_random_uuid(); inv2 uuid:=gen_random_uuid();
 round_v uuid; lid uuid; result jsonb; payload jsonb; response jsonb; rev integer:=0; pid uuid; next_id uuid; next_round uuid; count_before integer;
 token text:=repeat('a',64); token2 text:=repeat('b',64); claim jsonb;
begin
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 insert into public.proc_items(id,item_code,category,description,uom,max_stock,reorder_level,movement) values(iid,'PORTAL-QA','GENERAL','PORTAL TEST ITEM','PCS',20,10,'FAST');
 insert into public.proc_suppliers(id,supplier_code,name,whatsapp,active) values(sid,'PORTAL-QA-1','Portal supplier one','0771234567',true),(sid2,'PORTAL-QA-2','Portal supplier two','0771234568',true);
 insert into public.proc_requirements(id,requirement_no,item_id,location_id,required_qty,adjusted_qty,approval_status,created_by,source_type)
 values(req,'PORTAL-QA-REQ',iid,private.proc_default_location_id(),10,10,'approved',admin_id,'manual');
 update public.proc_requirements set approval_status='approved',selected_for_order=true,approved_by=admin_id,approved_at=now() where id=req;
 insert into public.proc_rfqs(id,rfq_no,status,created_by) values(rfq,'PORTAL-QA-RFQ','prepared',admin_id);
 insert into public.proc_rfq_items(id,rfq_id,requirement_id,requested_qty) values(ri,rfq,req,10);
 insert into public.proc_rfq_suppliers(id,rfq_id,supplier_id,requested_item_ids) values(inv,rfq,sid,array[ri]),(inv2,rfq,sid2,array[ri]);
 execute 'set local role authenticated';
 round_v:=public.proc_portal_start_round_v1(rfq,10000,50000,1000,14);
 assert public.proc_portal_process_round_v1(round_v)->>'status'='waiting','Round executed before six hours';
 result:=public.proc_portal_issue_link_v1(inv,encode(extensions.digest(token,'sha256'),'hex'),24);lid:=(result->>'link_id')::uuid;
 assert (result->>'closes_at')::timestamptz<clock_timestamp()+interval '7 hours','Link escaped six-hour round deadline';
 perform public.proc_portal_issue_link_v1(inv2,encode(extensions.digest(token2,'sha256'),'hex'),6);
 perform set_config('request.jwt.claim.sub','',true);
 execute 'set local role anon';
 begin perform public.proc_portal_read_v1(token);raise exception 'TEST bearer-only read allowed';exception when insufficient_privilege then null;end;
 execute 'reset role';
 assert jsonb_array_length(public.proc_portal_read_v1(token)->'items')=1,'Server cannot read invited item';
 execute 'set local role anon';
 begin perform public.proc_portal_read_v1(repeat('x',64));raise exception 'TEST invalid token allowed';exception when insufficient_privilege then null;end;
 begin perform public.proc_portal_staff_responses_v1(rfq);raise exception 'TEST anonymous staff access';exception when insufficient_privilege then null;end;
 begin perform private.proc_portal_begin_context(admin_id);raise exception 'TEST delegation helper exposed';exception when insufficient_privilege then null;end;
 perform set_config('gh.portal_context',admin_id::text||':'||txid_current()||':'||repeat('0',64),true);
 begin perform private.proc_assert_permission('procurement.rfq.manage');raise exception 'TEST forged delegation accepted';exception when insufficient_privilege then null;end;
 perform set_config('gh.portal_context','',true);
 begin perform public.proc_portal_due_rounds_v1();raise exception 'TEST anonymous worker';exception when insufficient_privilege then null;end;
 begin perform 1 from public.proc_supplier_portal_links;raise exception 'TEST direct portal table access';exception when insufficient_privilege then null;end;
 payload:=jsonb_build_array(jsonb_build_object('id',ri,'status','in_stock','price','50','quantity','6','image',null,'variations',jsonb_build_array(jsonb_build_object('name','Larger size','price',70,'quantity',3,'image',null)),
 'discount','0','tax','0','freight_unit','5','moq','0','multiple','1','lead_days','2','valid_until',current_date+2,'uom','PCS','terms_confirmed',true));
 execute 'reset role';execute 'set local role service_role';
 result:=public.proc_portal_submit_v1(token,payload,0,false);assert result->>'status'='draft';
 begin perform public.proc_portal_submit_v1(token,payload,0,true);raise exception 'TEST stale revision allowed';exception when sqlstate 'PT409' then null;end;
 begin perform public.proc_portal_submit_v1(token,jsonb_set(payload,'{0,id}',to_jsonb(gen_random_uuid())),1,true);raise exception 'TEST item swap allowed';exception when others then if sqlerrm='TEST item swap allowed' then raise;end if;end;
 begin perform public.proc_portal_submit_v1(token,jsonb_set(payload,'{0,price}','"NaN"'),1,true);raise exception 'TEST NaN allowed';exception when others then if sqlerrm='TEST NaN allowed' then raise;end if;end;
 begin perform public.proc_portal_submit_v1(token,jsonb_set(payload,'{0,image}',to_jsonb('data:image/svg+xml;base64,AAA'::text)),1,true);raise exception 'TEST SVG allowed';exception when others then if sqlerrm='TEST SVG allowed' then raise;end if;end;
 result:=public.proc_portal_submit_v1(token,payload,1,true);assert result->>'status'='confirmed';
 -- Cheaper base unit price but more expensive landed cost must lose.
 response:=jsonb_set(jsonb_set(jsonb_set(payload,'{0,price}','"40"'),'{0,freight_unit}','"30"'),'{0,quantity}','"2"');
 perform public.proc_portal_submit_v1(token2,response,0,true);
 execute 'reset role';
 assert (select count(*) from public.proc_quotes where rfq_id=rfq)=2,'Confirmed quotes not synchronized to Prices';
 assert (select count(*) from public.proc_quote_lines ql join public.proc_quotes q on q.id=ql.quote_id where q.rfq_id=rfq)=2,'Variations leaked into exact stock lines';
 -- Withdrawal of a confirmed response to draft removes prices until reconfirmed.
 execute 'set local role service_role';
 perform public.proc_portal_submit_v1(token,payload,2,false);
 execute 'reset role';
 assert not exists(select 1 from public.proc_quote_lines ql join public.proc_quotes q on q.id=ql.quote_id where q.rfq_id=rfq and q.supplier_id=sid),'Draft left a stale confirmed price';
 execute 'set local role service_role';perform public.proc_portal_submit_v1(token,payload,3,true);execute 'reset role';
 -- Fixture-only time travel; actual code always uses PostgreSQL clock/deadlines.
 update public.proc_portal_rounds set opens_at=clock_timestamp()-interval '7 hours',closes_at=clock_timestamp()-interval '1 hour' where id=round_v;
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claim.role','service_role',true);
 execute 'set local role service_role';
 result:=public.proc_portal_process_round_v1(round_v);
 assert result->>'status'='completed','Due round failed';
 assert jsonb_array_length(result->'allocations')=2,'Partial availability did not split eligible suppliers';
 assert result->'allocations'->0->>'supplier_id'=sid::text,'Lowest eligible landed cost not selected first';
 next_id:=(result->>'next_rfq_id')::uuid;next_round:=(result->>'next_round_id')::uuid;
 assert next_id is not null,'Unfulfilled quantities not reopened';
 assert public.proc_portal_process_round_v1(round_v)=result,'Round retry not idempotent';
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 assert (select ordered_qty from public.proc_requirements where id=req)=8,'Wrong reserved quantity';
 assert (select count(*) from public.proc_awards where rfq_item_id=ri)=2,'Portal POs missing existing award history';
 assert (select sum(awarded_qty) from public.proc_awards where rfq_item_id=ri)=8,'Award history quantities differ from POs';
 assert not exists(select 1 from public.proc_awards where rfq_item_id=ri and (awarded_by<>admin_id or landed_unit_cost is null)),'Award history lacks approver or landed cost';
 assert not exists(select 1 from public.proc_quotes where rfq_id=rfq and status<>'selected'),'Allocated quotes not marked selected';

 assert (select requested_qty from public.proc_rfq_items where rfq_id=next_id)=2,'Reopened quantities include already ordered stock';
 assert (select closes_at-opens_at from public.proc_portal_rounds where id=next_round)=interval '24 hours','Incorrect follow-up duration';
 assert (select count(*) from public.proc_portal_po_jobs j where j.round_id=round_v)=2,'Supplier-wise POs missing';
 select p.id into pid from public.proc_purchase_orders p join public.proc_portal_po_jobs j on j.po_id=p.id where j.round_id=round_v and p.supplier_id=sid;
 assert (select total from public.proc_purchase_orders where id=pid)=330,'Landed PO total incorrect';
 execute 'set local role authenticated';
 begin perform public.proc_portal_allow_dispatch_v1(pid);raise exception 'TEST unapproved dispatch authorized';exception when others then if sqlerrm='TEST unapproved dispatch authorized' then raise;end if;end;
 perform public.proc_approve_po_v2(pid);
 perform public.proc_portal_allow_dispatch_v1(pid);
 execute 'reset role';
 perform set_config('request.jwt.claim.role','service_role',true);
 claim:=public.proc_portal_claim_dispatch_v1();assert claim->>'job_id' is not null,'Approved dispatch not claimed';
 assert public.proc_portal_claim_dispatch_v1() is null,'Concurrent/repeated claim duplicated send';
 assert public.proc_portal_finish_dispatch_v1((claim->>'job_id')::uuid,'accepted','test-message-1'),'Dispatch result missing';
 assert (select status from public.proc_purchase_orders where id=pid)='approved','Acceptance falsely marked delivered';
 perform set_config('request.jwt.claim.role','authenticated',true);
 execute 'set local role authenticated';
 perform public.proc_portal_confirm_delivery_v1(pid,'test-message-1','Verified exact message delivered in isolated QA');
 execute 'reset role';
 assert (select status from public.proc_purchase_orders where id=pid)='sent','Verified delivery did not integrate with existing PO workflow';
 -- Same supplier links now show just their residual-only second round; quotations reset.
 execute 'set local role service_role';result:=public.proc_portal_read_v1(token);
assert (result->'items'->0->>'requested_qty')::numeric=2;
 assert result->>'status'='draft' and result->'response'='[]','Residual round retained old supplier prices';
 execute 'reset role';
end $test$;
rollback;
