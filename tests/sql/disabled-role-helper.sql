-- Fixture profile changes are invisible to other sessions and rolled back.
begin;
set local statement_timeout='15s';
set local lock_timeout='2s';
do $test$
declare principal uuid; role_key_v text:='qa_disabled_'||substr(replace(gen_random_uuid()::text,'-',''),1,12); denied boolean;
begin
 select id into strict principal from public.proc_profiles where role_key='admin' and active limit 1;
 perform set_config('request.jwt.claim.sub',principal::text,true);
 perform set_config('request.jwt.claim.role','service_role',true);
 insert into public.proc_roles(role_key,name,base_role,enabled,protected)
 values(role_key_v,'Temporary disabled role','admin',false,false);
 update public.proc_profiles set role_key=role_key_v,role='admin' where id=principal;
 perform set_config('request.jwt.claim.role','authenticated',true);
 if private.proc_is_role(array['admin']) then raise exception 'Disabled role passes legacy role helper'; end if;
 if private.proc_has_permission('stock.count.enter') then raise exception 'Disabled role retains stock permission'; end if;
 denied:=false;
 begin perform public.proc_begin_stock_count_session_v1(); exception when others then denied:=true; end;
 if not denied then raise exception 'Disabled role can start stock count'; end if;
 perform set_config('request.jwt.claim.role','service_role',true);
 update public.proc_roles set enabled=true where role_key=role_key_v;
 update public.proc_profiles set active=false where id=principal;
 if private.proc_is_role(array['admin']) then raise exception 'Inactive profile passes role helper'; end if;
 update public.proc_profiles set active=true,role='viewer' where id=principal;
 if private.proc_is_role(array['admin','viewer']) then raise exception 'Mismatched base role passes role helper'; end if;
 update public.proc_profiles set role='admin' where id=principal;
 if not private.proc_is_role(array['admin']) then raise exception 'Valid enabled custom role rejected'; end if;
end $test$;
select 'PASS disabled, inactive, mismatched and enabled custom role checks' as result;
rollback;
