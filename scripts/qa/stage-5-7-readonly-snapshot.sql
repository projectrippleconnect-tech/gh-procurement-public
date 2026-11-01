-- Read-only operational acceptance snapshot.
-- This script intentionally does not contact WhatsApp, send messages, change approval limits,
-- create orders, modify supplier data, enable automation, or expose API secrets.
WITH scheduled AS (
 SELECT j.jobname,j.active,
  COALESCE((SELECT d.status FROM cron.job_run_details d WHERE d.jobid=j.jobid ORDER BY d.start_time DESC LIMIT 1),'never_run') AS last_status
 FROM cron.job j
 WHERE j.jobname IN ('gh-procurement-portal-rounds-v1','gh-procurement-notification-issues',
                     'gh-procurement-admin-push','gh-procurement-automation-sweep')
)
SELECT jsonb_build_object(
 'checked_at',clock_timestamp(),
 'jobs',COALESCE((SELECT jsonb_object_agg(jobname,jsonb_build_object('active',active,'last_status',last_status)) FROM scheduled),'{}'::jsonb),
 'portal_scheduler_enabled',(SELECT enabled FROM private.proc_portal_scheduler_control WHERE singleton),
 'portal_rounds',(SELECT count(*) FROM public.proc_portal_rounds),
 'portal_po_jobs',(SELECT count(*) FROM public.proc_portal_po_jobs),
 'approved_unsent_orders',(SELECT count(*) FROM public.proc_purchase_orders WHERE status='approved'),
 'failed_or_action_send_jobs',(SELECT count(*) FROM public.proc_automation_jobs
   WHERE job_type IN ('po_send','rfq_send') AND status IN ('failed','needs_action')),
 'private_audit_copies',(SELECT count(*) FROM public.proc_whatsapp_private_group_copies),
 'private_audit_missing_ids',(SELECT count(*) FROM public.proc_whatsapp_private_group_copies
   WHERE status='accepted' AND message_id IS NULL),
 'registered_push_devices',(SELECT count(*) FROM public.proc_push_subscriptions),
 'portal_public_rls',(SELECT bool_and(relrowsecurity) FROM pg_class
   WHERE oid IN ('public.proc_portal_rounds'::regclass,
                 'public.proc_portal_po_jobs'::regclass,
                 'public.proc_whatsapp_private_group_copies'::regclass)),
 'private_round_processor_public_execute',has_function_privilege('anon','private.proc_portal_run_due_rounds_v1()','execute')
) AS acceptance_snapshot;
