-- Run only in the disposable CI database. No production connection is used.
create role anon;
create role authenticated;
create schema auth;
create schema private;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function private.proc_has_permission(text) returns boolean language sql as $$ select coalesce(current_setting('test.allowed',true),'yes')='yes' $$;
create table public.proc_rfqs(id uuid primary key);
create table public.proc_quotes(id uuid primary key,rfq_id uuid,supplier_id uuid,quote_ref text,freight_total numeric,minimum_order_value numeric,valid_until date,notes text);
create table public.proc_quote_lines(id uuid primary key,quote_id uuid,rfq_item_id uuid,unit_price numeric,notes text);
create function public.proc_save_quote_v3(uuid,uuid,text,jsonb,date,text,text,numeric,numeric) returns jsonb language plpgsql as $$
declare qid uuid;
begin
 perform 1 from public.proc_rfqs where id=$1 for update;
 select id into qid from public.proc_quotes where rfq_id=$1 and supplier_id=$2;
 if qid is null then qid:='10000000-0000-4000-8000-000000000003';insert into public.proc_quotes(id,rfq_id,supplier_id) values(qid,$1,$2);end if;
 update public.proc_quotes set quote_ref=$3,valid_until=$5,notes=$7,freight_total=$8,minimum_order_value=$9 where id=qid;
 delete from public.proc_quote_lines where quote_id=qid;
 insert into public.proc_quote_lines select '10000000-0000-4000-8000-000000000004',qid,(x->>'rfq_item_id')::uuid,(x->>'unit_price')::numeric,x->>'notes' from jsonb_array_elements($4) x;
 return '{"status":"quoted"}'::jsonb;
end $$;
create function public.proc_save_quote_with_sizes_v1(uuid,uuid,text,jsonb,jsonb,date,text,text,numeric,numeric) returns jsonb language sql as $$ select public.proc_save_quote_v3($1,$2,$3,$4,$6,$7,$8,$9,$10)||'{"additional_size_count":1}'::jsonb $$;
\ir ../../supabase/migrations/20261012110046_procurement_quote_conflict_guard.sql
-- Grant minimal fixture access so SECURITY INVOKER is tested as the client role.
grant usage on schema auth,private,public to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant execute on all functions in schema auth,private to authenticated;
insert into public.proc_rfqs values('10000000-0000-4000-8000-000000000001');
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000009',false);
do $test$
declare r uuid:='10000000-0000-4000-8000-000000000001';s uuid:='10000000-0000-4000-8000-000000000002'; first_v text; current_v text;result jsonb;
 lines jsonb:='[{"rfq_item_id":"10000000-0000-4000-8000-000000000008","unit_price":40}]';
begin
 first_v:=public.proc_quote_snapshot_v1(r,s)->>'revision';
 result:=public.proc_save_quote_guarded_v1(r,s,first_v,'REF',lines,'[]',null,null,'commercial notes',90,275);
 current_v:=public.proc_quote_snapshot_v1(r,s)->>'revision';
 assert first_v<>current_v,'First save changes revision';
 begin
  perform public.proc_save_quote_guarded_v1(r,s,first_v,'STALE',lines);
  raise exception 'TEST: stale overwrite accepted';
 exception when serialization_failure then null; end;
 assert (select quote_ref from public.proc_quotes)='REF','Stale write must not change commercial terms';
 update public.proc_quote_lines set unit_price=55;
 begin
  perform public.proc_save_quote_guarded_v1(r,s,current_v,'STALE',lines);
  raise exception 'TEST: changed line accepted';
 exception when serialization_failure then null; end;
 current_v:=public.proc_quote_snapshot_v1(r,s)->>'revision';
 update public.proc_quotes set freight_total=100;
 begin
  perform public.proc_save_quote_guarded_v1(r,s,current_v,'STALE',lines,'[{"size":"2 ft"}]');
  raise exception 'TEST: changed terms accepted';
 exception when serialization_failure then null; end;
 assert (select unit_price from public.proc_quote_lines)=55,'Rejected size save preserves prices';
 perform set_config('test.allowed','no',true);
 begin
  perform public.proc_quote_snapshot_v1(r,s);
  raise exception 'TEST: unauthorized read accepted';
 exception when insufficient_privilege then null; end;
 perform set_config('test.allowed','yes',true);
 assert (public.proc_quote_snapshot_v1(r,s)->'quote'->>'minimum_order_value')::numeric=275,'Commercial terms survive';
end $test$;
select 'PASS isolated PostgreSQL snapshot, first-save revision, stale prices/terms/size guard and client permissions' result;
