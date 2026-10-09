-- Run against a database with procurement fixtures; every mutation is rolled back.
begin;
do $test$
declare
 admin_id uuid;
 rid uuid;
 free_sid uuid:=gen_random_uuid();
 scoped_sid uuid:=gen_random_uuid();
 inactive_sid uuid:=gen_random_uuid();
 empty_rid uuid:=gen_random_uuid();
 item_id uuid;
 result jsonb;
 first_id text;
 quote_before jsonb;
 lines_before jsonb;
begin
 select id into admin_id from public.proc_profiles where active and role_key='admin' limit 1;
 select id into rid from public.proc_rfqs where status='prepared' order by created_at desc limit 1;
 if admin_id is null or rid is null then raise exception 'Tests need an active admin and prepared RFQ'; end if;
 select rr.item_id into item_id from public.proc_rfq_items ri join public.proc_requirements rr on rr.id=ri.requirement_id where ri.rfq_id=rid limit 1;
 select jsonb_agg(to_jsonb(q) order by id) into quote_before from public.proc_quotes q;
 select jsonb_agg(to_jsonb(q) order by id) into lines_before from public.proc_quote_lines q;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 execute 'set local role authenticated';
 insert into public.proc_suppliers(id,supplier_code,name,active) values
 (free_sid,'TEST-'||free_sid,'RFQ test unrestricted',true),
 (scoped_sid,'TEST-'||scoped_sid,'RFQ test scoped',true),
 (inactive_sid,'TEST-'||inactive_sid,'RFQ test inactive',false);
 insert into public.proc_supplier_scopes(supplier_id,scope_type,scope_value) values(scoped_sid,'category','__UNMATCHED_TEST_CATEGORY__');
 insert into public.proc_rfqs(id,rfq_no,status,created_by) values(empty_rid,'TEST-'||empty_rid,'prepared',admin_id);

 result:=public.proc_add_rfq_supplier_v1(rid,free_sid);
 if result->>'added'<>'true' or result->'invitation'->>'status'<>'pending'
 or result->'invitation'->>'sent_at' is not null or result->>'rfq_status'<>'prepared' then
  raise exception 'New supplier must be pending, never falsely sent';
 end if;
 first_id:=result->'invitation'->>'id';
 update public.proc_rfq_suppliers set status='quoted',replied_at=now() where id=first_id::uuid;
 result:=public.proc_add_rfq_supplier_v1(rid,free_sid);
 if result->>'added'<>'false' or result->'invitation'->>'id'<>first_id
 or result->'invitation'->>'status'<>'quoted' then raise exception 'Retry altered the existing invitation'; end if;
 if (select count(*) from public.proc_rfq_suppliers where rfq_id=rid and supplier_id=free_sid)<>1 then raise exception 'Duplicate invitation'; end if;

 begin perform public.proc_add_rfq_supplier_v1(rid,inactive_sid); raise exception 'Inactive supplier accepted';
 exception when others then if sqlerrm<>'Invalid or inactive supplier' then raise; end if; end;
 begin perform public.proc_add_rfq_supplier_v1(rid,gen_random_uuid()); raise exception 'Missing supplier accepted';
 exception when others then if sqlerrm<>'Invalid or inactive supplier' then raise; end if; end;
 begin perform public.proc_add_rfq_supplier_v1(gen_random_uuid(),free_sid); raise exception 'Missing RFQ accepted';
 exception when others then if sqlerrm<>'RFQ not found' then raise; end if; end;
 begin perform public.proc_add_rfq_supplier_v1(empty_rid,free_sid); raise exception 'Empty RFQ accepted';
 exception when others then if sqlerrm<>'RFQ has no items' then raise; end if; end;
 begin perform public.proc_add_rfq_supplier_v1(rid,scoped_sid); raise exception 'Unmatched coverage accepted';
 exception when others then if sqlerrm not like 'Supplier does not cover any RFQ item.%' then raise; end if; end;
 begin perform public.proc_add_rfq_supplier_v1(rid,scoped_sid,repeat('x',501)); raise exception 'Oversized override accepted';
 exception when others then if sqlerrm<>'Coverage override reason must be 500 characters or less' then raise; end if; end;

 update public.proc_rfqs set status='quoted' where id=rid;
 result:=public.proc_add_rfq_supplier_v1(rid,scoped_sid,'  Supplier confirmed ability to supply these items  ');
 if result->>'rfq_status'<>'partially_quoted' or result->'invitation'->>'scope_override_reason'<>'Supplier confirmed ability to supply these items' then
  raise exception 'Override or reopened quote status incorrect';
 end if;
 -- Fixture reset uses the test runner role; application users keep no DELETE grant.
 execute 'reset role';
 delete from public.proc_rfq_suppliers where rfq_id=rid and supplier_id=scoped_sid;
 execute 'set local role authenticated';
 insert into public.proc_supplier_scopes(supplier_id,scope_type,item_id) values(scoped_sid,'item',item_id);
 result:=public.proc_add_rfq_supplier_v1(rid,scoped_sid);
 if result->>'added'<>'true' then raise exception 'Matching supplier coverage rejected'; end if;

 for result in select to_jsonb(x) from unnest(array['awarded','closed','cancelled']) x loop
  update public.proc_rfqs set status=trim(both '"' from result::text) where id=rid;
  begin perform public.proc_add_rfq_supplier_v1(rid,free_sid); raise exception 'Final RFQ accepted';
  exception when others then if sqlerrm<>'Cannot add suppliers to an awarded, closed or cancelled RFQ' then raise; end if; end;
 end loop;

 execute 'reset role';
 update public.proc_role_permissions set allowed=false where role_key='admin' and permission_key='procurement.rfq.manage';
 execute 'set local role authenticated';
 begin perform public.proc_add_rfq_supplier_v1(rid,free_sid); raise exception 'Granular permission ignored';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin perform public.proc_add_rfq_supplier_v1(rid,free_sid); raise exception 'Missing profile accepted';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.proc_add_rfq_supplier_v1(rid,free_sid); raise exception 'Unauthenticated call accepted';
 exception when insufficient_privilege then null; end;
 execute 'reset role';
 if quote_before is distinct from (select jsonb_agg(to_jsonb(q) order by id) from public.proc_quotes q)
 or lines_before is distinct from (select jsonb_agg(to_jsonb(q) order by id) from public.proc_quote_lines q) then raise exception 'Existing quotations changed'; end if;
end
$test$;
rollback;
select 'PASS: pending invitation, duplicate retry, inactive/missing supplier, missing/empty RFQ, coverage/override, quoted status, final states, granular permissions, missing profile, authentication and quotation preservation; all test data rolled back' as verification;
