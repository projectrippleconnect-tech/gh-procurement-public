-- Additive supplier-facing quotation intake. No existing RFQ, quote or PO tables are modified.
-- Intentional release gate: confirmation is not a PO authorization or automatic dispatch.
begin;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.proc_supplier_portal_links(
 id uuid primary key default gen_random_uuid(),
 rfq_supplier_id uuid not null unique references public.proc_rfq_suppliers(id) on delete cascade,
 token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 opens_at timestamptz not null default now(),
 closes_at timestamptz not null,
 revoked_at timestamptz,
 revision integer not null default 0 check(revision>=0),
 status text not null default 'draft' check(status in ('draft','confirmed','imported')),
 response jsonb not null default '[]'::jsonb check(jsonb_typeof(response)='array'),
 confirmed_at timestamptz,
 imported_at timestamptz,
 imported_revision integer,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint proc_portal_closes_after_open check(closes_at>opens_at)
);
create index if not exists proc_supplier_portal_links_due_idx
 on public.proc_supplier_portal_links(closes_at) where revoked_at is null;
create table if not exists public.proc_supplier_portal_history(
 id bigint generated always as identity primary key,
 link_id uuid not null references public.proc_supplier_portal_links(id) on delete cascade,
 revision integer not null,
 confirmed boolean not null,
 changed_at timestamptz not null default now(),
 response_summary jsonb not null default '[]'::jsonb,
 unique(link_id,revision)
);

alter table public.proc_supplier_portal_links enable row level security;
alter table public.proc_supplier_portal_history enable row level security;
revoke all on public.proc_supplier_portal_links from public,anon,authenticated;
revoke all on public.proc_supplier_portal_history from public,anon,authenticated;
revoke all on sequence public.proc_supplier_portal_history_id_seq from public,anon,authenticated;

-- Tokens are generated using crypto.getRandomValues(32) in staff browser; only their SHA-256 hash is saved.
create or replace function public.proc_portal_issue_link_v1(
 p_rfq_supplier_id uuid,p_token_hash text,p_hours integer default 6
) returns jsonb language plpgsql security definer set search_path='' as $$
declare rec public.proc_rfq_suppliers; request public.proc_rfqs; access public.proc_supplier_portal_links;
begin
 if auth.uid() is null or not private.proc_has_permission('procurement.rfq.manage') then
  raise exception 'Not authorized' using errcode='42501';
 end if;
 perform private.proc_assert_access();
 if p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid link token hash'; end if;
 if p_hours not between 1 and 48 then raise exception 'Window must be 1–48 hours'; end if;
 select * into rec from public.proc_rfq_suppliers where id=p_rfq_supplier_id;
 if not found then raise exception 'Supplier invitation not found'; end if;
 select * into request from public.proc_rfqs where id=rec.rfq_id;
 if request.status not in ('draft','prepared','sent','partially_quoted','quoted') then
  raise exception 'RFQ already closed or awarded';
 end if;
 if exists(select 1 from public.proc_supplier_portal_links where rfq_supplier_id=p_rfq_supplier_id and status='imported') then
  raise exception 'Supplier prices already imported. Create a new RFQ before issuing another link';
 end if;
 insert into public.proc_supplier_portal_links(rfq_supplier_id,token_hash,closes_at,created_by)
 values(p_rfq_supplier_id,p_token_hash,now()+make_interval(hours=>p_hours),auth.uid())
 on conflict(rfq_supplier_id) do update
 set token_hash=excluded.token_hash,opens_at=now(),closes_at=excluded.closes_at,
     revoked_at=null,status='draft',confirmed_at=null,updated_at=now()
 returning * into access;
 return jsonb_build_object('link_id',access.id,'closes_at',access.closes_at,'status',access.status);
end $$;

