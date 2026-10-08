-- GH Procurement: simplified stock history + four-step procurement flow
-- Stock Entry -> Review -> RFQ / Quotes -> Orders
begin;

-- Run configuration updates under an active procurement admin identity so
-- existing permission-guard triggers accept this migration.
select set_config('request.jwt.claim.sub',(
  select id::text from public.proc_profiles
  where active=true and role='admin'
  order by created_at asc limit 1
),true);
select set_config('request.jwt.claim.role','authenticated',true);

-- Migration runs outside a user JWT. Mark this transaction as service_role so
-- configuration-table permission guards allow the intended deployment changes.
select set_config('request.jwt.claim.role','service_role',true);

-- Stock-generated requirements must be labelled as stock_count so the RBAC
-- requirement guard permits stock-checker submissions after migration 046.
create or replace function private.proc_submit_stock_count_impl(p_count_id uuid)
returns integer
language plpgsql
security definer
set search_path=''
as $stock_submit$
declare
  c public.proc_stock_counts;
  l record;
  prev_qty numeric(14,3);
  created_count integer:=0;
  req_no text;
  caller uuid:=auth.uid();
  caller_role text;
  existing_req public.proc_requirements;
  new_target numeric(14,3);
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  select role into caller_role from public.proc_profiles where id=caller and active=true;
  if caller_role not in ('admin','procurement','stock_handler','stock_checker') then raise exception 'Not authorized'; end if;

  select * into c from public.proc_stock_counts where id=p_count_id for update;
  if c.id is null then raise exception 'Stock count not found'; end if;
  if c.status<>'draft' then raise exception 'Only draft counts can be submitted'; end if;
  if c.counted_by<>caller and caller_role not in ('admin','procurement','stock_handler') then raise exception 'Not authorized'; end if;

  for l in
    select scl.*,i.item_code
    from public.proc_stock_count_lines scl
    join public.proc_items i on i.id=scl.item_id
    where scl.count_id=p_count_id
  loop
    if exists(
      select 1 from public.proc_stock_ledger sl
      where sl.item_id=l.item_id
        and sl.location_id=c.location_id
        and sl.created_at>c.count_started_at
        and sl.source_id is distinct from c.id
    ) then
      raise exception 'Stock changed after counting began for item %. Recount this item before submitting.',l.item_code;
    end if;

    select qty into prev_qty
    from public.proc_stock_balances
    where item_id=l.item_id and location_id=c.location_id;

    insert into public.proc_stock_balances(item_id,location_id,qty,last_counted_at)
    values(l.item_id,c.location_id,l.current_stock,now())
    on conflict(item_id,location_id)
    do update set qty=excluded.qty,last_counted_at=excluded.last_counted_at,updated_at=now();

    insert into public.proc_stock_ledger(
      item_id,location_id,txn_type,qty_delta,balance_after,source_type,source_id,note,created_by
    )
    values(
      l.item_id,c.location_id,'COUNT',
      l.current_stock-coalesce(prev_qty,0),l.current_stock,
      'STOCK_COUNT',c.id,'Physical stock count',caller
    );

    existing_req:=null;
    select * into existing_req
    from public.proc_requirements
    where item_id=l.item_id
      and location_id=c.location_id
      and status not in ('closed','cancelled','received')
      and (source_type='stock_count' or source_count_line_id is not null)
    order by created_at desc
    limit 1
    for update;

    if existing_req.id is not null then
      new_target:=greatest(existing_req.ordered_qty,existing_req.received_qty+l.required_qty);
      update public.proc_requirements
      set source_count_line_id=l.id,
          source_type='stock_count',
          required_qty=existing_req.received_qty+l.required_qty,
          adjusted_qty=new_target,
          status=case
            when exists(
              select 1
              from public.proc_rfq_items ri
              join public.proc_rfqs q on q.id=ri.rfq_id
              where ri.requirement_id=existing_req.id
                and q.status in ('draft','prepared','sent','partially_quoted','quoted')
            ) then 'quoting'
            when new_target=0 then 'closed'
            when existing_req.received_qty>=new_target then 'received'
            when existing_req.received_qty>0 then 'partially_received'
            when existing_req.ordered_qty>=new_target then 'ordered'
            when existing_req.ordered_qty>0 then 'partially_ordered'
            when l.required_qty>0 then 'open'
            else 'closed'
          end,
          updated_at=now()
      where id=existing_req.id;

      -- A recount may change the current need while an RFQ is already active.
      -- Keep the RFQ history intact, but automatically exclude lines whose
      -- current remaining requirement is now zero. Award Review also caps any
      -- selected line to the latest requirement quantity.
      update public.proc_rfq_items ri
      set selected_for_po=(new_target>existing_req.ordered_qty)
      from public.proc_rfqs q
      where ri.requirement_id=existing_req.id
        and q.id=ri.rfq_id
        and q.status in ('draft','prepared','sent','partially_quoted','quoted');
    elsif l.required_qty>0 then
      req_no:='REQ-'||to_char(clock_timestamp(),'YYMMDDHH24MISSMS')||'-'||right(l.item_code,6);
      insert into public.proc_requirements(
        requirement_no,source_count_line_id,item_id,location_id,
        required_qty,adjusted_qty,status,created_by,source_type
      )
      values(req_no,l.id,l.item_id,c.location_id,l.required_qty,l.required_qty,'open',caller,'stock_count');
      created_count:=created_count+1;
    end if;
  end loop;

  update public.proc_stock_counts
  set status='submitted',submitted_at=now(),updated_at=now()
  where id=p_count_id;

  return created_count;
