# GH Procurement Supplier Quotation Portal — production-readiness report

Updated: 22 October 2026 (Sri Lanka)
Repository: projectrippleconnect-tech/gh-procurement-public
Branch: feature/supplier-quote-portal-20261021
Continuation base: 4ec146f2f764b2b710986a508f3cc0dfc5ecd7ed

**Current continuation status — database scheduler implemented, production HOLD.**
The scheduler extension passes 452 unit tests, 23 isolated SQL suites, TypeScript
checks and the production build. Earlier native PostgreSQL/API/concurrency evidence
below predates this extension; native scheduler and real pg_cron replay are still
required before releasing the new code. No production migration or activation occurred.

**Earlier release decision: release candidate for a controlled manual rollout. Live purchasing and dispatch
remain on HOLD until the production release and real-delivery checks below are approved.**
The development implementation has passed isolated native PostgreSQL, real PostgREST/SDK,
mobile browser and simulated gateway tests. The production portal migrations remain
unapplied. No production deployment, live supplier message or purchasing activation occurred.
This report distinguishes verified implementation behavior from the remaining production
operator checks; it does not certify an unperformed live deployment or WhatsApp delivery.

## Implemented behavior

- Supplier-specific, revocable 256-bit links; only SHA-256 token hashes are stored.
  New links use URL fragments so the token is not sent in page requests. Both fragment and legacy query links are accepted and removed from browser history after capture; tab-scoped session storage supports
  reload. A separate anonymous Supabase client never reuses staff authentication. Portal pages use no-referrer and no-store headers. Supplier entry has noindex tags.
- Prices, availability, optional compressed product photos, up to four priced variations,
  incomplete drafts, optimistic revisions, and final confirmation. Database validation
  enforces item scope, deadlines, finite amounts, two-decimal currency, three-decimal
  quantities, and attachment limits. Variations remain separate from exact-stock purchasing.
- Confirmed exact-item rates synchronize into existing Prices. A subsequent draft or
  no-stock confirmation withdraws superseded price lines. Already allocated lines cannot
  be replaced. Optional per-line freight and validity fields make existing landed-cost
  comparisons accurate for portal offers while retaining legacy calculation behavior for
  ordinary manual quotes.
- An admin explicitly approves an RFQ's frozen supplier, requirement, category and location
  scope and finite purchasing limits. Approved item identity, specification, UOM and requested quantity are also frozen; changing them blocks ordering. That starts one shared six-hour deadline. General
  Items and individual Company Items rounds cannot be mixed. Later-issued links use the
  same round deadline.
- The due-round processor ranks eligible confirmed exact items by landed unit cost:
  price × (1 − discount/100) × (1 + tax/100) + confirmed freight per unit.
  It filters expiry, delivery time, UOM, active suppliers, supplier coverage, allowed scope,
  quantity, MOQ and order multiples; zero base prices and unconfirmed terms are not bought
  automatically. Selected quantities can split across suppliers. Freight is explicitly
  confirmed per unit; fixed delivery-charge negotiations require manual review.
- One pending-approval PO per selected supplier; existing sequential document numbering,
  requirement balances, Company identity, Prices, Orders and receiving remain in use.
  Automatic allocations also write the existing award history with approver, effective
  and landed costs, and mark allocated quotes selected. Cancelled, closed or received
  requirements cannot be purchased by a previously approved round.
  PO totals, supplier minimum goods values, per-PO caps and a daily monetary cap are checked
  transactionally; unpriced existing company POs hold daily-limit verification for review. Manual or Direct PO allocations are deducted before ordering.
- Round locks, requirement locks, a global budget advisory lock, persistent round keys,
  per-PO dispatch uniqueness and the existing WhatsApp dispatch ledger prevent duplicate
  generation and sending. Failures roll back reservations and POs together; the worker
  records exceptions for staff review. Current permissions and active approvers are checked.
