# GH Procurement — current WAHA GOWS gateway recovery (2026-11-02)

**A Hostless service already exists at `https://gh-procurement-waha.hostless.app`.** The `default` WhatsApp session was previously linked, and a separate `gh-waha-sessions` PostgreSQL resource was configured. Hostless has since reported repeated OOM, CPU, and database-storage alerts. **The connection is not verified stable or currently WORKING.** No supplier sending should be enabled.

This repository directory is a **proposed configuration**, not a direct representation of the live settings. Updating it or merging a PR does not prove that Hostless deployed it. Never create another service or change the existing session namespace or PostgreSQL connection as part of recovery.

## Recovery patch (not yet deployed)

- Hostless documented ingress requirement: WAHA must listen on `0.0.0.0` at the configured port. The previous Dockerfile did not explicitly set `WHATSAPP_API_HOSTNAME`, and from GitHub's network, `/ping`, `/health`, and `/api/sessions/default` all returned **HTTP 404** on the existing Hostless domain. An upstream WAHA source review confirmed `WHATSAPP_API_HOSTNAME` does not control the socket bind in the current main entrypoint, so that override has been removed. This patch does not fix the 404 route until Hostless corrects the active release or routing. **Routing as the actual cause is a hypothesis, not confirmed**, until a fresh live deployment is verified.
- Single GOWS worker, one replica, `0.2 vCPU` maximum.
- Proposed app ceiling: `512 MB`, up from the checked-in previous `384 MB`. Keep the existing PostgreSQL service and its data. **Before applying this limit, confirm the exact current Hostless free entitlement and running resource allocation for this account.** Shared free plan documentation includes `0.5 vCPU / 1 GiB RAM / 512 MiB database storage`, but older accounts and billing cycles can have different limits. Do not incur charges, add a card, enable paid resources, or upgrade.
- Set `WHATSAPP_RESTART_ALL_SESSIONS=False`, `WHATSAPP_START_SESSION=default` so restarting the container does not revive unrelated stored STOPPED sessions. These variables must not be used to destroy or re-pair the existing authorized device.
- Keep `WHATSAPP_SESSIONS_POSTGRESQL_URL` and `WAHA_API_KEY` server-only; keep Swagger and dashboard disabled.
- **Do not enable `WAHA_SENDING_ENABLED`, `GH_AUTO_DISPATCH_ENABLED`, portal processing, or supplier sends.** A `200` API acceptance is not delivery proof.

## Before live rollout

1. Confirm zero-cost eligibility for the existing app and database together from the Hostless account Usage/Billing screen or a written support reply. If it cannot be proven, do not change the memory limit.
2. Inspect the app's actual live environment and log memory/CPU cause, current `default` session count and status, and `gh-waha-sessions` storage. Keep database snapshots/backups in a free, authorized location; **never truncate, reset, or delete WhatsApp session databases**.
3. Confirm the existing Hostless app is attached to this exact directory/branch and that a deployment would modify **only** the existing app; no additional services, secret rotation or automatic supplier sends. If the Hostless settings differ from these source files, reconcile the changes rather than assuming a merge automatically fixes production.
4. Deploy the verified change to **one** existing Hostless replica only after all prerequisites pass. Check app startup, memory, session `WORKING`, persistence across a controlled restart, and at least 24 hours of stable provider alerts.
5. Check Netlify's administrator-only `/whatsapp-connection-check` on a verified release when Netlify production deployment is allowed. **Do not copy protected WAHA secrets through CLI or into GitHub.** Verify authentication from the server runtime, not a masked CLI value.
6. With an authorized test recipient and owner-only audit group, verify actual RFQ and approved PO PNG + caption delivery, message IDs, no duplicate sends on unknown attempts, and audit receipt. Only after these acceptance checks, decide whether to enable the unattended dispatch gate for newly created jobs. Do not mass-retry the 11 historical `needs_action` jobs.

### Why not force history synchronization changes?

WAHA documents experimental GOWS history-sync limits, but applying some flags may require WhatsApp re-pairing. They are **not** part of this safe recovery patch. Evaluate only if the memory/storage fault persists and the owner explicitly authorizes a controlled re-pair.

Documentation: [WAHA configuration](https://waha.devlike.pro/docs/how-to/config/), [WAHA storages](https://waha.devlike.pro/docs/how-to/storages/), [Hostless free entitlement](https://docs.hostless.cloud/plans/limits), [Hostless legacy-vs-shared tier](https://docs.hostless.cloud/plans/free-tier).
