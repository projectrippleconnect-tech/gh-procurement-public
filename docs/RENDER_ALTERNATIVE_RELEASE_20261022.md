# GH Procurement — alternative Render release request

Status: prepared; not created or deployed.
Date: 22 October 2026 (Sri Lanka)
Source branch: feature/supplier-quote-portal-20261021
Verified implementation commit: 4a7fcc7523fa6053983f6faaf0b4361c0ee6be30

## Proposed service

- Name: gh-procurement-portal-review
- Source: https://github.com/projectrippleconnect-tech/gh-procurement-public
- Branch: feature/supplier-quote-portal-20261021
- Runtime: Node.js 24
- Region: Singapore
- Compute plan: free
- Automatic deployment: disabled
- Build: npm ci --ignore-scripts --no-audit --no-fund && npm run build
- Start: npm start -- --hostname 0.0.0.0 --port $PORT
- Database: existing GH NEXUS Supabase project; no new database or datastore
- Proposed workspace: Project's workspace (tea-db2ci0h7lnhs73effd80)
- Workspace confirmation: required by the connected Render tool before scoped operations

## Environment

Copy only the two existing browser-safe Supabase settings into this new service.
Set NODE_VERSION=24 and all of the following to false:
GH_PORTAL_PROCESSING_ENABLED, GH_PORTAL_DISPATCH_ENABLED,
GH_PORTAL_DELIVERY_VERIFIED, WAHA_SENDING_ENABLED.

Do not copy server secrets into this file or a public repository.
WhatsApp and Google Sheets server integrations cannot be certified until their
existing private configuration can be securely supplied to the alternate service.

## Limits and remaining gates

Render Free sleeps after 15 minutes without inbound traffic. Therefore it does
not provide an always-running six-hour/24-hour worker. Do not activate the
existing process-owned timer on this service or present this fallback as the
completed automatic purchasing system.

Free-service bandwidth/build overages can be billable if a payment method is
present. Verify workspace included usage and applicable spend controls before
creation; do not authorize an upgrade or paid overage to make the deployment work.

The production portal migrations are still pending. Before applying them, verify
a restorable backup, migration prerequisites and the safe release sequence.
The alternate service is a review deployment until hosted schema, roles,
mobile workflow and integrations are verified. A real WhatsApp pilot still
requires a verified test recipient and actual delivered-message evidence.

## Findings

- Render connection works; it exposes one workspace but none is selected.
- Railway connector requires reauthentication; its dashboard also displays an
  outage notice in the current browser session.
- Existing Vercel projects are connected to a Hobby team. Vercel's terms restrict
  Hobby to personal/non-commercial use, so this business release was not started there.
- No new hosting service, paid subscription, production migration or live
  purchasing/dispatch activation was performed while preparing this request.

References:
- https://render.com/docs/free
- https://vercel.com/docs/limits/fair-use-guidelines
