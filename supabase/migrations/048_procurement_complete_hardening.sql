-- GH Procurement complete hardening: safer automation, quote logic, three-way matching and durable exceptions.
begin;

-- RFQs must not claim to be sent before a human or delivery integration confirms transmission.
alter table public.proc_rfqs drop constraint if exists proc_rfqs_status_check;
alter table public.proc_rfqs add constraint proc_rfqs_status_check
  check(status = any(array['draft','prepared','sent','partially_quoted','quoted','awarded','closed','cancelled']::text[]));

alter table public.proc_rfq_suppliers drop constraint if exists proc_rfq_suppliers_status_check;
alter table public.proc_rfq_suppliers add constraint proc_rfq_suppliers_status_check
  check(status = any(array['pending','prepared','sent','viewed','quoted','declined']::text[]));

alter table public.proc_rfq_suppliers
  add column if not exists sent_by uuid references auth.users(id);

alter table public.proc_purchase_orders
  add column if not exists auto_approved boolean not null default false,
  add column if not exists auto_approval_reason text;

alter table public.proc_supplier_invoices
  add column if not exists match_detail jsonb not null default '{}'::jsonb;

-- Durable automation/exception queue. This is intentionally visible only to operational roles.
create table if not exists public.proc_automation_jobs(
  id uuid primary key default gen_random_uuid(),
  job_type text not null check(job_type in ('stock_continue','rfq_send','rfq_reminder','award_retry','po_send','po_delivery_overdue')),
  entity_type text not null check(entity_type in ('stock_count','rfq','po')),
  entity_id uuid not null,
  status text not null default 'pending' check(status in ('pending','needs_action','completed','failed')),
  attempts integer not null default 0 check(attempts>=0),
  next_attempt_at timestamptz,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_type,entity_id)
);
create index if not exists proc_automation_jobs_status_due_idx
  on public.proc_automation_jobs(status,next_attempt_at,updated_at desc);

alter table public.proc_automation_jobs enable row level security;
grant select on public.proc_automation_jobs to authenticated;
revoke insert,update,delete on public.proc_automation_jobs from anon,authenticated,public;

drop policy if exists proc_automation_jobs_read on public.proc_automation_jobs;
create policy proc_automation_jobs_read on public.proc_automation_jobs
for select to authenticated
using(private.proc_has_any_permission(array[
  'procurement.requirements.manage',
  'procurement.rfq.manage',
  'procurement.orders.edit',
  'admin.audit.view'
]));

