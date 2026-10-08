-- GH Procurement full hardening 043:
-- landed-cost quotation terms and explicit award review.
-- Unreleased until the user explicitly asks to deploy.

begin;

alter table public.proc_rfqs
  add column if not exists quote_exception_reason text;

alter table public.proc_quotes
  add column if not exists freight_total numeric(16,2) not null default 0,
  add column if not exists minimum_order_value numeric(16,2) not null default 0;

alter table public.proc_quotes
  drop constraint if exists proc_quotes_freight_total_check,
  drop constraint if exists proc_quotes_minimum_order_value_check;
alter table public.proc_quotes
  add constraint proc_quotes_freight_total_check check(freight_total>=0),
  add constraint proc_quotes_minimum_order_value_check check(minimum_order_value>=0);

alter table public.proc_quote_lines
  add column if not exists moq numeric(14,3) not null default 0,
  add column if not exists order_multiple numeric(14,3) not null default 1;

alter table public.proc_quote_lines
  drop constraint if exists proc_quote_lines_moq_check,
  drop constraint if exists proc_quote_lines_order_multiple_check;
alter table public.proc_quote_lines
  add constraint proc_quote_lines_moq_check check(moq>=0),
  add constraint proc_quote_lines_order_multiple_check check(order_multiple>0);

alter table public.proc_awards
  add column if not exists landed_unit_cost numeric(16,4),
  add column if not exists award_method text not null default 'recommended',
  add column if not exists override_reason text;

alter table public.proc_awards drop constraint if exists proc_awards_award_method_check;
alter table public.proc_awards add constraint proc_awards_award_method_check
  check(award_method in ('recommended','override'));

alter table public.proc_po_lines
  add column if not exists source_quote_line_id uuid references public.proc_quote_lines(id),
  add column if not exists landed_unit_cost numeric(16,4);

alter table public.proc_purchase_orders
  add column if not exists freight_total numeric(16,2) not null default 0;

alter table public.proc_purchase_orders drop constraint if exists proc_purchase_orders_freight_total_check;
alter table public.proc_purchase_orders add constraint proc_purchase_orders_freight_total_check
  check(freight_total>=0);

create index if not exists proc_po_lines_source_quote_line_idx
  on public.proc_po_lines(source_quote_line_id)
  where source_quote_line_id is not null;

-- PO totals include supplier freight while preserving subtotal/tax detail.
create or replace function private.proc_po_status_guard()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  caller_role text;
  calc_subtotal numeric(16,2);
  calc_tax numeric(16,2);
  calc_total numeric(16,2);
  any_received boolean;
  all_received boolean;
