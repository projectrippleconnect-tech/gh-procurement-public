# GH Procurement — private WhatsApp RFQ gateway

The optional gateway sends an RFQ PNG and caption to its invited supplier. WAHA uses an unofficial WhatsApp Web bridge; it is not the WhatsApp Business Platform. Account restrictions remain possible.

## Historical infrastructure snapshot, 2026-10-09 (not a current health check)
- One Railway WAHA GOWS service, private endpoint `gh-procurement-waha-gows.railway.internal:3000`, with a 500 MB volume at `/app/.sessions`.
- No WAHA public domain. Dashboard and Swagger remain disabled.
- The session is linked and reports `WORKING`. Historical image requests returned HTTP 201, with corresponding accepted dispatch audit records. Acceptance does not prove recipient delivery.
- Gateway migrations are applied to the existing Supabase project. Existing procurement data and role permissions are preserved.

## Gateway portability and safe rollout (2026-11-02)
The pairing, RFQ and PO routes share a single server-only endpoint validator. Existing private Railway URLs remain compatible, but Railway is **not** an approved new host for this project.

For a non-Railway gateway use only `WAHA_BASE_URL=https://<fully-qualified-host>` with a matching `WAHA_ALLOWED_HOST=<fully-qualified-host>` on the application **server only**. This explicit, exact-host allowlist rejects other domains, raw IP addresses, embedded credentials, paths, queries, HTTP, nonstandard TLS ports and unconfigured hosts. Keep `WAHA_API_KEY` secret. These checks do not replace correct DNS, TLS, WAHA API-key enforcement, firewall or provider access-control settings. If a public HTTPS endpoint is unavoidable, restrict access upstream wherever possible and rotate keys after testing.

Do not activate `WAHA_SENDING_ENABLED` or any automated portal dispatch flags until a **working** persistent gateway, operator-controlled linked device, supplier test recipient and owner-only audit WhatsApp group are individually verified. The gateway host must support the WAHA image or equivalent supported runtime, a persistent session store, inbound HTTPS from Netlify, outbound WhatsApp connectivity, auto-restart, and credible memory/uptime stability. A provider advertising free Node.js hosting does **not** establish WAHA image compatibility or sufficient persistent storage. Unofficial WhatsApp bridge traffic may violate WhatsApp policy and risks account restrictions.

Acceptance sequence: (1) provider and container/runtime checks, (2) dedicated gateway account/volume, (3) independent health/session and restart tests, (4) pairing by an authorized administrator, (5) one controlled supplier PNG+caption RFQ, (6) one approved PO PNG+caption, (7) exactly one owner audit-group copy per item, (8) duplicate tap/retry prevention and unknown-status audit verification, (9) monitored 24-hour persistence, (10) explicitly controlled enablement. Never reuse production supplier recipients for a dry-run.

Production Netlify deployments remain manual and pinned to reviewed commits. This branch is a staging change: it does not change production environment values or enable message sending.

## Configuration and access
The web service needs server-only `WAHA_BASE_URL`, `WAHA_API_KEY`, `WAHA_SESSION`, and `WAHA_SENDING_ENABLED`, plus its existing public Supabase URL and publishable key. For a public HTTPS gateway, also configure `WAHA_ALLOWED_HOST` to its **exact DNS hostname** (no scheme, port, wildcard or path); this must match `WAHA_BASE_URL`. Private `*.railway.internal` HTTP endpoints retain their historical path solely for backward compatibility; localhost HTTP is limited to non-production environments. Arbitrary public hosts and public HTTP are rejected. The route uses the signed-in user's token and guarded database RPCs; a Supabase service-role key is not required or configured.

Pairing requires an active administrator. Sending requires an active admin/procurement profile, RFQ management permission, an active invited supplier, an unsent invitation, a valid PNG and a working session. Supplier numbers are resolved from the database.

Dispatch attempts are claimed atomically before sending. A unique RFQ/supplier key blocks concurrent or repeated attempts. Accepted, failed and unknown outcomes are audited. Unknown outcomes must be inspected in WhatsApp before any manual resend. Completed dispatches cannot be overwritten through the finish RPC.

## Controlled deployment
The web app remains on the established Netlify manual-deploy path. This change does not enable Railway, switch providers or trigger a deployment. A new always-on WAHA provider is **not yet verified**. Before adopting a free hosting service, verify that it supports the WAHA container/engine, stable outbound WhatsApp WebSocket connectivity, persistent session data, secure inbound HTTPS and recovery from restarts. Botkeep currently documents Node.js runtimes but does not certify arbitrary WAHA Docker workloads; treat it as an evaluation candidate only. Never enable `WAHA_SENDING_ENABLED` until that provider has been tested with an authorized recipient.

Run the quality gate first: locked install, security audit, TypeScript validation, tests, production build and responsive browser checks. After the quality gate passes, deploy the **exact validated commit** via the established manual Netlify process only. Verify deployment metadata and `/api/health` both identify that commit. Do not redeploy an older release or expose a WAHA dashboard or API key.

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
