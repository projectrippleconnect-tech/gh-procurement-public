CREATE OR REPLACE FUNCTION public.proc_create_invoice_v4(p_po_id uuid, p_invoice_no text, p_lines jsonb, p_attachment_path text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  caller uuid:=auth.uid(); caller_role text; po public.proc_purchase_orders; iid uuid; x jsonb; pl public.proc_po_lines;
  q numeric; pr numeric; disc numeric; tax numeric; line_net numeric; line_tax numeric;
  accepted_to_date numeric; previously_invoiced numeric; available_to_invoice numeric;
  v_subtotal numeric:=0; v_tax_total numeric:=0; v_variance boolean:=false; details jsonb:='[]'::jsonb;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  select role into caller_role from public.proc_profiles where id=caller and active=true;
  if caller_role is null or caller_role not in ('admin','procurement') then raise exception 'Not authorized'; end if;
  if not private.proc_has_permission('invoices.manage') then raise exception 'Permission denied: invoices.manage' using errcode='42501'; end if;
  if nullif(trim(p_invoice_no),'') is null then raise exception 'Invoice number is required'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Invoice lines are required'; end if;

  if (select count(*)<>count(distinct entry.value->>'po_line_id') from jsonb_array_elements(p_lines) as entry(value)) then raise exception 'Each purchase order line may appear only once per invoice'; end if;
  select * into po from public.proc_purchase_orders where id=p_po_id for update;
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
end $function$
;

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
    if previously_accepted+acc>pl.qty then raise exception 'Accepted quantity would exceed the outstanding ordered quantity'; end if;

    insert into public.proc_grn_lines(grn_id,po_line_id,item_id,ordered_qty,received_qty,accepted_qty,rejected_qty,rejection_reason)
    values(gid,pl.id,pl.item_id,pl.qty,rec,acc,rej,reject_reason);
  end loop;

  posted:=private.proc_post_grn_impl(gid);
  return jsonb_build_object('grn_id',gid,'grn_no',gno,'lines_posted',posted,'replayed',false);
end $function$
;

create or replace view public.proc_v_dashboard with (security_invoker=true) as
 select
 (select count(*) from public.proc_items where active) as active_items,
 (select count(*) from public.proc_requirements where status not in ('received','closed','cancelled')) as open_requirements,
 (select count(*) from public.proc_requirements where adjusted_qty>ordered_qty and status not in ('closed','cancelled')) as still_to_order,
 (select count(*) from public.proc_requirements where ordered_qty>received_qty and status not in ('closed','cancelled')) as awaiting_receipt,
 (select count(*) from public.proc_purchase_orders where status in ('pending_approval','approved','sent','partially_received')) as open_pos,
 (select coalesce(sum(total),0) from public.proc_purchase_orders where status<>'cancelled') as po_value,
 (select count(*) from public.proc_supplier_invoices where status='variance') as invoice_variances,
 (select count(*) from public.proc_stock_counts where status='draft') as draft_counts;