create or replace function public.proc_portal_read_v1(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare access record; entries jsonb;
begin
 if p_token is null or length(p_token)>200 or length(p_token)<24 then
  raise exception 'Invalid quotation link' using errcode='42501';
 end if;
 select l.*,rs.supplier_id,rs.rfq_id,rs.requested_item_ids,s.name as supplier_name,r.rfq_no,r.status as rfq_status
 into access
 from public.proc_supplier_portal_links l
 join public.proc_rfq_suppliers rs on rs.id=l.rfq_supplier_id
 join public.proc_suppliers s on s.id=rs.supplier_id
 join public.proc_rfqs r on r.id=rs.rfq_id
 where l.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and l.revoked_at is null;
 if not found then raise exception 'Invalid or revoked quotation link' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',ri.id,'description',i.description,'size',i.size,'uom',i.uom,
  'requested_qty',ri.requested_qty,'item_code',i.item_code
 ) order by i.description,ri.id),'[]'::jsonb) into entries
 from public.proc_rfq_items ri
 join public.proc_requirements q on q.id=ri.requirement_id
 join public.proc_items i on i.id=q.item_id
 where ri.rfq_id=access.rfq_id
   and (coalesce(cardinality(access.requested_item_ids),0)=0 or ri.id=any(access.requested_item_ids));
 return jsonb_build_object('rfq_no',access.rfq_no,'supplier_name',access.supplier_name,
  'items',entries,'closes_at',access.closes_at,'server_now',now(),
  'can_edit',now()<access.closes_at and access.rfq_status in ('draft','prepared','sent','partially_quoted','quoted'),
  'status',access.status,'revision',access.revision,'response',access.response,
  'confirmed_at',access.confirmed_at);
end $$;

