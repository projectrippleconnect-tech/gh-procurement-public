-- Access rules remain private. Only Super Admin can inspect/change another
-- user's rule; authenticated users can check their own effective access.
create table private.proc_access_rules (
 scope_id uuid primary key,
 time_enabled boolean not null default true,
 location_enabled boolean not null default true,
 days integer[] not null default array[0,1,2,3,4,5],
 start_time time not null default '07:30',
 end_time time not null default '18:30',
 latitude double precision not null default 7.0552571,
 longitude double precision not null default 80.5345549,
 radius_m double precision not null default 100,
 location_name text not null default 'General Hardware, No. 14 Kandy Road, Nawalapitiya',
 revision uuid not null default gen_random_uuid(),
 check(cardinality(days)>0 and days <@ array[0,1,2,3,4,5,6]),
 check(end_time>start_time),
 check(latitude between -90 and 90 and longitude between -180 and 180),
 check(radius_m between 25 and 5000)
);
-- Stage the rule disabled so the previous web client remains usable until the
-- new release is healthy. Deployment activates both checks as its final step.
insert into private.proc_access_rules(scope_id,time_enabled,location_enabled)
values('00000000-0000-0000-0000-000000000000',false,false);
create table private.proc_access_leases (
 user_id uuid not null references public.proc_profiles(id) on delete cascade,
 session_id uuid not null,
 revision uuid not null,
 expires_at timestamptz not null,
 primary key(user_id,session_id)
);
alter table private.proc_access_rules enable row level security;
alter table private.proc_access_leases enable row level security;
revoke all on private.proc_access_rules,private.proc_access_leases from public,anon,authenticated;

create function private.proc_access_super_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.proc_profiles p join public.proc_roles r on r.role_key=p.role_key
 where p.id=auth.uid() and p.active and p.deleted_at is null and r.enabled
 and p.role_key='admin' and p.role='admin' and r.protected and r.base_role='admin')
$$;
create function private.proc_access_rule() returns private.proc_access_rules
language sql stable security definer set search_path='' as $$
 select r from private.proc_access_rules r
 where r.scope_id in (auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid)
 order by (r.scope_id=auth.uid()) desc limit 1
$$;
create function private.proc_access_in_window(p_days integer[],p_start time,p_end time,p_now timestamptz default now())
returns boolean language sql stable set search_path='' as $$
 select extract(dow from p_now at time zone 'Asia/Colombo')::integer=any(p_days)
 and (p_now at time zone 'Asia/Colombo')::time>=p_start
 and (p_now at time zone 'Asia/Colombo')::time<p_end
$$;
create function private.proc_access_reason() returns text
language plpgsql stable security definer set search_path='' as $$
declare r private.proc_access_rules;
begin
 if not exists(select 1 from public.proc_profiles p join public.proc_roles pr on pr.role_key=p.role_key
  where p.id=auth.uid() and p.active and p.deleted_at is null and pr.enabled and p.role=pr.base_role) then return 'disabled';end if;
 if private.proc_access_super_admin() then return 'allowed';end if;
 r:=private.proc_access_rule();
 if r.scope_id is null then return 'disabled';end if;
 if r.time_enabled and not private.proc_access_in_window(r.days,r.start_time,r.end_time) then return 'outside_hours';end if;
 if r.location_enabled and not exists(select 1 from private.proc_access_leases l
  where l.user_id=auth.uid() and l.session_id=nullif(auth.jwt()->>'session_id','')::uuid
    and l.revision=r.revision and l.expires_at>now()) then return 'location_required';end if;
 return 'allowed';
end $$;
create function private.proc_access_allowed() returns boolean
language sql stable security definer set search_path='' as $$
 select private.proc_access_reason()='allowed'
$$;
create function private.proc_assert_access() returns void
language plpgsql stable security definer set search_path='' as $$
begin
 -- Preserve existing server-to-server worker execution with its signed JWT.
 if auth.jwt()->>'role'='service_role' then return;end if;
 if not private.proc_access_allowed() then raise exception 'GH Procurement access restricted: %',private.proc_access_reason() using errcode='42501';end if;
end $$;

create function public.proc_access_status_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r private.proc_access_rules;reason text;until_at timestamptz;exempt boolean;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 reason:=private.proc_access_reason();exempt:=private.proc_access_super_admin();r:=private.proc_access_rule();
 if not exempt then
  if r.time_enabled then until_at:=((now() at time zone 'Asia/Colombo')::date+r.end_time) at time zone 'Asia/Colombo';end if;
  if r.location_enabled then
   select least(until_at,l.expires_at) into until_at from private.proc_access_leases l
   where l.user_id=auth.uid() and l.session_id=nullif(auth.jwt()->>'session_id','')::uuid and l.revision=r.revision;
  end if;
 end if;
 return jsonb_build_object('allowed',reason='allowed','reason',reason,'exempt',exempt,
  'policy',to_jsonb(r)-'revision'-'scope_id','server_now',now(),'valid_until',until_at);
