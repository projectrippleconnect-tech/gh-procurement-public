-- Reconcile stalled work against its current source status, not a stale job flag.
-- A prepared RFQ has one issue; awarded/closed RFQs do not. PO send reminders use the configured delay.
CREATE OR REPLACE FUNCTION private.proc_notification_issues() RETURNS TABLE(issue_key text,kind text,title text,body text,target_view text,record_id uuid,target_filter text,severity text,responsible_role text,due_at timestamptz,action_label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH settings AS (
  SELECT greatest(1,least(10,coalesce((SELECT (config->>'minimum_quotes')::int FROM public.proc_feature_settings WHERE feature_key='quotes.minimum_quotes'),2))) minimum_quotes,
   greatest(1,least(168,coalesce((SELECT (config->>'reminder_hours')::int FROM public.proc_feature_settings WHERE feature_key='quotes.minimum_quotes'),24))) reminder_hours,
   greatest(1,least(168,coalesce((SELECT (config->>'po_send_reminder_hours')::int FROM public.proc_feature_settings WHERE feature_key='procurement.straight_through'),4))) po_send_hours
 ), today AS (SELECT (now() AT TIME ZONE 'Asia/Colombo')::date d)
 SELECT 'no-response:'||rs.id,'no_response','Supplier response overdue',r.rfq_no||' · '||s.name||' · response still outstanding','rfq',r.id,r.id::text,'warning','Procurement',coalesce(r.due_date::timestamp AT TIME ZONE 'Asia/Colombo',rs.sent_at+make_interval(hours=>cfg.reminder_hours)),'Follow up supplier'
 FROM public.proc_rfq_suppliers rs JOIN public.proc_rfqs r ON r.id=rs.rfq_id JOIN public.proc_suppliers s ON s.id=rs.supplier_id CROSS JOIN settings cfg CROSS JOIN today
 WHERE r.status IN ('sent','partially_quoted') AND rs.status IN ('sent','viewed') AND (r.due_date<today.d OR rs.sent_at<=now()-make_interval(hours=>cfg.reminder_hours))
 UNION ALL
 SELECT 'few-quotes:'||ri.id,'insufficient_quotes','Insufficient valid quotations',r.rfq_no||' · '||i.description||' · minimum '||cfg.minimum_quotes||' valid suppliers required','rfq',r.id,r.id::text,'warning','Procurement',r.due_date::timestamp AT TIME ZONE 'Asia/Colombo','Review quote sufficiency'
 FROM public.proc_rfq_items ri JOIN public.proc_rfqs r ON r.id=ri.rfq_id JOIN public.proc_requirements req ON req.id=ri.requirement_id JOIN public.proc_items i ON i.id=req.item_id CROSS JOIN settings cfg CROSS JOIN today
 WHERE r.status IN ('sent','partially_quoted','quoted') AND r.due_date<today.d AND nullif(trim(r.quote_exception_reason),'') IS NULL
 AND (SELECT count(DISTINCT c.supplier_id) FROM public.proc_v_quote_comparison c WHERE c.rfq_item_id=ri.id AND coalesce(c.available_qty,ri.requested_qty)>0)<cfg.minimum_quotes
 UNION ALL
 SELECT 'expired:'||q.id,'expired_quote','Quotation expired',r.rfq_no||' · '||s.name||' · validity ended '||q.valid_until,'rfq',r.id,r.id::text,'warning','Procurement',q.valid_until::timestamp AT TIME ZONE 'Asia/Colombo','Request a fresh quotation'
 FROM public.proc_quotes q JOIN public.proc_rfqs r ON r.id=q.rfq_id JOIN public.proc_suppliers s ON s.id=q.supplier_id CROSS JOIN today
 WHERE r.status IN ('sent','partially_quoted','quoted') AND q.status IN ('received','reviewed','selected') AND q.valid_until<today.d
 UNION ALL
 SELECT 'overbuy:'||q.id,'overbuy','MOQ / minimum order review',r.rfq_no||' · '||s.name||' · supplier minimum may exceed requested purchase','rfq',r.id,r.id::text,'warning','Procurement / Approver',r.due_date::timestamp AT TIME ZONE 'Asia/Colombo','Review minimums before award'
 FROM public.proc_quotes q JOIN public.proc_rfqs r ON r.id=q.rfq_id JOIN public.proc_suppliers s ON s.id=q.supplier_id CROSS JOIN today
 WHERE r.status IN ('sent','partially_quoted','quoted') AND q.status IN ('received','reviewed','selected') AND (q.valid_until IS NULL OR q.valid_until>=today.d)
 AND (EXISTS(SELECT 1 FROM public.proc_quote_lines l JOIN public.proc_rfq_items ri ON ri.id=l.rfq_item_id WHERE l.quote_id=q.id AND (l.moq>ri.requested_qty OR l.order_multiple>1 AND mod(ri.requested_qty,l.order_multiple)<>0)) OR q.minimum_order_value>(SELECT coalesce(sum(c.requested_qty*c.landed_unit_cost),0) FROM public.proc_v_quote_comparison c WHERE c.quote_id=q.id))
 UNION ALL
 SELECT 'approval:'||p.id,'unapproved_cost','Order awaiting approval',p.po_no||' · cost needs administrator approval','po',p.id,p.id::text,'warning','Approver',p.created_at,'Review and approve order'
 FROM public.proc_purchase_orders p WHERE p.status='pending_approval'
 UNION ALL
 SELECT 'delivery:'||p.id,'delayed_delivery','Delivery overdue',p.po_no||' · expected '||p.expected_date,'receiving',p.id,p.id::text,'urgent','Procurement / Receiver',p.expected_date::timestamp AT TIME ZONE 'Asia/Colombo','Follow up outstanding delivery'
 FROM public.proc_purchase_orders p CROSS JOIN today WHERE p.status IN ('sent','partially_received') AND p.expected_date<today.d
 UNION ALL
 SELECT 'invoice:'||v.id,'invoice_variance','Invoice variance unresolved',v.invoice_no||' · investigate and record a resolution','invoices',v.id,'variance','urgent','Accounts / Approver',v.created_at,'Resolve invoice variance'
 FROM public.proc_supplier_invoices v WHERE v.status='variance' AND v.variance_resolution_status NOT IN ('resolved','not_required')
 UNION ALL
 SELECT 'rejected:'||c.id,'rejected_goods','Rejected goods follow-up',c.grn_no||' · '||c.po_no||' · '||coalesce(c.rejection_reason,'Rejected goods need resolution'),'receiving',c.po_id,'followup:'||c.po_no,'warning','Receiver / Procurement',c.due_date::timestamp AT TIME ZONE 'Asia/Colombo','Resolve rejected goods case'
 FROM public.proc_v_rejection_cases c WHERE c.status<>'resolved'
 UNION ALL
 SELECT 'unexpected:'||g.id,'unexpected_receipt','Unexpected receipt quantity',g.grn_no||' · received item or quantity differs from order; inspect before accepting','receiving',g.po_id,g.po_id::text,'urgent','Receiver / Approver',g.created_at,'Review receipt against order'
 FROM public.proc_grns g WHERE g.status='posted' AND EXISTS(SELECT 1 FROM public.proc_grn_lines l JOIN public.proc_po_lines p ON p.id=l.po_line_id WHERE l.grn_id=g.id AND (l.item_id<>p.item_id OR l.received_qty>l.ordered_qty))
 UNION ALL
 SELECT 'job:'||j.id,'stalled_document','Work needs attention',replace(j.job_type,'_',' ')||' · '||left(coalesce(j.last_error,'Document has stalled'),220),'urgent_actions',j.entity_id,'','warning','Procurement',coalesce(j.next_attempt_at,j.created_at),'Review automation exception'
 FROM public.proc_automation_jobs j WHERE j.status IN ('failed','needs_action') AND j.job_type NOT IN ('rfq_reminder','po_delivery_overdue','po_send','rfq_send')
 UNION ALL
 SELECT 'unsent-rfq:'||r.id,'stalled_document','Supplier request not sent',r.rfq_no||' · prepared request still needs sending','rfq',r.id,r.id::text,'warning','Procurement',r.due_date::timestamp AT TIME ZONE 'Asia/Colombo','Send prepared supplier request'
 FROM public.proc_rfqs r WHERE r.status IN ('draft','prepared') AND EXISTS(SELECT 1 FROM public.proc_automation_jobs j WHERE j.entity_id=r.id AND j.job_type='rfq_send' AND j.status IN ('failed','needs_action'))
 UNION ALL
 SELECT 'unsent:'||p.id,'stalled_document','Approved order not sent',p.po_no||' · approved order still needs sending','po',p.id,p.id::text,'warning','Procurement',coalesce(p.approved_at,p.created_at)+make_interval(hours=>cfg.po_send_hours),'Send approved order'
 FROM public.proc_purchase_orders p CROSS JOIN settings cfg WHERE p.status='approved' AND coalesce(p.approved_at,p.created_at)<now()-make_interval(hours=>cfg.po_send_hours)
 UNION ALL
 SELECT 'rfq-send:'||d.id,'failed_supplier_notification','Supplier request delivery needs review',r.rfq_no||' · gateway '||d.status||'; check WhatsApp before retrying','rfq',r.id,r.id::text,'urgent','Procurement',d.updated_at,'Review dispatch history'
 FROM public.proc_whatsapp_rfq_dispatches d JOIN public.proc_rfqs r ON r.id=d.rfq_id WHERE d.status IN ('failed','unknown') AND r.status NOT IN ('closed','awarded')
 UNION ALL
 SELECT 'po-send:'||d.id,'failed_supplier_notification','Order delivery needs review',p.po_no||' · gateway '||d.status||'; check WhatsApp before retrying','po',p.id,p.id::text,'urgent','Procurement',d.updated_at,'Review dispatch history'
 FROM public.proc_whatsapp_po_dispatches d JOIN public.proc_purchase_orders p ON p.id=d.po_id WHERE d.status IN ('failed','unknown') AND p.status NOT IN ('closed','cancelled')
 UNION ALL
 SELECT 'push:'||d.notification_id||':'||d.subscription_id,'failed_notification','Phone notification failed','Push retries exhausted. Check device registration and send a test.','urgent_actions',d.notification_id,'','warning','Administrator',d.next_attempt_at,'Check Notifications device status'
 FROM public.proc_push_deliveries d JOIN public.proc_admin_notifications n ON n.id=d.notification_id WHERE d.sent_at IS NULL AND d.attempts>=5 AND n.kind<>'failed_notification' AND n.created_at>now()-interval '7 days'
$$;
