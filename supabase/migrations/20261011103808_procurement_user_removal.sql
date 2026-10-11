-- App-scoped deletion: keep the identity referenced by procurement history and
-- the other GH apps using this shared Supabase Auth project.
alter table public.proc_profiles add column deleted_at timestamptz;
alter table public.proc_profiles add column deleted_by uuid;
alter table public.proc_profiles add constraint proc_deleted_user_inactive check (deleted_at is null or active=false);

create or replace function private.proc_admin_delete_user_impl(p_user_id uuid,p_confirmation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.proc_profiles; caller uuid:=auth.uid();
begin
 if caller is null or not private.proc_is_role(array['admin']) or not private.proc_has_permission('admin.users.manage') then
  raise exception 'Only an active procurement administrator can delete users' using errcode='42501';
 end if;
 if p_user_id=caller then raise exception 'You cannot delete your own account';end if;
 -- Serialize with role changes and deactivation as well as other deletions.
 lock table public.proc_profiles in share row exclusive mode;
 select * into target from public.proc_profiles where id=p_user_id for update;
 if target.id is null then raise exception 'User not found';end if;
 if p_confirmation is distinct from 'DELETE '||target.display_name then raise exception 'Type the exact confirmation phrase';end if;
 if target.deleted_at is not null then return jsonb_build_object('ok',true,'user_id',target.id);end if;
 if target.role_key='admin' and target.active and not exists(
  select 1 from public.proc_profiles where id<>target.id and role_key='admin' and active and deleted_at is null
 ) then raise exception 'The last active Super Admin cannot be deleted';end if;
 update public.proc_profiles set active=false,deleted_at=now(),deleted_by=caller,updated_at=now() where id=target.id;
 update public.app_users set custom_data=coalesce(custom_data,'{}'::jsonb)||jsonb_build_object('gh_procurement_access',false),updated_at=now() where id=target.id;
 update public.proc_user_invites set status='revoked',updated_at=now() where invited_user_id=target.id and status='pending';
 delete from public.proc_user_directory where user_id=target.id;
 insert into public.proc_audit_logs(table_name,record_id,action,old_data,new_data,user_id)
 values('proc_profiles',target.id,'DELETE',to_jsonb(target),jsonb_build_object('deleted_at',now(),'active',false,'scope','gh_procurement'),caller);
 return jsonb_build_object('ok',true,'user_id',target.id);
end $$;
revoke all on function private.proc_admin_delete_user_impl(uuid,text) from public,anon;
grant execute on function private.proc_admin_delete_user_impl(uuid,text) to authenticated;

create or replace function public.proc_admin_delete_user_v1(p_user_id uuid,p_confirmation text)
returns jsonb language sql security invoker set search_path='' as $$
 select private.proc_admin_delete_user_impl(p_user_id,p_confirmation)
$$;
revoke all on function public.proc_admin_delete_user_v1(uuid,text) from public,anon;
grant execute on function public.proc_admin_delete_user_v1(uuid,text) to authenticated;
