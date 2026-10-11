-- All fixtures, profile changes, permissions and audit rows roll back.
begin;
set local statement_timeout='15s';
set local lock_timeout='2s';
create temporary table clone_results(check_name text,passed boolean);
do $$
declare principal uuid; cloned public.proc_roles; template public.proc_roles; failure text; template_key text;
begin
 select id into strict principal from public.proc_profiles where role_key='admin' and active limit 1;
 perform set_config('request.jwt.claim.sub',principal::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 begin
  perform public.proc_admin_duplicate_role_v1('admin','Unsafe admin clone');
 exception when others then failure:=sqlerrm; end;
 if failure is null or failure not like 'Super Admin cannot be duplicated.%' then raise exception 'Protected admin clone accepted: %',failure; end if;
 insert into clone_results values('Super Admin cloning blocked',true);
 for template_key in select role_key from public.proc_roles where not protected and base_role<>'admin' and role_key not like 'custom_%' loop
  select * into template from public.proc_roles where role_key=template_key;
  select * into cloned from public.proc_admin_create_role_v1('Clone test',template_key,null);
  if cloned.base_role<>template.base_role or cloned.protected or cloned.enabled<>template.enabled then raise exception 'Template state mismatch: %',template_key; end if;
  if exists((select permission_key,allowed from public.proc_role_permissions where role_key=template_key except select permission_key,allowed from public.proc_role_permissions where role_key=cloned.role_key) union all (select permission_key,allowed from public.proc_role_permissions where role_key=cloned.role_key except select permission_key,allowed from public.proc_role_permissions where role_key=template_key)) then raise exception 'Permission copy mismatch: %',template_key; end if;
  insert into clone_results values('Exact staff permission copy: '||template_key,true);
 end loop;
 update public.proc_roles set enabled=false where role_key=cloned.role_key;
 select * into cloned from public.proc_admin_duplicate_role_v1(cloned.role_key,'Disabled clone');
 if cloned.enabled then raise exception 'Disabled template was re-enabled'; end if;
 insert into clone_results values('Disabled template stays disabled',true);
 perform set_config('request.jwt.claim.role','service_role',true);
 update public.proc_profiles set role='viewer',role_key='viewer' where id=principal;
 perform set_config('request.jwt.claim.role','authenticated',true);
 failure:=null;
 begin perform public.proc_admin_create_role_v1('Denied clone','viewer',null); exception when others then failure:=sqlerrm; end;
 if failure is distinct from 'Permission denied: admin.roles.manage' then raise exception 'Viewer could create a role: %',failure; end if;
 insert into clone_results values('Viewer role creation denied',true);
end $$;
select * from clone_results;
rollback;
