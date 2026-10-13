-- Company stock entry is available to existing stock-count roles; explicit overrides are retained.
insert into public.proc_role_permissions(role_key,permission_key,allowed)
select role_key,'company_lists.view',true from public.proc_role_permissions where permission_key='stock.count.enter' and allowed
on conflict(role_key,permission_key) do nothing;
-- Company Items shares requirements, stock history, POs and receiving with normal procurement.
alter table public.proc_items add column if not exists colour text, add column if not exists variation text;
alter table public.proc_company_list_items add column if not exists max_stock_review boolean not null default false,
 add column if not exists source_key text, add column if not exists source_sheet_id bigint;
create function private.proc_company_reorder_guard() returns trigger language plpgsql set search_path='' as $$
begin
 new.reorder_level:=case when new.max_stock_review then null else new.target_stock*.5 end;return new;
end $$;
revoke all on function private.proc_company_reorder_guard() from public,anon,authenticated;
create trigger proc_company_reorder_guard before insert or update on public.proc_company_list_items for each row execute function private.proc_company_reorder_guard();
update public.proc_company_list_items set reorder_level=target_stock*.5 where not max_stock_review;
create unique index proc_company_source_idx on public.proc_company_list_items(company_id,source_key) where source_key is not null;
alter table public.proc_companies add column if not exists sheet_id bigint, add column if not exists export_sheet_id bigint,
 add column if not exists order_route text not null default 'quotation' check(order_route in ('quotation','direct')),
 add column if not exists auto_approve boolean not null default false,
 add column if not exists auto_send boolean not null default false,
 add column if not exists automation_admin_id uuid references public.proc_profiles(id),
 add column if not exists visible_fields jsonb not null default '{}',
 add column if not exists sheet_sync_at timestamptz;
alter table public.proc_suppliers add column if not exists supplier_kind text not null default 'general' check(supplier_kind in ('general','company'));
alter table public.proc_requirements add column if not exists company_id uuid references public.proc_companies(id);
alter table public.proc_purchase_orders add column if not exists company_id uuid references public.proc_companies(id),
 add column if not exists quantity_only boolean not null default false;
create index proc_requirement_company_idx on public.proc_requirements(company_id);
create index proc_po_company_idx on public.proc_purchase_orders(company_id);
create index proc_company_automation_admin_idx on public.proc_companies(automation_admin_id);

create table public.proc_company_attachments(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.proc_companies(id),
 supplier_id uuid references public.proc_suppliers(id),item_id uuid references public.proc_items(id),
 quote_id uuid references public.proc_quotes(id),po_id uuid references public.proc_purchase_orders(id),
 kind text not null check(kind in ('quotation','price_list','order')),send_with_order boolean not null default false,
 name text not null,storage_path text not null,mime_type text not null,
 discount_percent numeric not null default 0 check(discount_percent between 0 and 100),
 discount_amount numeric not null default 0 check(discount_amount>=0),remarks text,
 created_by uuid not null default auth.uid(),created_at timestamptz not null default now()
);
create index proc_company_attachment_company_idx on public.proc_company_attachments(company_id);
create index proc_company_attachment_supplier_idx on public.proc_company_attachments(supplier_id);
create index proc_company_attachment_item_idx on public.proc_company_attachments(item_id);
create index proc_company_attachment_quote_idx on public.proc_company_attachments(quote_id);
create index proc_company_attachment_po_idx on public.proc_company_attachments(po_id);
create index proc_company_attachment_creator_idx on public.proc_company_attachments(created_by);
alter table public.proc_company_attachments enable row level security;
revoke all on public.proc_company_attachments from public,anon,authenticated;
grant select,insert,update,delete on public.proc_company_attachments to authenticated;
create policy company_docs_read on public.proc_company_attachments for select to authenticated using(private.proc_access_allowed() and private.proc_has_any_permission(array['company_lists.manage','procurement.rfq.manage']));
create policy company_docs_insert on public.proc_company_attachments for insert to authenticated with check(private.proc_access_allowed() and private.proc_has_any_permission(array['company_lists.manage','procurement.rfq.manage']) and created_by=auth.uid());
create policy company_docs_update on public.proc_company_attachments for update to authenticated using(private.proc_access_allowed() and private.proc_has_any_permission(array['company_lists.manage','procurement.rfq.manage'])) with check(private.proc_access_allowed() and private.proc_has_any_permission(array['company_lists.manage','procurement.rfq.manage']));
create policy company_docs_delete on public.proc_company_attachments for delete to authenticated using(private.proc_access_allowed() and private.proc_has_any_permission(array['company_lists.manage','procurement.rfq.manage']));

