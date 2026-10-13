-- Run after stock_sufficient_status migration; all fixture records roll back.
begin;
set local statement_timeout='30s';
set local lock_timeout='2s';
do $test$
declare principal uuid; visual uuid:=gen_random_uuid(); counted uuid:=gen_random_uuid(); loc uuid; result jsonb; failed boolean;
begin
 select id into strict principal from public.proc_profiles where active and role_key='admin' limit 1;
 perform set_config('request.jwt.claim.sub',principal::text,true);
 loc:=private.proc_default_location_id();
 insert into public.proc_items(id,item_code,category,description,uom,max_stock,reorder_level,movement)
 values(visual,'VISUAL-TEST-'||visual,'GENERAL','Visual check fixture','PCS',20,10,'FAST'),
       (counted,'COUNT-TEST-'||counted,'GENERAL','Physical count fixture','PCS',20,10,'SLOW');
 insert into public.proc_stock_balances(item_id,location_id,qty) values(visual,loc,15);
 result:=public.proc_submit_stock_and_continue_v3('GENERAL',jsonb_build_array(
  jsonb_build_object('item_id',visual,'sufficient_stock',true),jsonb_build_object('item_id',counted,'current_stock',2)));
 if (select qty from public.proc_stock_balances where item_id=visual and location_id=loc)<>15 then raise exception 'Visual check changed recorded stock'; end if;
 if exists(select 1 from public.proc_stock_ledger where item_id=visual) then raise exception 'Visual check created an inventory transaction'; end if;
 if exists(select 1 from public.proc_requirements where item_id=visual) then raise exception 'Visual check created a shortage'; end if;
 if not exists(select 1 from public.proc_stock_count_lines where count_id=(result->>'count_id')::uuid and item_id=visual and sufficient_stock and current_stock is null and required_qty=0) then raise exception 'Visual status was not preserved'; end if;
 if not exists(select 1 from public.proc_requirements where item_id=counted and adjusted_qty=18) then raise exception 'Counted shortage missing'; end if;
 if (select zero_count from public.proc_stock_submission_history_v1(100) where count_id=(result->>'count_id')::uuid)<>0 then raise exception 'Visual status counted as zero'; end if;
 result:=public.proc_submit_stock_and_continue_v3('GENERAL',jsonb_build_array(jsonb_build_object('item_id',counted,'sufficient_stock',true)));
 if result->'automation'->>'status'<>'no_requirements' then raise exception 'Visual-only submission should not need procurement'; end if;
 if exists(select 1 from public.proc_requirements where item_id=counted and adjusted_qty>0) then raise exception 'Old shortage remains after sufficient stock check'; end if;
 failed:=false;
 begin
  perform public.proc_submit_stock_and_continue_v3('GENERAL',jsonb_build_array(jsonb_build_object('item_id',visual,'sufficient_stock',true,'current_stock',0)));
 exception when others then failed:=true;
 end;
 if not failed then raise exception 'Conflicting quantity and visual status accepted'; end if;
end $test$;
rollback;
