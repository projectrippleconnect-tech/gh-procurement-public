-- SQL role-boundary tests, not a substitute for real browser sign-in tests.
-- Reuse an existing principal only within this transaction; no account or token
-- is created. Profile changes are invisible to other sessions and rolled back.
begin;
set local statement_timeout='15s';
set local lock_timeout='2s';
create temporary table role_results(role_key text,passed boolean);
grant insert,select on role_results to authenticated;
do $test$
declare principal uuid; r record; failure text; expected boolean; permission text;
begin
  select id into strict principal from public.proc_profiles where role_key='admin' and active limit 1;
  perform set_config('request.jwt.claim.sub',principal::text,true);
  -- Confirm the real caller cannot demote itself before harness setup.
  failure:=null;
  begin update public.proc_profiles set active=false where id=principal; exception when others then failure:=sqlerrm; end;
  if failure is distinct from 'You cannot remove your own Super Admin access' then raise exception 'Self-lockout protection failed'; end if;
  for r in select role_key,base_role from public.proc_roles where enabled order by role_key loop
    -- Harness-only fixture setup. This is not an issued JWT or browser session.
    perform set_config('request.jwt.claim.role','service_role',true);
    update public.proc_profiles set role_key=r.role_key,role=r.base_role,active=true where id=principal;
    perform set_config('request.jwt.claim.role','authenticated',true);
    execute 'set local role authenticated';
    foreach permission in array array['stock.count.enter','procurement.rfq.manage','procurement.orders.approve','receiving.manage','admin.users.manage'] loop
      -- Use the configured grants as the source of truth and test the caller helper.
      execute 'reset role';
      select exists(select 1 from public.proc_role_permissions where role_key=r.role_key and permission_key=permission and allowed) into expected;
      execute 'set local role authenticated';
      if private.proc_has_permission(permission) is distinct from expected then
        raise exception 'Permission mismatch for %: %',r.role_key,permission;
      end if;
    end loop;
    if r.role_key<>'admin' then
      failure:=null;
      begin perform public.proc_approve_po_v2(gen_random_uuid()); exception when others then failure:=sqlerrm; end;
      if failure is distinct from 'Permission denied: procurement.orders.approve' then raise exception 'Approval boundary failed for %: %',r.role_key,failure; end if;
      failure:=null;
      begin perform public.proc_admin_assign_role_v1(principal,'admin'); exception when others then failure:=sqlerrm; end;
      if failure is distinct from 'Permission denied: admin.users.manage' then raise exception 'Self-promotion boundary failed for %: %',r.role_key,failure; end if;
      failure:=null;
      begin perform public.proc_release_po_balance_v1(gen_random_uuid(),'cancel','Role test'); exception when others then failure:=sqlerrm; end;
      if failure is null or failure not like 'Permission denied:%' then raise exception 'Balance-release boundary failed for %: %',r.role_key,failure; end if;
    end if;
    if r.role_key not in ('admin','procurement') then
      failure:=null;
      begin perform public.proc_finalize_award_plan_v2(gen_random_uuid(),'[]'::jsonb); exception when others then failure:=sqlerrm; end;
      if failure is distinct from 'Permission denied: procurement.orders.create' then raise exception 'Award boundary failed for %: %',r.role_key,failure; end if;
      failure:=null;
      begin perform public.proc_create_rfq_v4('{}'::uuid[],'{}'::uuid[]); exception when others then failure:=sqlerrm; end;
      if failure is distinct from 'Not authorized' then raise exception 'RFQ boundary failed for %: %',r.role_key,failure; end if;
    end if;
    if r.role_key not in ('admin','procurement','receiver') then
      failure:=null;
      begin perform public.proc_receive_po_v3(gen_random_uuid(),gen_random_uuid(),'[]'::jsonb); exception when others then failure:=sqlerrm; end;
      if failure is distinct from 'Not authorized' then raise exception 'Receiving boundary failed for %: %',r.role_key,failure; end if;
    end if;
    insert into role_results values(r.role_key,true);
    execute 'reset role';
  end loop;
  perform set_config('request.jwt.claim.role','service_role',true);
  update public.proc_profiles set role_key='admin',role='admin',active=false where id=principal;
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  if private.proc_has_permission('admin.users.manage') then raise exception 'Inactive principal retained administration'; end if;
  failure:=null;
  begin perform public.proc_create_rfq_v4('{}'::uuid[],'{}'::uuid[]); exception when others then failure:=sqlerrm; end;
  if failure is distinct from 'Not authorized' then raise exception 'Inactive principal retained RFQ access'; end if;
  insert into role_results values('inactive_admin',true);
  execute 'reset role';
end $test$;
select * from role_results order by role_key;
rollback;