- Unallocated quantities reopen once for another 24 hours, sharing the original requirements.
  Reopening deducts allocations from the approved RFQ quantity, even when the underlying
  requirement has a larger shortage. Fully allocated subsets do not reopen unrelated demand.
  Approved supplier-coverage exception reasons follow their invitations into round two.
  The first RFQ is finalized before the residual RFQ is created. Existing supplier links
  follow their scoped next round; prior responses are preserved in the round audit.
  Remaining balances after round two require manual follow-up. Short deliveries and returns
  continue through the existing receiving/rebuy workflow; they are not blindly reordered.
- Dispatch requires an actually approved PO, separate staff verification of the recipient
  and document, a matching immutable snapshot hash, current approval permissions, an active
  supplier, a private working gateway and independent server activation flags. The worker
  generates the PNG from database contents, with no Direct PO label on quoted orders.
  Orders over the single-image limit go to manual dispatch review.
- Timeout, missing message IDs and uncertain gateway outcomes become unknown, never an
  automatic resend. Gateway acceptance leaves the PO approved. Staff must verify the exact
  delivered WhatsApp message and record evidence before the existing PO workflow marks it
  sent. Unknown message IDs have an explicit, audited reconciliation action.

## Security and preservation

No production business records were read for fixtures or changed. Tests use synthetic
records in isolated PostgreSQL engines seeded with repository schema definitions.
Existing schema/migration checksums remain enforced by the test harness. The new optional
quote columns do not rewrite existing business rows. No existing feature was removed.

Anonymous callers receive no direct portal-table, official-quote or PO grants. Private
helpers, signing keys, staff review and worker functions have restricted execution rights.
The narrowly scoped portal write functions use transaction-bound HMAC delegation to honor
existing permission triggers without forging a user's JWT. Its secret stays in an
unexposed private table; caller-supplied context strings cannot authorize writes. Delegation
is cleared before return. A dedicated anonymous test covers forged-context rejection.
Server credentials never enter browser code. Background processing defaults to disabled.

Image limits: 8 MB input before client compression; approximately 150 KB per encoded photo;
1.5 MB total JSON submission; maximum 100 requested rows and four variations per row.
Large images/object-storage expansion and unlimited quotation rounds are outside this release.

## Verification evidence

| Check | Result |
|---|---|
| Locked dependency installation | Passed; Node 24, npm ci with install scripts disabled |
| Existing and new unit/contract tests | 451 passed; zero failures |
| In-memory SQL regression | 22 suites passed; all fixture business rows rolled back |
| Native PostgreSQL SQL regression | 22 suites passed; existing purchasing, roles, Company Items, receiving and portal behavior |
| Native concurrency | 8 scenarios passed; real separate sessions and observed lock waits |
| Real API and browser integration | 8 scenarios passed with PostgreSQL 17.11, PostgREST 14.18 and @supabase/supabase-js 2.117.2 |
| Gateway integration | Local simulator passed real PNG generation, approval gating, single dispatch, acceptance/delivery separation and uncertain-outcome no-resend |
| Portal mobile browser regression | Passed at 320, 360, 390, 768 and 1280 px; drafts, price/image/variation entry, final confirmation, reload and stale edits |
| Browser with actual database responses | Passed at 320/390 px, including two windows and persisted price changes; only local API origin and test credential substituted |
| Existing app browser regression | Final full run passed at 320/390/768/1366 px, including staff stale-quote draft recovery and existing workflow guards |
| TypeScript/JSX checks | Passed |
| Production build and HTTP smoke | Passed; privacy headers and unauthorized worker rejection checked; automation disabled |
| Dependency audit | Zero known vulnerabilities |
| Hosted Supabase compatibility | Read-only check: PostgreSQL 17.11, pgcrypto in extensions, portal migrations absent |
| Real WhatsApp delivery | NOT RUN; no recipient has been authorized for a live pilot |

The eight native concurrency scenarios verify one winner for stale saves, rechecking an
elapsed deadline after a lock wait, duplicate worker idempotency, shared requirement balances,
manual versus automatic award finalization in both winning orders, a shared daily budget,
exclusive dispatch claims and blocking after recipient changes.

