# GH Procurement — Attached PNG over WhatsApp (private WAHA gateway)

This optional integration sends a **real PNG attachment with a caption to the RFQ's invited supplier**, without installing the GH Procurement companion APK. It uses the unofficial WAHA/WhatsApp Web bridge and can result in WhatsApp account restrictions or suspension. This is **not** the official WhatsApp Business Platform. Only use a dedicated procurement WhatsApp number if you accept that risk.

## Before enabling
1. Provision a **private** WAHA container (e.g., `devlikeapro/waha:chrome` using WEBJS) reachable from GH Procurement on Railway's private network. **Never expose WAHA's API or dashboard publicly.** Set a strong unique `WAHA_API_KEY` in WAHA only.
2. Attach an encrypted, durable volume to WAHA mounted at **`/app/.sessions`**. The session will disappear after redeploys without it; do not put WhatsApp session tokens in GitHub.
3. Pair a dedicated procurement number from WhatsApp > Linked Devices using WAHA's authorized dashboard/QR flow, and confirm `GET /api/sessions/default` reports `WORKING`. Pairing is manual and only the account owner can do it.
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