end $$;

create function public.proc_verify_location_v1(p_latitude double precision,p_longitude double precision,p_accuracy double precision)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.proc_access_rules;distance_m double precision;s uuid;reason text;answer jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 answer:=public.proc_access_status_v1();
 if (answer->>'exempt')::boolean or answer->>'reason' in ('disabled','outside_hours') then return answer;end if;
 r:=private.proc_access_rule();if not r.location_enabled then return answer;end if;
 s:=nullif(auth.jwt()->>'session_id','')::uuid;
 if s is null then raise exception 'A signed-in session is required' using errcode='42501';end if;
 delete from private.proc_access_leases where user_id=auth.uid() and session_id=s;
 if p_latitude is null or not (p_latitude between -90 and 90) or p_longitude is null or not (p_longitude between -180 and 180)
 or p_accuracy is null or not (p_accuracy between 0 and 50) then reason:='inaccurate_location';
 else
  distance_m:=6371000*2*asin(sqrt(least(1.0,
   power(sin(radians(p_latitude-r.latitude)/2),2)+cos(radians(r.latitude))*cos(radians(p_latitude))*power(sin(radians(p_longitude-r.longitude)/2),2))));
  -- The reported uncertainty must also fit inside the permitted area.
  if distance_m+p_accuracy>r.radius_m then reason:='outside_location';
  else
   insert into private.proc_access_leases(user_id,session_id,revision,expires_at)
   values(auth.uid(),s,r.revision,now()+interval '90 seconds');reason:='allowed';
  end if;
 end if;
 answer:=public.proc_access_status_v1();
 return answer||jsonb_build_object('allowed',reason='allowed','reason',reason);
end $$;