The eight API scenarios cover actual anonymous grants and invalid JWT/token rejection,
existing Prices and Company directory conflicts without mutation, draft withdrawal and
photo/variation round trips, overlapping confirmations returning HTTP
409, the mobile browser against actual database responses, worker-created awards/POs and
24-hour residuals, approved PNG dispatch and verified receipt state, and unknown outcomes
that cannot trigger a second send. The gateway is a loopback simulator; acceptance and
receipt evidence in these tests are synthetic.

A software-emulated, offline Alpine VM ran native PostgreSQL without Docker or a paid cloud
resource. PostgreSQL ran as its normal non-root guest user. Signed Alpine packages and a
checksum-verified official OS image were used; no production credentials entered the VM.
The same schema bootstrap and SQL regression module serve both database engines. The native
fixture and historical migration hashes are checked, and test records use synthetic IDs.

Machine-readable results are in
[verification/supplier-portal-validation-20261022.json](verification/supplier-portal-validation-20261022.json).
See [SUPPLIER_PORTAL_NATIVE_QA.md](SUPPLIER_PORTAL_NATIVE_QA.md) to reproduce the native/API tests.

## Release-blocking defect found and fixed

Actual HTTP testing reproduced an infinite retry loop that database-only and mocked-browser
tests could not reveal. A stale quotation revision used custom SQLSTATE 40001; PostgREST 14
treats that as a transient transaction failure and repeatedly retries it. Native SQL calls
returned an error normally, while the HTTP request stalled and consumed database CPU.

The pending intake migration now raises PT409 for a business revision conflict. Actual HTTP
and browser tests verify a prompt HTTP 409, one successful writer, preserved unsaved browser
edits and unchanged database quantities after the rejected save. Dedicated supplier and worker
clients now have 20-second database-request timeouts and disable automatic request retries.
Existing staff clients retain their connection configuration. Staff Prices recognizes PT409
and retains compatibility with older 40001 responses, preserving draft recovery and refresh. A separate narrow migration also fixes
three legacy Prices/Company-contact conflict entry points using PT409 while retaining their
bodies, owners, signatures, settings and ACLs. SQL and actual HTTP tests verify that stale
edits return 409 and leave the stored quotation/contact unchanged. Historic migration
files are preserved.

Supabase documents the behavior and the PT409 resolution here:
[SQLSTATE 40001 in an RPC function causes infinite retries](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions).
No looping production session was created; the defect was reproduced only in the isolated VM.

Other continuation fixes remain verified: partial RFQ subsets reopen only their unallocated
requested quantities; fully allocated subsets do not reopen unrelated shortages; supplier
scope exceptions survive round two; automatic POs populate existing award history and selected
quote statuses; cancelled, closed or received requirements cannot be automatically ordered.

## Remaining release gates

1. **Explicit production migration and manual Railway deployment approval.** Back up the
   database, reconcile actual migration history and review prerequisites. Apply only the
   approved intake, round and business-conflict migrations in order; do not replay the QA bootstrap or
   all repository migration files. The pending files are
   20261021212000_supplier_quote_portal_intake.sql and
   20261021213000_supplier_portal_rounds.sql, followed by
   20261022020929_procurement_rpc_revision_http_conflicts.sql. Each file is transactional; no business-row migration is performed. Never install tests/fixtures or QA principals on production.
2. **Hosted post-migration smoke test while automation stays disabled.** Check the actual
   Supabase API key/JWT mapping, PostgREST schema-cache visibility, revocation, staff roles,
   image payloads, quotation-to-Prices synchronization and existing General/Company screens.
   Local native/API tests cover the implementation; they do not substitute for verifying
   the deployed project's configuration. Review inherited Supabase advisor findings, including
   privileged-function notices and leaked-password protection, as a separate existing-project
   security gate. Do not silently rewrite unrelated production authorization.
3. **Explicitly authorized test recipient and real gateway pilot.** Verify exact recipient,
   generated document, gateway health, one accepted message, actual delivered-message evidence,
   interrupted/unknown outcomes and duplicate blocking. The simulator proves code behavior,
   not WhatsApp delivery. Never send development messages to an arbitrary supplier.
