-- Read-only report. Caller permissions and underlying table RLS remain enforced.
CREATE VIEW public.proc_v_item_order_recency WITH (security_invoker=true) AS
SELECT i.id AS item_id,i.item_code,i.category,i.description,i.size,i.uom,i.movement,
       last_po.last_ordered_at,
       CASE WHEN last_po.last_ordered_at IS NULL THEN NULL
            ELSE greatest(0,(now() AT TIME ZONE 'Asia/Colombo')::date-(last_po.last_ordered_at AT TIME ZONE 'Asia/Colombo')::date) END AS days_since_order,
       last_po.last_ordered_at IS NULL AS never_ordered
FROM public.proc_items i
LEFT JOIN (
 SELECT l.item_id,max(coalesce(p.sent_at,p.po_date::timestamp AT TIME ZONE 'Asia/Colombo')) AS last_ordered_at
 FROM public.proc_po_lines l JOIN public.proc_purchase_orders p ON p.id=l.po_id
 WHERE p.status IN ('sent','partially_received','received','closed')
 GROUP BY l.item_id
) last_po ON last_po.item_id=i.id
WHERE i.active AND (SELECT private.proc_has_any_permission(ARRAY['reports.view','procurement.requirements.view']::text[]));
REVOKE ALL ON public.proc_v_item_order_recency FROM PUBLIC,anon;
GRANT SELECT ON public.proc_v_item_order_recency TO authenticated,service_role;
COMMENT ON VIEW public.proc_v_item_order_recency IS 'Active items and most recent actually sent order; draft, approved-unsent and cancelled POs excluded. Security invoker preserves caller RLS.';
