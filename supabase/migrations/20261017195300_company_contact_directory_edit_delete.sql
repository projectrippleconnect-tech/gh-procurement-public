-- Company-scoped directory editing/removal. Supplier master, routing and purchase history are preserved.
-- Contact titles are aliases owned by the company association, not global supplier names.

create or replace function public.proc_company_directory_update_contact(
 p_id uuid,p_display_name text,p_phone text,p_expected_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
 v_row public.proc_company_contact_directory%rowtype;
 v_name text;
 v_digits text;
 v_old_digits text;
 v_phone text;
 v_supplier_id uuid;
 v_route_linked boolean;
begin
 perform private.proc_assert_access();
 if not private.proc_is_role(array['admin']) or not private.proc_has_permission('company_lists.manage') then
  raise exception 'Company management permission required' using errcode='42501';
 end if;
 select * into v_row from public.proc_company_contact_directory where id=p_id for update;
 if v_row.id is null or not exists (
  select 1 from public.proc_companies c where c.id=v_row.company_id and c.active and c.company_list_enabled
 ) then raise exception 'Directory contact no longer exists; refresh the list' using errcode='22023'; end if;
 if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
  raise exception 'This contact changed since it was opened. Refresh before editing.' using errcode='40001';
 end if;
 v_name:=trim(regexp_replace(coalesce(p_display_name,''),'\s+',' ','g'));
 if length(v_name)<1 or length(v_name)>200 then
  raise exception 'Contact name must be 1–200 characters' using errcode='22023';
 end if;
 v_digits:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 if v_digits ~ '^07[0-9]{8}$' then v_digits:='94'||substring(v_digits from 2);end if;
 if v_digits !~ '^947[0-9]{8}$' then
  raise exception 'Enter a valid Sri Lankan mobile number (07 or +94)' using errcode='22023';
 end if;
 v_phone:='+'||v_digits;
 select regexp_replace(coalesce(s.whatsapp,s.phone,''),'[^0-9]','','g') into v_old_digits
 from public.proc_suppliers s where s.id=v_row.supplier_id;
 if v_old_digits is null then raise exception 'Supplier record missing' using errcode='22023';end if;

 select (
  exists(select 1 from public.proc_companies c where c.id=v_row.company_id and c.default_supplier_id=v_row.supplier_id)
  or exists(select 1 from public.proc_company_contacts x where x.company_id=v_row.company_id and x.supplier_id=v_row.supplier_id)
  or exists(select 1 from public.proc_company_group_contacts x where x.company_id=v_row.company_id and x.supplier_id=v_row.supplier_id)
  or exists(select 1 from public.proc_company_section_route_suppliers x
    join public.proc_company_section_routes y on y.id=x.route_id
    where y.company_id=v_row.company_id and x.supplier_id=v_row.supplier_id)
  or exists(select 1 from public.proc_company_section_routes y where y.company_id=v_row.company_id
    and v_row.supplier_id=any(coalesce(y.assigned_supplier_ids,array[]::uuid[])))
 ) into v_route_linked;

 v_supplier_id:=v_row.supplier_id;
 if v_old_digits<>v_digits then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('company-contact:'||v_digits,0));
  select s.id into v_supplier_id from public.proc_suppliers s
  where s.supplier_kind='company'
    and regexp_replace(coalesce(s.whatsapp,s.phone,''),'[^0-9]','','g')=v_digits
  order by s.active desc,s.created_at,s.id limit 1;
  if v_supplier_id is null then
   insert into public.proc_suppliers(supplier_code,name,phone,whatsapp,supplier_kind,active)
   values('CO-DIR-'||upper(substring(md5(v_phone) from 1 for 16)),
    v_name,v_phone,v_phone,'company',true)
   returning id into v_supplier_id;
  end if;
  if exists(select 1 from public.proc_company_contact_directory d
    where d.company_id=v_row.company_id and d.supplier_id=v_supplier_id and d.id<>p_id) then
   raise exception 'That number is already listed for this company; edit the existing contact instead' using errcode='23505';
  end if;
 end if;
 update public.proc_company_contact_directory
 set supplier_id=v_supplier_id,display_name=v_name,updated_at=now()
 where id=p_id;
 return jsonb_build_object(
  'id',p_id,'company_id',v_row.company_id,'supplier_id',v_supplier_id,
  'name',v_name,'phone',v_phone,'phone_changed',(v_old_digits<>v_digits),
  'routing_unchanged',v_route_linked and (v_old_digits<>v_digits)
 );
end
$function$;
revoke all on function public.proc_company_directory_update_contact(uuid,text,text,timestamptz) from public,anon;
grant execute on function public.proc_company_directory_update_contact(uuid,text,text,timestamptz) to authenticated;

create or replace function public.proc_company_directory_delete_contact(
 p_id uuid,p_expected_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
 v_row public.proc_company_contact_directory%rowtype;
 v_route_linked boolean;
begin
 perform private.proc_assert_access();
 if not private.proc_is_role(array['admin']) or not private.proc_has_permission('company_lists.manage') then
  raise exception 'Company management permission required' using errcode='42501';
 end if;
 select * into v_row from public.proc_company_contact_directory where id=p_id for update;
 if v_row.id is null then raise exception 'Directory contact no longer exists; refresh the list' using errcode='22023';end if;
 if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
  raise exception 'This contact changed since it was opened. Refresh before deleting.' using errcode='40001';
 end if;
 select (
  exists(select 1 from public.proc_companies c where c.id=v_row.company_id and c.default_supplier_id=v_row.supplier_id)
  or exists(select 1 from public.proc_company_contacts x where x.company_id=v_row.company_id and x.supplier_id=v_row.supplier_id)
  or exists(select 1 from public.proc_company_group_contacts x where x.company_id=v_row.company_id and x.supplier_id=v_row.supplier_id)
  or exists(select 1 from public.proc_company_section_route_suppliers x
    join public.proc_company_section_routes y on y.id=x.route_id
    where y.company_id=v_row.company_id and x.supplier_id=v_row.supplier_id)
  or exists(select 1 from public.proc_company_section_routes y where y.company_id=v_row.company_id
    and v_row.supplier_id=any(coalesce(y.assigned_supplier_ids,array[]::uuid[])))
 ) into v_route_linked;
 delete from public.proc_company_contact_directory where id=p_id;
 return jsonb_build_object('id',p_id,'company_id',v_row.company_id,
  'deleted_from_directory',true,'routing_unchanged',v_route_linked);
end
$function$;
revoke all on function public.proc_company_directory_delete_contact(uuid,timestamptz) from public,anon;
grant execute on function public.proc_company_directory_delete_contact(uuid,timestamptz) to authenticated;
