-- Explicitly requested manual dispatch of newly created, approved company POs.
-- This function only inserts missing queue claims for the precise provided PO IDs.
-- It never changes a purchase order, resets a queue status, or sends WhatsApp.
CREATE OR REPLACE FUNCTION public.proc_company_queue_selected_po_send(
 p_company_id uuid, p_po_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
 v_po record;
 v_selected_count integer;
 v_inserted integer:=0;
 v_existing text;
BEGIN
 PERFORM private.proc_assert_access();
 IF auth.uid() IS NULL OR NOT private.proc_is_role(ARRAY['admin'])
  OR NOT private.proc_has_permission('company_lists.manage')
  OR NOT private.proc_has_permission('procurement.orders.approve') THEN
  RAISE EXCEPTION 'Company purchase order administrator required' USING errcode='42501';
 END IF;
 v_selected_count:=coalesce(cardinality(p_po_ids),0);
 IF p_company_id IS NULL OR v_selected_count<1 OR v_selected_count>200
  OR array_position(p_po_ids,NULL) IS NOT NULL
  OR (SELECT count(DISTINCT id) FROM unnest(p_po_ids) ids(id))<>v_selected_count THEN
  RAISE EXCEPTION 'Select unique, valid purchase order IDs (up to 200)';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.proc_companies c WHERE c.id=p_company_id AND c.active AND c.company_list_enabled) THEN
  RAISE EXCEPTION 'Company is unavailable';
 END IF;
 -- Validate the full batch before creating any pending dispatch entry.
 IF (SELECT count(*) FROM public.proc_purchase_orders p WHERE p.id=ANY(p_po_ids))<>v_selected_count THEN
  RAISE EXCEPTION 'A selected purchase order no longer exists';
 END IF;
 FOR v_po IN
  SELECT p.id,p.company_id,p.status,p.sent_at,p.quantity_only,p.supplier_id,
   s.active AS supplier_active,s.supplier_kind,s.phone,s.whatsapp
  FROM public.proc_purchase_orders p
  LEFT JOIN public.proc_suppliers s ON s.id=p.supplier_id
  WHERE p.id=ANY(p_po_ids)
  ORDER BY p.id FOR UPDATE OF p
 LOOP
  IF v_po.company_id IS DISTINCT FROM p_company_id OR v_po.status<>'approved'
   OR v_po.sent_at IS NOT NULL OR NOT v_po.quantity_only
   OR NOT coalesce(v_po.supplier_active,false) OR v_po.supplier_kind<>'company'
   OR nullif(trim(coalesce(nullif(v_po.whatsapp,''),v_po.phone,'')),'') IS NULL THEN
   RAISE EXCEPTION 'PO % is not an approved, unsent quantity-only order for this company',v_po.id;
  END IF;
  SELECT q.status INTO v_existing
   FROM public.proc_company_dispatch_queue q WHERE q.po_id=v_po.id FOR UPDATE;
  IF v_existing IS NOT NULL AND v_existing<>'pending' THEN
   RAISE EXCEPTION 'PO % already has sending status %. Inspect history; do not retry automatically.',v_po.id,v_existing;
  END IF;
 END LOOP;
 INSERT INTO public.proc_company_dispatch_queue(po_id,company_id,status)
 SELECT id,p_company_id,'pending' FROM unnest(p_po_ids) ids(id)
 ON CONFLICT (po_id) DO NOTHING;
 GET DIAGNOSTICS v_inserted=ROW_COUNT;
 RETURN jsonb_build_object('ok',true,'selected',v_selected_count,'added',v_inserted);
END $$;
REVOKE ALL ON FUNCTION public.proc_company_queue_selected_po_send(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_company_queue_selected_po_send(uuid,uuid[]) TO authenticated;
