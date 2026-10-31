-- Production stock engine snapshot: recounts update existing requirements instead of always inserting.
CREATE OR REPLACE FUNCTION private.proc_submit_stock_count_impl(p_count_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if caller_role is null or caller_role not in ('admin','procurement','stock_handler','stock_checker') then raise exception 'Not authorized'; end if;

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

    if not l.sufficient_stock then
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

    end if; -- Visual checks do not write quantities, balances or ledger transactions.
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
$function$;
