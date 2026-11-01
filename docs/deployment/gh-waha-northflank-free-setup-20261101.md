# New GH Procurement WhatsApp gateway — Northflank Sandbox provisioning

**Status: prepared, NOT provisioned, NOT connected, NOT allowed to send suppliers.**

This playbook connects a new WAHA instance to the existing `https://gh-procurement.netlify.app` app. It does **not** use Railway, does not require a card according to Northflank's published Sandbox terms, and must **not** create a paid plan or add a payment method.

## Decision and free-tier boundary

Northflank Sandbox currently advertises **no card required**, **always on/no sleeping**, **two services and one database**, with up to **$20/month in included resources**. Free is not an uptime SLA. Check projected resource usage and $0 plan in the actual account before creating anything. Stop if signup asks for a payment card, a paid upgrade, or a paid resource. A free account on a third-party service still requires its owner's sign-in; no GH Procurement GitHub/Netlify credentials can create it by themselves.

WAHA Core is free; its **GOWS** engine avoids a headless Chromium process. WAHA supports persistent sessions through PostgreSQL. Use **Northflank's own separate PostgreSQL addon**, not the live GH NEXUS production database.

Reference:
- https://northflank.com/pricing
- https://northflank.com/docs/v1/application/databases-and-persistence/deploy-databases-on-northflank/deploy-postgresql-on-northflank
- https://northflank.com/docs/v1/application/databases-and-persistence/connect-database-secrets-to-workloads
- https://northflank.com/docs/v1/application/network/configure-ports
- https://waha.devlike.pro/docs/how-to/config/
- https://waha.devlike.pro/docs/how-to/storages/
- https://waha.devlike.pro/docs/how-to/sessions/

## A. Create the separated free project

1. Visit https://northflank.com/ and select **Sandbox / Start free**. Sign in using your own account. Do **not** enter card details or select pay-as-you-go.
2. Create a project called `gh-procurement-waha`.
3. Under the project select **Create new → Addon → PostgreSQL**. Name it `waha-sessions`. Select the smallest eligible **free Sandbox** resource plan and **one replica**, with enough space for a single WhatsApp session. Keep the database **private**: do not enable public exposure. Review that the combined projected usage stays within the free allowance.
4. Create a **runtime secret group**, e.g. `waha-connection-secrets`. Under **Linked addons**, select `waha-sessions`, add its `POSTGRES_URI` connection string and set the alias to the **exact** WAHA variable `WHATSAPP_SESSIONS_POSTGRESQL_URL`. Scope the group only to the WAHA service. Never copy the connection string into GitHub, chat or a screenshot.
5. Create **Deployment service** `gh-waha` using **external Docker image** `devlikeapro/waha` (official image; once a working release is selected, pin its digest to avoid uncontrolled changes). Configure **one replica**, available Sandbox compute with **at least 512 MB RAM if offered**, and **public HTTP port 3000**. Northflank will assign a TLS-protected `https://…code.run` URL; keep it to yourself until configured. Avoid setting a Git-linked automatic deployment.
6. Link the runtime secret group from step 4 to `gh-waha`.
7. Add the following **runtime environment variables** in Northflank, all *server-only*. Generate unique strong secrets in Northflank's secret editor; never use example passwords.

| Variable | Setting |
| --- | --- |
| `WHATSAPP_DEFAULT_ENGINE` | `GOWS` |
| `WAHA_NAMESPACE` | `all` |
| `WAHA_API_KEY` | Strong independent random key (32+ bytes; *secret*, do not paste into chat) |
| `WAHA_DASHBOARD_ENABLED` | `true` during initial pairing; disable after pairing if no longer needed |
| `WAHA_DASHBOARD_USERNAME` | Unique administrator login |
| `WAHA_DASHBOARD_PASSWORD` | Unique long random password (secret) |
| `WHATSAPP_SWAGGER_ENABLED` | `false` |
| `WAHA_PRINT_QR` | `False` (prevent QR data in logs) |
| `WAHA_LOG_LEVEL` | `info` |
| `TZ` | `Asia/Colombo` |
| `WHATSAPP_SESSIONS_POSTGRESQL_URL` | **Inherit from PostgreSQL addon secret group** — do not manually guess |
| `WAHA_PUBLIC_URL` | The **actual Northflank HTTPS public origin**, only if required for public links |

