CREATE OR REPLACE FUNCTION public.proc_finalize_award_plan_v1(p_rfq_id uuid, p_allocations jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Asia/Colombo'
AS $function$
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
  if caller_role is null or caller_role not in ('admin','procurement') then raise exception 'Not authorized'; end if;
  if jsonb_typeof(p_allocations)<>'array' or jsonb_array_length(p_allocations)=0 then
    raise exception 'Award allocations are required';
  end if;

  select * into rfq_rec from public.proc_rfqs where id=p_rfq_id for update;
  if rfq_rec.id is null then raise exception 'RFQ not found'; end if;
  if rfq_rec.status in ('awarded','closed','cancelled') then raise exception 'RFQ has already been awarded or closed'; end if;

  -- One valid supplier price is sufficient; validate every allocation below.
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
end $function$;

CREATE OR REPLACE FUNCTION public.proc_finalize_award_plan_v2(p_rfq_id uuid, p_allocations jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Asia/Colombo'
AS $function$
declare
  caller uuid:=auth.uid(); caller_role text;
  preferred integer; ri record; eligible integer; required_q integer; received integer;
  exception_reason text; x jsonb; qid uuid; q_valid date; result jsonb;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  select role into caller_role from public.proc_profiles where id=caller and active=true;
  if caller_role is null or caller_role not in ('admin','procurement') then raise exception 'Not authorized'; end if;

  preferred:=1;
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

    if received<1 then
      raise exception 'A valid supplier quotation is required for item %.', ri.rfq_item_id;
    end if;
  end loop;

  for x in select * from jsonb_array_elements(p_allocations) loop
    select q.id,q.valid_until into qid,q_valid
    from public.proc_quote_lines ql join public.proc_quotes q on q.id=ql.quote_id
    where ql.id=(x->>'quote_line_id')::uuid and q.rfq_id=p_rfq_id;
    if qid is null then raise exception 'Award quote line does not belong to this RFQ'; end if;
    if q_valid is not null and q_valid<current_date then raise exception 'Expired quotation cannot be awarded'; end if;
  end loop;

  result:=public.proc_finalize_award_plan_v1(p_rfq_id,p_allocations);
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.proc_try_auto_award_v2(p_rfq_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Asia/Colombo'
AS $function$
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
  if caller_role is null or caller_role not in ('admin','procurement') then raise exception 'Not authorized'; end if;

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

  preferred:=1;

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
end $function$;

do $migration$
declare previous_role text:=current_setting('request.jwt.claim.role',true);
begin
 perform set_config('request.jwt.claim.role','service_role',true);
 update public.proc_feature_settings set label='Quotation reminders',config=jsonb_set(config,'{minimum_quotes}','1'::jsonb),updated_at=now() where feature_key='quotes.minimum_quotes';
 perform set_config('request.jwt.claim.role',coalesce(previous_role,''),true);
end $migration$;


-- NULL preserves legacy requests; an explicit list customizes a supplier's RFQ.
alter table public.proc_rfq_suppliers add column requested_item_ids uuid[];
create or replace function public.proc_set_rfq_supplier_items_v1(p_rfq_id uuid,p_supplier_id uuid,p_item_ids uuid[])
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare rfq public.proc_rfqs; invitation public.proc_rfq_suppliers;
begin
 if auth.uid() is null or not private.proc_has_permission('procurement.rfq.manage') then
  raise exception 'Permission denied: procurement.rfq.manage' using errcode='42501';
 end if;
 select * into rfq from public.proc_rfqs where id=p_rfq_id for update;
 if rfq.id is null then raise exception 'RFQ not found'; end if;
 if rfq.status not in ('draft','prepared','sent','partially_quoted','quoted') then raise exception 'Cannot change request items on a closed RFQ'; end if;
 select * into invitation from public.proc_rfq_suppliers where rfq_id=p_rfq_id and supplier_id=p_supplier_id for update;
 if invitation.id is null then raise exception 'Supplier is not invited to this RFQ'; end if;
 if invitation.status not in ('pending','prepared') then raise exception 'Request already sent: create a follow-up RFQ to change its items'; end if;
 if p_item_ids is null or cardinality(p_item_ids)=0 then raise exception 'Select at least one request item'; end if;
 if exists(select 1 from unnest(p_item_ids) requested(id) where requested.id is null or not exists(select 1 from public.proc_rfq_items ri where ri.id=requested.id and ri.rfq_id=p_rfq_id)) then raise exception 'Request item does not belong to this RFQ'; end if;
 update public.proc_rfq_suppliers set requested_item_ids=array(select distinct x from unnest(p_item_ids) x order by x)
 where id=invitation.id returning * into invitation;
 return to_jsonb(invitation);
end $function$;
revoke all on function public.proc_set_rfq_supplier_items_v1(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.proc_set_rfq_supplier_items_v1(uuid,uuid,uuid[]) to authenticated;