create table public.proc_company_dispatch_queue(
 id uuid primary key default gen_random_uuid(),po_id uuid not null unique references public.proc_purchase_orders(id),
 company_id uuid not null references public.proc_companies(id),status text not null default 'pending'
 check(status in ('pending','sending','accepted','failed','unknown')),
 message_id text,last_error text,claimed_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index proc_company_queue_company_idx on public.proc_company_dispatch_queue(company_id);
create index proc_company_queue_status_idx on public.proc_company_dispatch_queue(status,created_at);
alter table public.proc_company_dispatch_queue enable row level security;
revoke all on public.proc_company_dispatch_queue from public,anon,authenticated;
grant select on public.proc_company_dispatch_queue to authenticated;
create policy company_queue_read on public.proc_company_dispatch_queue for select to authenticated using(private.proc_access_allowed() and private.proc_has_permission('company_lists.view'));

create table public.proc_company_contacts(
 id uuid primary key default gen_random_uuid(),created_at timestamptz not null default now(),
 company_id uuid not null references public.proc_companies(id),brand text not null,
 supplier_id uuid not null references public.proc_suppliers(id),unique(company_id,brand)
);
create index proc_company_contact_supplier_idx on public.proc_company_contacts(supplier_id);
alter table public.proc_company_contacts enable row level security;
revoke all on public.proc_company_contacts from public,anon,authenticated;
grant select,insert,update,delete on public.proc_company_contacts to authenticated;
create policy company_contacts_read on public.proc_company_contacts for select to authenticated using(private.proc_access_allowed() and private.proc_has_permission('company_lists.view'));
create policy company_contacts_manage on public.proc_company_contacts for all to authenticated using(private.proc_access_allowed() and private.proc_is_role(array['admin']) and private.proc_has_permission('company_lists.manage')) with check(private.proc_access_allowed() and private.proc_is_role(array['admin']) and private.proc_has_permission('company_lists.manage') and exists(select 1 from public.proc_suppliers where id=supplier_id and active and supplier_kind='company'));

-- Guard all admin configuration; staff cannot enable their own approval bypass.
create function private.proc_company_config_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.proc_assert_access();
 if tg_op='INSERT' or new.auto_approve is distinct from old.auto_approve or new.auto_send is distinct from old.auto_send or new.order_route is distinct from old.order_route or new.default_supplier_id is distinct from old.default_supplier_id or new.visible_fields is distinct from old.visible_fields then
  if not private.proc_has_permission('company_lists.manage') or not private.proc_is_role(array['admin']) then raise exception 'Only an administrator may configure company orders';end if;
  new.automation_admin_id:=auth.uid();
 end if;
 if new.default_supplier_id is not null and not exists(select 1 from public.proc_suppliers where id=new.default_supplier_id and active and supplier_kind='company') then raise exception 'Select an active company supplier contact';end if;
 return new;
end $$;
revoke all on function private.proc_company_config_guard() from public,anon,authenticated;
create trigger proc_company_config_guard before insert or update on public.proc_companies for each row execute function private.proc_company_config_guard();

create function public.proc_company_edit_item(p_list_id uuid,p_patch jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare row_v public.proc_company_list_items; max_v numeric;
begin
 perform private.proc_assert_access();
 if not private.proc_has_permission('company_lists.manage') then raise exception 'Company management permission required';end if;
 select * into row_v from public.proc_company_list_items where id=p_list_id;
 if row_v.id is null then raise exception 'Company item not found';end if;
 if p_patch ? 'target_stock' then
  max_v:=nullif(p_patch->>'target_stock','')::numeric;
  if max_v<0 or max_v::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid maximum stock';end if;
  update public.proc_company_list_items set target_stock=coalesce(max_v,0),reorder_level=max_v*.5,max_stock_review=max_v is null,updated_at=now() where id=p_list_id;
 end if;
 update public.proc_items set description=coalesce(nullif(trim(p_patch->>'description'),''),description),
 category=coalesce(nullif(trim(p_patch->>'category'),''),category),
 brand=case when p_patch ? 'brand' then nullif(trim(p_patch->>'brand'),'') else brand end,
 subgroup=case when p_patch ? 'subgroup' then nullif(trim(p_patch->>'subgroup'),'') else subgroup end,
 main_group=case when p_patch ? 'main_group' then nullif(trim(p_patch->>'main_group'),'') else main_group end,
 size=case when p_patch ? 'size' then nullif(trim(p_patch->>'size'),'') else size end,
 colour=case when p_patch ? 'colour' then nullif(trim(p_patch->>'colour'),'') else colour end,
 variation=case when p_patch ? 'variation' then nullif(trim(p_patch->>'variation'),'') else variation end,
 uom=coalesce(nullif(trim(p_patch->>'uom'),''),uom),movement=coalesce(nullif(p_patch->>'movement',''),movement),
 remarks=case when p_patch ? 'remarks' then p_patch->>'remarks' else remarks end,
 max_stock=case when p_patch ? 'target_stock' then coalesce(max_v,0) else max_stock end,
 reorder_level=case when p_patch ? 'target_stock' then coalesce(max_v*.5,0) else reorder_level end,updated_at=now() where id=row_v.item_id;
end $$;
revoke all on function public.proc_company_edit_item(uuid,jsonb) from public,anon;
grant execute on function public.proc_company_edit_item(uuid,jsonb) to authenticated;

create function public.proc_company_move_group(p_company_id uuid,p_from_field text,p_from text,p_category text,p_main_group text,p_subgroup text) returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 perform private.proc_assert_access();
 if not private.proc_has_permission('company_lists.manage') then raise exception 'Company management permission required';end if;
 if p_from_field not in ('category','main_group','subgroup','brand') or nullif(trim(p_from),'') is null or nullif(trim(p_category),'') is null then raise exception 'Choose a source group and destination category';end if;
 update public.proc_items i set category=trim(p_category),main_group=nullif(trim(p_main_group),''),subgroup=nullif(trim(p_subgroup),''),updated_at=now()
 where exists(select 1 from public.proc_company_list_items c where c.company_id=p_company_id and c.item_id=i.id and c.active)
 and to_jsonb(i)->>p_from_field=p_from;
 get diagnostics n=row_count;return n;
end $$;
revoke all on function public.proc_company_move_group(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.proc_company_move_group(uuid,text,text,text,text,text) to authenticated;

create function public.proc_company_import_sheet(p_title text,p_sheet_id bigint,p_rows jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.proc_companies;i public.proc_items;line public.proc_company_list_items;x jsonb;max_v numeric;count_v integer:=0;
begin
 perform private.proc_assert_access();
 if not private.proc_has_permission('company_lists.manage') or not private.proc_is_role(array['admin']) then raise exception 'Admin company management required';end if;
 if nullif(trim(p_title),'') is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>10000 then raise exception 'Invalid company sheet';end if;
 perform pg_advisory_xact_lock(hashtextextended('company-sheet:'||p_sheet_id::text,0));
 select * into c from public.proc_companies where sheet_id=p_sheet_id;
 if c.id is null then select * into c from public.proc_companies where lower(trim(name))=lower(trim(p_title)) order by created_at limit 1;end if;
 if c.id is null then
  insert into public.proc_companies(company_code,name,sheet_id,created_by) values('SHEET-'||p_sheet_id,trim(p_title),p_sheet_id,auth.uid()) returning * into c;
 else update public.proc_companies set sheet_id=coalesce(sheet_id,p_sheet_id) where id=c.id;end if;
 for x in select value from jsonb_array_elements(p_rows) loop
  if nullif(trim(x->>'description'),'') is null or nullif(x->>'source_key','') is null then raise exception 'Missing item description/source';end if;
  max_v:=nullif(x->>'max_stock','')::numeric;
  if max_v<0 or max_v::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid maximum';end if;
  select * into line from public.proc_company_list_items where company_id=c.id and source_key=x->>'source_key';
  -- Repeated sync never silently overwrites an admin-edited item. Review existing rows separately.
  if line.id is not null then continue;end if;
  select * into i from public.proc_items where lower(trim(description))=lower(trim(x->>'description'))
   and coalesce(size,'')=coalesce(x->>'size','') and coalesce(brand,'')=coalesce(x->>'brand','')
   and coalesce(colour,'')=coalesce(x->>'colour','') and coalesce(variation,'')=coalesce(x->>'variation','')
   and coalesce(subgroup,'')=coalesce(x->>'subgroup','') and coalesce(main_group,'')=coalesce(x->>'main_group','') and category=coalesce(nullif(x->>'category',''),trim(p_title)) order by active desc limit 1;
  if i.id is null then
   insert into public.proc_items(item_code,description,category,main_group,subgroup,brand,size,colour,variation,uom,movement,max_stock,reorder_level,source,remarks)
   values('CI-'||replace(gen_random_uuid()::text,'-',''),trim(x->>'description'),coalesce(nullif(x->>'category',''),trim(p_title)),x->>'main_group',x->>'subgroup',nullif(x->>'brand',''),nullif(x->>'size',''),nullif(x->>'colour',''),nullif(x->>'variation',''),coalesce(nullif(x->>'uom',''),'PCS'),coalesce(nullif(x->>'movement',''),'NORMAL'),coalesce(max_v,0),coalesce(max_v*.5,0),'COMPANY SHEET',x->>'remarks') returning * into i;
  end if;
  insert into public.proc_company_list_items(company_id,item_id,target_stock,reorder_level,max_stock_review,source_key,source_sheet_id,sort_order,created_by)
  values(c.id,i.id,coalesce(max_v,0),max_v*.5,max_v is null,x->>'source_key',p_sheet_id,count_v,auth.uid())
  on conflict(company_id,item_id) do nothing;
  count_v:=count_v+1;i:=null;line:=null;
 end loop;
 update public.proc_companies set sheet_sync_at=now() where id=c.id;
 return jsonb_build_object('company_id',c.id,'imported',count_v);
end $$;
revoke all on function public.proc_company_import_sheet(text,bigint,jsonb) from public,anon;
grant execute on function public.proc_company_import_sheet(text,bigint,jsonb) to authenticated;

-- Internal automation runs as the admin who enabled it, only for this company's submitted shortages.
-- Claims are scoped to the transaction block and restored on both success and error.
create function private.proc_company_direct_orders(p_company_id uuid,p_requirement_ids uuid[],p_auto boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.proc_companies;r record;po_v jsonb;po_id_v uuid;po_no_v text;qty_v numeric;claims_v text;sub_v text;actor uuid;result jsonb:='[]';
begin
 perform private.proc_assert_access();
 select * into c from public.proc_companies where id=p_company_id and active for update;
 if c.id is null or c.order_route<>'direct' then return result;end if;
 if p_auto then
  if not c.auto_approve or not private.proc_has_permission('stock.count.enter') then raise exception 'Automatic company approval is not enabled';end if;
  actor:=c.automation_admin_id;
 else
  if not private.proc_is_role(array['admin']) or not private.proc_has_permission('procurement.orders.approve') then raise exception 'Administrator approval required';end if;actor:=auth.uid();
 end if;
 if not exists(select 1 from public.proc_profiles where id=actor and active and role='admin') then raise exception 'Company automation approving admin is inactive';end if;
 claims_v:=current_setting('request.jwt.claims',true);sub_v:=current_setting('request.jwt.claim.sub',true);
 begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);perform set_config('request.jwt.claim.sub',actor::text,true);
  for r in select rr.*,coalesce((select supplier_id from public.proc_company_contacts cc where cc.company_id=c.id and cc.brand=coalesce(i.brand,'')),c.default_supplier_id) supplier_id from public.proc_requirements rr join public.proc_items i on i.id=rr.item_id where rr.id=any(p_requirement_ids) and rr.company_id=c.id and rr.status not in ('closed','cancelled','received') and rr.adjusted_qty>rr.ordered_qty order by rr.id for update of rr loop
   qty_v:=r.adjusted_qty-r.ordered_qty;
   if r.supplier_id is null or not exists(select 1 from public.proc_suppliers where id=r.supplier_id and active and supplier_kind='company') then raise exception 'Set an active company supplier contact for every ordered brand';end if;
   select (value->>'id')::uuid into po_id_v from jsonb_array_elements(result) where value->>'supplier_id'=r.supplier_id::text;
   if po_id_v is null then
    insert into public.proc_purchase_orders(po_no,supplier_id,status,created_by,company_id,quantity_only,notes,terms)
    values('COMPANY-'||gen_random_uuid(),r.supplier_id,'pending_approval',actor,c.id,true,'Company quantity-only order. Price not requested.','Quantity only; supplier to confirm availability and delivery.') returning id,po_no into po_id_v,po_no_v;
    result:=result||jsonb_build_array(jsonb_build_object('id',po_id_v,'po_no',po_no_v,'supplier_id',r.supplier_id));
   end if;
   insert into public.proc_po_lines(po_id,requirement_id,item_id,qty,unit_price,discount_percent,tax_percent) values(po_id_v,r.id,r.item_id,qty_v,0,0,0);
   update public.proc_requirements set ordered_qty=ordered_qty+qty_v,status='ordered',approval_status='approved',selected_for_order=true,approved_by=actor,approved_at=now() where id=r.id;
  end loop;
  for po_v in select value from jsonb_array_elements(result) loop
   po_id_v:=(po_v->>'id')::uuid;
   perform public.proc_approve_po_v2(po_id_v);
   update public.proc_purchase_orders set auto_approved=p_auto,auto_approval_reason=case when p_auto then 'Company auto-approve configured by administrator' end where id=po_id_v;
   if c.auto_send then insert into public.proc_company_dispatch_queue(po_id,company_id) values(po_id_v,c.id) on conflict(po_id) do nothing;end if;
  end loop;
  perform set_config('request.jwt.claims',coalesce(claims_v,''),true);perform set_config('request.jwt.claim.sub',coalesce(sub_v,''),true);
 exception when others then perform set_config('request.jwt.claims',coalesce(claims_v,''),true);perform set_config('request.jwt.claim.sub',coalesce(sub_v,''),true);raise;end;
 return result;
end $$;
revoke all on function private.proc_company_direct_orders(uuid,uuid[],boolean) from public,anon,authenticated;

create function public.proc_submit_company_list_check_v2(p_company_id uuid,p_lines jsonb,p_notes text default null,p_count_started_at timestamptz default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare caller uuid:=auth.uid();c public.proc_companies;loc uuid;count_id_v uuid;count_no_v text;x jsonb;cli public.proc_company_list_items;it public.proc_items;current_v numeric;trigger_v numeric;suggested numeric;enough boolean;req_count integer;ids uuid[];orders jsonb:='[]';
begin
 perform private.proc_assert_access();
 if not private.proc_has_permission('stock.count.enter') then raise exception 'Stock entry permission required';end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>1000 then raise exception 'Choose 1–1000 counted items';end if;
 select * into c from public.proc_companies where id=p_company_id and active and company_list_enabled;
 if c.id is null then raise exception 'Company list not found';end if;
 if (select count(distinct value->>'company_list_item_id') from jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) then raise exception 'Duplicate company stock item';end if;
 loc:=private.proc_default_location_id();count_no_v:='COMPANY-'||gen_random_uuid();
 insert into public.proc_stock_counts(count_no,location_id,category,status,counted_by,notes,count_started_at)
 values(count_no_v,loc,'COMPANY: '||c.name,'draft',caller,p_notes,coalesce(p_count_started_at,now())) returning id,count_no into count_id_v,count_no_v;
 for x in select value from jsonb_array_elements(p_lines) loop
  select * into cli from public.proc_company_list_items where id=(x->>'company_list_item_id')::uuid and company_id=c.id and active;
  if cli.id is null then raise exception 'Invalid company-list item';end if;
  select * into it from public.proc_items where id=cli.item_id and active;
  if it.id is null then raise exception 'Inactive company item';end if;
  enough:=coalesce((x->>'sufficient_stock')::boolean,false);
  if cli.max_stock_review and not enough then raise exception 'Admin must enter maximum stock before ordering this item';end if;
  current_v:=case when enough then null else (x->>'current_stock')::numeric end;
  if not enough and (current_v is null or current_v<0 or current_v::text in ('NaN','Infinity','-Infinity')) then raise exception 'Invalid current stock';end if;
  trigger_v:=coalesce(cli.reorder_level,cli.target_stock*.5);
  suggested:=case when enough then 0 when current_v<=trigger_v then greatest(cli.target_stock-current_v,0) else 0 end;
  insert into public.proc_stock_count_lines(count_id,item_id,current_stock,max_stock_snapshot,reorder_level_snapshot,movement_snapshot,suggested_qty,required_qty,sufficient_stock,note)
  values(count_id_v,it.id,current_v,cli.target_stock,trigger_v,it.movement,suggested,suggested,enough,nullif(x->>'note',''));
 end loop;
 req_count:=private.proc_submit_stock_count_impl(count_id_v);
 ids:=private.proc_company_link_count(c.id,count_id_v);
 if c.auto_approve and c.order_route='direct' and coalesce(cardinality(ids),0)>0 then orders:=private.proc_company_auto_from_count(c.id,count_id_v,ids);end if;
 return jsonb_build_object('count_id',count_id_v,'count_no',count_no_v,'requirements_created',req_count,'purchase_orders',orders,'company_id',c.id);
end $$;
-- Expose one tightly bounded private entry point: a caller can automate only their submitted count.
create function private.proc_company_auto_from_count(p_company_id uuid,p_count_id uuid,p_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.proc_assert_access();
 if not private.proc_has_permission('stock.count.enter') or not exists(select 1 from public.proc_stock_counts where id=p_count_id and counted_by=auth.uid() and status='submitted')
 or exists(select 1 from unnest(p_ids) x where not exists(select 1 from public.proc_requirements r join public.proc_stock_count_lines l on l.id=r.source_count_line_id where r.id=x and r.company_id=p_company_id and l.count_id=p_count_id)) then raise exception 'Invalid company auto-approval scope';end if;
 return private.proc_company_direct_orders(p_company_id,p_ids,true);
end $$;
revoke all on function private.proc_company_auto_from_count(uuid,uuid,uuid[]) from public,anon;
grant execute on function private.proc_company_auto_from_count(uuid,uuid,uuid[]) to authenticated;
revoke all on function public.proc_submit_company_list_check_v2(uuid,jsonb,text,timestamptz) from public,anon;
grant execute on function public.proc_submit_company_list_check_v2(uuid,jsonb,text,timestamptz) to authenticated;

create function private.proc_company_manual_orders(p_company_id uuid,p_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.proc_assert_access();
 if not private.proc_is_role(array['admin']) or not private.proc_has_permission('procurement.orders.approve') then raise exception 'Admin approval required';end if;
 return private.proc_company_direct_orders(p_company_id,p_ids,false);
end $$;
create function public.proc_company_approve_direct(p_company_id uuid,p_ids uuid[]) returns jsonb language sql security invoker set search_path='' as $$select private.proc_company_manual_orders(p_company_id,p_ids)$$;
revoke all on function public.proc_company_approve_direct(uuid,uuid[]),private.proc_company_manual_orders(uuid,uuid[]) from public,anon;
grant execute on function public.proc_company_approve_direct(uuid,uuid[]),private.proc_company_manual_orders(uuid,uuid[]) to authenticated;

create function private.proc_company_claim_send(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.proc_company_dispatch_queue;c public.proc_companies;po public.proc_purchase_orders;s public.proc_suppliers;lines jsonb;attachments jsonb;
begin
 perform private.proc_assert_access();
 if not private.proc_has_permission('company_lists.view') then raise exception 'Company list access required';end if;
 select * into q from public.proc_company_dispatch_queue where id=p_id and status in ('pending','failed') for update;
 if q.id is null then return null;end if;
 select * into c from public.proc_companies where id=q.company_id and active and auto_send;
 select * into po from public.proc_purchase_orders where id=q.po_id and company_id=c.id and quantity_only and status='approved';
 if po.id is null then raise exception 'Company order is not eligible for automatic sending';end if;
 -- Stock staff can process orders only when admin configured automatic approval.
 if not private.proc_has_permission('company_lists.manage') and not(c.auto_approve and private.proc_has_permission('stock.count.enter')) then raise exception 'Admin-approved sending required';end if;
 select * into s from public.proc_suppliers where id=po.supplier_id and active and supplier_kind='company';
 if s.id is null then raise exception 'Company supplier unavailable';end if;
 select jsonb_agg(jsonb_build_object('description',i.description,'brand',i.brand,'size',i.size,'colour',i.colour,'variation',i.variation,'uom',i.uom,'qty',l.qty,'remarks',i.remarks) order by i.description,l.id) into lines from public.proc_po_lines l join public.proc_items i on i.id=l.item_id where l.po_id=po.id;
 select coalesce(jsonb_agg(jsonb_build_object('name',name,'storage_path',storage_path,'mime_type',mime_type,'remarks',remarks,'discount_percent',discount_percent,'discount_amount',discount_amount)),'[]') into attachments from public.proc_company_attachments where company_id=c.id and send_with_order and kind in ('price_list','order') and (po_id is null or po_id=po.id) and (supplier_id is null or supplier_id=s.id) and (item_id is null or exists(select 1 from public.proc_po_lines where po_id=po.id and proc_po_lines.item_id=proc_company_attachments.item_id));
 update public.proc_company_dispatch_queue set status='sending',claimed_by=auth.uid(),last_error=null,updated_at=now() where id=q.id;
 return jsonb_build_object('id',q.id,'po_id',po.id,'po_no',po.po_no,'phone',coalesce(s.whatsapp,s.phone),'supplier',s.name,'company',c.name,'lines',lines,'attachments',attachments);
end $$;
create function public.proc_company_claim_send(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.proc_company_claim_send(p_id)$$;
revoke all on function public.proc_company_claim_send(uuid),private.proc_company_claim_send(uuid) from public,anon;
grant execute on function public.proc_company_claim_send(uuid),private.proc_company_claim_send(uuid) to authenticated;

create function private.proc_company_finish_send(p_id uuid,p_status text,p_message_id text,p_error text) returns void language plpgsql security definer set search_path='' as $$
declare q public.proc_company_dispatch_queue;c public.proc_companies;claims_v text;sub_v text;
begin
 perform private.proc_assert_access();
 if p_status not in ('accepted','failed','unknown') then raise exception 'Invalid dispatch outcome';end if;
 select * into q from public.proc_company_dispatch_queue where id=p_id and status='sending' and claimed_by=auth.uid() for update;
 if q.id is null then raise exception 'Dispatch is not owned by this caller';end if;
 update public.proc_company_dispatch_queue set status=p_status,message_id=left(p_message_id,500),last_error=left(p_error,1000),updated_at=now() where id=p_id;
 if p_status='accepted' then
  select * into c from public.proc_companies where id=q.company_id;
  if not exists(select 1 from public.proc_profiles where id=c.automation_admin_id and active and role='admin') then raise exception 'Automation admin no longer active; verify accepted send before updating order';end if;
  claims_v:=current_setting('request.jwt.claims',true);sub_v:=current_setting('request.jwt.claim.sub',true);
  begin
   perform set_config('request.jwt.claims',jsonb_build_object('sub',c.automation_admin_id,'role','authenticated')::text,true);perform set_config('request.jwt.claim.sub',c.automation_admin_id::text,true);
   update public.proc_purchase_orders set status='sent',sent_at=now() where id=q.po_id and status='approved';
   perform set_config('request.jwt.claims',coalesce(claims_v,''),true);perform set_config('request.jwt.claim.sub',coalesce(sub_v,''),true);
  exception when others then perform set_config('request.jwt.claims',coalesce(claims_v,''),true);perform set_config('request.jwt.claim.sub',coalesce(sub_v,''),true);raise;end;
 end if;
 -- Sent records gateway acceptance; recipient delivery is not claimed.

end $$;
create function public.proc_company_finish_send(p_id uuid,p_status text,p_message_id text,p_error text) returns void language sql security invoker set search_path='' as $$select private.proc_company_finish_send(p_id,p_status,p_message_id,p_error)$$;
revoke all on function public.proc_company_finish_send(uuid,text,text,text),private.proc_company_finish_send(uuid,text,text,text) from public,anon;
grant execute on function public.proc_company_finish_send(uuid,text,text,text),private.proc_company_finish_send(uuid,text,text,text) to authenticated;

-- Attachment storage is private and follows the company document permission.
create policy company_attachment_storage_read on storage.objects for select to authenticated using(bucket_id='gh-procurement' and name like 'company-attachments/%' and private.proc_access_allowed() and private.proc_has_any_permission(array['company_lists.manage','procurement.rfq.manage']));
create policy company_attachment_storage_insert on storage.objects for insert to authenticated with check(bucket_id='gh-procurement' and name like 'company-attachments/%' and private.proc_access_allowed() and private.proc_has_any_permission(array['company_lists.manage','procurement.rfq.manage']));
create policy company_attachment_storage_delete on storage.objects for delete to authenticated using(bucket_id='gh-procurement' and name like 'company-attachments/%' and private.proc_access_allowed() and private.proc_has_any_permission(array['company_lists.manage','procurement.rfq.manage']));
create function private.proc_company_attachment_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.storage_path not like 'company-attachments/'||new.company_id::text||'/%' or new.mime_type not in ('application/pdf','image/png','image/jpeg','image/webp') then raise exception 'Invalid company attachment path or type';end if;
 if new.po_id is not null and not exists(select 1 from public.proc_purchase_orders where id=new.po_id and company_id=new.company_id) then raise exception 'Order does not belong to this company';end if;
 if new.item_id is not null and not exists(select 1 from public.proc_company_list_items where item_id=new.item_id and company_id=new.company_id and active) then raise exception 'Item does not belong to this company';end if;
 if new.quote_id is not null and not exists(select 1 from public.proc_quotes where id=new.quote_id and supplier_id=new.supplier_id) then raise exception 'Quotation does not belong to the selected supplier';end if;
 return new;
end $$;
revoke all on function private.proc_company_attachment_guard() from public,anon,authenticated;
create trigger company_attachment_guard before insert or update on public.proc_company_attachments for each row execute function private.proc_company_attachment_guard();

create function private.proc_company_link_count(p_company_id uuid,p_count_id uuid) returns uuid[] language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
 perform private.proc_assert_access();
 if not private.proc_has_permission('stock.count.enter') or not exists(select 1 from public.proc_stock_counts where id=p_count_id and counted_by=auth.uid() and status='submitted') or exists(select 1 from public.proc_stock_count_lines l where l.count_id=p_count_id and not exists(select 1 from public.proc_company_list_items where company_id=p_company_id and item_id=l.item_id and active)) then raise exception 'Invalid company count scope';end if;
 update public.proc_requirements set company_id=p_company_id where source_count_line_id in(select id from public.proc_stock_count_lines where count_id=p_count_id);
 select array_agg(id) into ids from public.proc_requirements where company_id=p_company_id and source_count_line_id in(select id from public.proc_stock_count_lines where count_id=p_count_id) and adjusted_qty>ordered_qty;
 return ids;
end $$;
revoke all on function private.proc_company_link_count(uuid,uuid) from public,anon;
grant execute on function private.proc_company_link_count(uuid,uuid) to authenticated;

-- A stock handler may read only explicitly selected supplier documents during an owned dispatch.
create function private.proc_company_can_send_attachment(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select private.proc_access_allowed() and exists(select 1 from public.proc_company_attachments a
 join public.proc_company_dispatch_queue q on q.company_id=a.company_id join public.proc_purchase_orders p on p.id=q.po_id
 where a.storage_path=p_path and a.send_with_order and a.kind in ('price_list','order') and (a.po_id is null or a.po_id=p.id)
 and (a.supplier_id is null or a.supplier_id=p.supplier_id) and (a.item_id is null or exists(select 1 from public.proc_po_lines where po_id=p.id and item_id=a.item_id)) and q.status='sending' and q.claimed_by=auth.uid())
$$;
revoke all on function private.proc_company_can_send_attachment(text) from public,anon;
grant execute on function private.proc_company_can_send_attachment(text) to authenticated;
create policy company_attachment_automatic_read on storage.objects for select to authenticated using(bucket_id='gh-procurement' and name like 'company-attachments/%' and private.proc_company_can_send_attachment(name));
create policy company_docs_auto_dispatch_read on public.proc_company_attachments for select to authenticated using(private.proc_company_can_send_attachment(storage_path));

create or replace function public.proc_quick_add_item_v1(p_item jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare i public.proc_items; description_v text; category_v text; size_v text; brand_v text; uom_v text; movement_v text; max_v numeric; identity_v text;colour_v text;variation_v text;
begin
 if auth.uid() is null or not private.proc_has_permission('items.edit') then raise exception 'Item editing permission required' using errcode='42501'; end if;
 description_v:=trim(coalesce(p_item->>'description',''));
 category_v:=trim(coalesce(p_item->>'category',''));
 uom_v:=upper(trim(coalesce(p_item->>'uom','PCS')));
 size_v:=trim(coalesce(p_item->>'size',''));brand_v:=trim(coalesce(p_item->>'brand',''));
 colour_v:=trim(coalesce(p_item->>'colour',''));variation_v:=trim(coalesce(p_item->>'variation',''));
 movement_v:=upper(coalesce(nullif(p_item->>'movement',''),'NORMAL'));
 max_v:=coalesce(nullif(p_item->>'max_stock','')::numeric,0);
 if description_v='' or category_v='' or uom_v='' then raise exception 'Item name, category and UOM are required'; end if;
 if movement_v not in ('FAST','NORMAL','SLOW') or max_v<0 or max_v::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid movement or maximum stock'; end if;
 identity_v:=lower(concat_ws('|',description_v,size_v,brand_v,category_v,uom_v,colour_v,variation_v));
 perform pg_advisory_xact_lock(hashtextextended(identity_v,0));
 select * into i from public.proc_items where lower(trim(description))=lower(description_v) and lower(trim(coalesce(size,'')))=lower(size_v) and lower(trim(coalesce(brand,'')))=lower(brand_v) and lower(trim(category))=lower(category_v) and upper(trim(uom))=uom_v and coalesce(colour,'')=colour_v and coalesce(variation,'')=variation_v order by active desc,created_at limit 1;
 if i.id is not null then
  if not i.active then raise exception 'This item already exists but is disabled. Enable it in Item Master.'; end if;
  return jsonb_build_object('existing',true,'item',to_jsonb(i));
 end if;
 insert into public.proc_items(item_code,description,category,size,brand,uom,main_group,subgroup,movement,max_stock,source,colour,variation)
 values('QA-'||upper(replace(gen_random_uuid()::text,'-','')),description_v,category_v,nullif(size_v,''),nullif(brand_v,''),uom_v,nullif(trim(p_item->>'main_group'),''),nullif(trim(p_item->>'subgroup'),''),movement_v,max_v,'QUICK ADD',nullif(colour_v,''),nullif(variation_v,'')) returning * into i;
 return jsonb_build_object('existing',false,'item',to_jsonb(i));
end $$;

-- Keep existing Super Admin force-delete previews aware of the new linked records.
create or replace function private.proc_record_delete_tables()
returns text[] language sql immutable set search_path='' as $$
 select array['proc_company_dispatch_queue','proc_company_attachments','proc_company_contacts','proc_automation_jobs','proc_whatsapp_po_dispatches','proc_whatsapp_rfq_dispatches','proc_po_balance_actions','proc_rejection_cases','proc_grn_lines','proc_grns','proc_invoice_lines','proc_supplier_invoices','proc_po_lines','proc_purchase_orders','proc_awards','proc_quote_lines','proc_quotes','proc_rfq_suppliers','proc_rfq_items','proc_rfqs','proc_item_requests','proc_requirements','proc_company_price_documents','proc_company_price_list_lines','proc_company_price_lists','proc_company_list_items','proc_stock_count_lines','proc_stock_counts','proc_supplier_scopes','proc_companies','proc_suppliers']
$$;

-- Avoid SQL inlining recursively expanding constant reset scopes.
create or replace function private.proc_data_reset_tables(p_scope text)
returns text[] language plpgsql immutable set search_path='' as $$
 begin return case p_scope
 when 'procurement' then array['proc_company_attachments','proc_company_dispatch_queue','proc_automation_jobs','proc_whatsapp_po_dispatches','proc_whatsapp_rfq_dispatches','proc_po_balance_actions','proc_rejection_cases','proc_grn_lines','proc_grns','proc_invoice_lines','proc_supplier_invoices','proc_po_lines','proc_purchase_orders','proc_awards','proc_quote_lines','proc_quotes','proc_rfq_suppliers','proc_rfq_items','proc_rfqs','proc_item_requests','proc_requirements']
 when 'lists' then array['proc_company_attachments','proc_company_price_documents','proc_company_price_list_lines','proc_company_price_lists','proc_company_list_items']
 when 'stock' then array['proc_stock_count_drafts','proc_stock_balances']
 when 'full' then array['proc_company_attachments','proc_company_dispatch_queue','proc_automation_jobs','proc_whatsapp_po_dispatches','proc_whatsapp_rfq_dispatches','proc_po_balance_actions','proc_rejection_cases','proc_grn_lines','proc_grns','proc_invoice_lines','proc_supplier_invoices','proc_po_lines','proc_purchase_orders','proc_awards','proc_quote_lines','proc_quotes','proc_rfq_suppliers','proc_rfq_items','proc_rfqs','proc_item_requests','proc_requirements']||array['proc_company_price_documents','proc_company_price_list_lines','proc_company_price_lists','proc_company_list_items']||array['proc_stock_ledger','proc_stock_count_lines','proc_stock_counts','proc_stock_count_drafts','proc_stock_balances']
 else null end; end
$$;

create trigger proc_company_attachment_audit after insert or update or delete on public.proc_company_attachments for each row execute function private.proc_audit_row();
create trigger proc_company_contact_audit after insert or update or delete on public.proc_company_contacts for each row execute function private.proc_audit_row();
