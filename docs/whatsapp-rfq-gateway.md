# GH Procurement — private WhatsApp RFQ gateway

The optional gateway sends an RFQ PNG and caption to its invited supplier. WAHA uses an unofficial WhatsApp Web bridge; it is not the WhatsApp Business Platform. Account restrictions remain possible.

## Verified infrastructure, 2026-10-09
- One Railway WAHA GOWS service, private endpoint `gh-procurement-waha-gows.railway.internal:3000`, with a 500 MB volume at `/app/.sessions`.
- No WAHA public domain. Dashboard and Swagger remain disabled.
- The session is linked and reports `WORKING`. Historical image requests returned HTTP 201, with corresponding accepted dispatch audit records. Acceptance does not prove recipient delivery.
- Gateway migrations are applied to the existing Supabase project. Existing procurement data and role permissions are preserved.

## Configuration and access
The web service needs server-only `WAHA_BASE_URL`, `WAHA_API_KEY`, `WAHA_SESSION`, and `WAHA_SENDING_ENABLED`, plus its existing public Supabase URL and publishable key. The route uses the signed-in user's token and guarded database RPCs; a Supabase service-role key is not required or configured.

Pairing requires an active administrator. Sending requires an active admin/procurement profile, RFQ management permission, an active invited supplier, an unsent invitation, a valid PNG and a working session. Supplier numbers are resolved from the database.

Dispatch attempts are claimed atomically before sending. A unique RFQ/supplier key blocks concurrent or repeated attempts. Accepted, failed and unknown outcomes are audited. Unknown outcomes must be inspected in WhatsApp before any manual resend. Completed dispatches cannot be overwritten through the finish RPC.

## Controlled deployment
Automatic Railway deployment is disabled by pinning the source to an explicitly verified commit. The existing manual-trigger watch pattern is also retained. Do not reconnect the source without a commit pin.

Run the quality gate first: locked install, security audit, TypeScript validation, tests, production build and responsive browser checks. Connect the exact passing commit, then explicitly redeploy that commit's deployment if Railway's watch pattern skips its first attempt. Verify the resulting deployment metadata and `/api/health` both identify the intended commit. Never redeploy an older release accidentally.

## Operator workflow
Open the prepared RFQ invitation and check connection status. Generate the PNG and use **Send Attached PNG + Caption** once. Inspect the recipient's WhatsApp chat for the correct image and caption before **Confirm Sent**. The manual download-and-attach fallback remains available.

To certify delivery, use a test RFQ and an explicitly authorized number controlled by the tester. Verify exactly one readable image and its complete caption at that recipient. The agent must not infer delivery from a successful gateway response.

## Verification commands
- `npm ci` (dependency lifecycle scripts disabled by `ignore-scripts=true`)
- `npm audit --audit-level=high`
- `npm run lint`
- `npm test`
- `npm run build` (explicitly copies reviewed PDF/OCR worker assets)
- `GH_UI_BROWSER_CHANNEL=chrome npm run test:ui`
- Execute `tests/procurement-workflow.sql` through the authorized Supabase SQL connector. It uses authenticated claims, isolated fixtures and an explicit rollback; it never contacts WhatsApp.

Responsive browser fixtures verify rendering and navigation, while the SQL integration test verifies actual database transitions. Neither substitutes for an Android-device or recipient-delivery test.
