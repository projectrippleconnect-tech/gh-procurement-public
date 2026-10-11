-- Keep legacy base-role checks consistent with the effective permission RPC.
-- Table permission triggers remain in place as a second authorization layer.
create or replace function private.proc_is_role(roles text[])
returns boolean language sql stable security definer set search_path='' as $function$
 select exists(
  select 1 from public.proc_profiles p
  join public.proc_roles r on r.role_key=p.role_key
  where p.id=auth.uid() and p.active and p.deleted_at is null
    and r.enabled and p.role=r.base_role and r.base_role=any(roles)
 )
$function$;
