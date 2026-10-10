-- Preserve original PO quantities and values; cancelled balances remain audited.
alter table public.proc_po_lines add column if not exists cancelled_qty numeric not null default 0 check(cancelled_qty >= 0 and cancelled_qty <= qty);
CREATE OR REPLACE FUNCTION public.proc_receive_po_v3(p_po_id uuid, p_receipt_key uuid, p_lines jsonb, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  caller uuid:=auth.uid(); caller_role text; po public.proc_purchase_orders; existing public.proc_grns;
  gid uuid; gno text; loc uuid; x jsonb; pl public.proc_po_lines;
  rec numeric; acc numeric; rej numeric; previously_accepted numeric; posted integer; reject_reason text;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  select role into caller_role from public.proc_profiles where id=caller and active=true;
  if caller_role is null or caller_role not in ('admin','procurement','receiver') then raise exception 'Not authorized'; end if;
  if not private.proc_has_permission('receiving.manage') then raise exception 'Permission denied: receiving.manage' using errcode='42501'; end if;
  if p_receipt_key is null then raise exception 'Receipt key is required'; end if;

  -- Lock before checking the key so concurrent identical requests can replay safely.
  select * into po from public.proc_purchase_orders where id=p_po_id for update;
  if po.id is null then raise exception 'Purchase order not found'; end if;
  select * into existing from public.proc_grns where receipt_key=p_receipt_key;
  if existing.id is not null then
    if existing.po_id<>p_po_id then raise exception 'Receipt key already belongs to another PO'; end if;
    return jsonb_build_object('grn_id',existing.id,'grn_no',existing.grn_no,'replayed',true);
  end if;

  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Receiving lines are required'; end if;
  if (select count(*)<>count(distinct entry.value->>'po_line_id') from jsonb_array_elements(p_lines) as entry(value)) then raise exception 'Each purchase order line may appear only once per receipt'; end if;
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
    if previously_accepted+acc>pl.qty-pl.cancelled_qty then raise exception 'Accepted quantity would exceed the outstanding ordered quantity'; end if;

    insert into public.proc_grn_lines(grn_id,po_line_id,item_id,ordered_qty,received_qty,accepted_qty,rejected_qty,rejection_reason)
    values(gid,pl.id,pl.item_id,pl.qty,rec,acc,rej,reject_reason);
  end loop;

  posted:=private.proc_post_grn_impl(gid);
  return jsonb_build_object('grn_id',gid,'grn_no',gno,'lines_posted',posted,'replayed',false);
end $function$;

CREATE OR REPLACE FUNCTION private.proc_post_grn_impl(p_grn_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  g public.proc_grns;
  po public.proc_purchase_orders;
  l record;
  bal numeric(14,3);
  posted_count integer := 0;
  caller uuid := auth.uid();
  caller_role text;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  select role into caller_role from public.proc_profiles where id=caller and active=true;
  if caller_role is null or caller_role not in ('admin','procurement','receiver') then raise exception 'Not authorized'; end if;

  select * into g from public.proc_grns where id=p_grn_id for update;
  if g.id is null then raise exception 'GRN not found'; end if;
  if g.status <> 'draft' then raise exception 'Only draft GRNs can be posted'; end if;

  select * into po from public.proc_purchase_orders where id=g.po_id for update;
  if po.id is null then raise exception 'Purchase order not found'; end if;
  if po.supplier_id<>g.supplier_id then raise exception 'GRN supplier does not match purchase order supplier'; end if;
  if po.status not in ('sent','partially_received') then raise exception 'Only sent purchase orders can be received'; end if;

  for l in
    select gl.*, pl.requirement_id,pl.po_id as line_po_id,pl.item_id as line_item_id
    from public.proc_grn_lines gl
    join public.proc_po_lines pl on pl.id=gl.po_line_id
    where gl.grn_id=p_grn_id
  loop
    if l.line_po_id<>g.po_id then raise exception 'GRN line belongs to a different purchase order'; end if;
    if l.line_item_id<>l.item_id then raise exception 'GRN item does not match purchase order line'; end if;
    if l.accepted_qty+l.rejected_qty>l.received_qty then raise exception 'Accepted plus rejected quantity cannot exceed received quantity'; end if;

    insert into public.proc_stock_balances(item_id,location_id,qty,last_counted_at)
    values(l.item_id,g.location_id,l.accepted_qty,now())
    on conflict(item_id,location_id)
    do update set qty=public.proc_stock_balances.qty+excluded.qty,updated_at=now()
    returning qty into bal;

    insert into public.proc_stock_ledger(item_id,location_id,txn_type,qty_delta,balance_after,source_type,source_id,note,created_by)
    values(l.item_id,g.location_id,'GRN',l.accepted_qty,bal,'GRN',g.id,
      case when l.rejected_qty>0 then 'Rejected: '||l.rejected_qty::text else null end,caller);

    update public.proc_requirements
    set received_qty=received_qty+l.accepted_qty,
        status=case
          when received_qty+l.accepted_qty >= adjusted_qty and adjusted_qty>0 then 'received'
          when received_qty+l.accepted_qty > 0 then 'partially_received'
          when ordered_qty >= adjusted_qty and adjusted_qty>0 then 'ordered'
          when ordered_qty > 0 then 'partially_ordered'
          else status
        end,
        updated_at=now()
    where id=l.requirement_id;
    posted_count := posted_count + 1;
  end loop;

  update public.proc_grns set status='posted',posted_at=now() where id=p_grn_id;

  update public.proc_purchase_orders p
  set status = case
    when not exists (
      select 1 from public.proc_po_lines pl
      left join (
        select gl.po_line_id,sum(gl.accepted_qty) rec
        from public.proc_grn_lines gl
        join public.proc_grns gg on gg.id=gl.grn_id and gg.status='posted'
        group by gl.po_line_id
      ) x on x.po_line_id=pl.id
      where pl.po_id=p.id and coalesce(x.rec,0) < pl.qty-pl.cancelled_qty
    ) then 'received'
    else 'partially_received'
  end,
  updated_at=now()
  where p.id=g.po_id;

  return posted_count;
end
$function$;

CREATE OR REPLACE FUNCTION public.proc_resolve_rejection_case_v1(p_case_id uuid, p_action text, p_notes text DEFAULT NULL::text, p_reference_no text DEFAULT NULL::text, p_due_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller uuid:=auth.uid();
  caller_role text;
  c public.proc_rejection_cases;
  g public.proc_grns;
  new_balance numeric;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  select role into caller_role from public.proc_profiles where id=caller and active=true;
  if caller_role is null or caller_role not in ('admin','procurement','receiver') then raise exception 'Not authorized'; end if;

  if not private.proc_has_permission('receiving.manage') then raise exception 'Permission denied: receiving.manage' using errcode='42501'; end if;

  select * into c from public.proc_rejection_cases where id=p_case_id for update;
  if c.id is null then raise exception 'Rejected-goods case not found'; end if;
  if c.status='resolved' then raise exception 'Rejected-goods case is already resolved'; end if;

  if p_action not in (
    'returned_to_supplier','replacement_requested','credit_note_requested',
    'replacement_received','credit_note_received','accept_loss','close_other'
  ) then raise exception 'Invalid rejected-goods action'; end if;

  if p_action='returned_to_supplier' then
    update public.proc_rejection_cases
    set status='returned',notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes),
        reference_no=coalesce(nullif(trim(coalesce(p_reference_no,'')),''),reference_no),
        due_date=p_due_date,updated_at=now()
    where id=c.id;
  elsif p_action='replacement_requested' then
    update public.proc_rejection_cases
    set status='replacement_due',notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes),
        reference_no=coalesce(nullif(trim(coalesce(p_reference_no,'')),''),reference_no),
        due_date=p_due_date,updated_at=now()
    where id=c.id;
  elsif p_action='credit_note_requested' then
    update public.proc_rejection_cases
    set status='credit_note_due',notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes),
        reference_no=coalesce(nullif(trim(coalesce(p_reference_no,'')),''),reference_no),
        due_date=p_due_date,updated_at=now()
    where id=c.id;
  else
    if p_action in ('credit_note_received') and nullif(trim(coalesce(p_reference_no,'')),'') is null then
      raise exception 'Credit note/reference number is required';
    end if;

    if p_action='replacement_received' then
      -- Normal receipt posting updates stock, requirement and PO balances together.
      perform public.proc_receive_po_v3(c.po_id,c.id,
        jsonb_build_array(jsonb_build_object(
          'po_line_id',(select po_line_id from public.proc_grn_lines where id=c.grn_line_id),
          'received_qty',c.rejected_qty,'accepted_qty',c.rejected_qty,'rejected_qty',0)),
        'Replacement for rejection case '||c.id::text||coalesce(' / '||p_reference_no,''));

    end if;

    update public.proc_rejection_cases
    set status='resolved',
        resolution_type=case p_action
          when 'replacement_received' then 'replacement'
          when 'credit_note_received' then 'credit_note'
          when 'accept_loss' then 'accepted_loss'
          else 'other'
        end,
        reference_no=coalesce(nullif(trim(coalesce(p_reference_no,'')),''),reference_no),
        notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes),
        resolved_by=caller,resolved_at=now(),updated_at=now()
    where id=c.id;
  end if;

  return (
    select jsonb_build_object(
      'case_id',rc.id,'status',rc.status,'resolution_type',rc.resolution_type,
      'reference_no',rc.reference_no
    )
    from public.proc_rejection_cases rc where rc.id=c.id
  );
