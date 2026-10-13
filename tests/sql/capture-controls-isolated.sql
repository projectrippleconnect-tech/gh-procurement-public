-- Disposable PostgreSQL only. Exercises role, session and expiry boundaries.
create schema auth;create schema private;
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
end $$;
grant usage on schema public,private,auth to authenticated;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('fixture.uid',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('fixture.jwt',true),''),'{}')::jsonb$$;
create table public.proc_profiles(id uuid primary key,is_super boolean,active boolean);
create function private.proc_access_super_admin() returns boolean language sql security definer set search_path='' as $$select coalesce((select p.is_super and p.active from public.proc_profiles p where p.id=auth.uid()),false)$$;
insert into public.proc_profiles values('00000000-0000-4000-8000-000000000001',true,true),('00000000-0000-4000-8000-000000000002',false,true);

\ir ../../supabase/migrations/20261013065345_procurement_capture_controls.sql

set fixture.uid='00000000-0000-4000-8000-000000000002';
set fixture.jwt='{"role":"authenticated","session_id":"00000000-0000-4000-8000-000000000010"}';
set role authenticated;
do $$declare denied boolean;begin
 assert not (public.proc_capture_status_v1()->>'capture_allowed')::boolean;
 assert not (public.proc_capture_status_v1()->>'can_override')::boolean;
 denied:=false;begin perform public.proc_set_capture_override_v1(true);exception when insufficient_privilege then denied:=true;end;assert denied;
 denied:=false;begin insert into private.proc_capture_overrides values(auth.uid(),'00000000-0000-4000-8000-000000000010',now()+interval '1 hour');exception when insufficient_privilege then denied:=true;end;assert denied;
end $$;
set fixture.uid='00000000-0000-4000-8000-000000000001';
do $$declare r jsonb;begin
 r:=public.proc_capture_status_v1();assert (r->>'can_override')::boolean;assert not (r->>'capture_allowed')::boolean;
 r:=public.proc_set_capture_override_v1(true);assert (r->>'capture_allowed')::boolean;assert (r->>'expires_in_seconds')::integer between 1 and 20;
 perform set_config('fixture.jwt','{"role":"authenticated","session_id":"00000000-0000-4000-8000-000000000011"}',true);
 assert not (public.proc_capture_status_v1()->>'capture_allowed')::boolean;
 perform set_config('fixture.jwt','{"role":"authenticated","session_id":"00000000-0000-4000-8000-000000000010"}',true);
 r:=public.proc_set_capture_override_v1(false);assert not (r->>'capture_allowed')::boolean;
 perform public.proc_set_capture_override_v1(true);
end $$;
reset role;
update private.proc_capture_overrides set expires_at=now()-interval '1 second';
set role authenticated;
do $$begin assert not (public.proc_capture_status_v1()->>'capture_allowed')::boolean;end $$;
reset role;
update public.proc_profiles set active=false where is_super;
set role authenticated;
do $$declare denied boolean;begin
 assert not (public.proc_capture_status_v1()->>'can_override')::boolean;
 denied:=false;begin perform public.proc_set_capture_override_v1(true);exception when insufficient_privilege then denied:=true;end;assert denied;
end $$;
reset role;
select 'PASS default protection, Super Admin-only override, expiry, session isolation and disabled-role checks' as result;
