-- Transactional fixture test. No business record is updated; fixtures roll back.
begin;
set local statement_timeout='30s';
set local lock_timeout='2s';
create temporary table large_count_results(check_name text,passed boolean,elapsed_ms numeric);
do $test$
declare principal uuid; result jsonb; payload jsonb; expected integer:=1000; started timestamptz:=clock_timestamp(); fixture_ids uuid[]; failure text;
begin
 select id into strict principal from public.proc_profiles where active and role_key='admin' limit 1;
 perform set_config('request.jwt.claim.sub',principal::text,true);
 create temporary table large_count_items(id uuid primary key);
 insert into large_count_items select gen_random_uuid() from generate_series(1,expected);
 select array_agg(id),jsonb_agg(jsonb_build_object('item_id',id,'current_stock',0)) into fixture_ids,payload from large_count_items;
 insert into public.proc_items(id,item_code,category,description,uom,max_stock,reorder_level,movement)
 select id,'LARGE-CERT-'||id,'GENERAL','Large certification fixture','PCS',10,5,'FAST' from large_count_items;
 execute 'set local role authenticated';
 failure:=null;
 begin perform public.proc_submit_stock_and_continue_v3('GENERAL',payload||jsonb_build_array(payload->0)); exception when others then failure:=sqlerrm; end;
 if failure is distinct from 'Submit no more than 1000 counted items at once' then raise exception 'Oversized batch boundary failed: %',failure; end if;
 failure:=null;
 begin perform public.proc_submit_stock_and_continue_v3('GENERAL',jsonb_build_array(jsonb_build_object('item_id',fixture_ids[1],'current_stock','NaN'))); exception when others then failure:=sqlerrm; end;
 if failure is null then raise exception 'Non-finite stock quantity accepted'; end if;
 result:=public.proc_submit_stock_and_continue_v3('GENERAL',payload);
 execute 'reset role';
 if (select count(*) from public.proc_requirements where item_id=any(fixture_ids) and adjusted_qty=10 and approval_status='pending_review')<>expected then
  raise exception 'Large stock submission lost items or produced incorrect quantities';
 end if;
 insert into large_count_results values('1000 entries preserve shortages; oversized and non-finite batches denied',true,extract(epoch from clock_timestamp()-started)*1000);
end $test$;
select * from large_count_results;
rollback;
