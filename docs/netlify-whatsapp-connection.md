# Netlify WhatsApp transport

## Connection policy

Every RFQ, PO, company dispatch, pairing, audit-group diagnostic and portal worker
uses `lib/waha-gateway.mjs`. Server-only gateway configuration includes:

- `WAHA_BASE_URL`: gateway origin only, including its scheme and optional port.
- `WAHA_API_KEY`: existing gateway credential, never a public frontend variable.
- `WAHA_SESSION`: existing procurement session, defaulting to `default`.
- `WAHA_ALLOWED_ORIGINS`: exact HTTPS origin for a gateway outside the app's
  private network. The configured base must match one entry exactly.

External gateways require HTTPS; URL credentials, paths, queries, fragments,
raw IP addresses and local/internal DNS names are rejected. Existing private
network installations and localhost fixtures retain compatibility. All
credential-bearing gateway fetches reject redirects.

This change does not create a gateway or expose an existing private gateway.
It does not enable WhatsApp sending, automatic dispatch or audit-group sharing.

## Commissioning

1. Configure an existing reachable gateway and its exact approved HTTPS origin
   using the hosting provider's server-only environment settings.
2. Use the administrator pairing screen to link the procurement session and
   confirm its state is WORKING.
3. Configure the exact existing RFQ/PO archive destinations. Verify each group's
   identity and exclusive owner membership through the administrator group check.
4. Verify an approved PNG with its caption and an audit copy, recording message
   identifiers and actual receipt. Gateway acceptance alone is not delivery.
5. Enable automatic dispatch only after the verified delivery gate is satisfied.
   Never requeue `unknown` records until gateway reconciliation rules out a send.

The read-only `WhatsApp connection diagnostics` manual workflow reports presence
and boolean readiness only. It does not print credentials or send messages.
Database quotation processing uses the existing database scheduler and should
not be duplicated by enabling a second web processor.

## 31 October 2026 investigation

The Netlify environment inspection did not find the gateway URL/API key or RFQ/PO
audit-group destinations. The existing gateway hosting connector required
reauthentication, so no session or delivery could be verified. One existing
company order has an unknown send state and was preserved. The database
quotation-round scheduler, procurement sweep and admin notification jobs were
active and their latest runs succeeded. No production business records were
changed during this investigation.
