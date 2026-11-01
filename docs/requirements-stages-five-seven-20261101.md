# GH Procurement requirements — Stages 5–7 acceptance checkpoint (1 November 2026)

This is a **live-evidence checkpoint, not a claim of completed end-to-end acceptance**. Stage 4 application revision `2488427d475b3c422c25e7a4a49485ef1a243ee4` passed all nine CI jobs and was manually released to the existing Netlify site (run [41297443336](https://github.com/projectrippleconnect-tech/gh-procurement-public/actions/runs/41297443336)). This Stage 5–7 patch branches from that source and is **not automatically deployed**.

## Stage 5 — supplier WhatsApp images, captions and private audit copies

Existing mechanisms:
- Separate authenticated RFQ, PO, company RFQ and company PO image/caption dispatch routes.
- Server-only WAHA URL/API key/session; explicitly pinned HTTPS origin when hosted externally; credentialed requests reject redirects.
- Database claim before send, status stored after send, safe manual PNG sharing, and no automatic retry of uncertain attempts.
- Audit group destination identity/participants verification, source/page uniqueness and archive performed only after accepted supplier gateway send.

**New fix in this candidate:** all four routes now treat HTTP success **without a WAHA message ID** as `unknown`, not `accepted`. Multi-page company RFQs stop at the uncertain page. Company POs check **each PNG page**, and a selected attachment must have an acknowledgement before treating the overall order as accepted. Unknown outcomes require manual reconciliation and are not automatically requeued. Regression tests are in `tests/waha-acknowledgement.test.mjs`.

Read-only production snapshot:
- RFQ gateway dispatch rows: 2 marked accepted; PO dispatch rows: 3 marked accepted.
- Private audit-copy rows: 6 marked accepted, all with gateway message IDs, dated 18–26 October 2026. This historic evidence is **not current recipient-delivery verification**.
- 5 POs remain approved/not sent, and 11 automation jobs require action (5 PO sends, 6 RFQ sends). Do not treat their presence as permission to auto-dispatch.
- Last documented Netlify configuration inspection (31 October) found no usable gateway URL/API key or RFQ/PO audit destinations. The currently deployed manual Netlify release has `WAHA_SENDING_ENABLED=false` and portal sending disabled. Recheck the actual server environment before asserting current gateway readiness.

**External acceptance required:** connect a zero-cost, reachable, authenticated WAHA session without exposing credentials; confirm the exact owner-only RFQ/PO group IDs and participants on the paired session; test one explicitly approved disposable supplier RFQ/PO PNG and caption to a controlled recipient; confirm **physical receipt**, server message ID, and private staff audit copy for each. Do not silently retry historical `unknown` sends. Do not enable unattended supplier dispatch until this is recorded.

## Stage 6 — six-hour selection and twenty-four-hour remaining-quantity round

Existing code/database behavior:
- First round closes at `opens_at + 6 hours`; unfulfilled residual creates one second round closing after 24 hours.
- Eligible offers are filtered before landed-cost ranking. Each supplier order is created pending purchase approval; guarded policies cover supplier/price/quantity and spend limits.
- One round per RFQ; root RFQ and round number are unique; the processor locks the round. Exceptions stop processing and leave a reviewed error; completed/exception rounds are not blindly replayed.
- `private.proc_portal_run_due_rounds_v1()` is inaccessible to anon, authenticated and service_role directly.
- Existing isolated database tests in `tests/sql/portal-database-scheduler.sql` and native concurrency tests cover due/future ordering, manual limits, duplicate replay and 24-hour residual creation.

Read-only production snapshot:
- `gh-procurement-portal-rounds-v1` runs every minute and latest observed execution succeeded.
- `private.proc_portal_scheduler_control.enabled=true`; batch limit 5; most recent tick returned `{status:'completed',rounds:[]}`.
- There are **zero real portal rounds** and **zero portal PO dispatch jobs**, so a production six-hour selection and residual reopen have **not been exercised**.
- Straight-through settings show `auto_award=false` and `manual_review_required=true`. Retain business approval and spending safeguards; no setting is relaxed by this checkpoint.

**External acceptance required:** on an approved test RFQ with controlled suppliers, verify their final-confirmed prices/availability enter the right RFQ and only eligible landed costs rank; wait or safely stage a *test-only* due round, check approval-guarded supplier-wise PO generation exactly once, test a residual 24-hour round, a retry, duplicate submission, cancellation, limits, and partial receipt. Never run a synthetic production order against real supplier records without test isolation or explicit staff-controlled scope.

## Stage 7 — final acceptance, backup, permissions and recovery

Already verified:
- Stage 4 release and quality gate both succeeded; a later production-health workflow succeeded.
- Database cron includes portal rounds every minute, notification issue reconciliation every minute, push delivery every minute, and procurement automation sweep every 30 minutes; latest observed runs succeeded.
- RLS is enabled for portal rounds, portal PO jobs, WhatsApp dispatch records and private audit-copy records.
- Private audit-copy table has a unique per-source/per-page constraint.
- GH Procurement has not sent any new supplier message as part of this checkpoint.

Not yet certified:
- Phone notification acceptance: zero owner-device push subscriptions were present at the preceding read; must enable, send test, and observe a real Android notification.
- Live supplier phone OTP delivery: staff-assisted WhatsApp method is deployed, but no real supplier-phone acceptance proven.
- New Stage 5–7 patch CI, manual Netlify release and exact revision production check.
- Real WhatsApp recipient and owner-only group-delivery test, plus actual 6-hour/24-hour portal purchase cycle.
- Fresh production-scope backup, **separately verified restore** including necessary Auth/Storage dependencies, and recovery-plan drill. Historical pre-portal ZIP was partial (procurement-scoped) and does not certify a current comprehensive recovery point.
- Long-running operational stability, real-device UI, and unresolved live automation work (11 needs-action jobs).

## No-go gates / preservation rules

- Never enable `WAHA_SENDING_ENABLED`, `GH_PORTAL_DISPATCH_ENABLED`, `GH_PORTAL_DELIVERY_VERIFIED` or `GH_WA_AUDIT_ENABLED` merely because source tests pass.
- Do not equate WAHA HTTP success with WhatsApp delivery, and do not equate a message ID with physical receipt.
- Keep existing Netlify site, zero-cost hosting policy, supplier assignments, approvals, spending caps, unique dispatch claims, and audit history unchanged.
- Do not silently requeue unknown sends, create real purchase orders during validation, or use supplier phones for unsolicited test messages.
- Future deployment must pin **the exact quality-tested revision** via the existing manual-only Netlify workflow. No automatic production deployment or Git linking.

## Completion criteria

Stage 5 is **code hardening / QA pending** until new CI and a controlled live gateway+recipient+audit test pass. Stage 6 is **installed and scheduled, production end-to-end unverified** until a controlled full cycle passes. Stage 7 is **not complete** until backup/restore and the external acceptance steps above are evidenced. Recording this distinction prevents a simulated or historical acceptance record being mistaken for a successful current live send.
