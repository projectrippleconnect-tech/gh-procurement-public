# GH Procurement hardening follow-up — 11 October 2026

This continues the released PR #37 validation. It records evidence rather than claiming zero defects.

## Changes

- Urgent actions, automation exceptions and unresolved rejected-goods cases now traverse the database API cap instead of stopping at 1,000, 200 and 500 records. Stable ordering and 50-row display pages retain access to older records without rendering the full dataset at once.
- Urgent queue refreshes ignore obsolete responses. Item searches ignore responses from a superseded search.
- Count badges render normal React children: no comma between the quantity and label, and zero is preserved instead of displayed as a dash.
- Workspace startup requests existing profiles, permissions and configuration concurrently. Only a newly provisioned legacy profile needs a subsequent permissions read. This removes a serial network round trip for invited staff without skipping access validation.
- The legacy private.proc_is_role helper requires an active, non-deleted profile, an enabled role and matching base role. Existing table-level permission triggers remain in place. Before the correction the helper accepted a disabled custom role, while the table trigger correctly rejected the tested write; no successful unauthorized write was demonstrated.
- A route error boundary provides Try again and Reload app after unexpected rendering errors without clearing browser drafts.
- An hourly GitHub workflow and manual production-check script check health, database schema readiness, login CSP/no-store, the OCR asset and unauthenticated sending rejection. The checker does not sign in or send messages. Scheduled execution depends on GitHub Actions availability.

## Actual authentication evidence

Disposable example.invalid accounts were used; no existing staff password was read or changed. A temporary seeded administrator authenticated through the real Auth password endpoint, then called the deployed invitation Edge Function in link mode. The invited stock-handler accepted the actual one-time link and successfully set a password in the production app. A fresh browser password login displayed the assigned, populated stock workspace.

A subsequent session-restore check reached the 15-second startup timeout on this runtime's slow network path. The parallel-startup correction passed real password login and reload/session restoration against the production Supabase backend using the prepared local release. Browser requests were transported through the runtime's proxy; real Auth and database responses were used rather than fixtures. A consumed invitation token was rejected and could not expose the password-update button. tests/live-auth.mjs makes this disposable-account integration check repeatable with an explicitly supplied private fixture file; it rejects normal email domains and does not log passwords or one-time URLs.

## Database and concurrency evidence

After the role-helper migration, transactional tests passed for configured roles/inactive administration, API privileges/RLS, custom-role cloning, the new disabled/inactive/mismatched-role helper cases, the complete procurement workflow, and a 1,000-item stock submission. Fixtures in these SQL suites rolled back.

Two simultaneous real HTTP receiving requests with the same receipt key both succeeded and returned the same goods-receipt ID: one new receipt and one replay. Database read-back showed one receipt, stock 10 and received quantity 10, confirming the stock was not posted twice. The temporary item and supplier were inactive and explicitly labelled QA. Their receipt, stock, order and related fixture records were removed afterward. Audit history is retained.

A separate competing-different-key over-receiving scenario was not completed: fixture reset failed through the connector, so both requests correctly encountered the already-received order. This is a harness limitation, not evidence of a concurrent over-receiving defect. Existing sequential excess-receiving and retry tests passed.

## Performance and browser evidence

- 87 automated tests, TypeScript validation and production compilation passed.
- Expanded isolated browser checks cover all configured staff roles at 320, 390, 768 and 1366 pixels, including full-dataset exception filters and records past the previous caps.
- A bounded real read test made 40 requests at concurrency 4 against production health and authenticated permissions, with zero failed responses. On this runtime's proxy path, median latency was 7,834 ms, p95 8,783 ms and maximum 8,988 ms. These figures do not establish normal Sri Lankan device latency or high-volume transaction capacity.
- Railway resource samples preceding the bounded check showed about 0.108 GB current memory and low CPU use. This is not a sustained memory-leak or capacity test.
- The production-check script passed against the previously released live app before publication of this follow-up.

## Remaining certification limits

Real email delivery and actual supplier WhatsApp receipt were not exercised; no external supplier messages were sent. Breached-password protection remains reported disabled; the connected tools do not expose an Auth-configuration update operation. Backup restoration and a complete reset in an isolated database were not demonstrated. No separate Supabase branch exists; creating one requires an explicit cost-confirmation workflow. Multi-hour load, competing distinct receipt keys and real-device keyboard/accessibility checks remain separate verification work.

Project-wide security-definer warnings are not all vulnerabilities: callable functions need authorization analysis, and legacy procurement writes also have table-trigger checks. Other applications share this database. Their functions and indexes were not indiscriminately changed. Procurement workflow and role-boundary suites passed after the helper correction.

## Release state

PR #38 was merged as `ccc2c26cefb6c6f318a93b45b509febfe49f3bdd` after both GitHub release gates passed: GH Procurement Web Validation run 38150378600 and Procurement Quality Gate run 38150378639, including the expanded four-width browser suite.

Railway production has a reviewed, non-destructive staged source change to that exact commit (patch `2430a07a-25b4-4229-907a-37e1a5cfb5ba`). The deployment acceptance call returned “Cancelled — the user did not approve this action. No changes were made.” The user had explicitly authorized deployment in the conversation, but the connector did not execute it. The source change remains pending; the follow-up frontend is not live and no post-deployment test of that frontend is claimed.

At 15:19 UTC, the current live release remained healthy at version `f570d912002abfc98846f1d15a7c58d72e531f3b`, deployment `0b9bfe66-6142-4656-84f1-56dde7899ab8`. The production checker passed health, database/schema readiness, login nonce/CSP and no-store, the OCR asset, and rejection of unauthenticated sending.

All temporary QA accounts and business fixture records were removed. Final counts returned to the baseline: 1,192 items, two profiles and Auth users, three purchase orders and eight RFQs; zero temporary concurrency items/suppliers or temporary QA profiles remained. The deleted disposable user's previously issued token returned an empty permission list from the actual `proc_my_permissions_v1` endpoint. Private password/session/invitation fixture files were removed. Audit history remains.

The hourly health workflow is merged but its first scheduled execution has not been observed. After deployment acceptance, verify the new live health version, rerun the production checker and repeat disposable-account login/session restoration before closing the release.
