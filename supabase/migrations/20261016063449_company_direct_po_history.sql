-- Direct company POs belong in the company procurement history without creating a fictitious RFQ.
CREATE OR REPLACE FUNCTION public.proc_company_direct_po_history(p_limit integer DEFAULT 100)
RETURNS TABLE(po_id uuid,po_no text,company_id uuid,company_name text,po_status text,created_at timestamptz,item_count bigint,sent_count bigint,failed_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.proc_assert_access();
 IF NOT private.proc_has_permission('procurement.rfq.manage') AND NOT private.proc_has_permission('company_lists.view')
 THEN RAISE EXCEPTION 'Company history permission required'; END IF;
 RETURN QUERY
 SELECT p.id,p.po_no,c.id,c.name,p.status::text,p.created_at,
  (SELECT count(*) FROM public.proc_po_lines l WHERE l.po_id=p.id),
  (SELECT count(*) FROM public.proc_company_dispatch_queue q WHERE q.po_id=p.id AND q.status='accepted'),
  (SELECT count(*) FROM public.proc_company_dispatch_queue q WHERE q.po_id=p.id AND q.status IN ('failed','unknown'))
 FROM public.proc_purchase_orders p JOIN public.proc_companies c ON c.id=p.company_id
 WHERE p.quantity_only
 ORDER BY p.created_at DESC,p.id LIMIT greatest(1,least(coalesce(p_limit,100),200));
END $$;
REVOKE ALL ON FUNCTION public.proc_company_direct_po_history(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_company_direct_po_history(integer) TO authenticated;

-- Quotation-based awards predate company_id on POs. Classify them from their source
-- requirements too, without rewriting historical orders or changing their ownership.
CREATE OR REPLACE FUNCTION public.proc_po_is_company(public.proc_purchase_orders)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT $1.company_id IS NOT NULL OR EXISTS(
  SELECT 1 FROM public.proc_po_lines l JOIN public.proc_requirements r ON r.id=l.requirement_id
  WHERE l.po_id=$1.id AND r.company_id IS NOT NULL
 );
$$;
REVOKE ALL ON FUNCTION public.proc_po_is_company(public.proc_purchase_orders) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_po_is_company(public.proc_purchase_orders) TO authenticated;
NOTIFY pgrst,'reload schema';
