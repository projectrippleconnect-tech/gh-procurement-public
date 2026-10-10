CREATE OR REPLACE FUNCTION private.proc_po_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      if caller_role is null or caller_role not in ('admin','procurement') then raise exception 'Not authorized to send purchase orders'; end if;
      new.sent_at:=coalesce(new.sent_at,now());
    elsif new.status='cancelled' then
      if caller_role is null or caller_role not in ('admin','procurement') then raise exception 'Not authorized to cancel purchase orders'; end if;
      if old.status in ('received','closed') then raise exception 'Received or closed purchase orders cannot be cancelled'; end if;
    elsif new.status='closed' then
      if old.status<>'received' then
        if old.status not in ('sent','partially_received')
          or not exists(select 1 from public.proc_po_lines where po_id=old.id and cancelled_qty>0)
          or exists(select 1 from public.proc_po_lines l where l.po_id=old.id
            and l.qty-l.cancelled_qty>(select coalesce(sum(gl.accepted_qty),0) from public.proc_grn_lines gl join public.proc_grns g on g.id=gl.grn_id and g.status='posted' where gl.po_line_id=l.id))
        then raise exception 'Only a received or fully accounted purchase order can be closed'; end if;
      end if;
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
          where pl.po_id=old.id and coalesce(rec.accepted_qty,0)<pl.qty-pl.cancelled_qty
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
end $function$;
