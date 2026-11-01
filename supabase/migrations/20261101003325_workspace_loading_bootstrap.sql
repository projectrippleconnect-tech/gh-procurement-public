begin;
-- One authenticated round trip; existing RLS and access guards still apply.
create or replace function public.proc_workspace_bootstrap_v1()
returns jsonb language plpgsql stable security invoker set search_path=''
as $$
declare staff jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 perform private.proc_assert_access();
 select to_jsonb(p) into staff from public.proc_profiles p where p.id=auth.uid();
 -- Legacy provisioning remains in its existing guarded write endpoint.
 if staff is null then return jsonb_build_object('profile',null);end if;
 if not coalesce((staff->>'active')::boolean,false) then raise exception 'Your GH Procurement access is disabled.' using errcode='42501';end if;
 return jsonb_build_object(
  'profile',staff,
  'permissions',coalesce((select jsonb_agg(permission_key) from public.proc_my_permissions_v1()),'[]'::jsonb),
  'config',jsonb_build_object(
   'modules',coalesce((select jsonb_agg(to_jsonb(m) order by m.sort_order) from public.proc_module_settings m),'[]'::jsonb),
   'fields',coalesce((select jsonb_agg(to_jsonb(f) order by f.module_key,f.sort_order) from public.proc_field_settings f),'[]'::jsonb),
   'features',coalesce((select jsonb_agg(to_jsonb(f) order by f.group_key) from public.proc_feature_settings f),'[]'::jsonb),
   'settings',coalesce((select jsonb_object_agg(s.key,s.value) from public.proc_settings s),'{}'::jsonb)
  )
 );
end $$;
revoke all on function public.proc_workspace_bootstrap_v1() from public,anon;
grant execute on function public.proc_workspace_bootstrap_v1() to authenticated;
notify pgrst,'reload schema';
commit;
