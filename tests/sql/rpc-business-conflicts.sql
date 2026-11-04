begin;
\ir ../fixtures/supplier-portal-native.sql
do $test$
declare f jsonb; sid uuid; cid uuid:=gen_random_uuid(); contact uuid:=gen_random_uuid(); stale timestamptz:='2000-01-01T00:00:00Z'; before_quote jsonb;
begin
 f:=private.qa_portal_fixture();
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000111',true);perform set_config('request.jwt.claim.role','authenticated',true);
 select supplier_id into sid from public.proc_rfq_suppliers where rfq_id=(f->>'rfq')::uuid;
 before_quote:=public.proc_quote_snapshot_v1((f->>'rfq')::uuid,sid);
 execute 'set local role authenticated';
 begin
  perform public.proc_save_quote_guarded_v1((f->>'rfq')::uuid,sid,'stale','QA','[]');
  raise exception 'TEST stale Prices accepted';
 exception when sqlstate 'PT409' then null;end;
 execute 'reset role';
 assert public.proc_quote_snapshot_v1((f->>'rfq')::uuid,sid)=before_quote,'Conflict changed a saved quotation';
 insert into public.proc_companies(id,company_code,name,created_by) values(cid,'QA-'||cid,'Isolated conflict company','00000000-0000-4000-8000-000000000111');
 update public.proc_suppliers set supplier_kind='company' where id=sid;
 insert into public.proc_company_contact_directory(id,company_id,supplier_id,display_name) values(contact,cid,sid,'Isolated contact');
 execute 'set local role authenticated';
 begin perform public.proc_company_directory_update_contact(contact,'Changed','0771234567',stale);raise exception 'TEST stale contact edited';exception when sqlstate 'PT409' then null;end;
 begin perform public.proc_company_directory_delete_contact(contact,stale);raise exception 'TEST stale contact deleted';exception when sqlstate 'PT409' then null;end;
 execute 'reset role';
 assert (select display_name from public.proc_company_contact_directory where id=contact)='Isolated contact','Conflict changed a directory contact';
 execute 'set local role anon';
 begin perform public.proc_company_directory_delete_contact(contact,stale);raise exception 'TEST anonymous directory access';exception when insufficient_privilege then null;end;
 execute 'reset role';
end $test$;
rollback;
