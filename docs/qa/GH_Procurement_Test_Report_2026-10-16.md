# GH Procurement — full test report, 16 October 2026

Status: all automated CI checks passed. Tested fixes deployed; post-release production health and permission checks passed.

## Test method

Testing used a fresh in-memory PostgreSQL instance built from schema-only production definitions: 60 procurement tables, the shared user bridge, 192 functions, 13 views, real constraints, triggers, RLS policies and grants. Only synthetic users/items/suppliers and standard role configuration were seeded. Every database scenario verifies that its fixture table row counts return to the seeded state. New migrations are applied to the isolated baseline before testing.

Supabase request claims and the user directory have synthetic adapters. This exercises application authorization but does not replace a real Auth-provider sign-in test. A separate PostgreSQL 17 CI job exercises genuinely concurrent recounts. Browser tests use real rendering, interactions and document exports with intercepted test APIs. Production checks are read-only.

## Automated coverage

| Area | Result | Evidence |
|---|---|---|
| Code/contract checks | 236 passed locally and in CI | `npm test`; repeated in CI |
| Full-schema database suites | 15 passed locally and in clean CI | `npm run test:database` |
| General purchasing lifecycle | Passed | Stock → approval → RFQ → partial quotes → price comparison → supplier POs → approval/sending audit → receipt → invoice match |
| Company purchasing | Passed | Manual and configured automatic routing; one/multiple suppliers; inherited category settings; repeat approvals; attachment authorization; uncertain-send hold |
| Recounts and concurrent submissions | Passed | Identical/new-token recounts; increased/decreased need; pending orders; simultaneous counts; stale-count rejection |
| Quantities | Passed | Zero, blank, decimal, missing maximum, sufficient checks, invalid/non-finite input, 1,000-item batches and oversized rejection |
| Receiving and balances | Passed | Partial acceptance/rejection, reasons, replacement receipts, duplicate receipt prevention, cancellation and buy-elsewhere balances |
| RFQs/quotes/awards | Passed | Coverage overrides, adding suppliers, missing/expired quotes, partial supplier coverage, duplicate awards, additional sizes and atomic failure |
| Roles and data controls | Passed | Seven standard roles, inactive/disabled/missing profiles, custom-role cloning, unauthorized submit/approve/reset/delete, RLS and invoker views |
| Browser suites | All 16 passed in clean CI | 16 browser modes covering 320, 390, 768 and 1366 px; selected focused modes use fewer widths |
| TypeScript and production build | Passed locally | Clean build after recovering a corrupted local build cache |
| Dependency audit | Passed | Zero reported vulnerabilities |
| Live health/security smoke | Passed on deployed revision 67c3f22 | Database/schema readiness, login CSP/no-store, OCR asset and unauthenticated sending denial |

## Confirmed issues and corrections

1. **Legacy company submission permission failure.** The authenticated v2 entrypoint could not execute a private route lookup. It now remains an invoker wrapper around a private guarded implementation. The implementation validates the actual caller, stock and company-list permissions, input and company scope before accessing internal routing. Internal route lookups remain unavailable to clients.
2. **Unnecessary table-control grants.** The company-sections table had TRUNCATE, REFERENCES and TRIGGER privileges for anonymous/authenticated roles. The hardening migration removes these privileges from procurement tables. Regression checks cover RLS, exposed view invoker settings and expected dispatch/award privileges.
3. **Input boundaries hardened.** Null payloads, duplicate items and materially future-dated count start times are rejected before saving a count.
4. **Older tests corrected.** Several tests depended on existing suppliers/RFQs, compared outdated denial text, used a pre-trigger PO number or expected the old automatic top-up rule. They now create their own fixtures and assert current business behaviour.

The earlier recount fix remains covered: an increased requirement against an outstanding PO needs review rather than an automatic supplemental PO. Already-sent PO 001 and PO 002 are preserved as historical records.

## Live record-integrity audit

The read-only audit found zero ordered-quantity mismatches, zero received-quantity mismatches, zero duplicate active stock requirements, zero invalid PO-line balances, zero stale sending jobs and zero accepted queue records attached to an unsent PO. These checks describe the records present at audit time; they are not a forecast of future correctness.

## External and physical-device checks not certified

- Actual receipt of a new WhatsApp test image on a recipient's phone. Gateway acceptance is recorded separately from delivery. No real supplier was sent a test order.
- New invitation, password login and recovery against the real Auth provider using a disposable test account. Browser auth flows are fixture-tested; live login endpoints/security headers are read-only checked.
- Physical Android contact-picker and GPS permission behaviour. Browser permission/denial and access-control paths are automated, not exercised on the user's phone.
- Real Google Sheets authenticated write-back and live Storage upload/download. The inspected production variables did not include the service-account variable used by the Sheets write-back code; fixture/connection-error tests do not certify an external write.
- Supabase's advisor reports provider-level leaked-password checking disabled. This was not enabled or represented as passing. Existing authenticated privileged RPC warnings require reviewing their caller checks; the application's role-boundary suite passed. Unrelated shared-project application RPCs were not changed.

No claim is made that a finite suite covers every possible input or provider outage. These remaining checks need dedicated external test destinations/accounts and, for hardware behaviour, the actual device.

## Reproduction and evidence

- `npm run test:database` — the 15 full-schema suites and fixture rollback checks.
- `npm test`, `npm run lint`, `npm audit --audit-level=high`, `npm run build`.
- `.github/workflows/procurement-quality.yml` — full browser matrix, isolated SQL and PostgreSQL concurrency.
- Current clean CI: https://github.com/projectrippleconnect-tech/gh-procurement-public/actions/runs/38894380656
- Review: https://github.com/projectrippleconnect-tech/gh-procurement-public/pull/110
- Supabase advisor explanation: https://supabase.com/docs/guides/database/database-linter

Release: `67c3f22e88f17138cb25f32b6cd11ac219be64c6`, Railway deployment `a336fe83-1db3-4734-a188-8fed50dc6b17`, SUCCESS on 16 October 2026 at 11:46 UTC. Both clean CI #386 jobs succeeded. Migration `procurement_full_test_hardening` applied successfully; live read-only RLS/table privileges and RPC execution boundaries passed. `node scripts/check-production.mjs` passed against this exact live revision: health, database/schema, login nonce/no-store, OCR asset and denial of unauthenticated sending. Security advisor categories remain as disclosed above.
