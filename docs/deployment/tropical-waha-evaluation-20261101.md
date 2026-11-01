# Tropical Hosting Sparrow — GH Procurement WAHA validation gate

**Evaluation only. As of 2026-11-01, no Tropical Hosting server has been provisioned, no WhatsApp account has been linked, and no supplier messaging has been enabled.**

## Purpose

GH Procurement requires **fully automatic**, approval-guarded supplier RFQ and PO dispatches (PNG plus caption), per-supplier duplicate prevention, and private RFQ/PO audit-group copies. Manual sharing is **not** a final substitute. The GH Procurement application remains on manually deployed Netlify, with purchasing and notification data in the existing GH NEXUS Supabase backend. The new WAHA runtime must live separately.

Do not use Railway or Northflank. Do not purchase a paid plan, attach a credit card or submit credentials to an unverified host.

## Free Sparrow plan — published claims vs unverified requirements

Official https://www.tropicalhosting.net/bot-hosting/ advertises no-card free Sparrow with 512 MB RAM, 1 vCPU, 2 GB SSD, custom Docker images, automatic restart and continuous bot operation. The following **must be confirmed directly with Tropical Hosting** before hosting any live WhatsApp business credentials:

| Gate | Provider confirmation required | Current conclusion |
|---|---|---|
| Free / zero-card | Sparrow can be created today with no card, subscription or time limit | Advertised; not yet account-tested |
| Image / memory | Official `devlikeapro/waha` GOWS Docker image is allowed, and container stays healthy within 512 MB | Unverified |
| Public API | Container port 3000 is reachable from external **Netlify Functions** via a public TLS/HTTPS hostname, inbound authenticated POST supported | Unverified — critical blocker |
| Persistence | A persistent directory mounted to `/app/.sessions` survives auto-restart, redeploy and updates; or an accessible external PostgreSQL store that allows WAHA database creation | Unverified — critical blocker |
| Security | Secret environment variables protected; API key and dashboard auth; possible access restriction, no accidental public dashboard | Unverified |
| Acceptable use | Transactional WhatsApp supplier RFQs/POs (not bulk advertising) and permanent GOWS WebSocket connection are permitted | Unverified |
| Recovery | No sleep, reliable auto-restart, logs and alerting; account suspension terms disclosed | Unverified |

WAHA official documentation: https://waha.devlike.pro/docs/how-to/storages/ and https://waha.devlike.pro/docs/engines/gows/ . GOWS is light relative to browser-based engines, but **512 MB adequacy is not proven without a real Docker startup and linked session stress check**.

WAHA sessions need persistence. If using PostgreSQL, set `WHATSAPP_SESSIONS_POSTGRESQL_URL`; note that WAHA creates multiple databases and requires DB create privileges. Do **not** put WAHA session data or administrative DB credentials into the live GH NEXUS procurement database. If using persistent local storage, mount `/app/.sessions` and test that the linked session remains WORKING after restart/redeploy.

Provider support: https://www.tropicalhosting.net/support/ . The support mailbox is listed as `support@tropicalhosting.net`. The service owner may send a no-secret inquiry with the requirements above.

## Provisioning sequence if ALL gates pass

1. Create **free Sparrow only** in the user's own Tropical Hosting account. No card or upgrade.
2. Start an isolated **dummy Docker health server**, not WAHA and not any WhatsApp session. Prove the container is continuously running, HTTPS endpoint permits inbound API calls from outside the host, and the provider permits secret environment variables. Observe automatic restart. Record a screenshot with sensitive values redacted.
3. Test persistent storage across restart/redeploy using a random marker file. If no persistent mount, obtain a separate free PostgreSQL database that meets WAHA's CREATE DATABASE requirements; otherwise **reject** this host.
4. Deploy the **official** pinned `devlikeapro/waha` Docker image using the GOWS engine with one replica. Expose HTTP port 3000 **behind host HTTPS**, not open plaintext HTTP. Configure `WHATSAPP_DEFAULT_ENGINE=GOWS`, `WAHA_NAMESPACE=all`, a strong `WAHA_API_KEY`, unique dashboard credentials and the persistent local volume or external PostgreSQL session URL. Never log QR codes, credentials or authentication tokens.
5. While no WhatsApp is linked, test that unauthorized API calls are rejected and authorized GET session-readiness checks work. Use `scripts/qa/waha-gateway-readonly.mjs` **from the secure operator environment**, not a client/browser exposing secrets. Do not print API keys in logs.
6. Pair only the designated business WhatsApp account through its own linked-device control; verify session WORKING across a restart. Confirm this does not violate provider or WhatsApp policy; unofficial WAHA can disconnect or face restrictions.
7. In Netlify server-only Functions environment, configure exact `WAHA_BASE_URL` (https://hostname without path/trailing slash), `WAHA_ALLOWED_ORIGINS` (same exact origin), `WAHA_API_KEY`, and `WAHA_SESSION=default`. Use manual-only re-publish; no Git autosync. Never prefix the secret variables `NEXT_PUBLIC_`.
8. Keep these flags **false** during commissioning: `WAHA_SENDING_ENABLED`, `GH_PORTAL_DISPATCH_ENABLED`, `GH_PORTAL_DELIVERY_VERIFIED`, `GH_WA_AUDIT_ENABLED`. Confirm `GH Procurement → Company Lists → Setup → WhatsApp Audit Groups` can connect and resolves the *exact existing* RFQ and PO subgroup IDs, names, and current owner-only membership.
9. When specifically approved controlled test recipients are available, authorize a non-business test RFQ and PO with PNG+caption and verify actual recipient-screen appearance, WAHA message identifiers, private audit subgroup delivery, and an idempotent no-resend replay. Avoid all existing unresolved automatic jobs (currently 11) until reconciled.
10. Only after all receipt and duplicate-protection checks pass, separately configure limited unattended supplier dispatch with a **kill switch** and admin notification on any failure. The application must never silently resend `unknown` or rejected sends without reconciliation.

## Acceptance fields

- Host plan documented $0/no-card, host security acceptable: **PENDING**
- Docker start and persistent session test: **PENDING**
- Netlify-to-gateway HTTPS API test: **PENDING**
- Pair one WhatsApp session and restart: **PENDING**
- Validate RFQ and PO private groups: **PENDING**
- Controlled supplier PNG + caption receipt + private copy: **PENDING**
- Duplicate/unknown failure prevention: **Implemented in app, live re-test pending**
- Unattended RFQ/PO dispatch and alert on failure: **PENDING live acceptance**

Do not mark Stage 5 complete based only on published free-tier features, CI checks or historical gateway message IDs.
