-- Final closure is independent of the received percentage: cancellation never
-- invents stock, and unresolved rejected goods must remain actionable.
CREATE FUNCTION private.proc_check_po_closure()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status='closed' AND OLD.status IS DISTINCT FROM NEW.status THEN
  PERFORM private.proc_assert_access();
  IF auth.uid() IS NULL OR NOT private.proc_has_permission('procurement.orders.edit')
   OR NOT private.proc_has_permission('procurement.orders.approve') THEN
   RAISE EXCEPTION 'Permission denied: order editing and approval required' USING ERRCODE='42501';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.proc_po_lines WHERE po_id=NEW.id) OR EXISTS(
   SELECT 1 FROM public.proc_po_lines l WHERE l.po_id=NEW.id AND l.qty-l.cancelled_qty>
    (SELECT coalesce(sum(gl.accepted_qty),0) FROM public.proc_grn_lines gl
     JOIN public.proc_grns g ON g.id=gl.grn_id AND g.status='posted' WHERE gl.po_line_id=l.id)
  ) THEN RAISE EXCEPTION 'Settle all outstanding delivery balances before closing this order';END IF;
  IF EXISTS(SELECT 1 FROM public.proc_rejection_cases WHERE po_id=NEW.id AND status<>'resolved') THEN
   RAISE EXCEPTION 'Resolve rejected goods in Receive / Follow-ups before closing this order';END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.proc_check_po_closure() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER b_proc_check_po_closure BEFORE UPDATE OF status ON public.proc_purchase_orders
 FOR EACH ROW EXECUTE FUNCTION private.proc_check_po_closure();

CREATE FUNCTION private.proc_close_po_v1(p_po_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE po public.proc_purchase_orders;
BEGIN
 PERFORM private.proc_assert_access();
 IF auth.uid() IS NULL OR NOT private.proc_has_permission('procurement.orders.edit')
  OR NOT private.proc_has_permission('procurement.orders.approve') THEN
  RAISE EXCEPTION 'Permission denied: order editing and approval required' USING ERRCODE='42501';END IF;
 SELECT * INTO po FROM public.proc_purchase_orders WHERE id=p_po_id FOR UPDATE;
 IF po.id IS NULL THEN RAISE EXCEPTION 'Order not found';END IF;
 IF po.status='closed' THEN RETURN jsonb_build_object('po_id',po.id,'status','closed','replayed',true);END IF;
 IF po.status<>'received' THEN RAISE EXCEPTION 'Receive all goods or release the outstanding balance before closing this order';END IF;
 UPDATE public.proc_purchase_orders SET status='closed',updated_at=now() WHERE id=po.id;
 RETURN jsonb_build_object('po_id',po.id,'status','closed','replayed',false);
END $$;
REVOKE ALL ON FUNCTION private.proc_close_po_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.proc_close_po_v1(uuid) TO authenticated;
CREATE FUNCTION public.proc_close_po_v1(p_po_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT private.proc_close_po_v1(p_po_id);
$$;
REVOKE ALL ON FUNCTION public.proc_close_po_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_close_po_v1(uuid) TO authenticated;
