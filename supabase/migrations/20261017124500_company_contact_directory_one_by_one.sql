-- Additive company supplier directory, independent from RFQ/PO routing.
create table if not exists public.proc_company_contact_directory(
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.proc_companies(id) on delete cascade,
 supplier_id uuid not null references public.proc_suppliers(id) on delete restrict,
 display_name text not null check(length(trim(display_name)) between 1 and 200),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint proc_company_contact_directory_unique unique(company_id,supplier_id)
);
create index if not exists proc_company_contact_directory_supplier_idx on public.proc_company_contact_directory(supplier_id);
alter table public.proc_company_contact_directory enable row level security;
revoke all on public.proc_company_contact_directory from public,anon,authenticated;
grant select,insert,update,delete on public.proc_company_contact_directory to authenticated;

do $policies$
begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='proc_company_contact_directory' and policyname='proc_company_contact_directory_read') then
  create policy proc_company_contact_directory_read on public.proc_company_contact_directory for select to authenticated using(private.proc_access_allowed() and private.proc_has_permission('company_lists.view'));
 end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='proc_company_contact_directory' and policyname='proc_company_contact_directory_insert') then
  create policy proc_company_contact_directory_insert on public.proc_company_contact_directory for insert to authenticated with check(private.proc_access_allowed() and private.proc_is_role(array['admin']) and private.proc_has_permission('company_lists.manage') and exists(select 1 from public.proc_suppliers s where s.id=supplier_id and s.supplier_kind='company'));
 end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='proc_company_contact_directory' and policyname='proc_company_contact_directory_update') then
  create policy proc_company_contact_directory_update on public.proc_company_contact_directory for update to authenticated using(private.proc_access_allowed() and private.proc_is_role(array['admin']) and private.proc_has_permission('company_lists.manage')) with check(private.proc_access_allowed() and private.proc_is_role(array['admin']) and private.proc_has_permission('company_lists.manage') and exists(select 1 from public.proc_suppliers s where s.id=supplier_id and s.supplier_kind='company'));
 end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='proc_company_contact_directory' and policyname='proc_company_contact_directory_delete') then
  create policy proc_company_contact_directory_delete on public.proc_company_contact_directory for delete to authenticated using(private.proc_access_allowed() and private.proc_is_role(array['admin']) and private.proc_has_permission('company_lists.manage'));
 end if;
end
$policies$;

-- Save one contact atomically, without dispatching or updating existing routing tables.
create or replace function public.proc_company_directory_save_contact(p_company_id uuid,p_display_name text,p_phone text)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
 v_name text;
 v_digits text;
 v_phone text;
 v_supplier_id uuid;
 v_directory_id uuid;
 v_existing boolean;
begin
 perform private.proc_assert_access();
 if not private.proc_is_role(array['admin']) or not private.proc_has_permission('company_lists.manage') then
  raise exception 'Company management permission required' using errcode='42501';
 end if;
 if not exists(select 1 from public.proc_companies c where c.id=p_company_id and c.active and c.company_list_enabled) then
  raise exception 'Active company list not found' using errcode='22023';
 end if;
 v_name:=trim(regexp_replace(coalesce(p_display_name,''),'\s+',' ','g'));
 if length(v_name)<1 or length(v_name)>200 then
  raise exception 'Contact name must be 1–200 characters' using errcode='22023';
 end if;
 v_digits:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 if v_digits ~ '^07[0-9]{8}$' then
  v_digits:='94'||substring(v_digits from 2);
 end if;
 if v_digits !~ '^947[0-9]{8}$' then
  raise exception 'Enter a valid Sri Lankan mobile number (07 or +94)' using errcode='22023';
 end if;
 v_phone:='+'||v_digits;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('company-contact:'||v_digits,0));
 select s.id into v_supplier_id from public.proc_suppliers s
 where s.supplier_kind='company'
  and pg_catalog.regexp_replace(coalesce(s.whatsapp,s.phone,''),'[^0-9]','','g')=v_digits
 order by s.active desc,s.created_at,s.id limit 1;
 if v_supplier_id is null then
  insert into public.proc_suppliers(supplier_code,name,phone,whatsapp,supplier_kind,active)
  values ('CO-DIR-'||upper(substring(md5(v_phone) from 1 for 16)),v_name,v_phone,v_phone,'company',true)
  returning id into v_supplier_id;
 end if;
 select exists(select 1 from public.proc_company_contact_directory where company_id=p_company_id and supplier_id=v_supplier_id) into v_existing;
 insert into public.proc_company_contact_directory(company_id,supplier_id,display_name)
 values(p_company_id,v_supplier_id,v_name)
 on conflict(company_id,supplier_id)
 do update set display_name=excluded.display_name,updated_at=now()
 returning id into v_directory_id;
 return jsonb_build_object('id',v_directory_id,'company_id',p_company_id,'supplier_id',v_supplier_id,'name',v_name,'phone',v_phone,'already_saved',v_existing);
end
$function$;
revoke all on function public.proc_company_directory_save_contact(uuid,text,text) from public,anon;
grant execute on function public.proc_company_directory_save_contact(uuid,text,text) to authenticated;
