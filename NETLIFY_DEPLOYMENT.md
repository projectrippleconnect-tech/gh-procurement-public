# GH Procurement — Netlify Free emergency preview

This branch is a copy of the approved GH Procurement release `d9fd03ef197ae7555e85abc240477931244cae26`
plus hosting configuration; it does not change the stock database, security,
search algorithm, or the running Railway production app.

## First deployment
1. Choose the Netlify **Free** plan; do not enable paid add-ons.
2. Deploy this branch; Netlify's OpenNext adapter handles Next.js App Router
   and route handlers. Node.js is pinned to version 24 in netlify.toml.
3. Provide these site environment values *inside Netlify*, never in a public
   GitHub issue or chat:
   - NEXT_PUBLIC_SUPABASE_URL (existing GH Procurement Supabase project).
   - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (publishable/anon client key only).
   The key is public by design, but don't use any Supabase service-role key.
4. First preview is for authorized validation only. WAHA_SENDING_ENABLED=false
   by default; Google Sheets service credentials are intentionally not copied.
5. Disable Netlify automatic builds after initial creation in Netlify
   Project configuration > Build & deploy. Manual deploys only.

## Smoke verification before directing staff
- GET /api/health returns 200, ok=true, schema_ready=true, version=
  d9fd03ef197ae7555e85abc240477931244cae26.
- GET / loads correct mobile UI with expected security headers.
- Unauthenticated POST /api/integrations/whatsapp/rfq returns 401 and does
  not send anything.
- Public OCR worker files /tesseract-data/eng.traineddata.gz and
  /pdf.worker.min.mjs are available.
- Pad loc, Padloc, Pad lock, Padlock, pad lok show identical item sets;
  numeric sizes and movement filtering still work.
- Validate login, role permissions, stock history, RFQ/PO draft and PDF output
  against safe test cases. No live supplier messaging.
- Set this new URL in Supabase Auth redirect allow-list only as needed after
  confirming the deployed site and its security.
- Do not switch production until fully verified, including offline queued
  stock submissions. Keep Railway for rollback.

## Known limitations
- Netlify Free: 300 credits per month, hard stop at allowance exhaustion.
- Function memory defaults to 1 GB, time limit 60s, buffered payload 6 MB.
- Automated WhatsApp gateway is tied to Railway-private DNS or localhost
  in current code. It is intentionally inactive on this alternate host.
- Google Sheets sync needs an external service-account secret and separate test.
- Never expose WAHA APIs, private keys, or Supabase service-role credentials.
