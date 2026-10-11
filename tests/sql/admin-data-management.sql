-- Run only after the migration. Every change is rolled back, including the reset.
begin;
set local statement_timeout='30s';
do $test$
declare admin_id uuid; preview jsonb; after_preview jsonb; original_items bigint; denied boolean:=false; item_id uuid:=gen_random_uuid(); item_code text:='RESET-TEST-'||gen_random_uuid();
begin
 select id into strict admin_id from public.proc_profiles where active and role_key='admin' limit 1;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 select count(*) into original_items from public.proc_items;
 preview:=public.proc_admin_reset_preview_v1('full');
 begin
  perform public.proc_admin_reset_data_v1('full',preview->>'token','WRONG','Transactional test');
 exception when others then denied:=true;end;
 if not denied then raise exception 'Wrong confirmation accepted';end if;
 begin
  perform public.proc_admin_reset_data_v1('full',preview->>'token','CLEAR FULL','Transactional rollback test');
  after_preview:=public.proc_admin_reset_preview_v1('full');
  if exists(select 1 from jsonb_each_text(after_preview->'counts') c where c.value::bigint<>0) then raise exception 'Full reset left operational rows';end if;
  if (select count(*) from public.proc_items)<>original_items then raise exception 'Reset removed item catalogue';end if;
  raise exception using errcode='P1001',message='Rollback successful test reset';
 exception when sqlstate 'P1001' then null;end;
 if public.proc_admin_reset_preview_v1('full')<>preview then raise exception 'Rollback did not restore records';end if;
 insert into public.proc_items(id,item_code,category,description,uom,max_stock,movement) values(item_id,item_code,'GENERAL','Reset deletion test','PCS',0,'SLOW');
 perform public.proc_admin_delete_item_v1(item_id,item_code);
 if exists(select 1 from public.proc_items where id=item_id) then raise exception 'Unused item deletion failed';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 denied:=false;
 begin perform public.proc_admin_reset_preview_v1('full');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Non-admin can preview reset';end if;
 raise notice 'PASS confirmation, full reset, item preservation, rollback, item deletion and non-admin boundary';
end $test$;
rollback;
