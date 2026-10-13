-- Default protection has no opt-out for staff. Super Admin can temporarily
-- allow capture only for their own signed-in session in the protected client.
create table private.proc_capture_overrides (
 user_id uuid not null references public.proc_profiles(id) on delete cascade,
 session_id uuid not null,
 expires_at timestamptz not null,
 primary key(user_id,session_id)
);
alter table private.proc_capture_overrides enable row level security;
revoke all on private.proc_capture_overrides from public,anon,authenticated;

create function public.proc_capture_status_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare permitted boolean:=private.proc_access_super_admin();until_at timestamptz;session uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 if permitted and session is not null then
  select expires_at into until_at from private.proc_capture_overrides where user_id=auth.uid() and session_id=session and expires_at>now();
 end if;
 return jsonb_build_object('can_override',permitted,'capture_allowed',until_at is not null,
  'expires_at',until_at,'expires_in_seconds',case when until_at is null then 0 else least(20,greatest(0,floor(extract(epoch from until_at-now()))::integer)) end);
end $$;

create function public.proc_set_capture_override_v1(p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare session uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
begin
 if not private.proc_access_super_admin() then raise exception 'Only Super Admin can allow screenshots' using errcode='42501';end if;
 if session is null then raise exception 'Signed-in session required' using errcode='42501';end if;
 if p_enabled is null then raise exception 'Choose whether to enable screenshots';end if;
 if p_enabled then
  insert into private.proc_capture_overrides(user_id,session_id,expires_at) values(auth.uid(),session,now()+interval '5 minutes')
  on conflict(user_id,session_id) do update set expires_at=excluded.expires_at;
 else delete from private.proc_capture_overrides where user_id=auth.uid() and session_id=session;end if;
 return public.proc_capture_status_v1();
end $$;

revoke all on function public.proc_capture_status_v1(),public.proc_set_capture_override_v1(boolean) from public,anon;
grant execute on function public.proc_capture_status_v1(),public.proc_set_capture_override_v1(boolean) to authenticated;
