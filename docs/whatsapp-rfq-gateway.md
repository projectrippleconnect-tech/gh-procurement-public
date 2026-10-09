# GH Procurement — Attached PNG over WhatsApp (private WAHA gateway)

This optional integration sends a **real PNG attachment with a caption to the RFQ's invited supplier**, without installing the GH Procurement companion APK. It uses the unofficial WAHA/WhatsApp Web bridge and can result in WhatsApp account restrictions or suspension. This is **not** the official WhatsApp Business Platform. Only use a dedicated procurement WhatsApp number if you accept that risk.

## Before enabling
1. Provision a **private** WAHA container (`devlikeapro/waha:gows` using GOWS (lower CPU and memory usage)) reachable from GH Procurement on Railway's private network. **Never expose WAHA's API or dashboard publicly.** Set a strong unique `WAHA_API_KEY` in WAHA only.
2. Attach a durable volume to WAHA mounted at **`/app/.sessions`**. Railway's current plan allows **500 MB maximum**. The session will disappear after redeploys without persistent storage; monitor capacity and never place WhatsApp session tokens in GitHub.
3. Use **GH Procurement > RFQs > WhatsApp Gateway Setup (Administrator)** to start the private session and request a phone pairing code, or display a QR. Open **WhatsApp > Linked Devices** on the dedicated procurement number and enter the code or scan the QR on a second device. Confirm status becomes `WORKING`. No WAHA public dashboard or companion APK is needed. Pairing always requires an account holder's action.
4. Apply `supabase/migrations/050_procurement_whatsapp_rfq_gateway.sql` to the existing Supabase database via the approved migration process (no data wipe).
5. Set **server-side only** environment variables on GH Procurement Railway service:
   - `WAHA_SENDING_ENABLED=false` while linking/testing infrastructure; change to `true` **only after test review and explicit authorization**.
   - `WAHA_BASE_URL=http://<waha-service>.railway.internal:3000` (private/internal hostname only)
   - `WAHA_API_KEY=<same-strong-api-key>`
   - `WAHA_SESSION=default`
   - `SUPABASE_SERVICE_ROLE_KEY=<Supabase service-role secret>` (**NEVER** NEXT_PUBLIC; do not commit or print)
   - Existing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
6. Railway gateway is staged with **GOWS**, the 500 MB volume and a private shared API key. No service is running until the owner approves applying staged changes. On gateway, configure `WHATSAPP_DEFAULT_ENGINE=GOWS`, and keep `WAHA_DASHBOARD_ENABLED=false` and `WHATSAPP_SWAGGER_ENABLED=false`. Set the `SUPABASE_SERVICE_ROLE_KEY` manually through Railway secrets in the GH Procurement web service; it is deliberately not committed or retrievable from GitHub. Never expose that key.
7. Deploy **only when the owner explicitly requests it**. The Railway watch pattern stays restricted to the manual release trigger file.

## UI and security
- Open RFQ, select the prepared invitation, and check gateway status.
- Tap **Send Attached PNG + Caption**, explicitly confirm the destination. The PNG is generated from that invitation as usual; the backend independently resolves the *actual invited supplier*, recipient number, RFQ number and caption from Supabase.
- The browser passes the PNG and RFQ/supplier UUIDs only. WAHA API keys, its private address and Supabase service-role key never go to the browser.
- The backend requires a current Supabase access token, an active **admin/procurement** profile, an active invited supplier, an unsent RFQ, a valid PNG signature/dimensions, and the connected WAHA session.
- The audit table is **inserted before sending**, with a unique `(rfq_id,supplier_id)`. The gateway must return a successful response before the record becomes `accepted`. That means *gateway accepted*, **not** delivered/read; verify in WhatsApp before clicking **Confirm Sent**.
- Network timeout/error after submission is marked `unknown`, and is **not retried automatically**. Failed sends also require manual review. Prevents duplicates from repeated taps or unreliable networks.
- Manual fallback **Download PNG → selected WhatsApp chat → attach from Downloads** remains available. No bulk sending, unsupervised retries, auto-send on page load, or unsafe public API access.
- To inspect the status and audit history for a request, the app calls authenticated `GET /api/integrations/whatsapp/rfq?rfqId=<uuid>`.

## Testing
- `npm test`
- `npm run build`
- Once deployed and paired, use a **test RFQ** addressed to a number you control; confirm in WhatsApp that it receives exactly one genuine image with the requested caption before contacting suppliers.

## Current limitations
- WhatsApp accounts can be restricted for unofficial clients. Security isolation does not remove that risk.
- Railway compute and persistent volumes may cost money even when WAHA Core itself is free.
- No migration, service creation, secrets, QR pairing or real WhatsApp send occurs merely by merging this code.
- One attempted send per RFQ/supplier is deliberately enforced; manual duplicate resolution is safer than blind retries.

## Current staging status (2026-10-09)
- Railway GH Procurement project: staged private `gh-procurement-waha` service from `devlikeapro/waha:gows` with 500 MB volume. Gateway and GH Procurement app API key settings are **staged**, not live; WAHA sending remains disabled.
- Admin-only pairing screen is included in source code; it cannot be used until the app and gateway are deployed with server-side secrets configured.
- Required Supabase migration `050_procurement_whatsapp_rfq_gateway.sql` has not been applied to production. It must be applied before enabling sends.
- Do **not** generate a Railway public domain for WAHA. Use GH Procurement's authenticated pairing proxy only.

## Reconciliation checkpoint — 2026-10-09
- A concurrent setup was already merged into `main` as `d3475474a503c245471a4f3bf0ea10ea70c092c8`. It provides an admin-only phone code and QR pairing interface. The overlapping PR #6 was closed without merging.
- Keep **one gateway only**: staged service `gh-procurement-waha` (GOWS) with private endpoint `gh-procurement-waha-gows.railway.internal:3000` and volume `waha-session-storage` (500 MB). The GH Procurement staged `WAHA_BASE_URL` has been corrected to this endpoint.
- An earlier duplicate NOWEB service was unstaged. Its old 500 MB volume was deleted but remains visible in Railway's pending changes as a soft-deleted/staged volume. **Review and discard only this specific duplicate volume pending change in the Railway canvas before applying the changeset**. Do not discard the GOWS service, its volume, or the shared API-key settings.
- `SUPABASE_SERVICE_ROLE_KEY` is **not configured** in GH Procurement; set it through Railway's protected variable settings before activating the admin pairing API. Do not paste service-role secrets into GitHub or chat.
- Pending changes must remain staged until explicit approval for deployment and any resulting hosting costs. Apply migration 050 to the existing GH NEXUS Supabase database only in the approved rollout. `WAHA_SENDING_ENABLED` must remain `false` until a linked-number test confirms actual PNG + caption delivery.
