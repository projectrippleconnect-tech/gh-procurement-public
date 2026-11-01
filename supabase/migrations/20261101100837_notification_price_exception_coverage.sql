-- Stage 4: durable admin events and an automatically reconciled issue queue.
-- The existing private push worker delivers these records; no supplier send flags change.
ALTER TABLE public.proc_admin_notifications
 ADD COLUMN severity text NOT NULL DEFAULT 'info' CHECK(severity IN ('info','warning','urgent')),
 ADD COLUMN responsible_role text,
 ADD COLUMN due_at timestamptz,
 ADD COLUMN action_label text,
 ADD COLUMN target_filter text NOT NULL DEFAULT '',
 ADD COLUMN issue_key text,
 ADD COLUMN resolved_at timestamptz,
 ADD COLUMN snoozed_until timestamptz;
CREATE INDEX proc_admin_open_issues ON public.proc_admin_notifications(recipient_id,created_at DESC) WHERE issue_key IS NOT NULL AND resolved_at IS NULL;

CREATE FUNCTION private.proc_notify_admins(p_key text,p_kind text,p_title text,p_body text,p_view text,p_record uuid,p_filter text DEFAULT '',p_severity text DEFAULT 'info',p_role text DEFAULT 'Procurement',p_due timestamptz DEFAULT NULL,p_action text DEFAULT 'Open record',p_issue text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO public.proc_admin_notifications(recipient_id,event_key,kind,title,body,target_view,record_id,target_filter,severity,responsible_role,due_at,action_label,issue_key)
 SELECT p.id,p_key,p_kind,p_title,left(p_body,600),p_view,p_record,p_filter,p_severity,p_role,p_due,p_action,p_issue
 FROM public.proc_profiles p JOIN public.proc_roles r ON r.role_key=p.role_key AND r.enabled
 WHERE p.active AND p.deleted_at IS NULL AND p.role='admin'
 ON CONFLICT(recipient_id,event_key) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION private.proc_notify_admins(text,text,text,text,text,uuid,text,text,text,timestamptz,text,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.proc_price_activity_alert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ref text; sid uuid; rid uuid; supplier text; key_v text; kind_v text; title_v text; body_v text; filter_v text;
BEGIN
 IF tg_table_name='proc_supplier_standing_prices' THEN
  IF NEW.state<>'submitted' OR (TG_OP='UPDATE' AND OLD.state='submitted') THEN RETURN NEW; END IF;
  SELECT name INTO supplier FROM public.proc_suppliers WHERE id=NEW.supplier_id;
  PERFORM private.proc_notify_admins('standing:'||NEW.id||':'||NEW.revision,'supplier_prices','Standing prices ready for review',coalesce(supplier,'Supplier')||' · new price version submitted','supplier_access',NEW.id,'','info','Approver',NEW.valid_until,'Review exact price version');
  RETURN NEW;
 ELSIF tg_table_name='proc_supplier_portal_links' THEN
  IF NEW.status NOT IN ('confirmed','imported') OR NEW.confirmed_at IS NULL OR (TG_OP='UPDATE' AND NEW.confirmed_at IS NOT DISTINCT FROM OLD.confirmed_at) THEN RETURN NEW; END IF;
  SELECT r.rfq_no,r.id,rs.supplier_id INTO ref,rid,sid FROM public.proc_rfq_suppliers rs JOIN public.proc_rfqs r ON r.id=rs.rfq_id WHERE rs.id=NEW.rfq_supplier_id;
  key_v:='portal-price:'||NEW.id||':'||NEW.revision;kind_v:='supplier_prices';title_v:='Supplier prices returned';
 ELSIF tg_table_name='proc_quotes' THEN
  IF TG_OP='UPDATE' AND ROW(NEW.quote_ref,NEW.valid_until,NEW.freight_total,NEW.minimum_order_value) IS NOT DISTINCT FROM ROW(OLD.quote_ref,OLD.valid_until,OLD.freight_total,OLD.minimum_order_value) THEN RETURN NEW; END IF;
  sid:=NEW.supplier_id;rid:=NEW.rfq_id;SELECT rfq_no INTO ref FROM public.proc_rfqs WHERE id=rid;
  key_v:='quote:'||NEW.id||':'||txid_current();kind_v:='supplier_prices';title_v:='Supplier prices updated';
 ELSIF tg_table_name='proc_quote_lines' THEN
  IF TG_OP='UPDATE' AND ROW(NEW.unit_price,NEW.discount_percent,NEW.tax_percent,NEW.available_qty,NEW.lead_days,NEW.moq,NEW.order_multiple,NEW.notes) IS NOT DISTINCT FROM ROW(OLD.unit_price,OLD.discount_percent,OLD.tax_percent,OLD.available_qty,OLD.lead_days,OLD.moq,OLD.order_multiple,OLD.notes) THEN RETURN NEW; END IF;
  SELECT q.supplier_id,q.rfq_id,r.rfq_no INTO sid,rid,ref FROM public.proc_quotes q JOIN public.proc_rfqs r ON r.id=q.rfq_id WHERE q.id=NEW.quote_id;
  key_v:='quote:'||NEW.quote_id||':'||txid_current();kind_v:='supplier_prices';title_v:='Supplier prices updated';
 ELSE
  IF NEW.status NOT IN ('sent','declined') OR (TG_OP='UPDATE' AND NEW.status=OLD.status) THEN RETURN NEW; END IF;
  sid:=NEW.supplier_id;rid:=NEW.rfq_id;SELECT rfq_no INTO ref FROM public.proc_rfqs WHERE id=rid;
  key_v:='rfq-activity:'||NEW.id||':'||NEW.status||':'||txid_current();kind_v:='rfq_activity';title_v:='Supplier request updated';
 END IF;
 IF kind_v='supplier_prices' THEN key_v:='prices:'||rid||':'||sid||':'||txid_current();title_v:='Supplier prices returned / updated'; END IF;
 SELECT name INTO supplier FROM public.proc_suppliers WHERE id=sid;
 body_v:=coalesce(ref,'Supplier request')||' · '||coalesce(supplier,'Supplier');
 PERFORM private.proc_notify_admins(key_v,kind_v,title_v,body_v,'rfq',rid,rid::text,'info','Procurement',NULL,'Review supplier prices');
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.proc_price_activity_alert() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER proc_standing_price_alert AFTER UPDATE ON private.proc_supplier_standing_prices FOR EACH ROW EXECUTE FUNCTION private.proc_price_activity_alert();
CREATE TRIGGER proc_price_header_alert AFTER INSERT OR UPDATE ON public.proc_quotes FOR EACH ROW EXECUTE FUNCTION private.proc_price_activity_alert();
CREATE TRIGGER proc_price_line_alert AFTER INSERT OR UPDATE ON public.proc_quote_lines FOR EACH ROW EXECUTE FUNCTION private.proc_price_activity_alert();
CREATE TRIGGER proc_portal_price_alert AFTER UPDATE ON public.proc_supplier_portal_links FOR EACH ROW EXECUTE FUNCTION private.proc_price_activity_alert();
CREATE TRIGGER proc_rfq_activity_alert AFTER INSERT OR UPDATE OF status ON public.proc_rfq_suppliers FOR EACH ROW EXECUTE FUNCTION private.proc_price_activity_alert();

CREATE FUNCTION private.proc_notification_issues() RETURNS TABLE(issue_key text,kind text,title text,body text,target_view text,record_id uuid,target_filter text,severity text,responsible_role text,due_at timestamptz,action_label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH settings AS (
  SELECT greatest(1,least(10,coalesce((SELECT (config->>'minimum_quotes')::int FROM public.proc_feature_settings WHERE feature_key='quotes.minimum_quotes'),2))) minimum_quotes,
   greatest(1,least(168,coalesce((SELECT (config->>'reminder_hours')::int FROM public.proc_feature_settings WHERE feature_key='quotes.minimum_quotes'),24))) reminder_hours
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
 FROM public.proc_automation_jobs j WHERE j.status IN ('failed','needs_action') AND j.job_type NOT IN ('rfq_reminder','po_delivery_overdue')
 UNION ALL
 SELECT 'unsent:'||p.id,'stalled_document','Approved order not sent',p.po_no||' · approved order still needs sending','po',p.id,p.id::text,'warning','Procurement',coalesce(p.approved_at,p.created_at)+interval '4 hours','Send approved order'
 FROM public.proc_purchase_orders p WHERE p.status='approved' AND coalesce(p.approved_at,p.created_at)<now()-interval '4 hours'
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
REVOKE ALL ON FUNCTION private.proc_notification_issues() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.proc_reconcile_notification_issues() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE issue record; count_v integer:=0; keys text[]:='{}';
BEGIN
 -- Serialize sweeps without blocking normal business transactions.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('proc-notification-sweep',0)) THEN RETURN 0; END IF;
 FOR issue IN SELECT * FROM private.proc_notification_issues() LOOP
  keys:=array_append(keys,issue.issue_key);
  -- Exactly one event per continuous issue episode, per active administrator.
  INSERT INTO public.proc_admin_notifications(recipient_id,event_key,kind,title,body,target_view,record_id,target_filter,severity,responsible_role,due_at,action_label,issue_key)
  SELECT p.id,'issue:'||issue.issue_key||':'||coalesce((SELECT count(*) FROM public.proc_admin_notifications n WHERE n.recipient_id=p.id AND n.issue_key=issue.issue_key),0),issue.kind,issue.title,left(issue.body,600),issue.target_view,issue.record_id,issue.target_filter,issue.severity,issue.responsible_role,issue.due_at,issue.action_label,issue.issue_key
  FROM public.proc_profiles p JOIN public.proc_roles r ON r.role_key=p.role_key AND r.enabled WHERE p.active AND p.deleted_at IS NULL AND p.role='admin'
  AND NOT EXISTS(SELECT 1 FROM public.proc_admin_notifications n WHERE n.recipient_id=p.id AND n.issue_key=issue.issue_key AND n.resolved_at IS NULL)
  ON CONFLICT(recipient_id,event_key) DO NOTHING;
  count_v:=count_v+1;
 END LOOP;
 WITH fixed AS (
  UPDATE public.proc_admin_notifications SET resolved_at=now() WHERE issue_key IS NOT NULL AND resolved_at IS NULL AND NOT(issue_key=ANY(keys)) RETURNING id,record_id,issue_key
 ) INSERT INTO public.proc_audit_logs(table_name,record_id,action,new_data,user_id)
 SELECT 'proc_admin_notifications',record_id,'notification_auto_resolved',jsonb_build_object('notification_id',id,'issue_key',issue_key),NULL FROM fixed;
 RETURN count_v;
END $$;
REVOKE ALL ON FUNCTION private.proc_reconcile_notification_issues() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.proc_notification_postpone_v1(p_id uuid,p_hours integer,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row_v public.proc_admin_notifications;
BEGIN
 IF auth.uid() IS NULL OR private.proc_current_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 PERFORM private.proc_assert_access();
 IF p_hours IS NULL OR p_hours NOT BETWEEN 1 AND 24 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 5 AND 400 THEN RAISE EXCEPTION 'Choose 1–24 hours and enter a reason (5–400 characters)'; END IF;
 SELECT * INTO row_v FROM public.proc_admin_notifications WHERE id=p_id AND recipient_id=auth.uid() AND issue_key IS NOT NULL AND resolved_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Open issue unavailable'; END IF;
 UPDATE public.proc_admin_notifications SET snoozed_until=now()+make_interval(hours=>p_hours) WHERE id=p_id;
 INSERT INTO public.proc_audit_logs(table_name,record_id,action,new_data) VALUES('proc_admin_notifications',p_id,'notification_postponed',jsonb_build_object('hours',p_hours,'reason',trim(p_reason),'issue_key',row_v.issue_key));
END $$;
REVOKE ALL ON FUNCTION public.proc_notification_postpone_v1(uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_notification_postpone_v1(uuid,integer,text) TO authenticated;

-- Real production scheduler only; isolated QA has no cron/network extensions.
DO $$ BEGIN
 IF to_regnamespace('cron') IS NOT NULL THEN
  EXECUTE $cron$SELECT cron.schedule('gh-procurement-notification-issues','* * * * *','select private.proc_reconcile_notification_issues();')$cron$;
 END IF;
END $$;

-- Service-only atomic batch claim. Scans past delivered history and never pushes fixed issues.
CREATE FUNCTION public.proc_push_claim_v1(p_limit integer DEFAULT 100)
RETURNS TABLE(notification_id uuid,subscription_id uuid,subscription jsonb,title text,body text,event_key text,attempt integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE x record; claimed public.proc_push_deliveries; n integer:=0;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Batch must contain 1–100 notifications'; END IF;
 FOR x IN
  SELECT a.id nid,s.id sid,s.subscription sub,a.title ttl,a.body msg,a.event_key key_v
  FROM public.proc_admin_notifications a JOIN public.proc_push_subscriptions s ON s.user_id=a.recipient_id
  JOIN public.proc_profiles p ON p.id=a.recipient_id AND p.active AND p.deleted_at IS NULL AND p.role='admin'
  JOIN public.proc_roles r ON r.role_key=p.role_key AND r.enabled
  LEFT JOIN public.proc_push_deliveries d ON d.notification_id=a.id AND d.subscription_id=s.id
  WHERE a.created_at>=s.created_at AND a.created_at>=now()-interval '24 hours' AND a.resolved_at IS NULL
   AND (a.snoozed_until IS NULL OR a.snoozed_until<=now()) AND a.read_at IS NULL
   AND (d.notification_id IS NULL OR d.sent_at IS NULL AND d.attempts<5 AND d.next_attempt_at<=now())
  ORDER BY a.created_at,a.id,s.id LIMIT p_limit*2
 LOOP
  INSERT INTO public.proc_push_deliveries(notification_id,subscription_id) VALUES(x.nid,x.sid) ON CONFLICT DO NOTHING;
  SELECT * INTO claimed FROM public.proc_push_deliveries d WHERE d.notification_id=x.nid AND d.subscription_id=x.sid AND d.sent_at IS NULL AND d.attempts<5 AND d.next_attempt_at<=now() FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN CONTINUE; END IF;
  UPDATE public.proc_push_deliveries d SET attempts=d.attempts+1,next_attempt_at=now()+interval '2 minutes' WHERE d.notification_id=x.nid AND d.subscription_id=x.sid;
  notification_id:=x.nid;subscription_id:=x.sid;subscription:=x.sub;title:=x.ttl;body:=x.msg;event_key:=x.key_v;attempt:=claimed.attempts+1;
  RETURN NEXT;n:=n+1;EXIT WHEN n>=p_limit;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.proc_push_claim_v1(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.proc_push_claim_v1(integer) TO service_role;
