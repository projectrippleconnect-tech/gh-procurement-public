# App loading performance — 1 November 2026

## Changes

- Work uses its own small component instead of importing the Stock module. PDF rendering loads after an explicit print/export action in Stock, quotations, purchase orders and Reports.
- Normal Stock browsing requests only its current server page. Due/guided queues retain their bounded counting behavior. Entered quantities and item names survive page changes and draft restoration.
- The complete fuzzy-search catalogue loads when search is opened, with bounded pages and retry/cancellation behavior. It does not download when Stock first opens.
- Previous-submission markers cover visible rows and pending lot IDs. Catalogue batches do not restart them. Obsolete scopes are cancelled; history RPCs preserve the 300-item limit and bounded concurrency. Final confirmation rechecks the lot before existing submission/recount guards run. Failure leaves submission blocked and explains how to retry.
- A single authenticated invoker bootstrap RPC returns the current profile, permissions and configuration. Existing access restrictions and row policies apply; there is no persistent permission cache.
- Simultaneous identical read requests share a request only while it is in flight. Authorization and all headers are part of the key. Writes, non-allowlisted RPCs and requests with independent abort signals are not combined. Completed responses and failures are not cached.
- Reports request one display page, with exact counts. CSV/PDF exports explicitly load every filtered page and fail rather than export incomplete results. Stale page requests are cancelled.
- Requirements and supplier names can render before auxiliary counts/performance queries finish. Urgent work and automation jobs load in parallel. Company history-list downloads wait until History is opened; company marker requests remain company-scoped and bounded/cancellable.

## Verification

The isolated browser PERFORMANCE mode enforces request budgets on 1,001 stock items and 1,027 report rows. It checks draft preservation across server pages, scoped history failure/retry, absence of automatic full-catalogue downloads, and a complete CSV beyond 1,000 rows. Existing browser regression modes remain enabled at 320, 390, 768 and 1366 pixels.

Unit/integration coverage additionally checks authenticated bootstrap access, disabled/anonymous refusal, identical-read isolation, no write deduplication, cancellation, bounded history concurrency and complete/failing exports. Production business records and supplier messages are not used as test fixtures.

Functional request budgets are reproducible in isolated fixtures. They are not a claim about the exact latency of a particular phone or mobile network. Live rollout and verification results are recorded below.


## Production rollout completed

Released 1 November 2026 (Asia/Colombo) to [GH Procurement](https://gh-procurement.netlify.app/).

| Evidence | Result |
| --- | --- |
| Application revision | `cd08cb306863bb2d7d28e7d96a6b46a92c7a6761` |
| Quality gate | [Run 507](https://github.com/projectrippleconnect-tech/gh-procurement-public/actions/runs/41258936924): all nine jobs successful |
| Manual publication | [Run 9](https://github.com/projectrippleconnect-tech/gh-procurement-public/actions/runs/41259166483): successful; required the exact candidate quality run to be complete and successful before publication |
| Automated verification | 509 unit/integration tests, 23 full-schema database suites, native PostgreSQL guards, all 20 existing browser modes and Work/Receiving/PERFORMANCE checks at all four widths |
| Independent live response | `ok=true`, database connected, schema ready, exact expected application revision |

The PERFORMANCE checks also freeze the reviewed quantity during final verification, submit only that quantity to isolated fixtures, and verify that finishing a lot does not restart an obsolete history scope and block the next review. Phone and desktop review screenshots were inspected.

The additive source migration `20261101003325_workspace_loading_bootstrap.sql` is applied as production history version `20261101004806` (`workspace_loading_bootstrap`). Its body matches the verified source. Read-only checks under the authenticated application role confirm the correct profile and current permissions/configuration. The function is stable, invoker-based, has an empty search path, and denies anonymous execution. Existing advisory finding counts did not increase.

The manual release repeated build/database, stock, company recount, notifications, quotation/PO sharing, Work, Receiving and performance acceptance checks. Production health, login/CSP/no-store, OCR asset, quotation route, exact version and unauthenticated-send boundaries passed. No production business rows or supplier messages were created as tests; unattended sending flags remain disabled. No new hosting service, paid resource or card verification was introduced.

The default manual workflow is pinned to the deployed application revision and its successful quality run. The previous reviewed production revision `997dc54f5736e5e086a1e1f5ac4761fec7c08e6a` is the rollback reference; the additive bootstrap function remains compatible with that frontend. The code/report are retained in the release branch, and browser evidence is attached to the workflow runs with seven-day retention for acceptance artifacts.