end $function$;
create table public.proc_po_balance_actions (
 id uuid primary key default gen_random_uuid(),
 po_line_id uuid not null references public.proc_po_lines(id),
 released_qty numeric not null check(released_qty>0),
 action text not null check(action in ('cancel','buy_elsewhere')),
 reason text not null check(length(trim(reason)) between 1 and 1000),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index proc_po_balance_actions_line_idx on public.proc_po_balance_actions(po_line_id);
create index proc_po_balance_actions_user_idx on public.proc_po_balance_actions(created_by);
alter table public.proc_po_balance_actions enable row level security;
grant select on public.proc_po_balance_actions to authenticated;
revoke all on public.proc_po_balance_actions from anon;
create policy procurement_balance_history on public.proc_po_balance_actions for select to authenticated using(private.proc_has_permission('procurement.orders.view'));

create or replace function private.proc_protect_cancelled_balance()
returns trigger language plpgsql set search_path='' as $fn$
begin
 if new.cancelled_qty is distinct from old.cancelled_qty and current_user not in ('postgres','service_role') then
  raise exception 'Use the audited balance action to cancel quantities' using errcode='42501';
 end if;
 return new;
end $fn$;
revoke all on function private.proc_protect_cancelled_balance() from public,anon,authenticated;
create trigger procurement_cancelled_balance_guard before update on public.proc_po_lines for each row execute function private.proc_protect_cancelled_balance();

create or replace function private.proc_release_po_balance_v1(p_po_line_id uuid,p_action text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare pl public.proc_po_lines; po public.proc_purchase_orders; accepted numeric; released numeric; rid uuid;
begin
 if auth.uid() is null or not private.proc_has_permission('procurement.orders.edit') or not private.proc_has_permission('procurement.orders.approve') then
  raise exception 'Permission denied: order editing and approval required' using errcode='42501';
 end if;
 if p_action not in ('cancel','buy_elsewhere') or length(trim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'Choose an action and enter a reason'; end if;
 select po_id into rid from public.proc_po_lines where id=p_po_line_id;
 select * into po from public.proc_purchase_orders where id=rid for update;
 if po.id is null or po.status not in ('sent','partially_received') then raise exception 'Only sent, outstanding orders can release a balance'; end if;
 select * into pl from public.proc_po_lines where id=p_po_line_id for update;
 if exists(select 1 from public.proc_rejection_cases c join public.proc_grn_lines gl on gl.id=c.grn_line_id where gl.po_line_id=pl.id and c.status<>'resolved') then raise exception 'Resolve rejected goods before releasing this balance'; end if;
 select coalesce(sum(gl.accepted_qty),0) into accepted from public.proc_grn_lines gl join public.proc_grns g on g.id=gl.grn_id and g.status='posted' where gl.po_line_id=pl.id;
 released:=pl.qty-pl.cancelled_qty-accepted;
 if released<=0 then raise exception 'This line has no outstanding delivery balance'; end if;
 update public.proc_po_lines set cancelled_qty=cancelled_qty+released where id=pl.id;
 insert into public.proc_po_balance_actions(po_line_id,released_qty,action,reason,created_by) values(pl.id,released,p_action,trim(p_reason),auth.uid());
 update public.proc_requirements set ordered_qty=greatest(ordered_qty-released,received_qty),
  adjusted_qty=case when p_action='cancel' then greatest(adjusted_qty-released,ordered_qty-released,received_qty) else adjusted_qty end,
  updated_at=now() where id=pl.requirement_id;
 perform public.proc_refresh_requirement_status(pl.requirement_id);
 if not exists(select 1 from public.proc_po_lines l where l.po_id=po.id and l.qty-l.cancelled_qty>(select coalesce(sum(gl.accepted_qty),0) from public.proc_grn_lines gl join public.proc_grns g on g.id=gl.grn_id and g.status='posted' where gl.po_line_id=l.id)) then
  update public.proc_purchase_orders set status='closed',updated_at=now() where id=po.id;
 end if;
 return jsonb_build_object('released_qty',released,'action',p_action);
end $fn$;
revoke all on function private.proc_release_po_balance_v1(uuid,text,text) from public,anon;
grant execute on function private.proc_release_po_balance_v1(uuid,text,text) to authenticated;
create or replace function public.proc_release_po_balance_v1(p_po_line_id uuid,p_action text,p_reason text)
returns jsonb language sql security invoker set search_path='' as $fn$
 select private.proc_release_po_balance_v1(p_po_line_id,p_action,p_reason);
$fn$;
revoke all on function public.proc_release_po_balance_v1(uuid,text,text) from public,anon;
grant execute on function public.proc_release_po_balance_v1(uuid,text,text) to authenticated;
