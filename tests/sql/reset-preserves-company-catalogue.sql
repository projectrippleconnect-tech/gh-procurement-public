begin;
set local statement_timeout='30s';
do $test$
declare a uuid;c uuid:=gen_random_uuid();i uuid:=gen_random_uuid();l uuid:=gen_random_uuid();p jsonb;before_item jsonb;before_link jsonb;
begin
 select id into strict a from public.proc_profiles where active and role_key='admin' limit 1;
 perform set_config('request.jwt.claim.sub',a::text,true);
 insert into public.proc_companies(id,company_code,name,company_list_enabled) values(c,'RESET-CATALOGUE-QA','Reset catalogue QA',true);
 insert into public.proc_items(id,item_code,category,description,uom,max_stock,movement) values(i,'RESET-CATALOGUE-QA','GENERAL','Keep this item','PCS',12,'NORMAL');
 insert into public.proc_company_list_items(id,company_id,item_id,target_stock,sort_order) values(l,c,i,12,7);
 select to_jsonb(x) into before_item from public.proc_items x where id=i;
 select to_jsonb(x) into before_link from public.proc_company_list_items x where id=l;
 if 'proc_company_list_items'=any(private.proc_data_reset_tables('full')) then raise exception 'Full reset includes company catalogue';end if;
 if 'proc_company_price_lists'=any(private.proc_data_reset_tables('full')) then raise exception 'Full reset includes price catalogue';end if;
 p:=public.proc_admin_reset_preview_v1('full');
 if (p->'counts')?'proc_company_list_items' then raise exception 'Preview includes preserved catalogue';end if;
 perform public.proc_admin_reset_data_v1('full',p->>'token','CLEAR FULL','Isolated catalogue preservation test');
 if (select to_jsonb(x) from public.proc_items x where id=i) is distinct from before_item then raise exception 'Item changed during reset';end if;
 if (select to_jsonb(x) from public.proc_company_list_items x where id=l) is distinct from before_link then raise exception 'Company item changed during reset';end if;
 if not exists(select 1 from public.proc_companies where id=c) then raise exception 'Company removed';end if;
 raise notice 'PASS actual full reset preserves item and company link including target, identity and sort order';
end $test$;
rollback;