begin
  if tg_op='INSERT' then return new; end if;

  select role into caller_role
  from public.proc_profiles
  where id=auth.uid() and active=true;

  if new.po_no is distinct from old.po_no then raise exception 'PO number is immutable'; end if;
  if new.supplier_id is distinct from old.supplier_id then raise exception 'PO supplier cannot be changed'; end if;
  if new.created_by is distinct from old.created_by then raise exception 'PO creator is immutable'; end if;
  if new.created_at is distinct from old.created_at then raise exception 'PO creation time is immutable'; end if;

  if old.status<>'pending_approval' then
    if new.terms is distinct from old.terms then raise exception 'Commercial terms cannot change after PO approval'; end if;
    if new.po_date is distinct from old.po_date then raise exception 'PO date cannot change after approval'; end if;
    if new.freight_total is distinct from old.freight_total then raise exception 'Freight cannot change after PO approval'; end if;
  end if;

  if new.status is distinct from old.status then
    if new.status='approved' then
      if caller_role<>'admin' then raise exception 'Only an admin can approve a purchase order'; end if;
      if old.status<>'pending_approval' then raise exception 'Only a pending purchase order can be approved'; end if;
      if not exists(select 1 from public.proc_po_lines where po_id=old.id) then raise exception 'Cannot approve an empty purchase order'; end if;
      new.approved_by:=auth.uid();
      new.approved_at:=now();
    elsif new.status='sent' then
      if old.status<>'approved' then raise exception 'Purchase order must be approved before it is sent'; end if;
      if caller_role not in ('admin','procurement') then raise exception 'Not authorized to send purchase orders'; end if;
      new.sent_at:=coalesce(new.sent_at,now());
    elsif new.status='cancelled' then
      if caller_role not in ('admin','procurement') then raise exception 'Not authorized to cancel purchase orders'; end if;
      if old.status in ('received','closed') then raise exception 'Received or closed purchase orders cannot be cancelled'; end if;
    elsif new.status='closed' then
      if old.status<>'received' then raise exception 'Only a fully received purchase order can be closed'; end if;
    elsif new.status in ('partially_received','received') then
      if old.status not in ('sent','partially_received') then raise exception 'Goods can only be received against a sent purchase order'; end if;

      select
        exists(
          select 1
          from public.proc_po_lines pl
          join (
            select gl.po_line_id,sum(gl.accepted_qty) accepted_qty
            from public.proc_grn_lines gl
            join public.proc_grns g on g.id=gl.grn_id and g.status='posted'
            group by gl.po_line_id
          ) rec on rec.po_line_id=pl.id
          where pl.po_id=old.id and rec.accepted_qty>0
        ),
        not exists(
          select 1
          from public.proc_po_lines pl
          left join (
            select gl.po_line_id,sum(gl.accepted_qty) accepted_qty
            from public.proc_grn_lines gl
            join public.proc_grns g on g.id=gl.grn_id and g.status='posted'
            group by gl.po_line_id
          ) rec on rec.po_line_id=pl.id
          where pl.po_id=old.id and coalesce(rec.accepted_qty,0)<pl.qty
        )
      into any_received,all_received;

      if new.status='received' and not all_received then
        raise exception 'PO cannot be marked received until posted GRNs cover all ordered quantities';
      end if;
      if new.status='partially_received' and (not any_received or all_received) then
        raise exception 'PO partial-receipt status does not match posted GRNs';
      end if;
    else
      raise exception 'Invalid purchase order status transition: % to %',old.status,new.status;
    end if;
  end if;

  select
    coalesce(sum(round(pl.qty*pl.unit_price*(1-pl.discount_percent/100.0),2)),0),
    coalesce(sum(round((pl.qty*pl.unit_price*(1-pl.discount_percent/100.0))*(pl.tax_percent/100.0),2)),0),
    coalesce(sum(pl.line_total),0)
  into calc_subtotal,calc_tax,calc_total
  from public.proc_po_lines pl
  where pl.po_id=old.id;

  new.subtotal:=calc_subtotal;
  new.tax_total:=calc_tax;
  new.total:=calc_total+coalesce(new.freight_total,0);
  return new;
end $$;

