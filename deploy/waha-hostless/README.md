# GH Procurement — experimental always-on WAHA GOWS gateway

**Recovery status (2026-11-02): Hostless app `gh-procurement-waha` was deployed and the `default` WhatsApp session was previously paired. It is NOT currently verified working: read-only requests to `/ping`, `/health` and `/api/sessions/default` all returned 404 from the existing public gateway URL. Supplier sending must remain OFF. Do not erase the separate `gh-waha-sessions` PostgreSQL storage.**

This directory is the checked-in Hostless **configuration candidate** for the already existing WAHA app, separate from the GH Procurement Next.js app on Netlify. A repository change alone does not prove the live Hostless app used the file. The 404 errors suggest an ingress/active-release mismatch; the Dockerfile now binds the WAHA listener to `0.0.0.0:3000` and starts only `default` on restart. It preserves the existing 384 MB resource cap pending verification of the active free tier. Hostless can build a Dockerfile. It advertises a no-card shared free allowance of 0.5 vCPU, 1 GiB RAM and 512 MiB database storage; real account capacity, pricing policy and permission checks MUST be verified before provisioning.

## Candidate topology and cost ceiling

- One WAHA GOWS web app: 1 replica, at most **0.2 vCPU / 384 MiB**.
- One separate Hostless managed PostgreSQL instance, initially **0.25 vCPU / 512 MiB / 512 MiB storage**, only if those defaults fit the account's free ceiling.
- Combined configured maximum: **0.45 vCPU / 896 MiB RAM / 512 MiB persistent database storage**. Build resources and platform accounting can differ; confirm the final configuration screens show **zero** spend and **no payment method**.
- **Never create an additional paid volume**. Hostless persistent volumes are separately billed and are not needed if the PostgreSQL session path works.
- WhatsApp session persistence requires PostgreSQL because container filesystem is ephemeral. WAHA creates multiple databases: the connected DB account **must** have `CREATEDB` / create-drop permissions. Managed PostgreSQL user permissions are presently unverified. If it lacks those permissions, stop; do not use the GH NEXUS production database or work around permissions.
- WAHA's 200 MB GOWS per-session memory estimate is an **estimate**, not an SLA. If it exceeds the free limit, stop without upgrading.

## Hostless setup — only after eligibility is verified

1. Create a Hostless account with the **free / no-card** option; do not accept a paid upgrade. Do not connect this until Hostless confirms the free resources and no payment obligation.
2. Create a dedicated free PostgreSQL database. Check that a new dedicated connection can run `SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user;` and that the session user is allowed to create/drop databases. *Do not run a destructive test against GH NEXUS.*
3. Create the WAHA web app from this repository; set **Working Directory** to `deploy/waha-hostless`, **Build Context** to that same directory, and **Hostless File Path** to `deploy/waha-hostless/hostless.yaml`. Set Docker build and one replica. Confirm the provider routes `PORT=3000` to HTTPS.
4. Set these **server-side-only** variables in Hostless: `PORT=3000`, `WHATSAPP_DEFAULT_ENGINE=GOWS`, `WAHA_API_KEY=<long-random-secret>`, `WHATSAPP_SESSIONS_POSTGRESQL_URL=<dedicated-Hostless-Postgres-URL>`. Use the Postgres *direct* endpoint if the platform's pooler blocks database-creation commands. Do not expose secrets in Git or logs. Keep dashboard and Swagger disabled.
5. Check private HTTPS gateway reachability, health, session creation, QR or code linking as an authorized admin, restart persistence, and TLS. WAHA uses an unofficial bridge that can lead to account restrictions. A visible running container alone does **not** prove reliable WhatsApp delivery.
6. Only after gateway acceptance, configure Netlify server-only variables: `WAHA_BASE_URL=https://<the-provider-hostname>`, `WAHA_ALLOWED_HOST=<the-exact-provider-hostname>`, `WAHA_API_KEY=<same-secret>`, `WAHA_SESSION=default`. **Keep `WAHA_SENDING_ENABLED=false`** throughout integration checks.
7. Use a controlled authorized recipient to check **one** supplier PNG+caption, followed by an approved PO and exactly one owner-private audit-group copy each. Inspect WhatsApp chats, not just API response status. Unknown responses are never retried automatically.
8. Only after the complete acceptance gate and a manually approved pinned Netlify release should sending and any unattended queue processing be enabled. Do not bulk-send old `needs_action` jobs without reviewing previous unknown/accepted attempts.

## Verified documentation

- [WAHA storage and PostgreSQL privileges](https://waha.devlike.pro/docs/how-to/storages/)
- [WAHA GOWS engine](https://waha.devlike.pro/docs/engines/gows/)
- [WAHA API configuration](https://waha.devlike.pro/docs/how-to/config/)
- [Hostless free shared allowance](https://docs.hostless.cloud/plans/limits)
- [Hostless managed database](https://docs.hostless.cloud/databases/create)
- [Hostless Docker app settings](https://docs.hostless.cloud/app/configurations)

**Blocking acceptance facts:** Hostless account not provisioned; database `CREATEDB` not proven; service/GOWS stability and free cost not proven; WhatsApp not paired, recipient delivery not verified. 