4. **Separate live purchasing/dispatch activation approval.** Deploy initially with processing
   and dispatch disabled. Processing requires GH_PORTAL_PROCESSING_ENABLED=true. Dispatch also
   requires GH_PORTAL_DISPATCH_ENABLED=true, GH_PORTAL_DELIVERY_VERIFIED=true and
   WAHA_SENDING_ENABLED=true, plus verified private WAHA configuration. Keep
   SUPABASE_SERVICE_ROLE_KEY and GH_PORTAL_WORKER_SECRET (at least 32 random characters)
   server-only. The existing web process owns the timer; no paid cron service is required.
   Disabling the flags is the immediate stop switch.
5. Every real round still requires bounded admin approval. Every generated PO requires GH
   Orders approval and independent recipient/document verification. Accepted or unknown sends
   must never be reset for an automatic resend. Physical iOS/Android pilot checks remain
   recommended; Chromium layouts and interactions have been tested at the widths above.

Optional Supabase CLI telemetry was blocked by automatic approval review after the local
migration file was generated. It was not retried; local editing and verification continued.
No cloud resource, paid subscription, GitHub Actions run or automatic deployment was requested.
Production Railway configuration was not modified. Its previously observed manual-trigger
watch pattern remains the required release method. No live procurement business row was
created, updated or deleted by this work.


## Release continuation — 22 October 2026

The user authorized continuation of the remaining release steps after reviewing the
previous status. Routine migration/deployment approval does not need to be requested
again within that scope. Runtime purchasing and dispatch gates remain closed until
the actual release, bounded approvals and delivery safeguards are verified.

### Fresh checks on the development release candidate

- Checked out branch head `4a7fcc7523fa6053983f6faaf0b4361c0ee6be30`.
- Reinstalled the locked dependencies with lifecycle scripts disabled.
- Re-ran 451 unit/contract tests: all passed, none skipped.
- Re-ran all 22 isolated PGlite database regression suites: all passed.
- Re-ran TypeScript checks and production build: passed.
- Verified all six recorded source hashes against the previous native/API validation
  evidence. Native concurrency, actual local PostgREST/browser and simulated gateway
  tests were not re-run in this continuation; their earlier evidence remains identified
  above rather than being presented as a new run.
- Ran the read-only production smoke script successfully. It checked health,
  database/schema connection, login CSP/no-store, OCR asset availability and rejection
  of unauthenticated RFQ sending. The running app reported version
  `35e0a2443bc7eac6b5cc69fbb7e86328b627456f`, not the portal release candidate.
- Rechecked the existing GH NEXUS Supabase project's catalog and migration history:
  PostgreSQL 17.11, pgcrypto in extensions, existing purchasing/RFQ tables with RLS,
  no supplier-portal tables and no portal migration entries.
- The three existing Prices/directory conflict functions still contain the old
  retryable conflict code. The pending narrow conflict migration is still required.
- Reviewed hosted security advisors. Existing privileged-function notices and
  disabled leaked-password protection remain inherited findings; no unrelated
  authorization settings were changed.

### Current blockers and safe resume order

1. Railway's existing OAuth connection returned `UNAUTHORIZED`, specifically
   reauthentication required. Project configuration, variables, billing/quota state,
   deployment and gateway status cannot currently be verified through that connection.
   Reconnect the existing Railway app; do not create another service or enable paid
   resources as a workaround.
2. A current, restorable pre-migration backup has not been verified or created in this
   continuation. The available SQL connection is not a full backup/export connection;
   no direct database credentials are available locally. After access is restored,
   verify or create a backup using the existing approved backup path. Do not claim that
   catalog inspection or regression fixtures constitute a production backup.
3. After backup and configuration checks, apply only the three reviewed migrations in
   their documented order, manually deploy the tested candidate to the existing
   service, observe a successful deployment, and repeat hosted checks with automation
   disabled. Preserve the manual deployment configuration.
4. A test WhatsApp recipient has not yet been specified and verified for the real
   gateway pilot. Obtain the intended test number, verify its identity and consent,
   then perform the bounded pilot. Do not use an arbitrary supplier's number.
