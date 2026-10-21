-- Development only: additive round automation. No scheduler or live settings are enabled.
begin;
-- Optional portal terms preserve all existing quote records and manual cost behavior.
alter table public.proc_quote_lines add column portal_freight_unit numeric(16,4) check(portal_freight_unit>=0 and portal_freight_unit::text not in ('NaN','Infinity','-Infinity'));
alter table public.proc_quote_lines add column portal_valid_until date;
create or replace view public.proc_v_quote_comparison WITH (security_invoker=true) AS
 WITH line_cost AS (
         SELECT qi.rfq_id,
            qi.id AS rfq_item_id,
            qi.requirement_id,
            qi.requested_qty,
            s.id AS supplier_id,
            s.supplier_code,
            s.name AS supplier_name,
            q.id AS quote_id,
            q.quote_ref,
            q.quote_date,
            q.valid_until,
            q.freight_total,
            q.minimum_order_value,
            ql.id AS quote_line_id,
            ql.unit_price,
            ql.available_qty,
            ql.lead_days,
            ql.discount_percent,
            ql.tax_percent,
            ql.moq,
            ql.order_multiple,
            ql.portal_freight_unit,
            round(ql.unit_price * (1::numeric - ql.discount_percent / 100.0), 4) AS net_unit_price,
            round(ql.unit_price * (1::numeric - ql.discount_percent / 100.0) * (1::numeric + ql.tax_percent / 100.0), 4) AS effective_unit_price,
            sum(GREATEST(LEAST(COALESCE(ql.available_qty, qi.requested_qty), qi.requested_qty), 0::numeric)) OVER (PARTITION BY q.id) AS quote_qty_basis
           FROM proc_rfq_items qi
             JOIN proc_quotes q ON q.rfq_id = qi.rfq_id
             JOIN proc_suppliers s ON s.id = q.supplier_id AND s.active = true
             JOIN proc_quote_lines ql ON ql.quote_id = q.id AND ql.rfq_item_id = qi.id
          WHERE (q.status = ANY (ARRAY['received'::text, 'reviewed'::text, 'selected'::text])) AND ql.unit_price >= 0::numeric AND (ql.portal_valid_until IS NULL OR ql.portal_valid_until >= (now() AT TIME ZONE 'Asia/Colombo'::text)::date) AND (q.valid_until IS NULL OR q.valid_until >= (now() AT TIME ZONE 'Asia/Colombo'::text)::date)
        ), landed AS (
         SELECT lc.rfq_id,
            lc.rfq_item_id,
            lc.requirement_id,
            lc.requested_qty,
            lc.supplier_id,
            lc.supplier_code,
            lc.supplier_name,
            lc.quote_id,
            lc.quote_ref,
            lc.quote_date,
            lc.valid_until,
            lc.freight_total,
            lc.minimum_order_value,
            lc.quote_line_id,
            lc.unit_price,
            lc.available_qty,
            lc.lead_days,
            lc.discount_percent,
            lc.tax_percent,
            lc.moq,
            lc.order_multiple,
            lc.net_unit_price,
            lc.effective_unit_price,
            lc.quote_qty_basis,
            round(
                CASE
                    WHEN lc.portal_freight_unit IS NOT NULL THEN lc.portal_freight_unit
                    WHEN COALESCE(lc.quote_qty_basis, 0::numeric) > 0::numeric THEN lc.freight_total / lc.quote_qty_basis
                    ELSE 0::numeric
                END, 4) AS freight_unit_cost,
            round(lc.effective_unit_price +
                CASE
                    WHEN lc.portal_freight_unit IS NOT NULL THEN lc.portal_freight_unit
                    WHEN COALESCE(lc.quote_qty_basis, 0::numeric) > 0::numeric THEN lc.freight_total / lc.quote_qty_basis
                    ELSE 0::numeric
                END, 4) AS landed_unit_cost
           FROM line_cost lc
        )
 SELECT rfq_id,
    rfq_item_id,
    requirement_id,
    supplier_id,
    supplier_code,
    supplier_name,
    quote_id,
    quote_ref,
    quote_line_id,
    unit_price,
    available_qty,
    lead_days,
    discount_percent,
    tax_percent,
    dense_rank() OVER (PARTITION BY rfq_item_id ORDER BY effective_unit_price, supplier_code) AS price_rank,
    effective_unit_price,
    valid_until,
    net_unit_price,
    requested_qty,
    quote_date,
    freight_total,
    minimum_order_value,
    moq,
    order_multiple,
    quote_qty_basis,
    freight_unit_cost,
    landed_unit_cost,
    dense_rank() OVER (PARTITION BY rfq_item_id ORDER BY landed_unit_cost, supplier_code) AS landed_rank
   FROM landed;

create table public.proc_portal_rounds(
 id uuid primary key default gen_random_uuid(), rfq_id uuid not null unique references public.proc_rfqs(id),
 root_rfq_id uuid not null references public.proc_rfqs(id), round_no integer not null check(round_no between 1 and 2),
 company_id uuid references public.proc_companies(id), opens_at timestamptz not null default now(),
 closes_at timestamptz not null, state text not null default 'open' check(state in ('open','completed','exception')),
 policy jsonb not null, approved_by uuid not null references auth.users(id), result jsonb,
 created_at timestamptz not null default now(), unique(root_rfq_id,round_no)
);
create table public.proc_portal_po_jobs(
 id uuid primary key default gen_random_uuid(), round_id uuid not null references public.proc_portal_rounds(id),
 po_id uuid not null unique references public.proc_purchase_orders(id),
 status text not null default 'pending_approval' check(status in ('pending_approval','ready','sending','accepted','delivered','failed','unknown','blocked')),
 approved_by uuid references auth.users(id), approved_hash text, approved_phone text, approved_at timestamptz,
 claimed_at timestamptz, message_id text, last_error text, delivered_at timestamptz,
 unique(round_id,po_id)
);
create table public.proc_portal_round_audit(
 id bigint generated always as identity primary key, round_id uuid not null references public.proc_portal_rounds(id),
 kind text not null, detail jsonb not null, created_at timestamptz not null default now()
);
alter table public.proc_portal_rounds enable row level security;
alter table public.proc_portal_po_jobs enable row level security;
alter table public.proc_portal_round_audit enable row level security;
revoke all on public.proc_portal_rounds,public.proc_portal_po_jobs,public.proc_portal_round_audit from public,anon,authenticated;
revoke all on sequence public.proc_portal_round_audit_id_seq from public,anon,authenticated;

