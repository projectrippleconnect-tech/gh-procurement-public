# Purchasing simplification — Stage 2 acceptance record

Verification scope: the prepared Work / Stock / Receive / More update. This is not a production deployment record. No production migration, message dispatch, hosting purchase or account-setting change is included.

The [PR checks](https://github.com/projectrippleconnect-tech/gh-procurement-public/pull/147/checks) identify the exact source revision for every run. Acceptance requires success in all eight jobs: the build/contracts/database job, native concurrency job, Work and receiving browser jobs, and all four browser regression groups. Each browser job checks its explicit PR head.

## Coverage

| Area | Acceptance checks |
|---|---|
| Work | One scope filter; independent Stock selection; 25-record server pages; correct counts; lazy details; every valid RFQ retained; failure/retry behavior |
| Next actions | Supplier assignment opens the supplier builder; comparison opens comparison; pending direct reviews allow approval; completed requirements open without active-only filters and remain read-only |
| Queue meaning | Routine supplier/delivery waits stay in In progress; actionable decisions and overdue follow-ups appear in Needs me; concurrent buying/receiving actions remain available |
| Stock | Saved drafts, one reviewed submission, item/submission history, explicit recounts, separate General/Company records, changed-shortage warnings and duplicate protections |
| Quotation to order | Supplier requests, saved quotation drafts, conflicting updates, price comparison, final award review, order approval, manual PNG plus caption sharing and duplicate-send protection |
| Receive | Explicit acceptance, rejection reasons, partial deliveries, follow-up, review cancellation, receipt replay/recovery, final closure and read-only restrictions |
| Permissions | Stock handler and viewer browser checks; custom-role RLS; forbidden receiving calls rejected; disabled roles denied; new helper functions use invoker access and deny anonymous execution |
| Scale | Exact counts and a later page beyond 1,000 requirements; accepted receipt quantities remain correct without fetching receipt history |
| Layout | 320, 390, 768 and 1366 pixels; keyboard/Submit reachability; stable main tabs; scrolling panels, picker/menu focus, long descriptions and expanded details |
| Existing features | Supplier directories, company routing, contact entry, printing, reviewed document import, deletion confirmations, working-hours/location locks, additional quotation sizes and supplier quotation portal |

The automated unit/integration suite contains 497 checks. The full isolated production-schema regression runs 23 database suites. Native PostgreSQL separately exercises quotation concurrency, company routes, recounts, access boundaries and other existing guards. The browser regression retains all 20 existing modes and runs independent groups in parallel; a failure does not suppress the remaining modes in that group.

Browser tests intercept Supabase, WhatsApp and other external write requests against synthetic fixtures. Database behavior is tested independently against disposable databases with actual SQL functions and policies. These checks do not claim that production migrations are already applied or that live supplier messages were sent.

## Corrections found during verification

- Restored the mobile main tabs that an old workflow CSS rule still hid on Stock and Receive. Purchasing sections scroll with their content and use three columns.
- Fixed completed-requirement deep links and excluded completed rows from editing/selection.
- Made approval available for eligible pending/held records opened directly from Work.
- Preserved each Work action's actual task step, including supplier assignment and price comparison.
- Kept routine waits out of Needs me while preserving optional receiving/follow-up actions in In progress.
- Removed the duplicate delivery-note disclosure wrapper, retained specific saved-work resume labels, and updated browser fixtures for the current controls and outcome wording.

## Security advisory review

Read-only project security and performance advisors were reviewed. They still flag existing project-wide items; this task does not claim to clear them or alter unrelated applications sharing the project:

- [Leaked-password protection setting](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- [Anonymous definer endpoints](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), including token-based supplier portal and legacy bootstrap/invitation entry points.
- [Authenticated definer entry points](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), whose existing business permission guards are covered separately by database regressions.
- Existing [backend tables with RLS and no client policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and [RLS/index performance notices](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan).

The two prepared Work migrations add read-only invoker helpers; they do not grant anonymous execution, bypass table policies or introduce a new definer endpoint. Their access behavior is checked in the isolated database tests. The migrations remain unapplied to production.

## Stage 3 boundary

Prepare the release against then-current production source, apply the verified Work migrations, publish through the existing manual Netlify release, and verify the live revision and production health. Stage 2 does not perform those actions.