create function public.proc_admin_access_policy_v1(p_user_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r private.proc_access_rules;
begin
 if not private.proc_access_super_admin() then raise exception 'Super Admin required' using errcode='42501';end if;
 select * into r from private.proc_access_rules
 where scope_id in (coalesce(p_user_id,'00000000-0000-0000-0000-000000000000'::uuid),'00000000-0000-0000-0000-000000000000'::uuid)
 order by (scope_id=p_user_id) desc nulls last limit 1;
 return to_jsonb(r)-'scope_id'-'revision';
end $$;
create function public.proc_admin_save_access_policy_v1(p_policy jsonb,p_user_id uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare scope uuid:=coalesce(p_user_id,'00000000-0000-0000-0000-000000000000'::uuid);allowed_days integer[];
begin
 if not private.proc_access_super_admin() then raise exception 'Super Admin required' using errcode='42501';end if;
 if p_user_id is not null and not exists(select 1 from public.proc_profiles where id=p_user_id and deleted_at is null) then raise exception 'User not found';end if;
 select array_agg(value::integer order by value::integer) into allowed_days from jsonb_array_elements_text(p_policy->'days');
 insert into private.proc_access_rules(scope_id,time_enabled,location_enabled,days,start_time,end_time,latitude,longitude,radius_m,location_name)
 values(scope,(p_policy->>'time_enabled')::boolean,(p_policy->>'location_enabled')::boolean,allowed_days,
 (p_policy->>'start_time')::time,(p_policy->>'end_time')::time,(p_policy->>'latitude')::double precision,
 (p_policy->>'longitude')::double precision,(p_policy->>'radius_m')::double precision,left(p_policy->>'location_name',200))
 on conflict(scope_id) do update set time_enabled=excluded.time_enabled,location_enabled=excluded.location_enabled,
 days=excluded.days,start_time=excluded.start_time,end_time=excluded.end_time,latitude=excluded.latitude,
 longitude=excluded.longitude,radius_m=excluded.radius_m,location_name=excluded.location_name,revision=gen_random_uuid();
 if p_user_id is null then delete from private.proc_access_leases;else delete from private.proc_access_leases where user_id=p_user_id;end if;
end $$;
create function public.proc_admin_clear_access_policy_v1(p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not private.proc_access_super_admin() then raise exception 'Super Admin required' using errcode='42501';end if;
 if p_user_id is null or p_user_id='00000000-0000-0000-0000-000000000000'::uuid then raise exception 'Select a user';end if;
 delete from private.proc_access_rules where scope_id=p_user_id;
 delete from private.proc_access_leases where user_id=p_user_id;
end $$;

-- Protect existing role/permission checks, including storage and definer RPCs.
create or replace function private.proc_has_permission(p_permission text) returns boolean
language sql stable security definer set search_path='' as $$
 select private.proc_access_allowed() and exists(select 1 from public.proc_profiles p
 join public.proc_roles r on r.role_key=p.role_key and r.enabled
 join public.proc_role_permissions rp on rp.role_key=r.role_key
 where p.id=auth.uid() and p.active and p.deleted_at is null and rp.permission_key=p_permission and rp.allowed)
$$;
create or replace function private.proc_is_role(roles text[]) returns boolean
language sql stable security definer set search_path='' as $$
 select private.proc_access_allowed() and exists(select 1 from public.proc_profiles p join public.proc_roles r on r.role_key=p.role_key
 where p.id=auth.uid() and p.active and p.deleted_at is null and r.enabled and p.role=r.base_role and r.base_role=any(roles))
$$;
create or replace function private.proc_current_role() returns text
language sql stable security definer set search_path='' as $$
 select p.role from public.proc_profiles p join public.proc_roles r on r.role_key=p.role_key
 where p.id=auth.uid() and p.active and p.deleted_at is null and r.enabled and p.role=r.base_role and private.proc_access_allowed()
$$;
create or replace function public.proc_my_permissions_v1() returns table(permission_key text)
language sql stable security definer set search_path='' as $$
 select rp.permission_key from public.proc_profiles p join public.proc_roles r on r.role_key=p.role_key and r.enabled
 join public.proc_role_permissions rp on rp.role_key=r.role_key and rp.allowed
 where p.id=auth.uid() and p.active and p.deleted_at is null and private.proc_access_allowed() order by rp.permission_key
$$;

-- Restrictive policies AND with existing business permissions; they never grant
-- access on their own. Include configuration, profiles and procurement files.
do $$declare t record;begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relname like 'proc\_%' escape '\' loop
  execute format('create policy proc_access_restriction on public.%I as restrictive for all to authenticated using ((select private.proc_access_allowed())) with check ((select private.proc_access_allowed()))',t.relname);
 end loop;
end $$;
create policy proc_access_restriction on storage.objects as restrictive for all to authenticated
using(bucket_id<>'gh-procurement' or (select private.proc_access_allowed()))
with check(bucket_id<>'gh-procurement' or (select private.proc_access_allowed()));

-- Old SECURITY DEFINER write APIs sometimes read a base role directly. Add
-- an entry guard without changing their business logic or signatures.
do $$declare f record;definition text;wrapped text;begin
 for f in select p.oid,p.prosrc as source,pg_get_functiondef(p.oid) as definition from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
 where n.nspname='public' and p.proname like 'proc\_%' escape '\' and l.lanname='plpgsql'
 and p.proname not in ('proc_access_status_v1','proc_verify_location_v1','proc_admin_access_policy_v1','proc_admin_save_access_policy_v1','proc_admin_clear_access_policy_v1') loop
  wrapped:='begin'||chr(10)||' perform private.proc_assert_access();'||chr(10)||regexp_replace(f.source,';?\s*$','')||';'||chr(10)||'end;';
  definition:=replace(f.definition,f.source,wrapped);
  if definition=f.definition then raise exception 'Access guard could not be installed for %',f.oid::regprocedure;end if;
  execute definition;
 end loop;
end $$;

-- SQL definer APIs can also bypass RLS (for example an own-history branch).
-- Preserve their SELECT bodies and return types, adding a separate entry guard.
do $$declare f record;wrapped text;definition text;begin
 for f in select p.oid,p.prosrc as source,p.proretset,pg_get_functiondef(p.oid) as definition
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
 where n.nspname='public' and p.proname like 'proc\_%' escape '\' and l.lanname='sql'
 and p.prosecdef and p.proname<>'proc_my_permissions_v1' loop
  wrapped:='begin'||chr(10)||' perform private.proc_assert_access();'||chr(10)||
   case when f.proretset then ' return query '||regexp_replace(f.source,';?\s*$','')||';'
   else ' return ('||regexp_replace(f.source,';?\s*$','')||');' end||chr(10)||'end;';
  definition:=replace(replace(f.definition,f.source,wrapped),'LANGUAGE sql','LANGUAGE plpgsql');
  execute definition;
 end loop;
end $$;

revoke all on function private.proc_access_super_admin(),private.proc_access_rule(),private.proc_access_in_window(integer[],time,time,timestamptz),private.proc_access_reason(),private.proc_access_allowed(),private.proc_assert_access() from public,anon,authenticated;
grant execute on function private.proc_access_allowed(),private.proc_assert_access() to authenticated;
grant execute on function private.proc_assert_access() to service_role;
revoke all on function public.proc_access_status_v1(),public.proc_verify_location_v1(double precision,double precision,double precision),public.proc_admin_access_policy_v1(uuid),public.proc_admin_save_access_policy_v1(jsonb,uuid),public.proc_admin_clear_access_policy_v1(uuid) from public,anon;
grant execute on function public.proc_access_status_v1(),public.proc_verify_location_v1(double precision,double precision,double precision),public.proc_admin_access_policy_v1(uuid),public.proc_admin_save_access_policy_v1(jsonb,uuid),public.proc_admin_clear_access_policy_v1(uuid) to authenticated;
