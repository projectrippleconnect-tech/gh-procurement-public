# GH Procurement — Attached PNG over WhatsApp (private WAHA gateway)

This optional integration sends a **real PNG attachment with a caption to the RFQ's invited supplier**, without installing the GH Procurement companion APK. It uses the unofficial WAHA/WhatsApp Web bridge and can result in WhatsApp account restrictions or suspension. This is **not** the official WhatsApp Business Platform. Only use a dedicated procurement WhatsApp number if you accept that risk.

## Before enabling
1. Provision a **private** WAHA container (using `devlikeapro/waha:noweb` with the NOWEB engine) reachable from GH Procurement on Railway's private network. **Never expose WAHA's API or dashboard publicly.** Set a strong unique `WAHA_API_KEY` in WAHA only.
2. Attach a durable, access-restricted volume to WAHA mounted at **`/app/.sessions`**. The session will disappear after redeploys without it; do not put WhatsApp session tokens in GitHub.
3. Pair a dedicated procurement number from GH Procurement **RFQs & Quotes → WhatsApp Gateway Setup (Admin)**. Choose **Start Pairing**, then **Get Pairing Code (Same Phone)**. Enter the resulting code in that number's WhatsApp → Linked Devices → Link a Device → Link with phone number instead. If code pairing is unavailable, use **Show QR (Other Screen)** to scan. Confirm the session reports `WORKING`. Pairing is manual and only the account owner can do it.
4. Apply `supabase/migrations/050_procurement_whatsapp_rfq_gateway.sql` to the existing Supabase database via the approved migration process (no data wipe).
5. Set **server-side only** environment variables on GH Procurement Railway service:
   - `WAHA_SENDING_ENABLED=true` (disabled unless explicitly enabled)
   - `WAHA_BASE_URL=http://<waha-service>.railway.internal:3000` (private/internal hostname only)
   - `WAHA_API_KEY=<same-strong-api-key>`
   - `WAHA_SESSION=default`
   - `SUPABASE_SERVICE_ROLE_KEY=<Supabase service-role secret>` (**NEVER** NEXT_PUBLIC; do not commit or print)
   - Existing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
6. Deploy **only when the owner explicitly requests it**. The Railway watch pattern stays restricted to the manual release trigger file.

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

## Staged Railway setup (2026-10-09)
- The service `gh-procurement-waha-YQ7R` (image `devlikeapro/waha:noweb`) and a `500 MB` volume at `/app/.sessions` have been **staged**, not deployed, in GH Procurement's Railway production environment. The current plan restricts the volume to 500 MB.
- Its internal-only hostname is staged as `gh-procurement-waha.railway.internal` (port 3000), with no public dashboard or domain required.
- `WHATSAPP_DEFAULT_ENGINE=NOWEB`, `WHATSAPP_RESTART_ALL_SESSIONS=True`, `WAHA_PRINT_QR=False` and `TZ=Asia/Colombo` are staged on the new WAHA service.
- The GH Procurement service has staged `WAHA_BASE_URL=http://gh-procurement-waha.railway.internal:3000`, `WAHA_SESSION=default`, and **`WAHA_SENDING_ENABLED=false`**.
- Secret API keys and the Supabase service role key have **not** been configured. Do not commit/stage fake or hardcoded secrets or enable sending until genuine secret values have been securely set on Railway.
- Pending Railway changes remain uncommitted. Committing them can provision a billable container/volume and may redeploy existing services. Wait for explicit owner authorization.
- The Supabase project containing `proc_rfqs` is the existing **GH NEXUS** project. Migration 050 has not been applied; verify its exact project and safety before applying it in production.
- Check that Railway's staged internal hostname has the correct DNS label, the WAHA `/api/health` check works, and the service has no public endpoint. Open admin pairing only after a safe rollout.