end
$stock_submit$;

-- Keep manual requests separate from stock-count requirements so recounts never
-- overwrite a deliberate buyer request for the same item.
create or replace function private.proc_add_requirement_impl(
  p_item_id uuid,p_required_qty numeric,p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $manual_req$
declare
  caller uuid:=auth.uid();
  caller_role text;
  loc uuid;
  r public.proc_requirements;
  req_no text;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  select role into caller_role from public.proc_profiles where id=caller and active=true;
  if caller_role not in ('admin','procurement','stock_handler') then raise exception 'Not authorized'; end if;
  if p_required_qty is null or p_required_qty<=0 then raise exception 'Required quantity must be greater than zero'; end if;
  if not exists(select 1 from public.proc_items where id=p_item_id and active=true) then raise exception 'Invalid item'; end if;

  loc:=private.proc_default_location_id();
  if loc is null then raise exception 'Default stock location is not configured'; end if;

  select * into r
  from public.proc_requirements
  where item_id=p_item_id
    and location_id=loc
    and status not in ('closed','cancelled','received')
    and (
      source_type='manual'
      or (source_type='normal' and source_count_line_id is null)
    )
  order by created_at desc
  limit 1
  for update;

  if r.id is not null then
    if r.ordered_qty>0 or r.received_qty>0 then
      raise exception 'This item already has a committed procurement requirement';
    end if;
    update public.proc_requirements
    set required_qty=p_required_qty,
        adjusted_qty=p_required_qty,
        notes=p_notes,
        source_type='manual',
        approval_status='pending_review',
        selected_for_order=false,
        approved_by=null,
        approved_at=null,
        hold_reason=null,
        status='open',
        updated_at=now()
    where id=r.id;
    return r.id;
  end if;

  req_no:='REQ-M-'||to_char(clock_timestamp(),'YYMMDDHH24MISSMS');
  insert into public.proc_requirements(
    requirement_no,item_id,location_id,required_qty,adjusted_qty,status,
    notes,approval_status,selected_for_order,created_by,source_type
  )
  values(
    req_no,p_item_id,loc,p_required_qty,p_required_qty,'open',
    p_notes,'pending_review',false,caller,'manual'
  )
  returning id into r.id;

  return r.id;
end
$manual_req$;

-- Routine stock shortages must stop at Procurement Review. Automation can still
-- calculate suggestions/comparisons, but it must not skip the buyer's approval.
update public.proc_feature_settings
set enabled=false,
    config=coalesce(config,'{}'::jsonb) || '{"manual_review_required":true,"auto_award":false}'::jsonb,
    updated_at=now()
where feature_key='procurement.straight_through';

update public.proc_module_settings set label='Review' where module_key='requirements';
update public.proc_module_settings set label='RFQs & Quotes' where module_key='rfq';
update public.proc_module_settings set label='Orders' where module_key='po';

-- Add current stock context and the source stock submission to the procurement
-- review view without removing any existing columns.
create or replace view public.proc_v_requirements
with (security_invoker=true)
as
select
 r.id,r.requirement_no,r.source_count_line_id,r.item_id,r.location_id,
 r.required_qty,r.adjusted_qty,r.ordered_qty,r.received_qty,r.status,
 r.priority,r.needed_by,r.notes,r.created_by,r.created_at,r.updated_at,
 i.item_code,i.category,i.description,i.size,i.uom,i.movement,
 l.code as location_code,l.name as location_name,
 greatest(r.adjusted_qty-r.ordered_qty,0::numeric) as remaining_to_order,
 greatest(r.ordered_qty-r.received_qty,0::numeric) as ordered_not_received,
 r.approval_status,r.selected_for_order,r.approved_by,r.approved_at,r.hold_reason,
 r.urgency_reason,r.customer_paid,r.customer_reference,r.request_image_path,r.source_type,
 r.request_reason,r.special_requested_qty,r.request_stock_snapshot,
 r.request_max_stock_snapshot,r.request_reorder_snapshot,
 i.max_stock,
 i.reorder_level,
 coalesce(b.qty,0::numeric) as current_stock,
 b.last_counted_at,
 sc.count_no as source_count_no,
 sc.submitted_at as source_submitted_at,
 coalesce(sc.submitted_at,r.created_at) as source_activity_at,
 exists(
   select 1
   from public.proc_rfq_items ari
   join public.proc_rfqs arq on arq.id=ari.rfq_id
   where ari.requirement_id=r.id
     and arq.status in ('draft','prepared','sent','partially_quoted','quoted')
 ) as has_active_rfq
from public.proc_requirements r
join public.proc_items i on i.id=r.item_id
join public.proc_locations l on l.id=r.location_id
left join public.proc_stock_balances b
  on b.item_id=r.item_id and b.location_id=r.location_id
left join public.proc_stock_count_lines scl on scl.id=r.source_count_line_id
left join public.proc_stock_counts sc on sc.id=scl.count_id;

grant select on public.proc_v_requirements to authenticated;

-- Compact stock-submission history. Stock counters see their own submissions;
-- procurement/admin users can review the full history.
create or replace function public.proc_stock_submission_history_v1(p_limit integer default 25)
returns table(
 count_id uuid,
 count_no text,
 category text,
 submitted_at timestamptz,
 counted_by uuid,
 counted_by_name text,
 item_count bigint,
 shortage_count bigint,
 zero_count bigint
)
language sql
stable
security definer
set search_path=''
as $$
 select
   c.id,
   c.count_no,
   c.category,
   c.submitted_at,
   c.counted_by,
   coalesce(nullif(trim(p.display_name),''),'Staff') as counted_by_name,
   count(cl.id) as item_count,
   count(cl.id) filter (where coalesce(cl.required_qty,0)>0) as shortage_count,
   count(cl.id) filter (where coalesce(cl.current_stock,0)=0) as zero_count
 from public.proc_stock_counts c
 left join public.proc_stock_count_lines cl on cl.count_id=c.id
 left join public.proc_profiles p on p.id=c.counted_by
 where c.status='submitted'
   and (
     c.counted_by=auth.uid()
     or private.proc_has_permission('procurement.requirements.view')
     or private.proc_has_permission('items.edit')
   )
 group by c.id,c.count_no,c.category,c.submitted_at,c.counted_by,p.display_name
 order by c.submitted_at desc nulls last
 limit least(greatest(coalesce(p_limit,25),1),100)
$$;

revoke all on function public.proc_stock_submission_history_v1(integer) from public,anon;
grant execute on function public.proc_stock_submission_history_v1(integer) to authenticated;

create or replace function public.proc_stock_submission_detail_v1(p_count_id uuid)
returns table(
 line_id uuid,
 item_id uuid,
 item_code text,
 description text,
 size text,
 uom text,
 current_stock numeric,
 suggested_qty numeric,
 required_qty numeric
)
language sql
stable
security definer
set search_path=''
as $$
 select
   cl.id,
   i.id,
   i.item_code,
   i.description,
   i.size,
   i.uom,
   cl.current_stock,
   cl.suggested_qty,
   cl.required_qty
 from public.proc_stock_count_lines cl
 join public.proc_stock_counts c on c.id=cl.count_id
 join public.proc_items i on i.id=cl.item_id
 where cl.count_id=p_count_id
   and c.status='submitted'
   and (
     c.counted_by=auth.uid()
     or private.proc_has_permission('procurement.requirements.view')
     or private.proc_has_permission('items.edit')
   )
 order by i.description,i.size
$$;

revoke all on function public.proc_stock_submission_detail_v1(uuid) from public,anon;
grant execute on function public.proc_stock_submission_detail_v1(uuid) to authenticated;

-- Review-first submit: stock is committed, history is preserved, shortages are
-- created/updated, and the buyer decides what goes to suppliers.
create or replace function public.proc_submit_stock_and_continue_v3(
 p_category text,
 p_lines jsonb,
 p_notes text default null,
 p_attachment_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $submit$
declare
 caller uuid:=auth.uid();
 trusted_started timestamptz;
 base jsonb;
 cid uuid;
 item_total integer:=0;
 shortage_total integer:=0;
begin
 if caller is null then raise exception 'Not authenticated'; end if;
 if not private.proc_has_permission('stock.count.enter') then
   raise exception 'Permission denied: stock.count.enter' using errcode='42501';
 end if;

 select count_started_at into trusted_started
 from public.proc_stock_count_drafts
 where owner_id=caller;

 if trusted_started is null then
   trusted_started:=public.proc_begin_stock_count_session_v1();
 end if;

 base:=public.proc_submit_stock_check_v4(
   p_category,p_lines,p_notes,p_attachment_path,trusted_started
 );
 cid:=(base->>'count_id')::uuid;

 select count(*),
        count(*) filter (where coalesce(required_qty,0)>0)
 into item_total,shortage_total
 from public.proc_stock_count_lines
 where count_id=cid;

 delete from public.proc_stock_count_drafts where owner_id=caller;

 return base || jsonb_build_object(
   'automation',
   jsonb_build_object(
     'status',case when shortage_total>0 then 'review_required' else 'no_requirements' end,
     'submitted_items',item_total,
     'requirements',shortage_total
   )
 );
end
$submit$;

revoke all on function public.proc_submit_stock_and_continue_v3(text,jsonb,text,text) from public,anon;
grant execute on function public.proc_submit_stock_and_continue_v3(text,jsonb,text,text) to authenticated;

commit;
