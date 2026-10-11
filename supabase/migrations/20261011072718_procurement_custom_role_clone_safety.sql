-- Staff templates retain their base-role boundaries and enabled state.
-- Super Admin must remain the single protected system role: legacy role-based
-- policies would otherwise grant an unprotected clone implicit admin access.
create or replace function public.proc_admin_create_role_v1(
 p_name text,p_clone_from text default 'viewer',p_description text default null
) returns public.proc_roles language plpgsql security definer set search_path='' as $$
declare r public.proc_roles; template public.proc_roles; k text;
begin
 perform private.proc_assert_permission('admin.roles.manage');
 if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'Role name is required'; end if;
 select * into template from public.proc_roles where role_key=p_clone_from for share;
 if not found then raise exception 'Template role not found'; end if;
 if template.protected or template.base_role='admin' then
  raise exception 'Super Admin cannot be duplicated. Choose a staff role template.';
 end if;
 k:='custom_'||substr(replace(gen_random_uuid()::text,'-',''),1,12);
 insert into public.proc_roles(role_key,name,description,base_role,enabled,protected)
 values(k,trim(p_name),nullif(trim(coalesce(p_description,'')),''),template.base_role,template.enabled,false)
 returning * into r;
 insert into public.proc_role_permissions(role_key,permission_key,allowed)
 select k,permission_key,allowed from public.proc_role_permissions where role_key=p_clone_from;
 return r;
end $$;
revoke all on function public.proc_admin_create_role_v1(text,text,text) from public,anon;
grant execute on function public.proc_admin_create_role_v1(text,text,text) to authenticated;
