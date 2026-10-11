-- Static regression guards: safe reset SQL and preserved role-scoped deletes.
-- This file inspects function definitions. It performs no data mutation.
do $verify$
declare reset_body text;
declare role_body text;
begin
 reset_body:=lower(pg_get_functiondef('public.proc_admin_reset_data_v1(text,text,text,text)'::regprocedure));
 role_body:=lower(pg_get_functiondef('public.proc_admin_update_role_v1(text,text,text,boolean,text[])'::regprocedure));

 if position('delete from public.%i where ctid is not null' in reset_body)=0 then
  raise exception 'Admin data reset requires filtered table deletion';
 end if;
 if position('where qty is distinct from 0 or last_counted_at is not null' in reset_body)=0 then
  raise exception 'Admin stock reset requires filtered balance update';
 end if;
 if position('private.proc_assert_data_admin()' in reset_body)=0 then
  raise exception 'Admin reset must retain permission checks';
 end if;
 if position('data changed. preview the reset again.' in reset_body)=0 then
  raise exception 'Admin reset must retain preview token validation';
 end if;
 if position('delete from public.proc_role_permissions where role_key=p_role_key' in role_body)=0 then
  raise exception 'Role permissions must only be deleted for selected role';
 end if;
end
$verify$;
