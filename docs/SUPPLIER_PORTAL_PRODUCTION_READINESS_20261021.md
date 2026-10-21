# GH Procurement Supplier Quotation Portal — readiness report

Date: 21 October 2026 (Sri Lanka project date)
Repository: projectrippleconnect-tech/gh-procurement-public
Development branch: feature/supplier-quote-portal-20261021
Starting commit: 606c605bea63a12086fdeefd907286f7f80b8c80

**Release decision: HOLD for controlled staging verification.** Implementation and local
regression testing are complete for the scope below. This is not a certification of live
Supabase/PostgREST, cross-browser/device coverage, concurrent PostgreSQL sessions, or WhatsApp
delivery. Those checks remain release blockers; no production deployment, migration,
supplier message, or live purchasing activation was performed.

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
  PO totals, supplier minimum goods values, per-PO caps and a daily monetary cap are checked
  transactionally; unpriced existing company POs hold daily-limit verification for review. Manual or Direct PO allocations are deducted before ordering.
- Round locks, requirement locks, a global budget advisory lock, persistent round keys,
  per-PO dispatch uniqueness and the existing WhatsApp dispatch ledger prevent duplicate
  generation and sending. Failures roll back reservations and POs together; the worker
  records exceptions for staff review. Current permissions and active approvers are checked.
- Unallocated quantities reopen once for another 24 hours, sharing the original requirements.
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
records in an in-memory PostgreSQL engine seeded with repository schema definitions.
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
| Locked dependency install | Passed (`npm ci --offline --ignore-scripts`; build copies required workers) |
| Existing plus new unit/contract tests | 449 passed; no failures |
| Focused worker/portal tests | 18 passed; rendering, approval gates, failed/unknown sends, audit failures |
| Isolated database regression | 20 suites passed; original purchasing/roles/company/receiving plus portal suites |
| Portal SQL lifecycle | Passed with a service-role worker and no human JWT subject |
| Boundary SQL cases | Passed: Company PO identity/history, caps and rollback, empty scopes, expired/revoked offers, existing manual reservations, incomplete drafts |
| TypeScript and JSX checks | Passed |
| Production dependency audit | Passed; npm audit reported zero known vulnerabilities |
| Production build | Passed; repeated-build cache corruption was eliminated by disabling Turbopack build filesystem persistence |
| Production HTTP smoke | Passed: both portal pages, privacy headers, unauthorized worker rejection, automation disabled |
| Portal browser validation | Passed in Chromium at 320/360/390/768/1280px: incomplete drafts, prices, terms, compressed images, alternatives, confirmation, reload, conflicting windows and disabled worker authorization; API calls mocked |
| Mobile visual review | Passed individual-control bounds and full-page screenshot inspection; fixed nested variation/file-input overflow that page-width checks alone missed |
| Cross-session PostgreSQL concurrency | NOT VERIFIED; PGlite serializes sessions. Idempotency and rollback are tested, real overlapping-session stress remains required |
| Live Supabase/PostgREST and WhatsApp pilot | NOT RUN; requires an approved isolated environment and explicit release authorization |

The original lifecycle test initially failed because its expired-date fixture used the
host's date while award validation uses Sri Lanka's business date. The fixture now uses
Asia/Colombo explicitly, and the entire lifecycle passes. The test adapter also installs
pgcrypto into the production-compatible extensions schema.

The production Supabase connection was checked read-only: the existing procurement tables
are present and the supplier portal tables are absent. Migration history was read only.
Railway still points to release/uppercase-items-on-live-20261019 at d9fd03ef197ae7555e85abc240477931244cae26,
with the existing manual-trigger watch pattern. No Railway setting, service, variable,
subscription or deployment was changed. No GitHub Actions run or paid resource was requested.

## Deployment blockers and controlled release procedure

