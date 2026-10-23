# GH Procurement live supplier portal continuation

Updated 22 October 2026, Sri Lanka time. This status supersedes earlier reports that the portal database functions were absent.

## Live state

Working application: https://gh-procurement.netlify.app/
Existing frontend release: b7acc93c9de682c27ca64c7d3f863647a98aebd3.
The supplier portal backend is installed in the existing GH NEXUS database. No frontend redeployment was required for the installed functions to become available to the existing supplier-link and quote screens.

Completed the previously missing public submit wrapper, delivery safeguards, database scheduler and inactive cron installation. Previously installed intake, round schema, synchronization, review/deadline, processor and business-conflict migrations were inspected and not replayed.

Hosted migration history added in this continuation: 20261022173150 supplier_portal_rounds_02b_submit_wrapper; 20261022173231 supplier_portal_rounds_04_delivery_guards; 20261022173239 supplier_portal_database_scheduler; 20261022173321 supplier_portal_inactive_cron.

The submit wrapper now invokes validated intake and synchronizes confirmed exact-item prices into Prices. Drafts withdraw superseded unallocated lines. The round processor supports bounded six-hour selection by eligible landed cost, supplier POs pending approval, duplicate prevention and one 24-hour residual round.

Database purchasing scheduling is ENABLED. Job gh-procurement-portal-rounds-v1 runs every minute as postgres, bounded to five due rounds per tick. Activation verified there were no existing open rounds. Each future round still requires staff approval of frozen scope and finite purchasing limits. Generated POs require existing GH Orders approval. No portal links, rounds or PO jobs existed at release verification; no purchasing transaction or supplier message was created by this continuation.

Cron job_run_details shows actual scheduled executions succeeded at 17:48 and 17:49 UTC, with completed empty batches. This is actual hosted pg_cron evidence, separate from the manually invoked first tick.

Automatic WhatsApp dispatch remains DISABLED and unverified. Manual PNG/caption sharing remains available in the deployed frontend. A private reachable gateway, protected server credentials, verified test recipient and real delivered-message evidence remain required. Do not equate share-sheet invocation or gateway acceptance with delivery.

## Verification

- 454 unit/contract tests passed, including the final rerun after the wording correction. TypeScript and the final production build passed.
- All 23 isolated database suites passed.
- All 27 live portal functions match tested function bodies, signatures, security mode, function settings and anon/authenticated execution rights exactly.
- Hosted Supabase default privileges add service_role execution on 14 functions beyond the isolated fixture. These are privileged-worker grants, not anonymous or staff expansion. Internal function guards remain unchanged; scheduler core/control are not worker-accessible. This difference is recorded rather than described as complete ACL equality.
- All four exposed portal tables have RLS enabled; anonymous SELECT/INSERT grants are absent.
- Actual anonymous Data API calls to read/submit with an invalid token and to staff responses/due rounds reject with authorization code 42501. None returned missing-function PGRST202.
- Hosted /supplier/quote and /supplier-links return HTTP 200 and no-store.
- Production smoke passed: healthy database/schema, login CSP nonce/no-store, OCR asset and unauthenticated sending rejection.
- Live browser shows the approved-staff login screen with public registration disabled.
- No real supplier confirmation, live staff workflow or WhatsApp delivery pilot was performed; isolated tests and deployed definition matching do not substitute for those checks.

## Backup

Existing saved archive GH_Procurement_PrePortal_Backup_20261022.zip passes ZIP CRC. Its verification records a restored procurement-scoped export of 63 tables and 9,941 records, all four planned migrations applied to the isolated copy, and original records unchanged in that restore test. This is not a full Supabase project backup; Auth credentials, sessions, unrelated tables and Storage bytes are excluded. Existing Auth/Storage must be retained during recovery.

## Remaining work and concrete blocker

Netlify browser sign-in failed with Authentication Error: Invalid state key after the selected Google login. No signed-in Netlify dashboard was reached and no new frontend build was uploaded in this continuation. Do not repeat the failed authorization callback or use its transient URL.

Two small frontend wording corrections are prepared to replace the obsolete claim that automatic PO generation is always OFF. They describe the independent database timer and dispatch gates without hard-coding deployment state. Their contract assertion is updated. These wording corrections are NOT LIVE until the next manual Netlify release. The current live OFF wording is stale for database scheduling; this report states the actual verified status.

After Netlify access is restored, manually build/deploy the prepared source to the existing free site, keeping Git-based auto-deploy disabled. Recheck hosted revision/assets. Restore Google Sheets server integration and the WhatsApp gateway without exposing private gateway endpoints or incurring charges. Complete the real staff/supplier and authorized delivery pilot before enabling dispatch. Full end-to-end completion is not certified.

## Stop switch

Disable both switches together if database purchasing must stop:

```sql
begin;
update private.proc_portal_scheduler_control set enabled=false where singleton;
select cron.alter_job((select jobid from cron.job where jobname='gh-procurement-portal-rounds-v1'),active:=false);
commit;
```

Web environment flags alone do not stop the database-owned timer. Dispatch remains independently disabled.

## Subsequent access recovery attempt

A fresh Google login resolved the expired-state failure but Netlify returned email_collision: the existing account uses email/password and Google is not linked. The normal secure email/password prompt was opened; the request was aborted by the user. After browser-session cleanup no authenticated Netlify tab remains. Do not retry credential collection without a renewed user request. No new frontend deployment occurred.

Railway discovery still returns UNAUTHORIZED with reauthentication required. No direct Netlify plugin was found. Restoring the existing Netlify email/password session and Railway connection remains necessary to complete the hosting/integration work. Do not create paid resources, link automatic deploys or enable WhatsApp dispatch as a workaround.