create or replace function public.proc_save_quote_v3(
  p_rfq_id uuid,
  p_supplier_id uuid,
  p_quote_ref text,
  p_lines jsonb,
  p_valid_until date default null,
  p_attachment_path text default null,
  p_notes text default null,
  p_freight_total numeric default 0,
  p_minimum_order_value numeric default 0
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  caller uuid:=auth.uid();
  caller_role text;
  qid uuid;
  x jsonb;
  ri uuid;
  price numeric;
  avail numeric;
  lead integer;
  disc numeric;
  tax numeric;
  moq_v numeric;
  multiple_v numeric;
  all_quoted boolean;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  select role into caller_role from public.proc_profiles where id=caller and active=true;
  if caller_role not in ('admin','procurement') then raise exception 'Not authorized'; end if;
  if not exists(select 1 from public.proc_rfq_suppliers where rfq_id=p_rfq_id and supplier_id=p_supplier_id) then
    raise exception 'Supplier is not invited to this RFQ';
  end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then
    raise exception 'At least one quote line is required';
  end if;
  if coalesce(p_freight_total,0)<0 or coalesce(p_minimum_order_value,0)<0 then
    raise exception 'Freight and minimum order value cannot be negative';
  end if;

  insert into public.proc_quotes(
    rfq_id,supplier_id,quote_ref,valid_until,attachment_path,status,notes,created_by,
    freight_total,minimum_order_value
  )
  values(
    p_rfq_id,p_supplier_id,nullif(trim(p_quote_ref),''),p_valid_until,p_attachment_path,
    'received',p_notes,caller,coalesce(p_freight_total,0),coalesce(p_minimum_order_value,0)
  )
  on conflict(rfq_id,supplier_id) do update
    set quote_ref=excluded.quote_ref,
        valid_until=excluded.valid_until,
        attachment_path=coalesce(excluded.attachment_path,public.proc_quotes.attachment_path),
        status='received',
        notes=excluded.notes,
        freight_total=excluded.freight_total,
        minimum_order_value=excluded.minimum_order_value
  returning id into qid;

  delete from public.proc_quote_lines where quote_id=qid;

  for x in select * from jsonb_array_elements(p_lines)
  loop
    ri:=(x->>'rfq_item_id')::uuid;
    if not exists(select 1 from public.proc_rfq_items where id=ri and rfq_id=p_rfq_id) then
      raise exception 'Quote line does not belong to this RFQ';
    end if;

    price:=(x->>'unit_price')::numeric;
    avail:=nullif(x->>'available_qty','')::numeric;
    lead:=nullif(x->>'lead_days','')::integer;
    disc:=coalesce(nullif(x->>'discount_percent','')::numeric,0);
    tax:=coalesce(nullif(x->>'tax_percent','')::numeric,0);
    moq_v:=coalesce(nullif(x->>'moq','')::numeric,0);
    multiple_v:=coalesce(nullif(x->>'order_multiple','')::numeric,1);

    if price is null or price<0 then raise exception 'Unit price must be zero or positive'; end if;
    if avail is not null and avail<0 then raise exception 'Available quantity cannot be negative'; end if;
    if lead is not null and lead<0 then raise exception 'Lead days cannot be negative'; end if;
    if disc<0 or disc>100 or tax<0 or tax>100 then raise exception 'Discount and tax must be 0 to 100'; end if;
    if moq_v<0 or multiple_v<=0 then raise exception 'MOQ must be zero or positive and order multiple must be greater than zero'; end if;

    insert into public.proc_quote_lines(
      quote_id,rfq_item_id,unit_price,available_qty,lead_days,
      discount_percent,tax_percent,moq,order_multiple,notes
    )
    values(
      qid,ri,price,avail,lead,disc,tax,moq_v,multiple_v,nullif(x->>'notes','')
    );
  end loop;

  update public.proc_rfq_suppliers
  set status='quoted',replied_at=now()
  where rfq_id=p_rfq_id and supplier_id=p_supplier_id;

  select not exists(
    select 1 from public.proc_rfq_suppliers where rfq_id=p_rfq_id and status not in ('quoted','declined')
  ) into all_quoted;

  update public.proc_rfqs
  set status=case when all_quoted then 'quoted' else 'partially_quoted' end,updated_at=now()
  where id=p_rfq_id;

  return jsonb_build_object(
    'quote_id',qid,
    'status',case when all_quoted then 'quoted' else 'partially_quoted' end
  );
end $$;

revoke all on function public.proc_save_quote_v3(uuid,uuid,text,jsonb,date,text,text,numeric,numeric) from public,anon;
grant execute on function public.proc_save_quote_v3(uuid,uuid,text,jsonb,date,text,text,numeric,numeric) to authenticated;

-- Legacy quote calls inherit stricter validation/default commercial terms.
create or replace function public.proc_save_quote_v2(
  p_rfq_id uuid,
  p_supplier_id uuid,
  p_quote_ref text,
  p_lines jsonb,
  p_valid_until date default null,
  p_attachment_path text default null,
  p_notes text default null
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select public.proc_save_quote_v3(
    p_rfq_id,p_supplier_id,p_quote_ref,p_lines,p_valid_until,p_attachment_path,p_notes,0,0
  )
$$;

create or replace view public.proc_v_quote_comparison
with (security_invoker=true)
as
with line_cost as (
  select
    qi.rfq_id,
    qi.id rfq_item_id,
    qi.requirement_id,
    qi.requested_qty,
    s.id supplier_id,
    s.supplier_code,
    s.name supplier_name,
    q.id quote_id,
    q.quote_ref,
    q.quote_date,
    q.valid_until,
    q.freight_total,
    q.minimum_order_value,
    ql.id quote_line_id,
    ql.unit_price,
    ql.available_qty,
    ql.lead_days,
    ql.discount_percent,
    ql.tax_percent,
    ql.moq,
    ql.order_multiple,
    round(ql.unit_price*(1-ql.discount_percent/100.0),4) net_unit_price,
    round(ql.unit_price*(1-ql.discount_percent/100.0)*(1+ql.tax_percent/100.0),4) effective_unit_price,
    sum(coalesce(ql.available_qty,qi.requested_qty)) over(partition by q.id) quote_qty_basis
  from public.proc_rfq_items qi
  join public.proc_quotes q on q.rfq_id=qi.rfq_id
  join public.proc_suppliers s on s.id=q.supplier_id and s.active=true
  join public.proc_quote_lines ql on ql.quote_id=q.id and ql.rfq_item_id=qi.id
  where q.status in ('received','reviewed','selected')
    and ql.unit_price>=0
),
landed as (
  select lc.*,
    round(case when coalesce(lc.quote_qty_basis,0)>0
      then lc.freight_total/lc.quote_qty_basis else 0 end,4) freight_unit_cost,
    round(
      lc.effective_unit_price +
      case when coalesce(lc.quote_qty_basis,0)>0 then lc.freight_total/lc.quote_qty_basis else 0 end,
      4
    ) landed_unit_cost
  from line_cost lc
)
select
  -- Preserve the deployed view's original first 18 columns in exactly the same order.
  l.rfq_id,
  l.rfq_item_id,
  l.requirement_id,
  l.supplier_id,
  l.supplier_code,
  l.supplier_name,
  l.quote_id,
  l.quote_ref,
  l.quote_line_id,
  l.unit_price,
  l.available_qty,
  l.lead_days,
  l.discount_percent,
  l.tax_percent,
  dense_rank() over(
    partition by l.rfq_item_id
    order by l.effective_unit_price asc,l.supplier_code asc
  ) price_rank,
  l.effective_unit_price,
  l.valid_until,
  l.net_unit_price,
  -- New hardening/commercial fields are append-only for CREATE OR REPLACE VIEW compatibility.
  l.requested_qty,
  l.quote_date,
  l.freight_total,
  l.minimum_order_value,
  l.moq,
  l.order_multiple,
  l.quote_qty_basis,
  l.freight_unit_cost,
  l.landed_unit_cost,
  dense_rank() over(
    partition by l.rfq_item_id
    order by l.landed_unit_cost asc,l.supplier_code asc
  ) landed_rank
from landed l;

grant select on public.proc_v_quote_comparison to authenticated;

create or replace function public.proc_finalize_award_plan_v1(
  p_rfq_id uuid,
  p_allocations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  caller uuid:=auth.uid();
  caller_role text;
  rfq_rec public.proc_rfqs;
  x jsonb;
  ri public.proc_rfq_items;
  ql public.proc_quote_lines;
  q public.proc_quotes;
  r public.proc_requirements;
  qty_v numeric;
  outstanding numeric;
  selected_target numeric;
  allocated_total numeric;
  available_v numeric;
  best_landed numeric;
  landed_v numeric;
  effective_v numeric;
  freight_unit_v numeric;
  method_v text;
  reason_v text;
  supplier_goods numeric;
  po_map jsonb:='{}'::jsonb;
  v_po_id uuid;
  supplier_key text;
  po_number text;
  map_rec record;
  result jsonb:='[]'::jsonb;
  subtotal_v numeric;
  tax_v numeric;
  goods_total_v numeric;
  freight_v numeric;
  preferred_quotes integer;
  received_quotes integer;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  select role into caller_role from public.proc_profiles where id=caller and active=true;
  if caller_role not in ('admin','procurement') then raise exception 'Not authorized'; end if;
  if jsonb_typeof(p_allocations)<>'array' or jsonb_array_length(p_allocations)=0 then
    raise exception 'Award allocations are required';
  end if;

  select * into rfq_rec from public.proc_rfqs where id=p_rfq_id for update;
  if rfq_rec.id is null then raise exception 'RFQ not found'; end if;
  if rfq_rec.status in ('awarded','closed','cancelled') then raise exception 'RFQ has already been awarded or closed'; end if;

  select coalesce(nullif(config->>'minimum_quotes','')::integer,2)
  into preferred_quotes
  from public.proc_feature_settings where feature_key='quotes.minimum_quotes';
  preferred_quotes:=greatest(coalesce(preferred_quotes,2),1);
  select count(*) into received_quotes from public.proc_rfq_suppliers where rfq_id=p_rfq_id and status='quoted';
  if received_quotes<preferred_quotes and nullif(trim(coalesce(rfq_rec.quote_exception_reason,'')),'') is null then
    raise exception 'Only % of the preferred % supplier quotations are received. Record a quote exception reason before finalizing.',received_quotes,preferred_quotes;
  end if;

  -- Every selected item must be completely allocated.
  for ri in
    select * from public.proc_rfq_items where rfq_id=p_rfq_id and selected_for_po=true
  loop
    select * into r from public.proc_requirements where id=ri.requirement_id for update;
    outstanding:=least(ri.requested_qty,greatest(r.adjusted_qty-r.ordered_qty,0));
    select coalesce(sum((a->>'qty')::numeric),0) into allocated_total
    from jsonb_array_elements(p_allocations) a
    where (a->>'rfq_item_id')::uuid=ri.id;
    if allocated_total<outstanding then
      raise exception 'Award plan must cover the full outstanding quantity for item % (required %, allocated %)',
        ri.id,outstanding,allocated_total;
    end if;
    if allocated_total>outstanding and not exists(
      select 1 from jsonb_array_elements(p_allocations) a
      where (a->>'rfq_item_id')::uuid=ri.id
        and nullif(trim(coalesce(a->>'override_reason','')),'') is not null
    ) then
      raise exception 'Award quantity exceeds the requirement for item %. Add an override reason for MOQ/order-multiple overbuy.',ri.id;
    end if;
  end loop;

  -- Validate each allocation before any PO is written.
  for x in select * from jsonb_array_elements(p_allocations)
  loop
    select * into ri
    from public.proc_rfq_items
    where id=(x->>'rfq_item_id')::uuid and rfq_id=p_rfq_id and selected_for_po=true;
    if ri.id is null then raise exception 'Award item does not belong to the selected RFQ'; end if;

    select * into ql from public.proc_quote_lines where id=(x->>'quote_line_id')::uuid;
    if ql.id is null or ql.rfq_item_id<>ri.id then raise exception 'Award quote line does not match the RFQ item'; end if;
    select * into q from public.proc_quotes where id=ql.quote_id and rfq_id=p_rfq_id;
    if q.id is null or q.status not in ('received','reviewed','selected') then raise exception 'Award quote is not available'; end if;

    qty_v:=(x->>'qty')::numeric;
    if qty_v is null or qty_v<=0 then raise exception 'Award quantity must be greater than zero'; end if;
    available_v:=coalesce(ql.available_qty,qty_v);
    if qty_v>available_v then raise exception 'Award quantity exceeds supplier availability'; end if;
    if ql.moq>0 and qty_v<ql.moq then raise exception 'Award quantity is below supplier MOQ'; end if;
    if ql.order_multiple>0 and mod(qty_v,ql.order_multiple)<>0 then
      raise exception 'Award quantity must respect the supplier order multiple';
    end if;

    select min(v.landed_unit_cost) into best_landed
    from public.proc_v_quote_comparison v
    where v.rfq_item_id=ri.id;

    select v.landed_unit_cost,v.effective_unit_price,v.freight_unit_cost
    into landed_v,effective_v,freight_unit_v
    from public.proc_v_quote_comparison v
    where v.quote_line_id=ql.id;

    if landed_v is null then raise exception 'Award quote is missing landed-cost comparison data'; end if;

    reason_v:=nullif(trim(coalesce(x->>'override_reason','')),'');
    method_v:=case when landed_v<=best_landed then 'recommended' else 'override' end;
    if method_v='override' and reason_v is null then
      raise exception 'Choosing a non-recommended supplier requires an override reason';
    end if;
  end loop;

  -- Supplier minimum-order values are enforced against planned effective goods value.
  for q in
    select distinct qq.*
    from public.proc_quotes qq
    join public.proc_quote_lines qql on qql.quote_id=qq.id
    join jsonb_array_elements(p_allocations) a on (a->>'quote_line_id')::uuid=qql.id
    where qq.rfq_id=p_rfq_id
  loop
    select coalesce(sum(
      (a->>'qty')::numeric
      * ql2.unit_price
      * (1-ql2.discount_percent/100.0)
      * (1+ql2.tax_percent/100.0)
    ),0)
    into supplier_goods
    from jsonb_array_elements(p_allocations) a
    join public.proc_quote_lines ql2 on ql2.id=(a->>'quote_line_id')::uuid
    where ql2.quote_id=q.id;

    if q.minimum_order_value>0 and supplier_goods<q.minimum_order_value then
      if not exists(
        select 1
        from jsonb_array_elements(p_allocations) a
        join public.proc_quote_lines ql3 on ql3.id=(a->>'quote_line_id')::uuid
        where ql3.quote_id=q.id
          and nullif(trim(coalesce(a->>'override_reason','')),'') is not null
      ) then
        raise exception 'Supplier minimum order value is %, but this award plan is only %. Add an override reason or adjust the award.',
          q.minimum_order_value,round(supplier_goods,2);
      end if;
    end if;
  end loop;

  -- Create one pending PO per supplier.
  for x in select * from jsonb_array_elements(p_allocations)
  loop
    select * into ri from public.proc_rfq_items where id=(x->>'rfq_item_id')::uuid;
    select * into ql from public.proc_quote_lines where id=(x->>'quote_line_id')::uuid;
    select * into q from public.proc_quotes where id=ql.quote_id;
    select * into r from public.proc_requirements where id=ri.requirement_id for update;
    qty_v:=(x->>'qty')::numeric;

    select v.landed_unit_cost,v.effective_unit_price,v.freight_unit_cost
    into landed_v,effective_v,freight_unit_v
    from public.proc_v_quote_comparison v where v.quote_line_id=ql.id;

    select min(v.landed_unit_cost) into best_landed
    from public.proc_v_quote_comparison v where v.rfq_item_id=ri.id;

    reason_v:=nullif(trim(coalesce(x->>'override_reason','')),'');
    method_v:=case when landed_v<=best_landed then 'recommended' else 'override' end;

    supplier_key:=q.supplier_id::text;
    if po_map ? supplier_key then
      v_po_id:=(po_map->>supplier_key)::uuid;
    else
      v_po_id:=gen_random_uuid();
      po_number:='PO-'||to_char(clock_timestamp(),'YYMMDD-HH24MISSMS')||'-'||substr(replace(q.supplier_id::text,'-',''),1,4);
      insert into public.proc_purchase_orders(
        id,po_no,supplier_id,status,po_date,created_by,freight_total
      )
      values(v_po_id,po_number,q.supplier_id,'pending_approval',current_date,caller,q.freight_total);
      po_map:=po_map||jsonb_build_object(supplier_key,v_po_id::text);
    end if;

    insert into public.proc_po_lines(
      po_id,requirement_id,item_id,qty,unit_price,discount_percent,tax_percent,
      source_quote_line_id,landed_unit_cost
    )
    values(
      v_po_id,ri.requirement_id,r.item_id,qty_v,ql.unit_price,ql.discount_percent,ql.tax_percent,
      ql.id,landed_v
    );

    insert into public.proc_awards(
      rfq_item_id,supplier_id,quote_line_id,awarded_qty,unit_price,
      discount_percent,tax_percent,effective_unit_cost,landed_unit_cost,
      award_method,override_reason,awarded_by
    )
    values(
      ri.id,q.supplier_id,ql.id,qty_v,ql.unit_price,ql.discount_percent,ql.tax_percent,
      effective_v,landed_v,method_v,reason_v,caller
    );

    update public.proc_quotes set status='selected' where id=q.id;

    update public.proc_requirements
    set adjusted_qty=greatest(adjusted_qty,ordered_qty+qty_v),
        ordered_qty=ordered_qty+qty_v,
        status=case when ordered_qty+qty_v>=greatest(adjusted_qty,ordered_qty+qty_v) then 'ordered' else 'partially_ordered' end,
        updated_at=now()
    where id=r.id;
  end loop;

  for map_rec in
    select key supplier_id_text,value #>> '{}' po_id_text from jsonb_each(po_map)
  loop
    v_po_id:=map_rec.po_id_text::uuid;
    select
      coalesce(sum(round(pl.qty*pl.unit_price*(1-pl.discount_percent/100.0),2)),0),
      coalesce(sum(round((pl.qty*pl.unit_price*(1-pl.discount_percent/100.0))*(pl.tax_percent/100.0),2)),0),
      coalesce(sum(pl.line_total),0)
    into subtotal_v,tax_v,goods_total_v
    from public.proc_po_lines pl where pl.po_id=v_po_id;

    select freight_total into freight_v from public.proc_purchase_orders where id=v_po_id;

    update public.proc_purchase_orders
    set subtotal=subtotal_v,tax_total=tax_v,total=goods_total_v+coalesce(freight_v,0),updated_at=now()
    where id=v_po_id
    returning po_no into po_number;

    result:=result||jsonb_build_array(jsonb_build_object(
      'po_id',v_po_id,'po_no',po_number,'supplier_id',map_rec.supplier_id_text::uuid,
      'subtotal',subtotal_v,'tax_total',tax_v,'freight_total',coalesce(freight_v,0),
      'total',goods_total_v+coalesce(freight_v,0)
    ));
  end loop;

  update public.proc_rfqs set status='awarded',updated_at=now() where id=p_rfq_id;
  return result;
end $$;

revoke all on function public.proc_finalize_award_plan_v1(uuid,jsonb) from public,anon;
grant execute on function public.proc_finalize_award_plan_v1(uuid,jsonb) to authenticated;

-- Retire the unsafe one-click award endpoint; all new awards must pass review.
create or replace function public.proc_create_best_price_pos(p_rfq_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
begin
  raise exception 'Automatic PO creation has been replaced by Award Review. Review landed-cost allocations before finalizing.';
end $$;

insert into public.proc_feature_settings(feature_key,label,enabled,group_key,sort_order,config)
values
 ('quotes.commercial_terms','Quote commercial terms (freight / MOQ / multiples)',true,'quotes',25,'{}'::jsonb),
 ('quotes.award_review','Award Review before purchase orders',true,'quotes',30,'{}'::jsonb)
on conflict(feature_key) do update set
  label=excluded.label,group_key=excluded.group_key,sort_order=excluded.sort_order;

insert into public.proc_field_settings(module_key,field_key,label,enabled,sort_order,required_core)
values
 ('rfq','freight_total','Freight Total',true,42,false),
 ('rfq','minimum_order_value','Minimum Order Value',true,44,false),
 ('rfq','moq','MOQ',true,86,false),
 ('rfq','order_multiple','Order Multiple',true,88,false),
 ('rfq','landed_cost','Landed Unit Cost',true,102,false),
 ('po','discount_percent','Discount %',true,62,false),
 ('po','tax_percent','Tax %',true,64,false),
 ('po','effective_unit_cost','Effective Unit Cost',true,66,false),
 ('po','landed_unit_cost','Landed Unit Cost',true,68,false),
 ('po','freight_total','Freight Total',true,72,false)
on conflict(module_key,field_key) do nothing;

commit;
