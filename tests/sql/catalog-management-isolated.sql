-- Disposable PostgreSQL database only; no production connection.

create schema auth; create schema private;
do $$begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;end$$; grant usage on schema public,private,auth to authenticated;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('fixture.uid',true),'')::uuid$$;
create function private.proc_has_permission(p text) returns boolean language sql as $$select coalesce(current_setting('fixture.permission',true),'')='yes'$$;
create function private.proc_assert_data_admin() returns void language plpgsql as $$begin if auth.uid() is null or current_setting('fixture.role',true)<>'admin' then raise exception 'Admin required';end if;end$$;
create table public.proc_items(id uuid primary key default gen_random_uuid(),item_code text unique not null,description text not null,category text not null,size text,brand text,uom text not null,main_group text,subgroup text,movement text,max_stock numeric,source text,active boolean default true,created_at timestamptz default now());
alter table public.proc_items enable row level security;
create policy item_view on public.proc_items for select to authenticated using(auth.uid() is not null);
create policy item_insert on public.proc_items for insert to authenticated with check(private.proc_has_permission('items.edit'));
grant select,insert on public.proc_items to authenticated;
create table public.proc_suppliers(id uuid primary key default gen_random_uuid(),supplier_code text not null,name text);
create table public.proc_quotes(id uuid primary key default gen_random_uuid(),supplier_id uuid references public.proc_suppliers(id) on delete cascade);
grant select,delete on public.proc_suppliers to authenticated;

\ir ../../supabase/migrations/20261013010350_procurement_catalog_management.sql

set role authenticated;
set fixture.uid='00000000-0000-4000-8000-000000000001';
set fixture.role='admin';set fixture.permission='yes';
do $$declare first_id uuid;r jsonb;denied boolean;begin
 r:=public.proc_quick_add_item_v1('{"description":"Cycle Lock","category":"GENERAL","size":"2 ft","uom":"PCS","max_stock":10}');
 assert (r->>'existing')::boolean=false;first_id:=(r->'item'->>'id')::uuid;
 r:=public.proc_quick_add_item_v1('{"description":" cycle lock ","category":"GENERAL","size":"2 ft","uom":"pcs","max_stock":10}');
 assert (r->>'existing')::boolean and (r->'item'->>'id')::uuid=first_id;
 r:=public.proc_quick_add_item_v1('{"description":"Cycle Lock","category":"GENERAL","size":"3 ft","uom":"PCS"}');
 assert (r->>'existing')::boolean=false;
 denied:=false;begin perform public.proc_quick_add_item_v1('{"description":"Bad","category":"GENERAL","max_stock":"NaN"}');exception when others then denied:=true;end;assert denied;
 perform set_config('fixture.permission','no',true);denied:=false;
 begin perform public.proc_quick_add_item_v1('{"description":"Bad","category":"GENERAL"}');exception when insufficient_privilege then denied:=true;end;assert denied;
end $$;
reset role;
insert into public.proc_suppliers(id,supplier_code,name) values('00000000-0000-4000-8000-000000000002','S2','Linked'),('00000000-0000-4000-8000-000000000003','S3','Unused');
insert into public.proc_quotes(supplier_id) values('00000000-0000-4000-8000-000000000002');
set role authenticated;
do $$declare denied boolean;begin
 denied:=false;begin perform public.proc_admin_delete_supplier_v1('00000000-0000-4000-8000-000000000003','wrong');exception when others then denied:=true;end;assert denied;
 denied:=false;begin perform public.proc_admin_delete_supplier_v1('00000000-0000-4000-8000-000000000002','S2');exception when others then denied:=true;end;assert denied;
 perform set_config('fixture.role','procurement',true);denied:=false;
 begin delete from public.proc_suppliers where supplier_code='S3';exception when others then denied:=true;end;assert denied;
 denied:=false;begin perform public.proc_admin_delete_supplier_v1('00000000-0000-4000-8000-000000000003','S3');exception when others then denied:=true;end;assert denied;
 perform set_config('fixture.role','admin',true);
 perform public.proc_admin_delete_supplier_v1('00000000-0000-4000-8000-000000000003','S3');
 assert (select count(*)=1 from public.proc_suppliers);
end $$;
reset role;
do $$begin assert (select count(*)=1 from public.proc_quotes);end $$;
select 'PASS catalog creation, duplicate handling, permissions, confirmations and cascading history retention' result;
