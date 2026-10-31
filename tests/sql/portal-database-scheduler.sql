begin;
\ir ../fixtures/supplier-portal-native.sql
do $$
declare partial jsonb; future jsonb; bad jsonb; result jsonb; next_id uuid; before_count integer;
begin
 partial:=private.qa_portal_fixture(1000000,4);
 future:=private.qa_portal_fixture();
 bad:=private.qa_portal_fixture();
 update public.proc_portal_rounds set closes_at=clock_timestamp()-interval '1 second' where id in ((partial->>'round')::uuid,(bad->>'round')::uuid);
 update public.proc_portal_rounds set policy=jsonb_set(policy,'{max_po}','1') where id=(bad->>'round')::uuid;
 select count(*) into before_count from public.proc_purchase_orders;
 assert private.proc_portal_run_due_rounds_v1()->>'status'='disabled','Migration unexpectedly activated purchasing';
 assert (select count(*) from public.proc_purchase_orders)=before_count;
 update private.proc_portal_scheduler_control set enabled=true,batch_limit=1 where singleton;
 -- Cron has a real database-owner session, not a forged service-role request.
 perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','',true);
 result:=private.proc_portal_run_due_rounds_v1();
 assert jsonb_array_length(result->'rounds')=1,'Batch limit ignored';
 result:=private.proc_portal_run_due_rounds_v1();
 assert jsonb_array_length(result->'rounds')=1,'Remaining due round skipped';
 assert (select state from public.proc_portal_rounds where id=(partial->>'round')::uuid)='completed';
 assert (select state from public.proc_portal_rounds where id=(bad->>'round')::uuid)='exception','Purchasing limit was bypassed';
 assert (select state from public.proc_portal_rounds where id=(future->>'round')::uuid)='open','Future round processed early';
 assert (select count(*) from public.proc_purchase_orders)=before_count+1,'Failed round left a partial PO';
 select (r.result->>'next_round_id')::uuid into next_id from public.proc_portal_rounds r where r.id=(partial->>'round')::uuid;
 assert next_id is not null,'Residual 24-hour round missing';
 assert (select closes_at-opens_at from public.proc_portal_rounds where id=next_id)=interval '24 hours';
 assert private.proc_portal_run_due_rounds_v1()->'rounds'='[]'::jsonb,'Completed/exception rounds automatically retried';
 assert (select count(*) from public.proc_purchase_orders)=before_count+1,'Replay created a duplicate PO';
 assert (select last_run_at is not null from private.proc_portal_scheduler_control where singleton),'Missing scheduler observability';
 assert current_setting('request.jwt.claim.role',true)='','Scheduler impersonated a JWT role';
 assert coalesce(current_setting('gh.portal_context',true),'')='','Delegation context leaked';
 assert not has_function_privilege('anon','private.proc_portal_run_due_rounds_v1()','execute');
 assert not has_function_privilege('authenticated','private.proc_portal_run_due_rounds_v1()','execute');
 assert not has_function_privilege('service_role','private.proc_portal_run_due_rounds_v1()','execute');
 assert not has_function_privilege('authenticated','private.proc_portal_process_round_core_v1(uuid)','execute');
 assert not has_function_privilege('service_role','private.proc_portal_process_round_core_v1(uuid)','execute');
 assert not has_table_privilege('authenticated','private.proc_portal_scheduler_control','update');
 assert not has_table_privilege('service_role','private.proc_portal_scheduler_control','update');
 assert (select count(*) from public.proc_portal_po_jobs where approved_at is not null or status<>'pending_approval')=0,'Scheduler authorized dispatch';
end $$;
set local role anon;
do $$begin
 begin perform private.proc_portal_run_due_rounds_v1();raise exception 'Anonymous scheduler execution allowed';exception when insufficient_privilege then null;end;
 begin perform private.proc_portal_process_round_core_v1(gen_random_uuid());raise exception 'Anonymous core execution allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
do $$begin
 begin perform private.proc_portal_run_due_rounds_v1();raise exception 'Staff scheduler execution allowed';exception when insufficient_privilege then null;end;
 begin perform private.proc_portal_process_round_core_v1(gen_random_uuid());raise exception 'Staff core execution allowed';exception when insufficient_privilege then null;end;
 begin perform enabled from private.proc_portal_scheduler_control;raise exception 'Staff can read scheduler control';exception when insufficient_privilege then null;end;
 begin perform public.proc_portal_process_round_v1(gen_random_uuid());raise exception 'Public wrapper accepted missing identity';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
