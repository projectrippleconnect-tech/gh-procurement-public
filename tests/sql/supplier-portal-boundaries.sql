begin;
do $test$
declare admin_v uuid:='00000000-0000-4000-8000-000000000111';company_v uuid:=gen_random_uuid();item_v uuid:=gen_random_uuid();supplier_v uuid:=gen_random_uuid();req_v uuid;rfq_v uuid;ri_v uuid;inv_v uuid;round_v uuid;link_v uuid;token_v text;reply jsonb;payload jsonb;pid uuid;mode text;before_count integer;failure text;
begin
 perform set_config('request.jwt.claim.sub',admin_v::text,true);perform set_config('request.jwt.claim.role','authenticated',true);
 insert into public.proc_companies(id,company_code,name,created_by) values(company_v,'PORTAL-BOUNDARY','Portal company boundary',admin_v);
 insert into public.proc_items(id,item_code,category,description,uom,max_stock,reorder_level,movement) values(item_v,'PORTAL-BOUNDARY','ELECTRICAL','Portal boundary item','PCS',20,10,'FAST');
 insert into public.proc_suppliers(id,supplier_code,name,whatsapp,active) values(supplier_v,'PORTAL-BOUNDARY','Portal boundary supplier','0771234567',true);
 foreach mode in array array['company','budget','empty_scope','expired','manual_reserved','revoked','incomplete_draft','spec_changed','partial_requested','fully_allocated_subset','cancelled_requirement'] loop
  req_v:=gen_random_uuid();rfq_v:=gen_random_uuid();ri_v:=gen_random_uuid();inv_v:=gen_random_uuid();token_v:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.proc_requirements(id,requirement_no,item_id,location_id,required_qty,adjusted_qty,created_by,source_type,company_id) values(req_v,'REQ-'||req_v,item_v,private.proc_default_location_id(),10,10,admin_v,'manual',case when mode='company' then company_v else null end);
  update public.proc_requirements set approval_status='approved',selected_for_order=true,approved_by=admin_v,approved_at=now() where id=req_v;
  insert into public.proc_rfqs(id,rfq_no,status,created_by) values(rfq_v,'RFQ-'||rfq_v,'prepared',admin_v);
  insert into public.proc_rfq_items(id,rfq_id,requirement_id,requested_qty) values(ri_v,rfq_v,req_v,case when mode in ('partial_requested','fully_allocated_subset') then 5 else 10 end);
  insert into public.proc_rfq_suppliers(id,rfq_id,supplier_id,scope_override_reason,requested_item_ids) values(inv_v,rfq_v,supplier_v,'Reviewed item-specific coverage exception',case when mode='empty_scope' then '{}'::uuid[] else array[ri_v] end);
  execute 'set local role authenticated';
  round_v:=public.proc_portal_start_round_v1(rfq_v,case when mode='budget' then 100 else 10000 end,100000,1000,14);
  reply:=public.proc_portal_issue_link_v1(inv_v,encode(extensions.digest(token_v,'sha256'),'hex'),6);link_v:=(reply->>'link_id')::uuid;
  execute 'reset role';perform set_config('request.jwt.claim.sub',admin_v::text,true);
  payload:=jsonb_build_array(jsonb_build_object('id',ri_v,'status','in_stock','price','50','quantity','10','variations','[]'::jsonb,'discount','0','tax','0','freight_unit','0','moq','0','multiple','1','lead_days','2','valid_until',case when mode='expired' then current_date-2 else current_date+2 end,'uom','PCS','terms_confirmed',true));
  if mode='partial_requested' then payload:=jsonb_set(payload,'{0,quantity}','"3"');end if;
  perform set_config('request.jwt.claim.sub','',true);execute 'set local role service_role';
  if mode='empty_scope' then
   assert public.proc_portal_read_v1(token_v)->'items'='[]';
   begin perform public.proc_portal_submit_v1(token_v,payload,0,true);raise exception 'TEST empty item scope bypassed';exception when others then if sqlerrm='TEST empty item scope bypassed' then raise;end if;end;
  elsif mode='incomplete_draft' then
   payload:=jsonb_set(jsonb_set(payload,'{0,price}','""'),'{0,lead_days}','""');
   assert public.proc_portal_submit_v1(token_v,payload,0,false)->>'status'='draft','Incomplete draft was rejected';
   begin perform public.proc_portal_submit_v1(token_v,payload,1,true);raise exception 'TEST incomplete quote confirmed';exception when others then if sqlerrm='TEST incomplete quote confirmed' then raise;end if;end;
  else
   perform public.proc_portal_submit_v1(token_v,payload,0,true);
  end if;
  execute 'reset role';perform set_config('request.jwt.claim.sub',admin_v::text,true);
  if mode='revoked' then
   execute 'set local role authenticated';perform public.proc_portal_revoke_link_v1(link_v);execute 'reset role';perform set_config('request.jwt.claim.sub',admin_v::text,true);perform set_config('request.jwt.claim.sub','',true);execute 'set local role service_role';
   begin perform public.proc_portal_read_v1(token_v);raise exception 'TEST revoked token read';exception when insufficient_privilege then null;end;
   execute 'reset role';perform set_config('request.jwt.claim.sub',admin_v::text,true);
  end if;
  if mode='spec_changed' then update public.proc_items set description='Changed specification' where id=item_v;end if;
  if mode='cancelled_requirement' then update public.proc_requirements set status='cancelled' where id=req_v;end if;
  if mode='manual_reserved' then update public.proc_requirements set ordered_qty=7,status='partially_ordered' where id=req_v;end if;
  update public.proc_portal_rounds set opens_at=clock_timestamp()-interval '7 hours',closes_at=clock_timestamp()-interval '1 hour' where id=round_v;
  select count(*) into before_count from public.proc_purchase_orders;
  if mode='cancelled_requirement' then
   failure:=null;begin perform public.proc_portal_process_round_v1(round_v);exception when others then failure:=sqlerrm;end;
   assert failure='Requirement approval or company changed','Cancelled requirement was purchased';
   assert (select count(*) from public.proc_purchase_orders)=before_count,'Cancelled requirement left a PO';
  elsif mode='spec_changed' then
   failure:=null;begin perform public.proc_portal_process_round_v1(round_v);exception when others then failure:=sqlerrm;end;
   assert failure='Approved purchasing scope changed','Changed specification was ordered';
   assert (select count(*) from public.proc_purchase_orders)=before_count,'Changed specification left a PO';
   update public.proc_items set description='Portal boundary item' where id=item_v;
  elsif mode='budget' then
   failure:=null;
   begin perform public.proc_portal_process_round_v1(round_v);exception when others then failure:=sqlerrm;end;
   assert failure like 'Purchasing limit exceeded:%','Budget exceeded without exception';
   assert (select count(*) from public.proc_purchase_orders)=before_count,'Over-budget transaction leaked POs';
   assert (select ordered_qty from public.proc_requirements where id=req_v)=0,'Over-budget transaction leaked reservations';
   perform set_config('request.jwt.claim.role','service_role',true);perform public.proc_portal_record_exception_v1(round_v,failure);perform set_config('request.jwt.claim.role','authenticated',true);
   assert public.proc_portal_review_v1(rfq_v)->'round'->>'state'='exception','Exception was not recorded';
  else
   reply:=public.proc_portal_process_round_v1(round_v);
   if mode in ('empty_scope','expired','revoked','incomplete_draft','spec_changed') then assert jsonb_array_length(reply->'allocations')=0,'Ineligible offer was purchased';
   elsif mode='partial_requested' then
    assert (reply->'unfulfilled'->0->>'qty')::numeric=2,'Follow-up reopens more than the approved RFQ subset';
    assert (select requested_qty from public.proc_rfq_items where rfq_id=(reply->>'next_rfq_id')::uuid)=2,'Follow-up RFQ has wrong quantity';
    assert (select scope_override_reason from public.proc_rfq_suppliers where rfq_id=(reply->>'next_rfq_id')::uuid)='Reviewed item-specific coverage exception','Follow-up lost the approved coverage exception';
   elsif mode='fully_allocated_subset' then
    assert reply->>'next_rfq_id' is null,'A completely allocated RFQ subset reopened the unrelated shortage';
   elsif mode='manual_reserved' then assert (reply->'allocations'->0->>'qty')::numeric=3,'Manual allocation was ordered twice';
   elsif mode='company' then
    select p.id into pid from public.proc_purchase_orders p join public.proc_portal_po_jobs j on j.po_id=p.id where j.round_id=round_v;
    assert (select company_id from public.proc_purchase_orders where id=pid)=company_v,'Company PO lost workflow identity';
    assert jsonb_array_length(public.proc_portal_company_history_v1())>0,'Company portal RFQ missing from history';
   end if;
  end if;
 end loop;
end $test$;
rollback;
