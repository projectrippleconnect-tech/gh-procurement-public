-- Run only in a disposable PostgreSQL database. No production data needed.
create schema auth;create schema private;create schema storage;
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
end $$;
grant usage on schema public,private,auth,storage to authenticated;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('fixture.uid',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('fixture.jwt',true),''),'{}')::jsonb$$;
create table public.proc_roles(role_key text primary key,base_role text,enabled boolean,protected boolean);
create table public.proc_profiles(id uuid primary key,role_key text,role text,active boolean,deleted_at timestamptz);
create table public.proc_role_permissions(role_key text,permission_key text,allowed boolean);
create table public.proc_test_records(id integer primary key);
create table storage.objects(bucket_id text,name text);
alter table public.proc_test_records enable row level security;
create policy existing_read on public.proc_test_records for all to authenticated using(true) with check(true);
grant select,insert on public.proc_test_records to authenticated;
create function private.proc_has_permission(p_permission text) returns boolean language sql as $$select true$$;
create function private.proc_is_role(roles text[]) returns boolean language sql as $$select true$$;
create function private.proc_current_role() returns text language sql as $$select 'viewer'::text$$;
create function public.proc_my_permissions_v1() returns table(permission_key text) language sql as $$select 'items.edit'::text$$;
create function public.proc_test_definer_write() returns void language plpgsql security definer as $$
declare new_id integer;
begin select coalesce(max(id),0)+1 into new_id from public.proc_test_records;insert into public.proc_test_records values(new_id);end
$$;
create function public.proc_test_definer_sql_read() returns table(record_id integer) language sql security definer as $$select r.id from public.proc_test_records r$$;
create function public.proc_test_definer_sql_scalar() returns integer language sql security definer as $$select count(*)::integer from public.proc_test_records$$;
insert into public.proc_roles values('admin','admin',true,true),('viewer','viewer',true,false),('custom_test','viewer',true,false);
insert into public.proc_profiles values
 ('00000000-0000-4000-8000-000000000001','admin','admin',true,null),
 ('00000000-0000-4000-8000-000000000002','custom_test','viewer',true,null);
insert into public.proc_role_permissions values('custom_test','items.edit',true);
insert into public.proc_test_records values(1);

\ir ../../supabase/migrations/20261013041517_procurement_access_restrictions.sql

do $$begin
 assert private.proc_access_in_window(array[0,1,2,3,4,5],'07:30','18:30','2026-10-13 02:00:00+00');
 assert not private.proc_access_in_window(array[0,1,2,3,4,5],'07:30','18:30','2026-10-13 01:59:59+00');
 assert not private.proc_access_in_window(array[0,1,2,3,4,5],'07:30','18:30','2026-10-13 13:00:00+00');
 assert private.proc_access_in_window(array[0,1,2,3,4,5],'07:30','18:30','2026-10-11 04:00:00+00');
 assert not private.proc_access_in_window(array[0,1,2,3,4,5],'07:30','18:30','2026-10-10 04:00:00+00');
end $$;
update private.proc_access_rules set time_enabled=false,location_enabled=true;
set fixture.uid='00000000-0000-4000-8000-000000000002';
set fixture.jwt='{"role":"authenticated","session_id":"00000000-0000-4000-8000-000000000010"}';
set role authenticated;
do $$declare r jsonb;denied boolean;begin
 r:=public.proc_access_status_v1();assert not (r->>'allowed')::boolean;assert r->>'reason'='location_required';
 assert not private.proc_has_permission('items.edit');
 assert (select count(*) from public.proc_test_records)=0;
 denied:=false;begin perform public.proc_test_definer_write();exception when insufficient_privilege then denied:=true;end;assert denied;
 denied:=false;begin perform public.proc_test_definer_sql_read();exception when insufficient_privilege then denied:=true;end;assert denied;
 denied:=false;begin perform public.proc_test_definer_sql_scalar();exception when insufficient_privilege then denied:=true;end;assert denied;
 denied:=false;begin perform public.proc_admin_access_policy_v1();exception when insufficient_privilege then denied:=true;end;assert denied;
 r:=public.proc_verify_location_v1(7.0552571,80.5345549,5);assert (r->>'allowed')::boolean;
 assert private.proc_has_permission('items.edit');assert (select count(*) from public.proc_test_records)=1;
 assert public.proc_test_definer_sql_scalar()=1;assert (select count(*) from public.proc_test_definer_sql_read())=1;
 perform public.proc_test_definer_write();assert (select count(*) from public.proc_test_records)=2;
 perform set_config('fixture.jwt','{"role":"authenticated","session_id":"00000000-0000-4000-8000-000000000011"}',true);
 assert not (public.proc_access_status_v1()->>'allowed')::boolean;
 perform set_config('fixture.jwt','{"role":"authenticated","session_id":"00000000-0000-4000-8000-000000000010"}',true);
 r:=public.proc_verify_location_v1(7.2,80.5,5);assert r->>'reason'='outside_location';assert not private.proc_has_permission('items.edit');
 r:=public.proc_verify_location_v1(7.0552571,80.5345549,100);assert r->>'reason'='inaccurate_location';
 r:=public.proc_verify_location_v1('NaN',80.5345549,5);assert not (r->>'allowed')::boolean;
 r:=public.proc_verify_location_v1(7.0552571,80.5345549,5);assert (r->>'allowed')::boolean;
end $$;
reset role;
update private.proc_access_leases set expires_at=now()-interval '1 second';
set role authenticated;
do $$begin assert not private.proc_access_allowed();end $$;
reset role;
update public.proc_roles set enabled=false where role_key='custom_test';
set role authenticated;
do $$begin assert public.proc_access_status_v1()->>'reason'='disabled';end $$;
reset role;
update public.proc_roles set enabled=true where role_key='custom_test';
set fixture.uid='00000000-0000-4000-8000-000000000001';
set role authenticated;
do $$declare r jsonb;p jsonb;begin
 r:=public.proc_access_status_v1();assert (r->>'allowed')::boolean;assert (r->>'exempt')::boolean;
 p:=public.proc_admin_access_policy_v1();
 perform public.proc_admin_save_access_policy_v1(p||'{"radius_m":150}');
 assert (public.proc_admin_access_policy_v1()->>'radius_m')::numeric=150;
 perform public.proc_admin_save_access_policy_v1(p||'{"radius_m":50}','00000000-0000-4000-8000-000000000002');
 assert (public.proc_admin_access_policy_v1('00000000-0000-4000-8000-000000000002')->>'radius_m')::numeric=50;
 perform public.proc_admin_clear_access_policy_v1('00000000-0000-4000-8000-000000000002');
 assert (public.proc_admin_access_policy_v1('00000000-0000-4000-8000-000000000002')->>'radius_m')::numeric=150;
end $$;
reset role;
update public.proc_profiles set active=false where role_key='admin';
set role authenticated;
do $$begin assert not (public.proc_access_status_v1()->>'allowed')::boolean;end $$;
reset role;
select 'PASS schedule, geofence, RLS, RPC, custom roles, session leases, accuracy and Super Admin checks' as result;
