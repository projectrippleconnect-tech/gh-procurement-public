# GH Procurement validation — 11 October 2026

## Scope and release baseline

The baseline repository commit is e344e7007e6d3cf8e341edd04fb663deffecfe16. Railway was serving 070f02681fee3f23988922ccd59f1b943c1988ba when this pass began. Deployment is explicitly authorised by the user after validation. Business records must not be cleared during testing.

## Implemented corrections

- Invitation lookup no longer stops after the first 1,000 Auth users. Existing staff use the indexed application directory first.
- Disabled caller roles cannot generate invitations or password recovery links. Directory, metadata and invitation read failures cannot report successful provisioning.
- Workspace permissions load alongside configuration after the profile is established, reducing serial startup requests.
- Sign-in, recovery and password changes restore their controls after unexpected request failures. Errors are announced and remain available until dismissed.
- Quote comparison indexes quotation rows once rather than scanning every quote for each item. Comparisons render 100 items per page; search and totals cover the entire dataset.
- OCR English language data is shipped with the application. Image and scanned-PDF extraction no longer depend on a separate language-data host. Worker startup and recognition have bounded waits.
- Sidebar navigation scrolls independently of account controls, preventing low menu entries from being covered on tablets and desktops.
- Browse All stock entries are not silently capped at 5,000. Stale filter responses cannot replace newer results. Stable item ordering prevents ambiguous pagination.
- Stock submission sends at most 1,000 counted items per atomic submission, matching the server limit. Remaining counts stay in the draft and are explained before and after submission. Pending draft writes finish before submission.
- Administration traverses database pagination for profiles and the user directory.

## Verification evidence

- Automated suite: 87 passing tests at the latest baseline run, including invitation behaviour, deadlines, 10,000-item comparison and 10,000-entry batch retention.
- TypeScript validation and production compilation passed.
- Dependency audit: zero reported vulnerabilities at the audit time.
- Browser suite covers 320, 390, 768 and 1366 pixel widths, setup/password flows, navigation, destructive warning cancellation and failure handling, supplier draft isolation, RFQ/PO exports, actual image OCR and scanned-PDF extraction, receiving drafts and replay keys. Expanded coverage includes role-specific section navigation and 205-item comparison pagination. Browser sessions and database responses are simulated.
- Actual database staff check: effective stock-handler grants, own profile, enabled modules and 1,192 stock rows were visible while executing under the authenticated database role with that principal's claims. This is a database-role check, not password authentication.
- Transactional database tests passed: API privileges/RLS, seven configured roles plus inactive administrator, role cloning, user-removal guards, reset function static safeguards, RFQ supplier addition, complete procurement workflow and delivery balance/rebuy actions.
- Large actual database test: 1,000 stock entries preserved all shortages and review states in approximately 974 ms. Oversized and non-finite inputs were rejected. All fixture records rolled back; the catalogue remained at 1,192 items.
- Synthetic quote benchmark in this environment: 10,000 items and 50,000 quotes, previous helper approximately 5,980 ms; indexed helper approximately 34 ms. This does not measure real-device or network latency.

## Limits of certification

This is a verified improvement release, not proof of zero defects. Real email delivery, real staff password login after a new invitation, actual supplier WhatsApp receipt, backup restoration and sustained production transaction-load testing have not been demonstrated in this session. No supplier messages were sent. No live system reset was executed. The full-reset transactional script could not run through the connector; reset SQL safeguards and mocked browser confirmations were checked instead.

Supabase's project-level advisor continues to report disabled breached-password protection and callable privileged functions. Callable functions require individual authorization review; the warning alone is not evidence of a vulnerability. Procurement role-boundary and API privilege tests passed. Performance notices for unindexed foreign keys, repeated Auth checks and multiple permissive policies were outside the proc_ tables; existing procurement indexes were retained.

## Published release and deployment state

- PR #37 merged at 74c30cb8a7e4e03da005fc7fdb5029d4c0af5d8e. The manually approved release marker commit is 59da2830aad0db7e86d8cfafa94034709cd3f9d4.
- Final clean npm ci, 87 tests, TypeScript, production build and expanded browser suite passed. Both GitHub workflows passed, including the installed-Chrome browser suite.
- Invitation Edge Function proc-invite-user version 9 is ACTIVE with JWT verification enabled. Unauthenticated POST returned 401; OPTIONS returned 200.
- Railway production source change is staged in patch 1e5882f7-2084-4160-8a42-ffc3e35971dd, changing only the pinned source commit to 59da2830aad0db7e86d8cfafa94034709cd3f9d4. The staged change is non-destructive.
- Railway accept-deploy was attempted after explicit user authorization. The connector returned: "Cancelled — the user did not approve this action. No changes were made." The deployment was not applied, and no alternate route was used to bypass this refusal.
- Read-back confirmed the patch remains STAGED. Live /api/health returned ok:true, database:connected, schema_ready:true and version 070f02681fee3f23988922ccd59f1b943c1988ba at 2026-10-11T14:00:49Z. This is the previous web release, not the new hardened web build.
- Post-test catalogue and profile counts remain 1,192 and 2 respectively.
- The initial approval block was subsequently resolved; see the final production verification below. Full release certification remains subject to the live-auth, external-delivery, restoration and sustained-load gaps above.

## Final production verification — 11 October 2026

- Railway deployment 0b9bfe66-6142-4656-84f1-56dde7899ab8 reached SUCCESS at 2026-10-11T14:30:08Z. It serves f570d912002abfc98846f1d15a7c58d72e531f3b, containing the merged PR #37 application code and validation record. No staged changes remain.
- Railway's release build passed all 87 tests, TypeScript, dependency audit and production compilation. Runtime logs show successful Next.js startup.
- Live /api/health returned HTTP 200 with ok:true, database:connected, schema_ready:true and the expected f570d912002abfc98846f1d15a7c58d72e531f3b release version.
- The live login returned HTTP 200 with a nonce-based Content Security Policy and no-store caching. Actual Chromium checks passed at 390 and 1366 pixels: the login rendered, show-password checked/unchecked changed the input type correctly, there were no page errors and there was no horizontal overflow. These checks did not sign in to a real staff account.
- The same-origin English OCR asset returned HTTP 200, 10,923,060 bytes, and successfully decompressed as gzip.
- Unauthenticated POST to /api/integrations/whatsapp/rfq returned HTTP 401 without sending messages.
- Production records remained 1,192 catalogue items, 2 profiles, 3 purchase orders and 8 RFQs after release verification.
- Application URL: https://gh-procurement-production.up.railway.app/