8. Deploy **only this new WAHA service**. Verify container health without enabling GH Procurement sending. The exposed API must remain protected by `X-Api-Key`. The database must not be internet-accessible.

## B. Link one WhatsApp account

1. Open `https://<actual-Northflank-host>/dashboard` in a trusted browser, and sign in using the private dashboard credentials.
2. Configure the API key securely if the dashboard asks for it. Create or start session `default` using **GOWS**.
3. On the intended WhatsApp/WhatsApp Business account, open **Linked devices**. If working with one phone, use WAHA's phone pairing-code flow where supported. If a QR scan is required, display the QR on a second trusted screen and scan it on the phone. Never disclose QR or pairing codes.
4. Confirm WAHA session state reads **`WORKING`**, ideally after a normal service restart with PostgreSQL persistence.
5. Disable the publicly accessible dashboard after successful linking if it is unnecessary, while retaining the key-protected API.

WAHA is a linked-device, unofficial WhatsApp Web integration; it may disconnect, and platform/service changes can require relinking. An always-on container cannot guarantee uninterrupted WhatsApp access.

## C. Connect the already-deployed Netlify app

Inside **Netlify site `gh-procurement` → Environment variables**, set the following **private server-side Functions variables**, not `NEXT_PUBLIC_*` values:

| Variable | Value |
| --- | --- |
| `WAHA_BASE_URL` | The exact Northflank HTTPS origin, e.g. `https://<assigned>.code.run` **without trailing slash or path** |
| `WAHA_ALLOWED_ORIGINS` | That same exact HTTPS origin |
| `WAHA_API_KEY` | The **same private API key** used on WAHA |
| `WAHA_SESSION` | `default` |

Retain `WAHA_SENDING_ENABLED=false`, `GH_PORTAL_DISPATCH_ENABLED=false`, `GH_PORTAL_DELIVERY_VERIFIED=false`, and `GH_WA_AUDIT_ENABLED=false` during commissioning. **Do not** enable full unattended supplier sending or auto purchasing.

After changing Netlify Functions environment, trigger the existing **manual-only** Netlify release/republish for the already quality-tested code; do not link automatic Git publishing. Verify `/api/health` is green and the exact version remains expected.

The historical RFQ and PO private group IDs are recorded in the procurement audit history, but do not copy them into a new server or activate archival until the newly connected WAHA session confirms the **actual group IDs, names, and owner-only participant identity**. Inspect via **GH Procurement → Company Lists → Setup → WhatsApp Audit Groups → Check my WhatsApp groups**. Do not send a message from the read-only diagnostic.

## D. Acceptance and no-go gates

1. **Host:** Northflank shows running WAHA; session state is `WORKING`. No paid resources were created; PostgreSQL session survives service restart.
2. **Gateway:** Netlify is able to read the session and groups from its private runtime variables using key-protected HTTPS; the diagnostic no longer says `The private WAHA gateway is not configured`.
3. **Audit privacy:** Exact RFQ/PO subgroup IDs and names verified from new session, *all* current participants inspected and exclusively owner-approved. Never send document copies to the parent community, general group or announcements.
4. **Controlled test only:** after operator selects a **controlled, authorized recipient and disposable test RFQ/PO**, enable only the minimum necessary manual sending path. Confirm actual device receipt of PNG with caption, gateway message ID, and the separate private audit-copy receipt. Never assume HTTP 200 or a message ID proves delivery. Turn off any temporary sending toggle after testing.
5. **Idempotency:** verify supplier dispatch claim and unique private audit source/page key. Preserve the 11 existing `needs_action` records for manual reconciliation and do not blindly replay `unknown` attempts.
6. **Long run:** observe WAHA restart recovery, WhatsApp re-link status, error alerts and session uptime. Only after all checks can the operator separately consider enabling automated sends.

### Rollback (no business-data mutation)

Disable Netlify `WAHA_SENDING_ENABLED`, `GH_WA_AUDIT_ENABLED` and portal dispatch flags. Remove the `WAHA_BASE_URL` and `WAHA_ALLOWED_ORIGINS` connection values **only if intentionally disconnecting**. Keep the Northflank PostgreSQL session database backed up. Do not delete or resend historical RFQs/POs. Never remove a service or database without confirming retained session backups and no paid-resource implications.

**External action still required:** the account owner must create/authorize a Northflank Sandbox workspace and link the intended WhatsApp device. No connected Northflank management tool was available at the time this file was prepared, so the service itself has **not** been provisioned.
