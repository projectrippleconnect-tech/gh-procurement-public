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

Functional request budgets are reproducible in isolated fixtures. They are not a claim about the exact latency of a particular phone or mobile network. Live rollout and verification results will be recorded after the release.