-- Draft saves and final confirmation are atomic. Each saved revision is checked for stale edits.
-- Both supplier item IDs and attachment sizes are validated server-side.
create or replace function public.proc_portal_submit_v1(
 p_token text,p_response jsonb,p_expected_revision integer,p_confirm boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare access record; line jsonb; option_line jsonb; item_id uuid;
 item_count integer; allowed_count integer; available numeric; price numeric; alternative_count integer;
 summary jsonb:='[]'::jsonb; seen uuid[]:='{}'::uuid[];
begin
 if p_token is null or length(p_token)>200 or length(p_token)<24 then
  raise exception 'Invalid quotation link' using errcode='42501';
 end if;
 select l.*,rs.rfq_id,rs.requested_item_ids,r.status as rfq_status
 into access from public.proc_supplier_portal_links l
 join public.proc_rfq_suppliers rs on rs.id=l.rfq_supplier_id
 join public.proc_rfqs r on r.id=rs.rfq_id
 where l.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and l.revoked_at is null
 for update of l;
 if not found then raise exception 'Invalid or revoked quotation link' using errcode='42501'; end if;
 if now()>=access.closes_at or access.rfq_status not in ('draft','prepared','sent','partially_quoted','quoted') then
  raise exception 'Quotation window is closed';
 end if;
 if access.status='imported' then raise exception 'Quotation already imported: request a new link'; end if;
 if p_expected_revision is distinct from access.revision then
  raise exception 'Quotation was changed in another window. Reload before saving' using errcode='40001';
 end if;
 if jsonb_typeof(p_response)<>'array' or jsonb_array_length(p_response)>100
    or octet_length(p_response::text)>1500000 then
  raise exception 'Invalid or oversized quotation';
 end if;
 select count(*) into allowed_count from public.proc_rfq_items ri
 where ri.rfq_id=access.rfq_id
  and (coalesce(cardinality(access.requested_item_ids),0)=0 or ri.id=any(access.requested_item_ids));
 for line in select * from jsonb_array_elements(p_response) loop
  if jsonb_typeof(line)<>'object' then raise exception 'Invalid item details'; end if;
  begin item_id:=(line->>'id')::uuid; exception when others then raise exception 'Invalid item identifier'; end;
  if item_id=any(seen) or not exists(
   select 1 from public.proc_rfq_items ri where ri.id=item_id and ri.rfq_id=access.rfq_id
    and (coalesce(cardinality(access.requested_item_ids),0)=0 or ri.id=any(access.requested_item_ids))
  ) then raise exception 'Duplicate or uninvited item'; end if;
  seen:=array_append(seen,item_id);
  if coalesce(line->>'status','') not in ('in_stock','no_stock','skip') then
   raise exception 'Select in stock, no stock, or skip';
  end if;
  if p_confirm and line->>'status'='skip' then raise exception 'Answer every item before confirming'; end if;
  if line->>'status'='in_stock' then
   begin price:=(line->>'price')::numeric;available:=(line->>'quantity')::numeric;
   exception when others then raise exception 'Enter valid price and quantity'; end;
   if price is null or price<0 or available is null or available<=0
      or price::text in ('NaN','Infinity','-Infinity') or available::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Price and quantity must be valid nonnegative numbers'; end if;
  end if;
  if length(coalesce(line->>'image',''))>210000
     or (line->>'image') is not null and line->>'image'!~'^data:image/(jpeg|png|webp);base64,' then
   raise exception 'Image must be JPEG, PNG or WebP, maximum 150 KB';
  end if;
  if jsonb_typeof(coalesce(line->'variations','[]'::jsonb))<>'array'
    or jsonb_array_length(coalesce(line->'variations','[]'::jsonb))>4 then
   raise exception 'Maximum four variations per item';
  end if;
  for option_line in select * from jsonb_array_elements(coalesce(line->'variations','[]'::jsonb)) loop
   if length(trim(coalesce(option_line->>'name','')))<2 or length(option_line->>'name')>140 then
    raise exception 'Variation name must be 2–140 characters'; end if;
   begin price:=(option_line->>'price')::numeric;available:=(option_line->>'quantity')::numeric;
   exception when others then raise exception 'Invalid variation price or quantity'; end;
   if price is null or price<0 or available is null or available<=0
       or price::text in ('NaN','Infinity','-Infinity') or available::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Variation price or quantity is invalid'; end if;
   if length(coalesce(option_line->>'image',''))>210000
      or (option_line->>'image') is not null and option_line->>'image'!~'^data:image/(jpeg|png|webp);base64,' then
    raise exception 'Variation image is invalid or too large';
   end if;
  end loop;
  summary:=summary||jsonb_build_array(jsonb_build_object('id',item_id,'status',line->>'status','variations',jsonb_array_length(coalesce(line->'variations','[]'::jsonb))));
 end loop;
 item_count:=coalesce(array_length(seen,1),0);
 if p_confirm and item_count<>allowed_count then raise exception 'All requested items need an availability answer'; end if;
 update public.proc_supplier_portal_links
 set response=p_response,revision=revision+1,
  status=case when p_confirm then 'confirmed' else 'draft' end,
  confirmed_at=case when p_confirm then now() else null end,updated_at=now()
 where id=access.id;
 insert into public.proc_supplier_portal_history(link_id,revision,confirmed,response_summary)
 values(access.id,access.revision+1,p_confirm,summary);
 return jsonb_build_object('revision',access.revision+1,'status',case when p_confirm then 'confirmed' else 'draft' end,'closes_at',access.closes_at);
end $$;

-- Revoke a leaked supplier link without deleting the quotation or its audit trail.
create or replace function public.proc_portal_revoke_link_v1(p_link_id uuid)
returns boolean language plpgsql security definer set search_path='' as $
begin
 if auth.uid() is null or not private.proc_has_permission('procurement.rfq.manage') then
  raise exception 'Not authorized' using errcode='42501';
 end if;
 perform private.proc_assert_access();
 update public.proc_supplier_portal_links set revoked_at=now(),updated_at=now()
 where id=p_link_id and revoked_at is null;
 return found;
end $;

-- Authorized staff can inspect responses and their import status.
create or replace function public.proc_portal_staff_responses_v1(p_rfq_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare response jsonb;
begin
 if auth.uid() is null or not private.proc_has_permission('procurement.rfq.manage') then
  raise exception 'Not authorized' using errcode='42501'; end if;
 perform private.proc_assert_access();
 select coalesce(jsonb_agg(jsonb_build_object(
  'link_id',l.id,'rfq_supplier_id',l.rfq_supplier_id,'supplier_id',rs.supplier_id,
  'supplier_name',s.name,'closes_at',l.closes_at,'status',l.status,
  'revision',l.revision,'imported_revision',l.imported_revision,'revoked_at',l.revoked_at,
  'confirmed_at',l.confirmed_at,'response',l.response
 ) order by s.name),'[]'::jsonb) into response
 from public.proc_supplier_portal_links l
 join public.proc_rfq_suppliers rs on rs.id=l.rfq_supplier_id
 join public.proc_suppliers s on s.id=rs.supplier_id
 where rs.rfq_id=p_rfq_id;
 return response;
end $$;

-- Explicit staff import: existing guarded RFQ quotation workflow remains the only writer.
-- Alternatives are intentionally NOT mistaken for exact stock-item matches.
create or replace function public.proc_portal_import_confirmed_v1(
 p_link_id uuid,p_expected_revision integer
) returns jsonb language plpgsql security definer set search_path='' as $
declare access record; offer jsonb; lines jsonb:='[]'::jsonb; snapshot jsonb; result jsonb;
begin
 if auth.uid() is null or not private.proc_has_permission('procurement.rfq.manage') then
  raise exception 'Not authorized' using errcode='42501'; end if;
 perform private.proc_assert_access();
 select l.*,rs.rfq_id,rs.supplier_id into access
 from public.proc_supplier_portal_links l
 join public.proc_rfq_suppliers rs on rs.id=l.rfq_supplier_id
 where l.id=p_link_id for update of l;
 if not found or access.status not in ('confirmed','imported') then raise exception 'Supplier has not confirmed a quotation'; end if;
 if access.revoked_at is not null then raise exception 'Revoked supplier links cannot be imported'; end if;
 if p_expected_revision is distinct from access.revision then raise exception 'Supplier revised the quotation: refresh before importing'; end if;
 if access.imported_revision=access.revision then return jsonb_build_object('status','already_imported'); end if;
 for offer in select * from jsonb_array_elements(access.response) loop
  if offer->>'status'='in_stock' then
   lines:=lines||jsonb_build_array(jsonb_build_object(
    'rfq_item_id',offer->>'id','unit_price',(offer->>'price')::numeric,
    'available_qty',(offer->>'quantity')::numeric,
    'notes',left(coalesce(offer->>'notes',''),500)
   ));
  end if;
 end loop;
 if jsonb_array_length(lines)=0 then raise exception 'All items were marked no stock; mark supplier declined in Prices'; end if;
 snapshot:=public.proc_quote_snapshot_v1(access.rfq_id,access.supplier_id);
 result:=public.proc_save_quote_guarded_v1(access.rfq_id,access.supplier_id,snapshot->>'revision',
  'PORTAL-'||left(p_link_id::text,8),lines,'[]'::jsonb,null,null,
  'Confirmed supplier portal revision '||access.revision,0,0);
 update public.proc_supplier_portal_links set status='imported',
  imported_revision=access.revision,imported_at=now(),updated_at=now() where id=access.id;
 return coalesce(result,'{}'::jsonb)||jsonb_build_object('status','imported','revision',access.revision);
end $$;

revoke all on function public.proc_portal_revoke_link_v1(uuid) from public,anon;
revoke all on function public.proc_portal_issue_link_v1(uuid,text,integer) from public,anon;
revoke all on function public.proc_portal_read_v1(text) from public,anon,authenticated;
revoke all on function public.proc_portal_submit_v1(text,jsonb,integer,boolean) from public,anon,authenticated;
revoke all on function public.proc_portal_staff_responses_v1(uuid) from public,anon;
revoke all on function public.proc_portal_import_confirmed_v1(uuid,integer) from public,anon;
grant execute on function public.proc_portal_revoke_link_v1(uuid) to authenticated;
grant execute on function public.proc_portal_issue_link_v1(uuid,text,integer) to authenticated;
grant execute on function public.proc_portal_read_v1(text) to anon,authenticated;
grant execute on function public.proc_portal_submit_v1(text,jsonb,integer,boolean) to anon,authenticated;
grant execute on function public.proc_portal_staff_responses_v1(uuid) to authenticated;
grant execute on function public.proc_portal_import_confirmed_v1(uuid,integer) to authenticated;
commit;