create function private.proc_portal_require_staff(p_permission text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.proc_has_permission(p_permission) then raise exception 'Not authorized' using errcode='42501'; end if;
 perform private.proc_assert_access();
end $$;
revoke all on function private.proc_portal_require_staff(text) from public,anon,authenticated;

-- Transaction-bound signed delegation lets the narrow portal functions honor the
-- existing permission triggers without forging a user's JWT or granting anonymous table writes.
create table private.proc_portal_signing_key(singleton boolean primary key default true check(singleton),secret bytea not null);
insert into private.proc_portal_signing_key values(true,extensions.gen_random_bytes(32));
alter table private.proc_portal_signing_key enable row level security;
revoke all on private.proc_portal_signing_key from public,anon,authenticated,service_role;
create function private.proc_portal_begin_context(p_actor uuid) returns text language plpgsql security definer set search_path='' as $$
declare payload text; signature text; previous text:=current_setting('gh.portal_context',true);
begin
 if not exists(select 1 from public.proc_profiles p join public.proc_roles r on r.role_key=p.role_key and r.enabled where p.id=p_actor and p.active and p.role in ('admin','procurement')) then raise exception 'Portal delegation owner is inactive'; end if;
 payload:=p_actor::text||':'||txid_current()::text;
 select encode(extensions.hmac(payload::bytea,secret,'sha256'),'hex') into signature from private.proc_portal_signing_key;
 perform set_config('gh.portal_context',payload||':'||signature,true);
 return coalesce(previous,'');
end $$;
revoke all on function private.proc_portal_begin_context(uuid) from public,anon,authenticated,service_role;
create or replace function private.proc_assert_permission(p_permission text) returns void language plpgsql stable security definer set search_path='' as $$
declare context text:=current_setting('gh.portal_context',true); payload text; signature text; actor uuid;
begin
 if private.proc_has_permission(p_permission) then return; end if;
 if p_permission in ('procurement.rfq.manage','procurement.orders.create','procurement.orders.edit','procurement.requirements.manage')
 and context ~ '^[0-9a-f-]{36}:[0-9]+:[0-9a-f]{64}$' then
  payload:=split_part(context,':',1)||':'||split_part(context,':',2);
  select encode(extensions.hmac(payload::bytea,secret,'sha256'),'hex') into signature from private.proc_portal_signing_key;
  actor:=split_part(context,':',1)::uuid;
  if split_part(context,':',2)=txid_current()::text and split_part(context,':',3)=signature
   and exists(select 1 from public.proc_profiles p join public.proc_roles r on r.role_key=p.role_key and r.enabled
    join public.proc_role_permissions rp on rp.role_key=p.role_key and rp.permission_key=p_permission and rp.allowed
    where p.id=actor and p.active and p.role in ('admin','procurement')) then return; end if;
 end if;
 raise exception 'Permission denied: %',p_permission using errcode='42501';
end $$;

-- All costs are LKR per quoted UOM. Freight is a confirmed PER-UNIT charge,
-- so partial awards cannot silently redistribute a fixed delivery charge.
create function private.proc_portal_terms(p_line jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare k text; n numeric; result jsonb:='{}'; d date;
begin
 if coalesce((p_line->>'terms_confirmed')::boolean,false) is not true then return null; end if;
 for k in select unnest(array['discount','tax','freight_unit','moq','multiple','lead_days']) loop
  n:=nullif(p_line->>k,'')::numeric;
  if n is null or n::text in ('NaN','Infinity','-Infinity') or n<0 or n>100000000 then raise exception 'Invalid commercial term: %',k; end if;
  if k in ('discount','tax','freight_unit') and round(n,4)<>n then raise exception 'Maximum four decimal places for rates'; end if;
  if k in ('moq','multiple') and round(n,3)<>n then raise exception 'Maximum three decimal places for quantities'; end if;
  if k in ('discount','tax') and n>100 then raise exception 'Percentage out of range'; end if;
  if k='multiple' and n<=0 then raise exception 'Order multiple must be positive'; end if;
  if k='lead_days' and (n<>trunc(n) or n>365) then raise exception 'Invalid delivery days'; end if;
  result:=result||jsonb_build_object(k,n);
 end loop;
 d:=(p_line->>'valid_until')::date;
 if d is null then raise exception 'Quotation validity is required'; end if;
 if length(coalesce(p_line->>'uom','')) not between 1 and 30 then raise exception 'Confirm the requested UOM'; end if;
 return result||jsonb_build_object('valid_until',d,'uom',p_line->>'uom');
end $$;
revoke all on function private.proc_portal_terms(jsonb) from public,anon,authenticated;

-- Called only after the capability-scoped submit validation, or by the round processor.
create function private.proc_portal_sync(p_link_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare previous_context text; l record; qid uuid; x jsonb; t jsonb; freight numeric:=0;
begin
 select a.*,rs.rfq_id,rs.supplier_id into l from public.proc_supplier_portal_links a
 join public.proc_rfq_suppliers rs on rs.id=a.rfq_supplier_id where a.id=p_link_id;
 if l.status not in ('confirmed','imported') or l.revoked_at is not null then return; end if;
 if not exists(select 1 from public.proc_profiles where id=l.created_by and active and role in ('admin','procurement')) then raise exception 'Invitation owner is no longer authorized'; end if;
 previous_context:=private.proc_portal_begin_context(l.created_by);
 -- Never replace official lines already referenced by an existing purchase order.
 if exists(select 1 from public.proc_po_lines pl join public.proc_quote_lines ql on ql.id=pl.source_quote_line_id
 join public.proc_quotes q on q.id=ql.quote_id where q.rfq_id=l.rfq_id and q.supplier_id=l.supplier_id) then raise exception 'Quotation has already been allocated'; end if;
 if not exists(select 1 from jsonb_array_elements(l.response) entry where entry->>'status'='in_stock') then
  delete from public.proc_quote_lines ql using public.proc_quotes q where ql.quote_id=q.id and q.rfq_id=l.rfq_id and q.supplier_id=l.supplier_id;
  update public.proc_rfq_suppliers set status='declined',replied_at=now() where id=l.rfq_supplier_id;
  perform set_config('gh.portal_context',previous_context,true);return;
 end if;
 for x in select * from jsonb_array_elements(l.response) loop
  if x->>'status'='in_stock' then t:=private.proc_portal_terms(x);freight:=freight+coalesce((t->>'freight_unit')::numeric,0)*(x->>'quantity')::numeric; end if;
 end loop;
 insert into public.proc_quotes(rfq_id,supplier_id,quote_ref,status,created_by,freight_total,notes)
 values(l.rfq_id,l.supplier_id,'PORTAL-'||l.id,'received',l.created_by,freight,'Supplier confirmed revision '||l.revision)
 on conflict(rfq_id,supplier_id) do update set status='received',freight_total=excluded.freight_total,quote_ref=excluded.quote_ref,notes=excluded.notes returning id into qid;
 delete from public.proc_quote_lines where quote_id=qid;
 for x in select * from jsonb_array_elements(l.response) loop
  if x->>'status'<>'in_stock' then continue; end if;
  t:=private.proc_portal_terms(x);
  insert into public.proc_quote_lines(quote_id,rfq_item_id,unit_price,available_qty,discount_percent,tax_percent,moq,order_multiple,lead_days,notes,portal_freight_unit,portal_valid_until)
  values(qid,(x->>'id')::uuid,(x->>'price')::numeric,(x->>'quantity')::numeric,
   coalesce((t->>'discount')::numeric,0),coalesce((t->>'tax')::numeric,0),coalesce((t->>'moq')::numeric,0),
   coalesce((t->>'multiple')::numeric,1),(t->>'lead_days')::integer,left(coalesce(x->>'notes',''),500),(t->>'freight_unit')::numeric,(t->>'valid_until')::date);
 end loop;
 update public.proc_supplier_portal_links set imported_revision=revision,imported_at=now() where id=l.id;
 update public.proc_rfq_suppliers set status='quoted',replied_at=now() where id=l.rfq_supplier_id;
 update public.proc_rfqs set status='partially_quoted' where id=l.rfq_id;
 perform set_config('gh.portal_context',previous_context,true);
end $$;
revoke all on function private.proc_portal_sync(uuid) from public,anon,authenticated;

alter function public.proc_portal_submit_v1(text,jsonb,integer,boolean) set schema private;
alter function private.proc_portal_submit_v1(text,jsonb,integer,boolean) rename to proc_portal_intake_v1;
revoke all on function private.proc_portal_intake_v1(text,jsonb,integer,boolean) from public,anon,authenticated;
create function public.proc_portal_submit_v1(p_token text,p_response jsonb,p_expected_revision integer,p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous_context text; actor uuid; rid uuid; lid uuid; x jsonb; t jsonb; result jsonb;
begin
 if p_token is null or p_token!~'^[0-9a-f]{64}$' then raise exception 'Invalid quotation link' using errcode='42501'; end if;
 select rs.rfq_id,l.id,l.created_by into rid,lid,actor from public.proc_supplier_portal_links l join public.proc_rfq_suppliers rs on rs.id=l.rfq_supplier_id
 where l.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and l.revoked_at is null;
 if rid is null then raise exception 'Invalid or revoked quotation link' using errcode='42501'; end if;
 -- Common lock ordering with manual quotes, award review and deadline processing.
 perform 1 from public.proc_rfqs where id=rid for update;
 if p_response is null or jsonb_typeof(p_response)<>'array' or jsonb_array_length(p_response)>100 or octet_length(p_response::text)>1500000 then raise exception 'Invalid quotation'; end if;
 for x in select * from jsonb_array_elements(p_response) loop
  if p_confirm and x->>'status'='in_stock' then
   t:=private.proc_portal_terms(x);
   if t is not null and not exists(select 1 from public.proc_rfq_items ri join public.proc_requirements r on r.id=ri.requirement_id
    join public.proc_items i on i.id=r.item_id where ri.id=(x->>'id')::uuid and i.uom=t->>'uom') then raise exception 'UOM does not match request'; end if;
  end if;
 end loop;
 result:=private.proc_portal_intake_v1(p_token,p_response,p_expected_revision,p_confirm);
 if p_confirm then perform private.proc_portal_sync(lid);
 else
  previous_context:=private.proc_portal_begin_context(actor);
  if exists(select 1 from public.proc_po_lines pl join public.proc_quote_lines ql on ql.id=pl.source_quote_line_id join public.proc_quotes q on q.id=ql.quote_id where q.rfq_id=rid and q.supplier_id=(select supplier_id from public.proc_rfq_suppliers rs join public.proc_supplier_portal_links l on l.rfq_supplier_id=rs.id where l.id=lid)) then raise exception 'Quotation has already been allocated'; end if;
  delete from public.proc_quote_lines ql using public.proc_quotes q,public.proc_rfq_suppliers rs,public.proc_supplier_portal_links l where ql.quote_id=q.id and q.rfq_id=rid and q.supplier_id=rs.supplier_id and rs.id=l.rfq_supplier_id and l.id=lid;
  perform set_config('gh.portal_context',previous_context,true);
 end if;
 return result;
end $$;
revoke all on function public.proc_portal_submit_v1(text,jsonb,integer,boolean) from public;
grant execute on function public.proc_portal_submit_v1(text,jsonb,integer,boolean) to anon,authenticated;

-- Explicit staff approval of a bounded purchasing round, independent of live worker activation.
create function public.proc_portal_start_round_v1(p_rfq_id uuid,p_max_po numeric,p_max_daily numeric,p_max_unit numeric,p_max_lead integer default 14)
returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid; groups integer; rid uuid; stamp timestamptz:=clock_timestamp();
begin
 perform private.proc_portal_require_staff('procurement.orders.approve');
 if not exists(select 1 from public.proc_profiles where id=auth.uid() and active and role='admin') then raise exception 'Admin approval required'; end if;
 if p_max_po is null or p_max_daily is null or p_max_unit is null or p_max_lead is null
 or p_max_po<=0 or p_max_daily<p_max_po or p_max_unit<=0 or p_max_lead not between 0 and 365
 or p_max_po::text in ('NaN','Infinity','-Infinity') or p_max_daily::text in ('NaN','Infinity','-Infinity') or p_max_unit::text in ('NaN','Infinity','-Infinity') then raise exception 'Positive finite purchasing limits are required'; end if;
 perform 1 from public.proc_rfqs where id=p_rfq_id and status in ('draft','prepared','sent','partially_quoted','quoted') for update;
 if not found then raise exception 'RFQ unavailable'; end if;
 select count(distinct coalesce(r.company_id,'00000000-0000-0000-0000-000000000000')), (array_agg(r.company_id))[1] into groups,cid
 from public.proc_rfq_items ri join public.proc_requirements r on r.id=ri.requirement_id where ri.rfq_id=p_rfq_id;
 if groups<>1 then raise exception 'A round must contain General Items or one company only'; end if;
 if not exists(select 1 from public.proc_rfq_suppliers where rfq_id=p_rfq_id) then raise exception 'Invite suppliers before opening a round'; end if;
 if exists(select 1 from public.proc_portal_rounds where rfq_id=p_rfq_id) then raise exception 'Round already started'; end if;
 insert into public.proc_portal_rounds(rfq_id,root_rfq_id,round_no,company_id,opens_at,closes_at,policy,approved_by)
 values(p_rfq_id,p_rfq_id,1,cid,stamp,stamp+interval '6 hours',jsonb_build_object('max_po',p_max_po,'max_daily',p_max_daily,'max_unit',p_max_unit,'max_lead',p_max_lead,
 'items',(select jsonb_agg(jsonb_build_object('requirement',r.id,'location',r.location_id,'category',i.category,'item',i.id,'description',i.description,'size',i.size,'uom',i.uom,'brand',i.brand,'colour',i.colour,'variation',i.variation,'requested_qty',ri.requested_qty)) from public.proc_rfq_items ri join public.proc_requirements r on r.id=ri.requirement_id join public.proc_items i on i.id=r.item_id where ri.rfq_id=p_rfq_id),
 'suppliers',(select jsonb_agg(supplier_id) from public.proc_rfq_suppliers where rfq_id=p_rfq_id)),auth.uid()) returning id into rid;
 update public.proc_supplier_portal_links l set closes_at=stamp+interval '6 hours' from public.proc_rfq_suppliers rs where rs.id=l.rfq_supplier_id and rs.rfq_id=p_rfq_id;
 insert into public.proc_portal_round_audit(round_id,kind,detail) values(rid,'round_approved',jsonb_build_object('by',auth.uid()));
 return rid;
end $$;
revoke all on function public.proc_portal_start_round_v1(uuid,numeric,numeric,numeric,integer) from public,anon;
grant execute on function public.proc_portal_start_round_v1(uuid,numeric,numeric,numeric,integer) to authenticated;

-- Keep every private link on its round's common deadline, even if issued later.
create function private.proc_portal_link_deadline() returns trigger language plpgsql set search_path='' as $$
declare deadline timestamptz;
begin
 select r.closes_at into deadline from public.proc_portal_rounds r join public.proc_rfq_suppliers rs on rs.rfq_id=r.rfq_id where rs.id=new.rfq_supplier_id and r.state='open';
 if deadline is not null then
  if deadline<=clock_timestamp() then raise exception 'Round already closed'; end if;
  new.closes_at:=deadline;
 end if;
 return new;
end $$;
revoke all on function private.proc_portal_link_deadline() from public,anon,authenticated;
create trigger proc_portal_link_deadline before insert or update on public.proc_supplier_portal_links for each row execute function private.proc_portal_link_deadline();

-- Snapshot is bound to quantities, commercial terms, recipient and supplier identity.
create function private.proc_portal_po_snapshot(p_po_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('po',to_jsonb(p),'supplier',jsonb_build_object('id',s.id,'name',s.name,'active',s.active,'phone',coalesce(nullif(s.whatsapp,''),s.phone)),
 'lines',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('description',i.description,'size',i.size,'uom',i.uom) order by l.id)
 from public.proc_po_lines l join public.proc_items i on i.id=l.item_id where l.po_id=p.id),'[]'))
 from public.proc_purchase_orders p join public.proc_suppliers s on s.id=p.supplier_id where p.id=p_po_id
$$;
revoke all on function private.proc_portal_po_snapshot(uuid) from public,anon,authenticated;

create function public.proc_portal_review_v1(p_rfq_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.proc_portal_require_staff('procurement.rfq.manage');
 select jsonb_build_object('round',to_jsonb(r),'jobs',coalesce((select jsonb_agg(to_jsonb(j)||jsonb_build_object('document',private.proc_portal_po_snapshot(j.po_id))) from public.proc_portal_po_jobs j where j.round_id=r.id),'[]'),
 'audit',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.proc_portal_round_audit a where a.round_id=r.id),'[]')) into result from public.proc_portal_rounds r where rfq_id=p_rfq_id;
 return result;
end $$;
revoke all on function public.proc_portal_review_v1(uuid) from public,anon;
grant execute on function public.proc_portal_review_v1(uuid) to authenticated;

-- Worker entry: service key is server-only. Interactive runs also require the approving admin.
create function public.proc_portal_process_round_v1(p_round_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous_context text; rd public.proc_portal_rounds; ri record; req public.proc_requirements; offer record; t jsonb; x jsonb;
 qty numeric; remaining numeric; landed numeric; effective numeric; freight numeric; pid uuid; plid uuid; qlid uuid;
 allocations jsonb:='[]'; a jsonb; po record; total_day numeric; next_rfq uuid; next_round uuid; inv record; new_inv uuid;
 residual jsonb:='[]'; outcome jsonb; known_supplier uuid; stamp timestamptz:=clock_timestamp();
begin
 if coalesce(auth.role(),'')<>'service_role' then perform private.proc_portal_require_staff('procurement.orders.approve'); end if;
 -- One global lock makes daily budgets atomic across different RFQs and worker replicas.
 perform pg_advisory_xact_lock(74121,1);
 select * into rd from public.proc_portal_rounds where id=p_round_id for update;
 if not found then raise exception 'Round not found'; end if;
 if coalesce(auth.role(),'')<>'service_role' and auth.uid()<>rd.approved_by then raise exception 'Only the approving admin may process this round'; end if;
 if rd.state<>'open' then return rd.result; end if;
 if stamp<rd.closes_at then return jsonb_build_object('status','waiting','closes_at',rd.closes_at); end if;
 if not exists(select 1 from public.proc_profiles p join public.proc_roles roles on roles.role_key=p.role_key and roles.enabled join public.proc_role_permissions rp on rp.role_key=p.role_key and rp.permission_key='procurement.orders.approve' and rp.allowed where p.id=rd.approved_by and p.active and p.role='admin') then raise exception 'Round approver is no longer active'; end if;
 previous_context:=private.proc_portal_begin_context(rd.approved_by);
 perform 1 from public.proc_rfqs where id=rd.rfq_id and status in ('draft','prepared','sent','partially_quoted','quoted') for update;
 if not found then raise exception 'RFQ was finalized elsewhere; review required'; end if;
 -- Lock current item specifications so an approved offer cannot switch products concurrently.
 perform 1 from public.proc_items it join public.proc_requirements r on r.item_id=it.id join public.proc_rfq_items i on i.requirement_id=r.id where i.rfq_id=rd.rfq_id order by it.id for share of it;
 -- Lock all shared requirements BEFORE reading balances. Existing direct/manual orders win.
 perform 1 from public.proc_requirements r where r.id in (select requirement_id from public.proc_rfq_items where rfq_id=rd.rfq_id) order by r.id for update;
 for ri in select i.* from public.proc_rfq_items i where i.rfq_id=rd.rfq_id and i.selected_for_po order by i.id loop
  select * into req from public.proc_requirements where id=ri.requirement_id;
  if not exists(select 1 from jsonb_array_elements(rd.policy->'items') z join public.proc_items it on it.id=req.item_id where z->>'requirement'=req.id::text and z->>'location'=req.location_id::text and z->>'category'=it.category and z->>'item'=it.id::text and z->>'description'=it.description and z->>'size' is not distinct from it.size and z->>'uom'=it.uom and z->>'brand' is not distinct from it.brand and z->>'colour' is not distinct from it.colour and z->>'variation' is not distinct from it.variation and ri.requested_qty<=(z->>'requested_qty')::numeric) then raise exception 'Approved purchasing scope changed'; end if;
  if req.status in ('cancelled','closed','received') or req.approval_status<>'approved' or not req.selected_for_order or req.company_id is distinct from rd.company_id then raise exception 'Requirement approval or company changed'; end if;
  remaining:=least(ri.requested_qty,greatest(req.adjusted_qty-req.ordered_qty,0));
  -- Eligible landed costs are ranked AFTER filtering unavailable, stale and incompatible offers.
  for offer in
   select l.id link_id,l.revision,rs.supplier_id,v.value line,
    ((v.value->>'price')::numeric*(1-(v.value->>'discount')::numeric/100)*(1+(v.value->>'tax')::numeric/100)+(v.value->>'freight_unit')::numeric) cost
   from public.proc_supplier_portal_links l join public.proc_rfq_suppliers rs on rs.id=l.rfq_supplier_id
   join public.proc_suppliers s on s.id=rs.supplier_id and s.active
   cross join lateral jsonb_array_elements(l.response) v(value)
   where rs.rfq_id=rd.rfq_id and l.status in ('confirmed','imported') and l.revoked_at is null
   and (rs.requested_item_ids is null or ri.id=any(rs.requested_item_ids))
   and (private.proc_supplier_covers_item_v1(rs.supplier_id,req.item_id) or nullif(trim(rs.scope_override_reason),'') is not null)
   and (v.value->>'price')::numeric>0
   and v.value->>'id'=ri.id::text and v.value->>'status'='in_stock' and v.value->>'terms_confirmed'='true'
   and rd.policy->'suppliers' @> to_jsonb(array[rs.supplier_id])
   order by cost,rs.supplier_id,l.id
  loop
   exit when remaining<=0;
   x:=offer.line;t:=private.proc_portal_terms(x);
   if (t->>'valid_until')::date<(stamp at time zone 'Asia/Colombo')::date or (t->>'lead_days')::integer>(rd.policy->>'max_lead')::integer
    or offer.cost<=0 or offer.cost>(rd.policy->>'max_unit')::numeric
    or not exists(select 1 from public.proc_items where id=req.item_id and active and uom=t->>'uom') then continue; end if;
   qty:=floor(least(remaining,(x->>'quantity')::numeric)/(t->>'multiple')::numeric)*(t->>'multiple')::numeric;
   if qty<=0 or qty<(t->>'moq')::numeric then continue; end if;
   allocations:=allocations||jsonb_build_array(jsonb_build_object('rfq_item_id',ri.id,'requirement_id',req.id,'item_id',req.item_id,'supplier_id',offer.supplier_id,'link_id',offer.link_id,'qty',qty,'price',(x->>'price')::numeric,'discount',t->'discount','tax',t->'tax','freight_unit',t->'freight_unit','cost',offer.cost));
   remaining:=remaining-qty;
  end loop;
 end loop;
 -- Finite money limits apply BEFORE any POs or reservations are written.
 if exists(select 1 from public.proc_purchase_orders p where p.quantity_only and p.total=0 and p.status<>'cancelled' and p.po_date=(stamp at time zone 'Asia/Colombo')::date) then raise exception 'Unpriced existing purchase order prevents verification of the daily purchasing limit'; end if;
 select coalesce(sum(p.total),0) into total_day from public.proc_purchase_orders p
 where p.status<>'cancelled' and p.po_date=(stamp at time zone 'Asia/Colombo')::date;
 for po in select (z->>'supplier_id')::uuid sid,sum(round((z->>'qty')::numeric*(z->>'price')::numeric*(1-(z->>'discount')::numeric/100)*(1+(z->>'tax')::numeric/100),2)) goods_amount,sum(round((z->>'qty')::numeric*(z->>'price')::numeric*(1-(z->>'discount')::numeric/100)*(1+(z->>'tax')::numeric/100),2))+round(sum((z->>'qty')::numeric*(z->>'freight_unit')::numeric),2) amount from jsonb_array_elements(allocations) z group by z->>'supplier_id' loop
  if po.goods_amount<(select coalesce(max(minimum_order_value),0) from public.proc_quotes where rfq_id=rd.rfq_id and supplier_id=po.sid) then raise exception 'Supplier minimum order value requires review'; end if;
  if po.amount>(rd.policy->>'max_po')::numeric or total_day+po.amount>(rd.policy->>'max_daily')::numeric then
   raise exception 'Purchasing limit exceeded: supplier %, amount %',po.sid,po.amount;
  end if;
  total_day:=total_day+po.amount;
 end loop;
 for po in select distinct (z->>'supplier_id')::uuid sid from jsonb_array_elements(allocations) z loop
  pid:=gen_random_uuid();
  insert into public.proc_purchase_orders(id,po_no,supplier_id,status,created_by,company_id,quantity_only,terms,notes)
  values(pid,'PORTAL-'||rd.round_no||'-'||pid,po.sid,'pending_approval',rd.approved_by,rd.company_id,false,'Supplier confirmed per-unit freight, discounts, taxes and delivery terms.','Supplier portal round '||rd.id);
  for a in select z from jsonb_array_elements(allocations) z where z->>'supplier_id'=po.sid::text loop
   select ql.id into qlid from public.proc_quote_lines ql join public.proc_quotes q on q.id=ql.quote_id where q.rfq_id=rd.rfq_id and q.supplier_id=po.sid and ql.rfq_item_id=(a->>'rfq_item_id')::uuid;
   if qlid is null or not exists(select 1 from public.proc_quote_lines where id=qlid and unit_price=(a->>'price')::numeric and discount_percent=(a->>'discount')::numeric and tax_percent=(a->>'tax')::numeric and available_qty>=(a->>'qty')::numeric and portal_freight_unit=(a->>'freight_unit')::numeric and (portal_valid_until is null or portal_valid_until>=(stamp at time zone 'Asia/Colombo')::date)) then raise exception 'Staff quotation changed after supplier confirmation; review required'; end if;
   insert into public.proc_po_lines(po_id,requirement_id,item_id,qty,unit_price,discount_percent,tax_percent,landed_unit_cost,source_quote_line_id)
   values(pid,(a->>'requirement_id')::uuid,(a->>'item_id')::uuid,(a->>'qty')::numeric,(a->>'price')::numeric,(a->>'discount')::numeric,(a->>'tax')::numeric,(a->>'cost')::numeric,qlid);
   insert into public.proc_awards(rfq_item_id,supplier_id,quote_line_id,awarded_qty,unit_price,
    discount_percent,tax_percent,effective_unit_cost,landed_unit_cost,award_method,awarded_by)
   values((a->>'rfq_item_id')::uuid,po.sid,qlid,(a->>'qty')::numeric,(a->>'price')::numeric,
    (a->>'discount')::numeric,(a->>'tax')::numeric,
    (a->>'price')::numeric*(1-(a->>'discount')::numeric/100)*(1+(a->>'tax')::numeric/100),
    (a->>'cost')::numeric,'recommended',rd.approved_by);
   update public.proc_quotes set status='selected' where id=(select quote_id from public.proc_quote_lines where id=qlid);
   update public.proc_requirements set ordered_qty=ordered_qty+(a->>'qty')::numeric,
    status=case when ordered_qty+(a->>'qty')::numeric>=adjusted_qty then 'ordered' else 'partially_ordered' end where id=(a->>'requirement_id')::uuid;
  end loop;
  select round(sum((z->>'qty')::numeric*(z->>'freight_unit')::numeric),2) into freight from jsonb_array_elements(allocations) z where z->>'supplier_id'=po.sid::text;
  update public.proc_purchase_orders p set subtotal=v.net,tax_total=v.tax,freight_total=freight,total=v.goods+freight
  from(select sum(round(pl.qty*pl.unit_price*(1-pl.discount_percent/100),2)) net,sum(round(pl.qty*pl.unit_price*(1-pl.discount_percent/100)*pl.tax_percent/100,2)) tax,sum(pl.line_total) goods from public.proc_po_lines pl where pl.po_id=pid) v where p.id=pid;
  insert into public.proc_portal_po_jobs(round_id,po_id) values(rd.id,pid);
 end loop;
 -- Reopen uncovered balances only. These share requirement IDs, so later direct orders
 -- are deducted again when round 2 closes. No new requirement or stock record is invented.
 for ri in select i.*,r.adjusted_qty,r.ordered_qty from public.proc_rfq_items i join public.proc_requirements r on r.id=i.requirement_id where i.rfq_id=rd.rfq_id and i.selected_for_po loop
  -- A requirement can exceed this approved RFQ's requested subset. Deduct this
  -- round's allocations from the subset before capping by the current shortage.
  qty:=greatest(least(ri.requested_qty-coalesce((select sum((z->>'qty')::numeric)
   from jsonb_array_elements(allocations) z where z->>'rfq_item_id'=ri.id::text),0),
   greatest(ri.adjusted_qty-ri.ordered_qty,0)),0);
  if qty>0 then residual:=residual||jsonb_build_array(jsonb_build_object('old_id',ri.id,'requirement_id',ri.requirement_id,'qty',qty)); end if;
 end loop;
 update public.proc_rfqs set status=case when jsonb_array_length(allocations)>0 then 'awarded' else 'closed' end where id=rd.rfq_id;
 if jsonb_array_length(residual)>0 and rd.round_no=1 then
  next_rfq:=gen_random_uuid();
  insert into public.proc_rfqs(id,rfq_no,status,created_by,notes) values(next_rfq,'RFQ-REOPEN-'||next_rfq,'prepared',rd.approved_by,'24-hour residual round from '||rd.rfq_id);
  for a in select * from jsonb_array_elements(residual) loop
   insert into public.proc_rfq_items(rfq_id,requirement_id,requested_qty) values(next_rfq,(a->>'requirement_id')::uuid,(a->>'qty')::numeric);
  end loop;
  insert into public.proc_portal_rounds(rfq_id,root_rfq_id,round_no,company_id,opens_at,closes_at,policy,approved_by)
  values(next_rfq,rd.root_rfq_id,2,rd.company_id,stamp,stamp+interval '24 hours',rd.policy,rd.approved_by) returning id into next_round;
  for inv in select * from public.proc_rfq_suppliers where rfq_id=rd.rfq_id loop
   insert into public.proc_rfq_suppliers(rfq_id,supplier_id,scope_override_reason,requested_item_ids)
   select next_rfq,inv.supplier_id,inv.scope_override_reason,array_agg(n.id) from public.proc_rfq_items n join public.proc_rfq_items old on old.requirement_id=n.requirement_id and old.rfq_id=rd.rfq_id
   where n.rfq_id=next_rfq and (inv.requested_item_ids is null or old.id=any(inv.requested_item_ids))
   having count(*)>0 returning id into new_inv;
   if new_inv is not null then
    -- Existing supplier link follows their next round; prior response is snapshotted below.
    insert into public.proc_portal_round_audit(round_id,kind,detail)
    select rd.id,'supplier_final_snapshot',jsonb_build_object('supplier_id',inv.supplier_id,'revision',l.revision,'response',l.response) from public.proc_supplier_portal_links l where l.rfq_supplier_id=inv.id;
    update public.proc_supplier_portal_links set rfq_supplier_id=new_inv,response='[]',revision=revision+1,status='draft',confirmed_at=null,imported_at=null,imported_revision=null,
     opens_at=stamp,closes_at=stamp+interval '24 hours' where rfq_supplier_id=inv.id and revoked_at is null;
   end if;
   new_inv:=null;
  end loop;
 end if;
 outcome:=jsonb_build_object('status','completed','allocations',allocations,'unfulfilled',residual,'next_rfq_id',next_rfq,'next_round_id',next_round);
 update public.proc_portal_rounds set state='completed',result=outcome where id=rd.id;
 update public.proc_rfqs set status=case when jsonb_array_length(allocations)>0 then 'awarded' else 'closed' end where id=rd.rfq_id;
 insert into public.proc_portal_round_audit(round_id,kind,detail) values(rd.id,'round_completed',outcome);
 perform set_config('gh.portal_context',previous_context,true);
 return outcome;
end $$;
revoke all on function public.proc_portal_process_round_v1(uuid) from public,anon;
grant execute on function public.proc_portal_process_round_v1(uuid) to authenticated,service_role;

create function public.proc_portal_due_rounds_v1() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Worker only' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(id),'[]') from (select id from public.proc_portal_rounds where state='open' and closes_at<=clock_timestamp() order by closes_at limit 20) r);
end $$;
revoke all on function public.proc_portal_due_rounds_v1() from public,anon,authenticated;
grant execute on function public.proc_portal_due_rounds_v1() to service_role;

-- Approval binds the exact approved PO and recipient. Any later edit invalidates dispatch.
create function public.proc_portal_allow_dispatch_v1(p_po_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare snap jsonb; phone text;
begin
 perform private.proc_portal_require_staff('procurement.orders.approve');
 perform 1 from public.proc_purchase_orders where id=p_po_id and status='approved' and approved_by is not null and approved_at is not null for update;
 if not found then raise exception 'Approve the purchase order in GH Orders first'; end if;
 snap:=private.proc_portal_po_snapshot(p_po_id);phone:=regexp_replace(snap->'supplier'->>'phone','[^0-9]','','g');
 if phone~'^0[0-9]{9}$' then phone:='94'||substring(phone from 2); end if;
 if phone!~'^94[0-9]{9}$' or snap->'supplier'->>'active'<>'true' then raise exception 'Verify an active supplier and Sri Lankan delivery number'; end if;
 update public.proc_portal_po_jobs set status='ready',approved_by=auth.uid(),approved_at=clock_timestamp(),approved_phone=phone,
 approved_hash=encode(extensions.digest(snap::text,'sha256'),'hex') where po_id=p_po_id and status='pending_approval';
 if not found then raise exception 'Dispatch was already authorized or attempted'; end if;
 return true;
end $$;
revoke all on function public.proc_portal_allow_dispatch_v1(uuid) from public,anon;
grant execute on function public.proc_portal_allow_dispatch_v1(uuid) to authenticated;

create function public.proc_portal_claim_dispatch_v1() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.proc_portal_po_jobs; snap jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Worker only' using errcode='42501'; end if;
 -- An interrupted send is unknown, never automatically retried.
 update public.proc_portal_po_jobs set status='unknown',last_error='Worker interrupted: reconcile delivery before any resend' where status='sending' and claimed_at<clock_timestamp()-interval '5 minutes';
 select * into j from public.proc_portal_po_jobs where status='ready' order by approved_at for update skip locked limit 1;
 if not found then return null; end if;
 perform 1 from public.proc_purchase_orders where id=j.po_id for update;
 snap:=private.proc_portal_po_snapshot(j.po_id);
 if snap->'po'->>'status'<>'approved' or snap->'supplier'->>'active'<>'true'
 or j.approved_hash is distinct from encode(extensions.digest(snap::text,'sha256'),'hex')
 or not exists(select 1 from public.proc_profiles p join public.proc_roles roles on roles.role_key=p.role_key and roles.enabled join public.proc_role_permissions rp on rp.role_key=p.role_key and rp.permission_key='procurement.orders.approve' and rp.allowed where p.id=j.approved_by and p.active and p.role='admin')
 or exists(select 1 from public.proc_whatsapp_po_dispatches where po_id=j.po_id) then
  update public.proc_portal_po_jobs set status='blocked',last_error='Approval, recipient or document changed, or an existing send attempt exists' where id=j.id;
  return jsonb_build_object('blocked',j.id);
 end if;
 -- Reserve the existing dispatch ledger too, preventing a concurrent legacy sender.
 insert into public.proc_whatsapp_po_dispatches(po_id,supplier_id,gateway_session,image_sha256,caption,status,sent_by)
 values(j.po_id,(snap->'po'->>'supplier_id')::uuid,'portal',j.approved_hash,'Supplier portal approved PO','sending',j.approved_by);
 update public.proc_portal_po_jobs set status='sending',claimed_at=clock_timestamp() where id=j.id;
 return jsonb_build_object('job_id',j.id,'phone',j.approved_phone,'document',snap);
end $$;
revoke all on function public.proc_portal_claim_dispatch_v1() from public,anon,authenticated;
grant execute on function public.proc_portal_claim_dispatch_v1() to service_role;

create function public.proc_portal_finish_dispatch_v1(p_job_id uuid,p_status text,p_message_id text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare pid uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Worker only' using errcode='42501'; end if;
 if p_status not in ('accepted','unknown','failed') or p_status is null then raise exception 'Invalid dispatch result'; end if;
 if p_status='accepted' and nullif(trim(p_message_id),'') is null then p_status:='unknown'; end if;
 update public.proc_portal_po_jobs set status=p_status,message_id=p_message_id,last_error=case when p_status='unknown' then 'Uncertain send. Inspect WhatsApp and reconcile the exact message; never resend automatically.' when p_status='failed' then 'Send rejected or document needs manual dispatch; review before any manual send.' else null end where id=p_job_id and status='sending' returning po_id into pid;
 if pid is null then return false; end if;
 update public.proc_whatsapp_po_dispatches set status=p_status,message_id=p_message_id where po_id=pid and status='sending';
 return true;
end $$;
revoke all on function public.proc_portal_finish_dispatch_v1(uuid,text,text) from public,anon,authenticated;
grant execute on function public.proc_portal_finish_dispatch_v1(uuid,text,text) to service_role;

create function public.proc_portal_record_exception_v1(p_round_id uuid,p_error text) returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Worker only' using errcode='42501'; end if;
 update public.proc_portal_rounds set state='exception',result=jsonb_build_object('status','exception','reason',left(p_error,500)) where id=p_round_id and state='open';
 if found then insert into public.proc_portal_round_audit(round_id,kind,detail) values(p_round_id,'exception',jsonb_build_object('reason',left(p_error,500))); end if;
end $$;
revoke all on function public.proc_portal_record_exception_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.proc_portal_record_exception_v1(uuid,text) to service_role;

create function public.proc_portal_retry_round_v1(p_round_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform private.proc_portal_require_staff('procurement.orders.approve');
 update public.proc_portal_rounds set state='open',result=null where id=p_round_id and state='exception' and approved_by=auth.uid();
 return found;
end $$;
revoke all on function public.proc_portal_retry_round_v1(uuid) from public,anon;
grant execute on function public.proc_portal_retry_round_v1(uuid) to authenticated;

-- A gateway acknowledgement is not a receipt. Staff must reconcile against WhatsApp.
create function public.proc_portal_confirm_delivery_v1(p_po_id uuid,p_message_id text,p_evidence text) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.proc_portal_po_jobs;
begin
 perform private.proc_portal_require_staff('procurement.orders.edit');
 if length(trim(coalesce(p_evidence,''))) not between 10 and 500 then raise exception 'Record verified delivery evidence'; end if;
 select * into j from public.proc_portal_po_jobs where po_id=p_po_id for update;
 if j.status not in ('accepted','unknown') or j.message_id is null or j.message_id is distinct from p_message_id then raise exception 'Reconcile the exact gateway message before confirming delivery'; end if;
 update public.proc_purchase_orders set status='sent' where id=p_po_id and status='approved';
 if not found then raise exception 'Order is no longer awaiting send confirmation'; end if;
 update public.proc_portal_po_jobs set status='delivered',delivered_at=clock_timestamp() where id=j.id;
 insert into public.proc_portal_round_audit(round_id,kind,detail) values(j.round_id,'delivery_verified',jsonb_build_object('po_id',p_po_id,'message_id',p_message_id,'by',auth.uid(),'evidence',p_evidence));
 return true;
end $$;
revoke all on function public.proc_portal_confirm_delivery_v1(uuid,text,text) from public,anon;
grant execute on function public.proc_portal_confirm_delivery_v1(uuid,text,text) to authenticated;

create function public.proc_portal_company_history_v1() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.proc_portal_require_staff('procurement.rfq.manage');
 return (select coalesce(jsonb_agg(jsonb_build_object('rfq_id',r.rfq_id,'rfq_no',f.rfq_no,'rfq_status',f.status,'company_id',r.company_id,'company_name',c.name,'created_at',r.created_at,
 'item_count',(select count(*) from public.proc_rfq_items where rfq_id=r.rfq_id),'supplier_count',(select count(*) from public.proc_rfq_suppliers where rfq_id=r.rfq_id),'sent_count',0,'failed_count',case when r.state='exception' then 1 else 0 end) order by r.created_at desc),'[]')
 from public.proc_portal_rounds r join public.proc_rfqs f on f.id=r.rfq_id join public.proc_companies c on c.id=r.company_id);
end $$;
revoke all on function public.proc_portal_company_history_v1() from public,anon;
grant execute on function public.proc_portal_company_history_v1() to authenticated;

create function public.proc_portal_reconcile_unknown_v1(p_po_id uuid,p_message_id text,p_evidence text) returns boolean language plpgsql security definer set search_path='' as $$
declare round_v uuid;
begin
 perform private.proc_portal_require_staff('procurement.orders.approve');
 if length(trim(coalesce(p_evidence,''))) not between 10 and 500 or length(trim(coalesce(p_message_id,''))) not between 1 and 200 then raise exception 'Record the exact verified gateway message ID and evidence'; end if;
 update public.proc_portal_po_jobs set message_id=p_message_id,last_error='Gateway message ID reconciled by staff; delivery confirmation still required' where po_id=p_po_id and status='unknown' and message_id is null returning round_id into round_v;
 if not found then raise exception 'No unresolved message ID to reconcile'; end if;
 update public.proc_whatsapp_po_dispatches set message_id=p_message_id where po_id=p_po_id;
 insert into public.proc_portal_round_audit(round_id,kind,detail) values(round_v,'unknown_reconciled',jsonb_build_object('po_id',p_po_id,'message_id',p_message_id,'by',auth.uid(),'evidence',p_evidence));
 return true;
end $$;
revoke all on function public.proc_portal_reconcile_unknown_v1(uuid,text,text) from public,anon;
grant execute on function public.proc_portal_reconcile_unknown_v1(uuid,text,text) to authenticated;

commit;
