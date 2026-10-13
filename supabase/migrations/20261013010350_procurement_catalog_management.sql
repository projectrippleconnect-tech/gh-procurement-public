-- Reuse existing RLS for creation, and serialize identical quick-add requests.
create or replace function public.proc_quick_add_item_v1(p_item jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare i public.proc_items; description_v text; category_v text; size_v text; brand_v text; uom_v text; movement_v text; max_v numeric; identity_v text;
begin
 if auth.uid() is null or not private.proc_has_permission('items.edit') then raise exception 'Item editing permission required' using errcode='42501'; end if;
 description_v:=trim(coalesce(p_item->>'description',''));
 category_v:=trim(coalesce(p_item->>'category',''));
 uom_v:=upper(trim(coalesce(p_item->>'uom','PCS')));
 size_v:=trim(coalesce(p_item->>'size',''));brand_v:=trim(coalesce(p_item->>'brand',''));
 movement_v:=upper(coalesce(nullif(p_item->>'movement',''),'NORMAL'));
 max_v:=coalesce(nullif(p_item->>'max_stock','')::numeric,0);
 if description_v='' or category_v='' or uom_v='' then raise exception 'Item name, category and UOM are required'; end if;
 if movement_v not in ('FAST','NORMAL','SLOW') or max_v<0 or max_v::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid movement or maximum stock'; end if;
 identity_v:=lower(concat_ws('|',description_v,size_v,brand_v,category_v,uom_v));
 perform pg_advisory_xact_lock(hashtextextended(identity_v,0));
 select * into i from public.proc_items where lower(trim(description))=lower(description_v) and lower(trim(coalesce(size,'')))=lower(size_v) and lower(trim(coalesce(brand,'')))=lower(brand_v) and lower(trim(category))=lower(category_v) and upper(trim(uom))=uom_v order by active desc,created_at limit 1;
 if i.id is not null then
  if not i.active then raise exception 'This item already exists but is disabled. Enable it in Item Master.'; end if;
  return jsonb_build_object('existing',true,'item',to_jsonb(i));
 end if;
 insert into public.proc_items(item_code,description,category,size,brand,uom,main_group,subgroup,movement,max_stock,source)
 values('QA-'||upper(replace(gen_random_uuid()::text,'-','')),description_v,category_v,nullif(size_v,''),nullif(brand_v,''),uom_v,nullif(trim(p_item->>'main_group'),''),nullif(trim(p_item->>'subgroup'),''),movement_v,max_v,'QUICK ADD') returning * into i;
 return jsonb_build_object('existing',false,'item',to_jsonb(i));
end $$;
revoke all on function public.proc_quick_add_item_v1(jsonb) from public,anon;
grant execute on function public.proc_quick_add_item_v1(jsonb) to authenticated;

-- Check even cascading references: deleting a supplier must never erase history.
create or replace function private.proc_supplier_delete_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare fk record; used boolean;
begin
 perform private.proc_assert_data_admin();
 for fk in select n.nspname schema_name,c.relname table_name,a.attname column_name from pg_constraint f join pg_class c on c.oid=f.conrelid join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum=f.conkey[1] where f.contype='f' and f.confrelid='public.proc_suppliers'::regclass loop
  execute format('select exists(select 1 from %I.%I where %I=$1)',fk.schema_name,fk.table_name,fk.column_name) into used using old.id;
  if used then raise exception 'Supplier is used in records, company lists or coverage rules. Deactivate it to retain history.'; end if;
 end loop;
 return old;
end $$;
revoke all on function private.proc_supplier_delete_guard() from public,anon,authenticated;
create trigger a_proc_supplier_delete_guard before delete on public.proc_suppliers for each row execute function private.proc_supplier_delete_guard();

create or replace function public.proc_admin_delete_supplier_v1(p_supplier_id uuid,p_confirmation text)
returns void language plpgsql security definer set search_path='' as $$
declare s public.proc_suppliers;
begin
 perform private.proc_assert_data_admin();
 select * into s from public.proc_suppliers where id=p_supplier_id for update;
 if s.id is null then raise exception 'Supplier not found'; end if;
 if p_confirmation is distinct from s.supplier_code then raise exception 'Type the supplier code to confirm deletion'; end if;
 delete from public.proc_suppliers where id=p_supplier_id;
end $$;
revoke all on function public.proc_admin_delete_supplier_v1(uuid,text) from public,anon;
grant execute on function public.proc_admin_delete_supplier_v1(uuid,text) to authenticated;