1. Chromium portal layout and interaction checks are complete at five widths, including two-window stale-save preservation. Physical iOS/Android and other browser engines remain recommended pilot checks. Both the original mobile suite (including alternative photos) and the expanded save/reload/conflict suite passed. The executable tests are `node tests/supplier-portal-mobile.mjs` (optional GH_UI_BROWSER_PATH) and `node tests/supplier-portal-ui.mjs` (optional GH_UI_BROWSER_EXECUTABLE). Both use synthetic intercepted RPC responses; they do not certify a live Supabase round trip.
2. On an explicitly approved, isolated Supabase/PostgreSQL test instance, apply only the
   reviewed portal migrations after checking that instance's actual history. Verify anonymous
   RPCs through PostgREST, RLS/ACL behavior, schema-cache refresh, image round trips, simultaneous
   submissions, deadline-versus-submit races, manual-versus-automatic ordering and two workers
   contending for a budget and dispatch. Local fixtures do not substitute for these checks.
3. Perform an explicitly approved test-supplier gateway pilot, including an interrupted send,
   duplicate attempt, recipient change and verified delivery reconciliation. No real supplier
   should receive an unsolicited development message.
4. Review existing resource quotas and cost controls. The implementation creates no new paid
   services and uses the existing Railway process for a once-per-minute timer after activation;
   normal existing Railway/Supabase usage still applies. Do not enable auto deployment.
5. Only after explicit approval: back up production, reconcile its migration history, apply
   20261021212000_supplier_quote_portal_intake.sql and 20261021213000_supplier_portal_rounds.sql,
   and perform a manual Railway deployment. Do not replay all fixture patches against production.
6. Deploy initially with both processing and dispatch disabled. Separately approve activation.
   Keep SUPABASE_SERVICE_ROLE_KEY and a random GH_PORTAL_WORKER_SECRET (at least 32 characters)
   server-only. Processing requires GH_PORTAL_PROCESSING_ENABLED=true. Dispatch also requires
   GH_PORTAL_DISPATCH_ENABLED=true, GH_PORTAL_DELIVERY_VERIFIED=true, WAHA_SENDING_ENABLED=true
   and the existing private WAHA configuration. The existing web process owns the timer; no
   additional cron service is needed. Disabled flags are the immediate stop switch.
7. Each real round still needs its bounded admin approval. Each generated PO still needs GH
   Orders approval and explicit recipient/document verification before automatic dispatch.
   Accepted or unknown sends must never be automatically retried or reset for a resend.

## Additional verification and reconciliation

A newer development commit (`8d12bd2`) arrived during this session. It was fast-forwarded and preserved before applying the final privacy, responsive layout, stale-edit and frozen-specification fixes. No competing automation schema or worker was layered over it. Machine-readable local results are in [verification/supplier-portal-validation-20261021.json](verification/supplier-portal-validation-20261021.json). Earlier scratch implementation checkpoints are not part of this release.

Supplier form improvements include server-clock-adjusted expiry, an explicit refresh for the residual round, save/confirmation status messages, unsaved-edit protection and preservation of a successful save when an additional refresh would fail. Busy controls stay disabled while saving. Nested file and variation controls now fit 320px screens; the tests check actual control bounds as well as document width.

Supabase schema/function compatibility and Railway configuration were inspected read-only using their existing connections. Railway's manual watch pattern and release branch remain unchanged; no staged changes or new worker variables were created. The existing Supabase security advisor also reported inherited privileged-function exposure notices and disabled leaked-password protection. Review those notices as part of release security review rather than treating local procurement tests as certification of the entire older project.

The test environment's default Playwright download failed; an isolated Chromium binary was obtained without adding an application dependency. No browser screenshot is included as a deliverable, and all test records are synthetic. No GitHub Actions workflow or paid cloud resource was requested.

## Reproduce local validation

```sh
npm run lint
npm test
npm run test:database
npm run build
node tests/supplier-portal-http.mjs
node tests/supplier-portal-mobile.mjs
node tests/supplier-portal-ui.mjs
```

Do not set live worker flags or use production credentials while running development tests.