create or replace function private.proc_supplier_covers_item_v1(p_supplier_id uuid,p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(select 1 from public.proc_suppliers s where s.id=p_supplier_id and s.active=true)
  and (
    not exists(select 1 from public.proc_supplier_scopes sc where sc.supplier_id=p_supplier_id)
    or exists(
      select 1
      from public.proc_supplier_scopes sc
      join public.proc_items i on i.id=p_item_id
      where sc.supplier_id=p_supplier_id
        and (
          (sc.scope_type='item' and sc.item_id=i.id)
          or (sc.scope_type='category' and sc.scope_value=i.category)
          or (sc.scope_type='main_group' and sc.scope_value=i.main_group)
          or (sc.scope_type='subgroup' and sc.scope_value=i.subgroup)
        )
    )
  )
$$;
revoke all on function private.proc_supplier_covers_item_v1(uuid,uuid) from public,anon,authenticated;

create or replace function private.proc_upsert_automation_job_v1(
  p_job_type text,p_entity_type text,p_entity_id uuid,p_status text,p_payload jsonb default '{}'::jsonb,p_error text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare v_id uuid;
begin
  insert into public.proc_automation_jobs(job_type,entity_type,entity_id,status,payload,last_error,created_by,updated_at)
  values(p_job_type,p_entity_type,p_entity_id,p_status,coalesce(p_payload,'{}'::jsonb),p_error,auth.uid(),now())
  on conflict(job_type,entity_id) do update
  set entity_type=excluded.entity_type,
      status=excluded.status,
      payload=excluded.payload,
      last_error=excluded.last_error,
      updated_at=now()
  returning id into v_id;
  return v_id;
end $$;
revoke all on function private.proc_upsert_automation_job_v1(text,text,uuid,text,jsonb,text) from public,anon,authenticated;

-- Prepared RFQs are created automatically but are not reported as transmitted.
create or replace function public.proc_straight_through_stock_count_v2(p_count_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  caller uuid:=auth.uid();
  caller_role text;
  cfg jsonb;
  enabled_v boolean;
  req_ids uuid[];
  supplier_ids uuid[];
  supplier_limit_v integer;
  min_quotes_v integer;
  due_days_v integer;
  rfq_id uuid;
  rfq_no text;
  rid uuid;
  sid uuid;
  r public.proc_requirements;
  item_rec public.proc_items;
  coverage_ok boolean;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  select role into caller_role from public.proc_profiles where id=caller and active=true;
  if caller_role not in ('admin','procurement','stock_handler','stock_checker') then raise exception 'Not authorized'; end if;

  select enabled,coalesce(config,'{}'::jsonb) into enabled_v,cfg
  from public.proc_feature_settings where feature_key='procurement.straight_through';
  if not coalesce(enabled_v,false) then return jsonb_build_object('status','disabled'); end if;

  if not exists(select 1 from public.proc_stock_counts where id=p_count_id and status='submitted') then
    raise exception 'Submitted stock count not found';
  end if;

  select array_agg(req.id order by req.created_at) into req_ids
  from public.proc_requirements req
  join public.proc_stock_count_lines scl on scl.id=req.source_count_line_id
  where scl.count_id=p_count_id
    and req.status not in ('received','closed','cancelled')
    and greatest(req.adjusted_qty-req.ordered_qty,0)>0
    and not exists(
      select 1 from public.proc_rfq_items ri
      join public.proc_rfqs q on q.id=ri.rfq_id
      where ri.requirement_id=req.id
        and q.status in ('draft','prepared','sent','partially_quoted','quoted')
    );

  if coalesce(array_length(req_ids,1),0)=0 then
    perform private.proc_upsert_automation_job_v1('stock_continue','stock_count',p_count_id,'completed','{"result":"no_requirements"}'::jsonb,null);
    return jsonb_build_object('status','no_requirements');
  end if;

  update public.proc_requirements
  set approval_status='approved',selected_for_order=true,approved_by=caller,approved_at=now(),updated_at=now()
  where id=any(req_ids);

  select greatest(coalesce(nullif(config->>'minimum_quotes','')::integer,2),1)
  into min_quotes_v from public.proc_feature_settings where feature_key='quotes.minimum_quotes';
  min_quotes_v:=greatest(coalesce(min_quotes_v,2),1);
  supplier_limit_v:=least(greatest(coalesce(nullif(cfg->>'supplier_limit','')::integer,3),min_quotes_v),10);
  due_days_v:=greatest(coalesce(nullif(cfg->>'rfq_due_days','')::integer,2),0);

  select array_agg(supplier_id) into supplier_ids
  from (
    select supplier_id
    from public.proc_suggest_suppliers(req_ids)
    order by matched_items desc,unrestricted asc,supplier_name asc
    limit supplier_limit_v
  ) s;

  if coalesce(array_length(supplier_ids,1),0)=0 then
    perform private.proc_upsert_automation_job_v1(
      'stock_continue','stock_count',p_count_id,'needs_action',
      jsonb_build_object('reason','no_eligible_supplier','requirements',array_length(req_ids,1)),
      'No active eligible supplier covers the shortage.'
    );
    return jsonb_build_object('status','needs_supplier_setup','requirements',array_length(req_ids,1));
  end if;

  -- Expand up to 10 suppliers if needed so every item is covered.
  foreach rid in array req_ids loop
    select i.* into item_rec from public.proc_requirements rr join public.proc_items i on i.id=rr.item_id where rr.id=rid;
    select exists(select 1 from unnest(supplier_ids) x(supplier_id)
      where private.proc_supplier_covers_item_v1(x.supplier_id,item_rec.id)) into coverage_ok;
    if not coverage_ok then
      select array_agg(supplier_id) into supplier_ids
      from (
        select supplier_id from public.proc_suggest_suppliers(req_ids)
        order by matched_items desc,unrestricted asc,supplier_name asc
        limit 10
      ) expanded;
      exit;
    end if;
  end loop;

  foreach rid in array req_ids loop
    select i.* into item_rec from public.proc_requirements rr join public.proc_items i on i.id=rr.item_id where rr.id=rid;
    select exists(select 1 from unnest(supplier_ids) x(supplier_id)
      where private.proc_supplier_covers_item_v1(x.supplier_id,item_rec.id)) into coverage_ok;
    if not coverage_ok then
      perform private.proc_upsert_automation_job_v1(
        'stock_continue','stock_count',p_count_id,'needs_action',
        jsonb_build_object('reason','supplier_coverage_gap','requirement_id',rid),
        'At least one shortage has no eligible supplier.'
      );
      return jsonb_build_object('status','needs_supplier_setup','requirements',array_length(req_ids,1),'requirement_id',rid);
    end if;
  end loop;

  rfq_id:=gen_random_uuid();
  rfq_no:='RFQ-'||to_char(clock_timestamp(),'YYMMDD-HH24MISSMS');
  insert into public.proc_rfqs(id,rfq_no,status,due_date,notes,created_by)
  values(rfq_id,rfq_no,'prepared',current_date+due_days_v,'Automatically prepared from physical stock count '||p_count_id::text,caller);

  foreach rid in array req_ids loop
    select * into r from public.proc_requirements where id=rid for update;
    insert into public.proc_rfq_items(rfq_id,requirement_id,requested_qty)
    values(rfq_id,r.id,greatest(r.adjusted_qty-r.ordered_qty,0));
    update public.proc_requirements set status='quoting',updated_at=now() where id=r.id;
  end loop;

  foreach sid in array supplier_ids loop
    insert into public.proc_rfq_suppliers(rfq_id,supplier_id,status,sent_at,sent_by)
    values(rfq_id,sid,'pending',null,null);
  end loop;

  perform private.proc_upsert_automation_job_v1(
    'stock_continue','stock_count',p_count_id,'completed',
    jsonb_build_object('rfq_id',rfq_id,'rfq_no',rfq_no),null
  );
  perform private.proc_upsert_automation_job_v1(
    'rfq_send','rfq',rfq_id,'needs_action',
    jsonb_build_object('suppliers',array_length(supplier_ids,1),'due_date',current_date+due_days_v),
    'RFQ prepared. Confirm actual supplier transmission.'
  );

  return jsonb_build_object(
    'status','rfq_prepared','rfq_id',rfq_id,'rfq_no',rfq_no,
    'requirements',array_length(req_ids,1),'suppliers',array_length(supplier_ids,1),
    'configured_minimum_quotes',min_quotes_v,'due_date',current_date+due_days_v
  );
end $$;
revoke all on function public.proc_straight_through_stock_count_v2(uuid) from public,anon;
grant execute on function public.proc_straight_through_stock_count_v2(uuid) to authenticated;

-- One atomic browser call: stock is always committed, while a follow-on automation failure becomes a durable exception.
create or replace function public.proc_submit_stock_and_continue_v1(
  p_category text,p_lines jsonb,p_notes text default null,p_attachment_path text default null,p_count_started_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare base jsonb; auto jsonb; cid uuid;
begin
  base:=public.proc_submit_stock_check_v4(p_category,p_lines,p_notes,p_attachment_path,p_count_started_at);
  cid:=(base->>'count_id')::uuid;
  begin
    auto:=public.proc_straight_through_stock_count_v2(cid);
  exception when others then
    perform private.proc_upsert_automation_job_v1(
      'stock_continue','stock_count',cid,'failed','{}'::jsonb,sqlerrm
    );
    auto:=jsonb_build_object('status','automation_failed','error',sqlerrm);
  end;
  return base||jsonb_build_object('automation',auto);
end $$;
revoke all on function public.proc_submit_stock_and_continue_v1(text,jsonb,text,text,timestamptz) from public,anon;
grant execute on function public.proc_submit_stock_and_continue_v1(text,jsonb,text,text,timestamptz) to authenticated;

-- A stock-count start timestamp must come from the server, not from a browser clock.
create or replace function public.proc_begin_stock_count_session_v1()
returns timestamptz
language plpgsql
security definer
set search_path=''
as $begin_count$
declare
  caller uuid:=auth.uid();
  caller_role text;
  started timestamptz;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  select role into caller_role from public.proc_profiles where id=caller and active=true;
  if caller_role not in ('admin','procurement','stock_handler','stock_checker') then raise exception 'Not authorized'; end if;

  insert into public.proc_stock_count_drafts(owner_id,count_started_at)
  values(caller,now())
  on conflict(owner_id) do update
    set count_started_at=coalesce(public.proc_stock_count_drafts.count_started_at,now()),
        updated_at=now()
  returning count_started_at into started;

  return started;
end
$begin_count$;
revoke all on function public.proc_begin_stock_count_session_v1() from public,anon;
grant execute on function public.proc_begin_stock_count_session_v1() to authenticated;

create or replace function public.proc_submit_stock_and_continue_v2(
  p_category text,p_lines jsonb,p_notes text default null,p_attachment_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $submit_count$
declare
  caller uuid:=auth.uid();
  trusted_started timestamptz;
  base jsonb;
  auto jsonb;
  cid uuid;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  select count_started_at into trusted_started
  from public.proc_stock_count_drafts
  where owner_id=caller;

  if trusted_started is null then
    trusted_started:=public.proc_begin_stock_count_session_v1();
  end if;

  base:=public.proc_submit_stock_check_v4(p_category,p_lines,p_notes,p_attachment_path,trusted_started);
  cid:=(base->>'count_id')::uuid;

  begin
    auto:=public.proc_straight_through_stock_count_v2(cid);
  exception when others then
    perform private.proc_upsert_automation_job_v1(
      'stock_continue','stock_count',cid,'failed','{}'::jsonb,sqlerrm
    );
    auto:=jsonb_build_object('status','automation_failed','error',sqlerrm);
  end;

  delete from public.proc_stock_count_drafts where owner_id=caller;
  return base||jsonb_build_object('automation',auto);
end
$submit_count$;
revoke all on function public.proc_submit_stock_and_continue_v2(text,jsonb,text,text) from public,anon;
grant execute on function public.proc_submit_stock_and_continue_v2(text,jsonb,text,text) to authenticated;


-- Manual RFQ creation is truthful from the first audit event: PREPARED until transmission is confirmed.
create or replace function public.proc_create_rfq_v3(
  p_requirement_ids uuid[], p_supplier_ids uuid[], p_due_date date default null,
  p_notes text default null, p_scope_overrides jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
set search_path=''
as $rfq_v3$
declare
  caller uuid:=auth.uid();
  caller_role text;
  rid uuid;
  sid uuid;
  req public.proc_requirements;
  rfq_id uuid;
  rfq_no text;
  scopes_exist boolean;
  matched_count integer;
  override_reason text;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  select role into caller_role from public.proc_profiles where id=caller and active=true;
  if caller_role not in ('admin','procurement') then raise exception 'Not authorized'; end if;
  if coalesce(array_length(p_requirement_ids,1),0)=0 then raise exception 'Select at least one requirement'; end if;
  if coalesce(array_length(p_supplier_ids,1),0)=0 then raise exception 'Select at least one supplier'; end if;

  foreach rid in array p_requirement_ids loop
    select * into req from public.proc_requirements where id=rid for update;
    if req.id is null or req.status in ('received','closed','cancelled') then raise exception 'Invalid requirement'; end if;
    if req.approval_status<>'approved' or req.selected_for_order<>true then
      raise exception 'Requirement must be approved and selected before requesting supplier prices';
    end if;
    if greatest(req.adjusted_qty-req.ordered_qty,0)<=0 then raise exception 'Requirement has no remaining quantity to order'; end if;
    if exists(
      select 1 from public.proc_rfq_items ri
      join public.proc_rfqs q on q.id=ri.rfq_id
      where ri.requirement_id=req.id
        and q.status in ('draft','prepared','sent','partially_quoted','quoted')
    ) then raise exception 'Requirement is already in an active supplier price request'; end if;
  end loop;

  foreach sid in array p_supplier_ids loop
    if not exists(select 1 from public.proc_suppliers where id=sid and active=true) then raise exception 'Invalid or inactive supplier'; end if;
    select exists(select 1 from public.proc_supplier_scopes sc where sc.supplier_id=sid) into scopes_exist;
    if scopes_exist then
      select count(*) into matched_count
      from public.proc_requirements rr
      join public.proc_items i on i.id=rr.item_id
      where rr.id=any(p_requirement_ids)
        and exists(
          select 1 from public.proc_supplier_scopes sc
          where sc.supplier_id=sid
            and (
              (sc.scope_type='item' and sc.item_id=i.id)
              or (sc.scope_type='category' and sc.scope_value=i.category)
              or (sc.scope_type='main_group' and sc.scope_value=i.main_group)
              or (sc.scope_type='subgroup' and sc.scope_value=i.subgroup)
            )
        );
      if matched_count=0 then
        override_reason:=nullif(trim(coalesce(p_scope_overrides->>sid::text,'')),'');
        if override_reason is null then
          raise exception 'Supplier % does not cover any selected item. Add an override reason or choose another supplier.',
            (select name from public.proc_suppliers where id=sid);
        end if;
      end if;
    end if;
  end loop;

  rfq_no:='RFQ-'||to_char(clock_timestamp(),'YYMMDD-HH24MISSMS');
  insert into public.proc_rfqs(rfq_no,status,due_date,notes,created_by)
  values(rfq_no,'prepared',p_due_date,p_notes,caller)
  returning id into rfq_id;

  foreach rid in array p_requirement_ids loop
    select * into req from public.proc_requirements where id=rid for update;
    insert into public.proc_rfq_items(rfq_id,requirement_id,requested_qty)
    values(rfq_id,req.id,greatest(req.adjusted_qty-req.ordered_qty,0));
    update public.proc_requirements set status='quoting',updated_at=now() where id=req.id;
  end loop;

  foreach sid in array p_supplier_ids loop
    override_reason:=nullif(trim(coalesce(p_scope_overrides->>sid::text,'')),'');
    insert into public.proc_rfq_suppliers(rfq_id,supplier_id,status,sent_at,sent_by,scope_override_reason)
    values(rfq_id,sid,'pending',null,null,override_reason);
  end loop;

  perform private.proc_upsert_automation_job_v1(
    'rfq_send','rfq',rfq_id,'needs_action',
    jsonb_build_object('suppliers',coalesce(array_length(p_supplier_ids,1),0),'due_date',p_due_date),
    'RFQ prepared. Confirm actual supplier transmission.'
  );

  return jsonb_build_object('rfq_id',rfq_id,'rfq_no',rfq_no,'status','prepared');
end
$rfq_v3$;

revoke all on function public.proc_create_rfq_v3(uuid[],uuid[],date,text,jsonb) from public,anon;
grant execute on function public.proc_create_rfq_v3(uuid[],uuid[],date,text,jsonb) to authenticated;

-- Manual RFQs now also become prepared, never falsely "sent".
create or replace function public.proc_create_rfq_v4(
  p_requirement_ids uuid[],p_supplier_ids uuid[],p_due_date date default null,p_notes text default null,p_scope_overrides jsonb default '{}'::jsonb
)
returns jsonb
language sql
security invoker
set search_path=''
as $rfq_v4$
  select public.proc_create_rfq_v3(p_requirement_ids,p_supplier_ids,p_due_date,p_notes,p_scope_overrides)
$rfq_v4$;
revoke all on function public.proc_create_rfq_v4(uuid[],uuid[],date,text,jsonb) from public,anon;
grant execute on function public.proc_create_rfq_v4(uuid[],uuid[],date,text,jsonb) to authenticated;

create or replace function public.proc_mark_rfq_supplier_sent_v1(p_rfq_id uuid,p_supplier_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare caller uuid:=auth.uid(); caller_role text; remaining integer; header_status text;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  select role into caller_role from public.proc_profiles where id=caller and active=true;
  if caller_role not in ('admin','procurement') then raise exception 'Not authorized'; end if;

  update public.proc_rfq_suppliers
  set status='sent',sent_at=now(),sent_by=caller
  where rfq_id=p_rfq_id and supplier_id=p_supplier_id and status in ('pending','prepared','sent');
  if not found then raise exception 'Supplier request is not pending transmission'; end if;

  select count(*) into remaining from public.proc_rfq_suppliers
  where rfq_id=p_rfq_id and status in ('pending','prepared');

  select case
    when exists(select 1 from public.proc_rfq_suppliers where rfq_id=p_rfq_id and status='quoted') then 'partially_quoted'
    else 'sent'
  end into header_status;
  update public.proc_rfqs set status=header_status,updated_at=now() where id=p_rfq_id and status not in ('awarded','closed','cancelled');

  if remaining=0 then
    perform private.proc_upsert_automation_job_v1('rfq_send','rfq',p_rfq_id,'completed','{}'::jsonb,null);
  end if;
  return jsonb_build_object('status','sent','remaining_unsent',remaining);
end $$;
revoke all on function public.proc_mark_rfq_supplier_sent_v1(uuid,uuid) from public,anon;
grant execute on function public.proc_mark_rfq_supplier_sent_v1(uuid,uuid) to authenticated;

-- Landed cost uses intended quote quantity, never supplier-declared available stock; expired quotes are excluded.
create or replace view public.proc_v_quote_comparison
with (security_invoker=true)
as
with line_cost as (
  select qi.rfq_id,qi.id rfq_item_id,qi.requirement_id,qi.requested_qty,
         s.id supplier_id,s.supplier_code,s.name supplier_name,
         q.id quote_id,q.quote_ref,q.quote_date,q.valid_until,q.freight_total,q.minimum_order_value,
         ql.id quote_line_id,ql.unit_price,ql.available_qty,ql.lead_days,ql.discount_percent,ql.tax_percent,ql.moq,ql.order_multiple,
         round(ql.unit_price*(1-ql.discount_percent/100.0),4) net_unit_price,
         round(ql.unit_price*(1-ql.discount_percent/100.0)*(1+ql.tax_percent/100.0),4) effective_unit_price,
         sum(greatest(least(coalesce(ql.available_qty,qi.requested_qty),qi.requested_qty),0))
           over(partition by q.id) quote_qty_basis
  from public.proc_rfq_items qi
  join public.proc_quotes q on q.rfq_id=qi.rfq_id
  join public.proc_suppliers s on s.id=q.supplier_id and s.active=true
  join public.proc_quote_lines ql on ql.quote_id=q.id and ql.rfq_item_id=qi.id
  where q.status in ('received','reviewed','selected')
    and ql.unit_price>=0
    and (q.valid_until is null or q.valid_until>=current_date)
), landed as (
  select lc.*,
         round(case when coalesce(lc.quote_qty_basis,0)>0 then lc.freight_total/lc.quote_qty_basis else 0 end,4) freight_unit_cost,
         round(lc.effective_unit_price+case when coalesce(lc.quote_qty_basis,0)>0 then lc.freight_total/lc.quote_qty_basis else 0 end,4) landed_unit_cost
  from line_cost lc
)
select rfq_id,rfq_item_id,requirement_id,supplier_id,supplier_code,supplier_name,quote_id,quote_ref,quote_line_id,
       unit_price,available_qty,lead_days,discount_percent,tax_percent,
       dense_rank() over(partition by rfq_item_id order by landed.effective_unit_price,supplier_code) price_rank,
       effective_unit_price,valid_until,net_unit_price,requested_qty,quote_date,freight_total,minimum_order_value,
       moq,order_multiple,quote_qty_basis,freight_unit_cost,landed_unit_cost,
       dense_rank() over(partition by rfq_item_id order by landed.landed_unit_cost,supplier_code) landed_rank
from landed;

-- Validate quote sufficiency PER ITEM. The effective minimum automatically falls to the number of eligible suppliers actually available.
create or replace function public.proc_finalize_award_plan_v2(p_rfq_id uuid,p_allocations jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  caller uuid:=auth.uid(); caller_role text;
  preferred integer; ri record; eligible integer; required_q integer; received integer;
  exception_reason text; x jsonb; qid uuid; q_valid date; result jsonb;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  select role into caller_role from public.proc_profiles where id=caller and active=true;
  if caller_role not in ('admin','procurement') then raise exception 'Not authorized'; end if;

  select greatest(coalesce(nullif(config->>'minimum_quotes','')::integer,2),1)
  into preferred from public.proc_feature_settings where feature_key='quotes.minimum_quotes';
  preferred:=greatest(coalesce(preferred,2),1);
  select quote_exception_reason into exception_reason from public.proc_rfqs where id=p_rfq_id;

  for ri in
    select i.id rfq_item_id,r.item_id
    from public.proc_rfq_items i join public.proc_requirements r on r.id=i.requirement_id
    where i.rfq_id=p_rfq_id and i.selected_for_po=true
  loop
    select count(*) into eligible
    from public.proc_rfq_suppliers rs
    where rs.rfq_id=p_rfq_id
      and rs.status<>'declined'
      and private.proc_supplier_covers_item_v1(rs.supplier_id,ri.item_id);
    required_q:=least(preferred,greatest(eligible,1));

    select count(distinct q.supplier_id) into received
    from public.proc_quote_lines ql
    join public.proc_quotes q on q.id=ql.quote_id
    where q.rfq_id=p_rfq_id and ql.rfq_item_id=ri.rfq_item_id
      and q.status in ('received','reviewed','selected')
      and (q.valid_until is null or q.valid_until>=current_date);

    if received<required_q and nullif(trim(coalesce(exception_reason,'')),'') is null then
      raise exception 'Item % has only % valid quotation(s); % are required from the % eligible supplier(s).',
        ri.rfq_item_id,received,required_q,eligible;
    end if;
  end loop;

  for x in select * from jsonb_array_elements(p_allocations) loop
    select q.id,q.valid_until into qid,q_valid
    from public.proc_quote_lines ql join public.proc_quotes q on q.id=ql.quote_id
    where ql.id=(x->>'quote_line_id')::uuid and q.rfq_id=p_rfq_id;
    if qid is null then raise exception 'Award quote line does not belong to this RFQ'; end if;
    if q_valid is not null and q_valid<current_date then raise exception 'Expired quotation cannot be awarded'; end if;
  end loop;

  -- Legacy v1 has a global quote-count guard. Record a truthful system exception only when supplier availability itself is below the configured preference.
  if nullif(trim(coalesce(exception_reason,'')),'') is null
     and (select count(*) from public.proc_rfq_suppliers where rfq_id=p_rfq_id and status='quoted')<preferred then
    update public.proc_rfqs
    set quote_exception_reason='System: fewer eligible suppliers are available than the configured preferred quotation count.',
        updated_at=now()
    where id=p_rfq_id;
  end if;

  result:=public.proc_finalize_award_plan_v1(p_rfq_id,p_allocations);
  return result;
end $$;
revoke all on function public.proc_finalize_award_plan_v2(uuid,jsonb) from public,anon;
grant execute on function public.proc_finalize_award_plan_v2(uuid,jsonb) to authenticated;

create or replace function public.proc_try_auto_award_v2(p_rfq_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  caller uuid:=auth.uid(); caller_role text; cfg jsonb; enabled_v boolean;
  auto_award_v boolean; auto_approve_v boolean; approval_limit_v numeric; daily_limit_v numeric;
  preferred integer; ri record; r public.proc_requirements; cand record; supplier_rec record; perf record;
  eligible integer; required_q integer; received integer; target_qty numeric;
  min_history_v integer; min_fill_v numeric; max_variance_v numeric; urgent_lead_v integer; is_urgent boolean;
  allocations jsonb:='[]'::jsonb; po_result jsonb; po jsonb; approved_count integer:=0;
  daily_used numeric:=0; skip_reason text:=null;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  select role into caller_role from public.proc_profiles where id=caller and active=true;
  if caller_role not in ('admin','procurement') then raise exception 'Not authorized'; end if;

  select enabled,coalesce(config,'{}'::jsonb) into enabled_v,cfg
  from public.proc_feature_settings where feature_key='procurement.straight_through';
  auto_award_v:=coalesce((cfg->>'auto_award')::boolean,true);
  auto_approve_v:=coalesce((cfg->>'auto_approve_po')::boolean,true);
  approval_limit_v:=greatest(coalesce(nullif(cfg->>'po_auto_approval_limit','')::numeric,0),0);
  daily_limit_v:=greatest(coalesce(nullif(cfg->>'daily_auto_approval_limit','')::numeric,approval_limit_v),0);
  min_history_v:=greatest(coalesce(nullif(cfg->>'supplier_history_min_pos','')::integer,3),1);
  min_fill_v:=greatest(least(coalesce(nullif(cfg->>'supplier_min_fill_rate_pct','')::numeric,90),100),0);
  max_variance_v:=greatest(least(coalesce(nullif(cfg->>'supplier_max_invoice_variance_pct','')::numeric,25),100),0);
  urgent_lead_v:=greatest(coalesce(nullif(cfg->>'urgent_max_lead_days','')::integer,7),0);

  if not coalesce(enabled_v,false) or not auto_award_v then return jsonb_build_object('status','disabled'); end if;
  if not exists(select 1 from public.proc_rfqs where id=p_rfq_id) then raise exception 'RFQ not found'; end if;
  if exists(select 1 from public.proc_rfqs where id=p_rfq_id and status in ('awarded','closed','cancelled')) then
    return jsonb_build_object('status','already_finalized');
  end if;

  select greatest(coalesce(nullif(config->>'minimum_quotes','')::integer,2),1)
  into preferred from public.proc_feature_settings where feature_key='quotes.minimum_quotes';
  preferred:=greatest(coalesce(preferred,2),1);

  for ri in
    select i.*,req.item_id
    from public.proc_rfq_items i join public.proc_requirements req on req.id=i.requirement_id
    where i.rfq_id=p_rfq_id and i.selected_for_po=true order by i.id
  loop
    select count(*) into eligible
    from public.proc_rfq_suppliers rs
    where rs.rfq_id=p_rfq_id and rs.status<>'declined'
      and private.proc_supplier_covers_item_v1(rs.supplier_id,ri.item_id);
    required_q:=least(preferred,greatest(eligible,1));

    select count(distinct q.supplier_id) into received
    from public.proc_quote_lines ql join public.proc_quotes q on q.id=ql.quote_id
    where q.rfq_id=p_rfq_id and ql.rfq_item_id=ri.id
      and q.status in ('received','reviewed','selected')
      and (q.valid_until is null or q.valid_until>=current_date);

    if received<required_q then
      return jsonb_build_object('status','waiting_quotes','rfq_item_id',ri.id,'received',received,'required',required_q,'eligible_suppliers',eligible);
    end if;

    select * into r from public.proc_requirements where id=ri.requirement_id for update;
    target_qty:=least(ri.requested_qty,greatest(r.adjusted_qty-r.ordered_qty,0));
    if target_qty<=0 then continue; end if;

    select v.* into cand from public.proc_v_quote_comparison v
    where v.rfq_item_id=ri.id and v.landed_rank=1
      and (v.available_qty is null or v.available_qty>=target_qty)
      and coalesce(v.moq,0)<=target_qty
      and mod(target_qty,coalesce(nullif(v.order_multiple,0),1))=0
    order by v.landed_unit_cost,v.supplier_name limit 1;

    if not found then
      perform private.proc_upsert_automation_job_v1(
        'award_retry','rfq',p_rfq_id,'needs_action',
        jsonb_build_object('reason','best_quote_requires_split_moq_or_override','rfq_item_id',ri.id),
        'Best quotation needs split/MOQ/override review.'
      );
      return jsonb_build_object('status','needs_review','reason','best_quote_requires_split_moq_or_override','rfq_item_id',ri.id);
    end if;

    select * into perf from public.proc_v_supplier_performance where supplier_id=cand.supplier_id;

    if coalesce(perf.po_count,0)>=min_history_v
       and perf.completed_fill_rate_pct is not null
       and perf.completed_fill_rate_pct<min_fill_v then
      perform private.proc_upsert_automation_job_v1(
        'award_retry','rfq',p_rfq_id,'needs_action',
        jsonb_build_object('reason','supplier_fill_rate','supplier_id',cand.supplier_id,'fill_rate_pct',perf.completed_fill_rate_pct),
        'Lowest landed-cost supplier is below the configured historical fill-rate threshold.'
      );
      return jsonb_build_object('status','needs_review','reason','supplier_fill_rate','rfq_item_id',ri.id,
        'supplier_id',cand.supplier_id,'fill_rate_pct',perf.completed_fill_rate_pct,'minimum_fill_rate_pct',min_fill_v);
    end if;

    if coalesce(perf.invoice_count,0)>=min_history_v
       and (100.0*coalesce(perf.invoice_variance_count,0)/greatest(perf.invoice_count,1))>max_variance_v then
      perform private.proc_upsert_automation_job_v1(
        'award_retry','rfq',p_rfq_id,'needs_action',
        jsonb_build_object('reason','supplier_invoice_variance','supplier_id',cand.supplier_id),
        'Lowest landed-cost supplier has excessive historical invoice variance.'
      );
      return jsonb_build_object('status','needs_review','reason','supplier_invoice_variance','rfq_item_id',ri.id,
        'supplier_id',cand.supplier_id,'variance_pct',
        round(100.0*coalesce(perf.invoice_variance_count,0)/greatest(perf.invoice_count,1),1));
    end if;

    is_urgent:=coalesce(r.customer_paid,false)
      or coalesce(r.priority,'normal') in ('urgent','high')
      or (r.needed_by is not null and r.needed_by<=current_date+urgent_lead_v);
    if is_urgent and (cand.lead_days is null or cand.lead_days>urgent_lead_v) then
      perform private.proc_upsert_automation_job_v1(
        'award_retry','rfq',p_rfq_id,'needs_action',
        jsonb_build_object('reason','urgent_lead_time','supplier_id',cand.supplier_id,'lead_days',cand.lead_days),
        'Urgent requirement needs lead-time review.'
      );
      return jsonb_build_object('status','needs_review','reason','urgent_lead_time','rfq_item_id',ri.id,
        'supplier_id',cand.supplier_id,'lead_days',cand.lead_days,'maximum_auto_lead_days',urgent_lead_v);
    end if;

    allocations:=allocations||jsonb_build_array(jsonb_build_object(
      'rfq_item_id',ri.id,'quote_line_id',cand.quote_line_id,'qty',target_qty,'override_reason',null
    ));
  end loop;

  if jsonb_array_length(allocations)=0 then return jsonb_build_object('status','nothing_to_award'); end if;

  for supplier_rec in
    select v.supplier_id,max(q.minimum_order_value) minimum_order_value,
           sum((a->>'qty')::numeric*v.effective_unit_price) planned_goods_value
    from jsonb_array_elements(allocations) a
    join public.proc_v_quote_comparison v on v.quote_line_id=(a->>'quote_line_id')::uuid
    join public.proc_quotes q on q.id=v.quote_id
    group by v.supplier_id
  loop
    if coalesce(supplier_rec.minimum_order_value,0)>coalesce(supplier_rec.planned_goods_value,0) then
      return jsonb_build_object('status','needs_review','reason','supplier_minimum_order',
        'supplier_id',supplier_rec.supplier_id,'minimum_order_value',supplier_rec.minimum_order_value,
        'planned_goods_value',supplier_rec.planned_goods_value);
    end if;
  end loop;

  po_result:=public.proc_finalize_award_plan_v2(p_rfq_id,allocations);

  if auto_approve_v and approval_limit_v>0 and caller_role='admin' then
    select coalesce(sum(total),0) into daily_used
    from public.proc_purchase_orders
    where auto_approved=true and approved_at::date=current_date;

    for po in select value from jsonb_array_elements(po_result) loop
      if coalesce((po->>'total')::numeric,0)<=approval_limit_v
         and (daily_limit_v=0 or daily_used+coalesce((po->>'total')::numeric,0)<=daily_limit_v) then
        perform public.proc_approve_po_v2((po->>'po_id')::uuid);
        update public.proc_purchase_orders
        set auto_approved=true,auto_approval_reason='Straight-through safe landed-cost award within configured limits'
        where id=(po->>'po_id')::uuid;
        daily_used:=daily_used+coalesce((po->>'total')::numeric,0);
        approved_count:=approved_count+1;
      end if;
    end loop;
  elsif auto_approve_v and caller_role<>'admin' then
    skip_reason:='Admin approval required by PO control policy';
  end if;

  perform private.proc_upsert_automation_job_v1('award_retry','rfq',p_rfq_id,'completed','{}'::jsonb,null);

  return jsonb_build_object(
    'status','awarded','purchase_orders',po_result,'auto_approved',approved_count,
    'approval_limit',approval_limit_v,'daily_auto_approval_limit',daily_limit_v,
    'approval_note',skip_reason
  );
end $$;
revoke all on function public.proc_try_auto_award_v2(uuid) from public,anon;
grant execute on function public.proc_try_auto_award_v2(uuid) to authenticated;

create or replace function public.proc_retry_automation_job_v1(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare caller uuid:=auth.uid(); caller_role text; j public.proc_automation_jobs; result jsonb;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  select role into caller_role from public.proc_profiles where id=caller and active=true;
  if caller_role not in ('admin','procurement') then raise exception 'Not authorized'; end if;

  select * into j from public.proc_automation_jobs where id=p_job_id for update;
  if j.id is null then raise exception 'Automation job not found'; end if;

  update public.proc_automation_jobs set attempts=attempts+1,status='pending',last_error=null,updated_at=now() where id=j.id;
  begin
    if j.job_type='stock_continue' then
      result:=public.proc_straight_through_stock_count_v2(j.entity_id);
    elsif j.job_type='award_retry' then
      result:=public.proc_try_auto_award_v2(j.entity_id);
    else
      update public.proc_automation_jobs set status='needs_action',last_error='Confirm supplier transmission manually.',updated_at=now() where id=j.id;
      return jsonb_build_object('status','needs_action','reason','manual_send_confirmation');
    end if;
    return result;
  exception when others then
    update public.proc_automation_jobs set status='failed',last_error=sqlerrm,next_attempt_at=now()+interval '15 minutes',updated_at=now() where id=j.id;
    return jsonb_build_object('status','failed','error',sqlerrm);
  end;
end $$;
revoke all on function public.proc_retry_automation_job_v1(uuid) from public,anon;
grant execute on function public.proc_retry_automation_job_v1(uuid) to authenticated;

-- Rejected goods must be explained, and accepted quantities remain capped at ordered balance.
create or replace function public.proc_receive_po_v3(p_po_id uuid,p_receipt_key uuid,p_lines jsonb,p_notes text default null)
returns jsonb
language plpgsql
set search_path=''
as $$
declare
  caller uuid:=auth.uid(); caller_role text; po public.proc_purchase_orders; existing public.proc_grns;
  gid uuid; gno text; loc uuid; x jsonb; pl public.proc_po_lines;
  rec numeric; acc numeric; rej numeric; previously_accepted numeric; posted integer; reject_reason text;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  select role into caller_role from public.proc_profiles where id=caller and active=true;
  if caller_role not in ('admin','procurement','receiver') then raise exception 'Not authorized'; end if;
  if p_receipt_key is null then raise exception 'Receipt key is required'; end if;

  select * into existing from public.proc_grns where receipt_key=p_receipt_key;
  if existing.id is not null then
    if existing.po_id<>p_po_id then raise exception 'Receipt key already belongs to another PO'; end if;
    return jsonb_build_object('grn_id',existing.id,'grn_no',existing.grn_no,'replayed',true);
  end if;

  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Receiving lines are required'; end if;
  select * into po from public.proc_purchase_orders where id=p_po_id for update;
  if po.id is null then raise exception 'Purchase order not found'; end if;
  if po.status not in ('sent','partially_received') then raise exception 'Only sent purchase orders can be received'; end if;

  loc:=private.proc_default_location_id();
  if loc is null then raise exception 'Default stock location is not configured'; end if;
  gno:='GRN-'||to_char(clock_timestamp(),'YYMMDD-HH24MISSMS');
  insert into public.proc_grns(grn_no,po_id,supplier_id,location_id,status,received_by,notes,receipt_key)
  values(gno,po.id,po.supplier_id,loc,'draft',caller,p_notes,p_receipt_key) returning id into gid;

  for x in select * from jsonb_array_elements(p_lines) loop
    select * into pl from public.proc_po_lines where id=(x->>'po_line_id')::uuid and po_id=po.id;
    if pl.id is null then raise exception 'Receiving line is not part of the selected PO'; end if;

    rec:=coalesce((x->>'received_qty')::numeric,0);
    acc:=coalesce((x->>'accepted_qty')::numeric,0);
    rej:=coalesce((x->>'rejected_qty')::numeric,0);
    reject_reason:=nullif(trim(coalesce(x->>'rejection_reason','')),'');
    if rec<0 or acc<0 or rej<0 then raise exception 'Receiving quantities cannot be negative'; end if;
    if acc+rej>rec then raise exception 'Accepted plus rejected quantity cannot exceed received quantity'; end if;
    if rej>0 and reject_reason is null then raise exception 'A rejection reason is required when rejected quantity is greater than zero'; end if;

    select coalesce(sum(gl.accepted_qty),0) into previously_accepted
    from public.proc_grn_lines gl join public.proc_grns g on g.id=gl.grn_id
    where gl.po_line_id=pl.id and g.status='posted';
    if previously_accepted+acc>pl.qty then raise exception 'Accepted quantity would exceed the outstanding ordered quantity'; end if;

    insert into public.proc_grn_lines(grn_id,po_line_id,item_id,ordered_qty,received_qty,accepted_qty,rejected_qty,rejection_reason)
    values(gid,pl.id,pl.item_id,pl.qty,rec,acc,rej,reject_reason);
  end loop;

  posted:=private.proc_post_grn_impl(gid);
  return jsonb_build_object('grn_id',gid,'grn_no',gno,'lines_posted',posted,'replayed',false);
end $$;
revoke all on function public.proc_receive_po_v3(uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.proc_receive_po_v3(uuid,uuid,jsonb,text) to authenticated;

-- Current quantity available to invoice, based on posted GRNs less earlier non-rejected invoices.
create or replace view public.proc_v_invoiceable_po_lines
with (security_invoker=true)
as
select
  pl.id as po_line_id,
  pl.po_id,
  pl.item_id,
  pl.qty as po_qty,
  coalesce(rec.accepted_qty,0) as accepted_qty,
  coalesce(inv.invoiced_qty,0) as invoiced_qty,
  greatest(coalesce(rec.accepted_qty,0)-coalesce(inv.invoiced_qty,0),0) as invoiceable_qty
from public.proc_po_lines pl
left join (
  select gl.po_line_id,sum(gl.accepted_qty) accepted_qty
  from public.proc_grn_lines gl
  join public.proc_grns g on g.id=gl.grn_id and g.status='posted'
  group by gl.po_line_id
) rec on rec.po_line_id=pl.id
left join (
  select il.po_line_id,sum(il.qty) invoiced_qty
  from public.proc_invoice_lines il
  join public.proc_supplier_invoices si on si.id=il.invoice_id and si.status<>'rejected'
  group by il.po_line_id
) inv on inv.po_line_id=pl.id;

grant select on public.proc_v_invoiceable_po_lines to authenticated;

-- Three-way matching: invoice quantity must not exceed posted GRN accepted quantity not already invoiced.
create or replace function public.proc_create_invoice_v4(
  p_po_id uuid,p_invoice_no text,p_lines jsonb,p_attachment_path text default null,p_notes text default null
)
returns jsonb
language plpgsql
set search_path=''
as $$
declare
  caller uuid:=auth.uid(); caller_role text; po public.proc_purchase_orders; iid uuid; x jsonb; pl public.proc_po_lines;
  q numeric; pr numeric; disc numeric; tax numeric; line_net numeric; line_tax numeric;
  accepted_to_date numeric; previously_invoiced numeric; available_to_invoice numeric;
  v_subtotal numeric:=0; v_tax_total numeric:=0; v_variance boolean:=false; details jsonb:='[]'::jsonb;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  select role into caller_role from public.proc_profiles where id=caller and active=true;
  if caller_role not in ('admin','procurement') then raise exception 'Not authorized'; end if;
  if nullif(trim(p_invoice_no),'') is null then raise exception 'Invoice number is required'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Invoice lines are required'; end if;

  select * into po from public.proc_purchase_orders where id=p_po_id;
  if po.id is null then raise exception 'Purchase order not found'; end if;
  if po.status not in ('approved','sent','partially_received','received') then raise exception 'Invoice cannot be entered for this purchase order status'; end if;

  insert into public.proc_supplier_invoices(supplier_id,po_id,invoice_no,subtotal,tax_total,total,attachment_path,status,notes,entered_by)
  values(po.supplier_id,po.id,trim(p_invoice_no),0,0,0,p_attachment_path,'entered',p_notes,caller)
  returning id into iid;

  for x in select * from jsonb_array_elements(p_lines) loop
    select * into pl from public.proc_po_lines where id=(x->>'po_line_id')::uuid and po_id=po.id;
    if pl.id is null then raise exception 'Invoice line is not part of the selected PO'; end if;

    q:=(x->>'qty')::numeric; pr:=(x->>'unit_price')::numeric;
    disc:=coalesce(nullif(x->>'discount_percent','')::numeric,0);
    tax:=coalesce(nullif(x->>'tax_percent','')::numeric,0);
    if q is null or q<=0 or pr is null or pr<0 then raise exception 'Invoice quantity must be greater than zero and price cannot be negative'; end if;
    if disc<0 or disc>100 or tax<0 or tax>100 then raise exception 'Discount and tax percentages must be between 0 and 100'; end if;

    select coalesce(sum(gl.accepted_qty),0) into accepted_to_date
    from public.proc_grn_lines gl join public.proc_grns g on g.id=gl.grn_id
    where gl.po_line_id=pl.id and g.status='posted';

    select coalesce(sum(il.qty),0) into previously_invoiced
    from public.proc_invoice_lines il
    join public.proc_supplier_invoices si on si.id=il.invoice_id
    where il.po_line_id=pl.id and si.id<>iid and si.status<>'rejected';

    available_to_invoice:=greatest(accepted_to_date-previously_invoiced,0);
    if q>available_to_invoice or pr<>pl.unit_price or disc<>pl.discount_percent or tax<>pl.tax_percent then v_variance:=true; end if;

    insert into public.proc_invoice_lines(invoice_id,po_line_id,item_id,qty,unit_price,discount_percent,tax_percent)
    values(iid,pl.id,pl.item_id,q,pr,disc,tax);

    details:=details||jsonb_build_array(jsonb_build_object(
      'po_line_id',pl.id,'invoice_qty',q,'accepted_to_date',accepted_to_date,
      'previously_invoiced',previously_invoiced,'available_to_invoice',available_to_invoice,
      'qty_match',q<=available_to_invoice,'commercial_match',
        (pr=pl.unit_price and disc=pl.discount_percent and tax=pl.tax_percent)
    ));

    line_net:=round(q*pr*(1-disc/100.0),2);
    line_tax:=round(line_net*(tax/100.0),2);
    v_subtotal:=v_subtotal+line_net; v_tax_total:=v_tax_total+line_tax;
  end loop;

  update public.proc_supplier_invoices
  set subtotal=v_subtotal,tax_total=v_tax_total,total=v_subtotal+v_tax_total,
      status=case when v_variance then 'variance' else 'matched' end,
      match_detail=details
  where id=iid;

  return jsonb_build_object(
    'invoice_id',iid,'status',case when v_variance then 'variance' else 'matched' end,
    'subtotal',v_subtotal,'tax_total',v_tax_total,'total',v_subtotal+v_tax_total,
    'match_detail',details
  );
end $$;
revoke all on function public.proc_create_invoice_v4(uuid,text,jsonb,text,text) from public,anon;
grant execute on function public.proc_create_invoice_v4(uuid,text,jsonb,text,text) to authenticated;

-- Lightweight health RPC: proves the Data API/database is reachable without exposing business data.
create or replace function public.proc_healthcheck_v1()
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select jsonb_build_object(
    'ok',true,
    'database','connected',
    'schema_ready',
      to_regclass('public.proc_items') is not null
      and to_regclass('public.proc_requirements') is not null
      and to_regclass('public.proc_purchase_orders') is not null
  )
$$;
revoke all on function public.proc_healthcheck_v1() from public;
grant execute on function public.proc_healthcheck_v1() to anon,authenticated,service_role;

-- Security: anonymous callers never need mutation helpers used by procurement/GH Nexus.
revoke execute on function public.assign_purchase_request_item_supplier(uuid,uuid) from public,anon;
revoke execute on function public.auto_assign_preferred_suppliers(uuid) from public,anon;
revoke execute on function public.capture_supplier_price_history() from public,anon;
revoke execute on function public.create_purchase_orders_from_request(uuid) from public,anon;
revoke execute on function public.receive_purchase_order_partial(uuid,uuid,uuid,jsonb,text) from public,anon;

-- Remove the exact duplicate RFQ requirement index found by the database advisor.
drop index if exists public.proc_rfq_items_requirement_idx;

-- Scheduled internal stall detection. This creates actionable exceptions; it does not pretend a WhatsApp/email was delivered.
create extension if not exists pg_cron with schema pg_catalog;

create or replace function private.proc_automation_sweep_v1()
returns integer
language plpgsql
security definer
set search_path=''
as $sweep$
declare
  reminder_hours_v integer:=24;
  po_send_hours_v integer:=4;
  touched integer:=0;
begin
  select greatest(coalesce(nullif(config->>'reminder_hours','')::integer,24),1)
  into reminder_hours_v
  from public.proc_feature_settings where feature_key='quotes.minimum_quotes';
  reminder_hours_v:=greatest(coalesce(reminder_hours_v,24),1);

  select greatest(coalesce(nullif(config->>'po_send_reminder_hours','')::integer,4),1)
  into po_send_hours_v
  from public.proc_feature_settings where feature_key='procurement.straight_through';
  po_send_hours_v:=greatest(coalesce(po_send_hours_v,4),1);

  insert into public.proc_automation_jobs(job_type,entity_type,entity_id,status,payload,last_error,created_by,updated_at)
  select 'rfq_reminder','rfq',q.id,'needs_action',
         jsonb_build_object(
           'rfq_no',q.rfq_no,
           'waiting_suppliers',count(*),
           'due_date',q.due_date
         ),
         'Supplier quotation reminder is due.',null,now()
  from public.proc_rfqs q
  join public.proc_rfq_suppliers rs on rs.rfq_id=q.id
  where q.status in ('sent','partially_quoted')
    and rs.status in ('sent','viewed')
    and rs.sent_at is not null
    and rs.sent_at<=now()-make_interval(hours=>reminder_hours_v)
  group by q.id,q.rfq_no,q.due_date
  on conflict(job_type,entity_id) do update
  set status='needs_action',payload=excluded.payload,last_error=excluded.last_error,updated_at=now();
  get diagnostics touched=row_count;

  update public.proc_automation_jobs j
  set status='completed',last_error=null,updated_at=now()
  where j.job_type='rfq_reminder' and j.status<>'completed'
    and not exists(
      select 1 from public.proc_rfq_suppliers rs
      where rs.rfq_id=j.entity_id and rs.status in ('sent','viewed')
    );

  insert into public.proc_automation_jobs(job_type,entity_type,entity_id,status,payload,last_error,created_by,updated_at)
  select 'po_send','po',po.id,'needs_action',
         jsonb_build_object('po_no',po.po_no,'supplier_id',po.supplier_id,'total',po.total),
         'Approved PO has not yet been confirmed as sent to the supplier.',null,now()
  from public.proc_purchase_orders po
  where po.status='approved'
    and po.approved_at is not null
    and po.approved_at<=now()-make_interval(hours=>po_send_hours_v)
  on conflict(job_type,entity_id) do update
  set status='needs_action',payload=excluded.payload,last_error=excluded.last_error,updated_at=now();

  update public.proc_automation_jobs j
  set status='completed',last_error=null,updated_at=now()
  where j.job_type='po_send' and j.status<>'completed'
    and exists(select 1 from public.proc_purchase_orders po where po.id=j.entity_id and po.status<>'approved');

  insert into public.proc_automation_jobs(job_type,entity_type,entity_id,status,payload,last_error,created_by,updated_at)
  select 'po_delivery_overdue','po',po.id,'needs_action',
         jsonb_build_object('po_no',po.po_no,'supplier_id',po.supplier_id,'expected_date',po.expected_date),
         'Purchase order is past its expected date and is not fully received.',null,now()
  from public.proc_purchase_orders po
  where po.status in ('sent','partially_received')
    and po.expected_date is not null
    and po.expected_date<current_date
  on conflict(job_type,entity_id) do update
  set status='needs_action',payload=excluded.payload,last_error=excluded.last_error,updated_at=now();

  update public.proc_automation_jobs j
  set status='completed',last_error=null,updated_at=now()
  where j.job_type='po_delivery_overdue' and j.status<>'completed'
    and exists(select 1 from public.proc_purchase_orders po where po.id=j.entity_id and po.status not in ('sent','partially_received'));

  return touched;
end
$sweep$;
revoke all on function private.proc_automation_sweep_v1() from public,anon,authenticated;

do $cron$
begin
  if exists(select 1 from cron.job where jobname='gh-procurement-automation-sweep') then
    perform cron.unschedule('gh-procurement-automation-sweep');
  end if;
  perform cron.schedule(
    'gh-procurement-automation-sweep',
    '*/30 * * * *',
    'select private.proc_automation_sweep_v1();'
  );
end
$cron$;

-- Safe wrappers do not need elevated public-schema execution context themselves.
alter function public.proc_add_requirement_v2(uuid,numeric,text) security invoker;
alter function public.proc_admin_duplicate_role_v1(text,text) security invoker;


-- Add a conservative aggregate limit; admins can change it from settings later.
update public.proc_feature_settings
set config=coalesce(config,'{}'::jsonb)||jsonb_build_object(
  'daily_auto_approval_limit',
  greatest(coalesce(nullif(config->>'daily_auto_approval_limit','')::numeric,
                    nullif(config->>'po_auto_approval_limit','')::numeric,0),0),
  'supplier_history_min_pos',greatest(coalesce(nullif(config->>'supplier_history_min_pos','')::integer,3),1),
  'supplier_min_fill_rate_pct',greatest(least(coalesce(nullif(config->>'supplier_min_fill_rate_pct','')::numeric,90),100),0),
  'supplier_max_invoice_variance_pct',greatest(least(coalesce(nullif(config->>'supplier_max_invoice_variance_pct','')::numeric,25),100),0),
  'urgent_max_lead_days',greatest(coalesce(nullif(config->>'urgent_max_lead_days','')::integer,7),0),
  'po_send_reminder_hours',greatest(coalesce(nullif(config->>'po_send_reminder_hours','')::integer,4),1)
)
where feature_key='procurement.straight_through';

commit;