5. Verify actual delivered-message evidence and every independent activation safeguard
   before enabling live purchasing or dispatch. Missing backup/access/delivery evidence
   is a release blocker, not a reason to bypass these checks.

No production migration, deployment, business-record change, supplier message, live
purchasing activation, paid resource creation or GitHub Actions run was performed in
this continuation. Production remains on its existing version.


## Database scheduling implementation — 22 October 2026

The purchasing timer no longer has to run in the web process. The new pending
migration `20261022073557_supplier_portal_database_scheduler.sql` extracts the
previous purchasing implementation into a private, database-owner-only core.
The existing public RPC retains staff/service-role authorization and locks the
approved round before calling that core. The core retains scope/approver checks,
transactional budget/quantity locks, PO approval requirements, audit history and
24-hour residual-round behavior.

The new private scheduler calls that core directly as its database owner. It
never fabricates a staff JWT or stores an HTTP worker secret. Its private activation
row defaults to disabled, its bounded batch defaults to five due rounds, and one
advisory lock prevents overlapping ticks. Future rounds are untouched. Each failed
round rolls back its allocations/POs and becomes an audited exception instead of
being retried indefinitely. A completed round is not purchased again.

`scripts/portal-database-schedule.sql` It creates one INACTIVE cron job after the
migrations; it refuses to overwrite an existing job. No job was installed by this
work. Once explicitly activated after release checks, the job checks once per
minute; normal deadline resolution is approximately one minute, with additional
delay possible under backlog or database contention. This is not a hard real-time
guarantee. The Supabase project must remain active and cron health must be monitored.

Set `GH_PORTAL_SCHEDULER_MODE=database` on web deployments to suppress the old web
purchasing timer. Dispatch is independent: the database scheduler neither sends
messages nor authorizes PO dispatch. Stop database purchasing by disabling both
`private.proc_portal_scheduler_control.enabled` and the cron job. Web environment
flags alone do not stop an activated database-owned schedule.

### Fresh verification

- 452 unit/contract tests passed, zero failures.
- All 23 isolated PGlite SQL regression suites passed, including scheduler-disabled
  defaults, bounded batches, future deadlines, monetary-limit rollback, 24-hour
  residuals, duplicate prevention, empty JWT context, no dispatch activation and
  owner-only execution/control access.
- TypeScript, JavaScript syntax, production build and diff checks passed.
- Native PostgreSQL and actual pg_cron execution were not rerun for the extension.
  This environment cannot start the required native database toolchain. Do not
  reuse the earlier native results as certification of the changed authorization
  wrapper or scheduler.
- Existing production was not used for fixtures or scheduling experiments.

Apply this fourth migration only after the original three pending portal/conflict
migrations and after backup/prerequisite checks. Install the inactive cron job as a
separate operator step. Native concurrency, hosted permission tests and cron owner,
job state, timing, exception visibility and stop-switch checks remain release gates.

### Alternative-host checks

Render Free was rejected because the user requires an available supplier-facing
app without its idle sleep. No Render resource was created. Cloudflare access was
searched through the connected-plugin catalog; no Cloudflare integration was found.

An isolated worktree tested OpenNext 1.20.13 and Wrangler 4.151.3. Their dependency
requirements required Next 16.4.1 in that worktree only. OpenNext generated an
intermediate bundle, but the Wrangler deployment dry run failed with nine unresolved
Sharp image-module imports. Local Worker preview also failed on the environment's
network-interface enumeration. No Cloudflare deployment is certified or was attempted,
no account was created, and none of those experimental dependency changes was applied
to the GH Procurement development branch. The main app remains on its existing
locked dependencies.

Direct Railway CLI installation was also attempted through the official npm
package. Its official GitHub release binary download failed with a proxy tunnel
timeout. This is a separate access failure from the expired Railway OAuth connection.
No paid upgrade, new service, purchasing activation or supplier message was used as
a workaround. The production backup, release access and verified delivery pilot
remain unresolved.
