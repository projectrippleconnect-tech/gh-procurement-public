# GH Procurement — manual Netlify release

Date: 22 October 2026 (Sri Lanka)
Source branch: `feature/supplier-quote-portal-20261021`
Source base: `113e0c3b7339d31d65c5433b4d9fbe1c8ca9e168`
Site: `gh-procurement` (`b36357ec-4dda-4373-a3d7-95f9c8f3ad9e`)
URL: https://gh-procurement.netlify.app

## Scope

This is a controlled alternative-host review release, not certification of the new
supplier portal against the production database. The existing Railway deployment
remains available and unchanged. Both hosts use the existing GH NEXUS database;
no database or records were copied, reset or migrated during hosting preparation.

The authorized account was confirmed as **Free**, with no payment method, 300 included
credits, zero credits used at the pre-deployment check, and overage accumulation
disabled. The site was created without a Git repository or CI hooks, so source pushes
do not deploy it. Free usage is capped; exhausting credits can pause the site.

The pinned Next.js adapter is `@netlify/plugin-nextjs` 5.16.4. Next.js remains 16.3.8
and Node remains 24. The Netlify build generated the server-function ZIP and middleware
edge bundle. A Deno dependency fetch for edge-function configuration types reported a
connection-refused warning; the build exited successfully and produced both artifacts.
Hosted response checks remain necessary to verify nonce middleware actually runs.

Only the existing browser-safe Supabase URL/key, release label and disabled automation
flags were supplied. No service-role key, gateway credential or Google Sheets server
credential was copied. `GH_PORTAL_SCHEDULER_MODE=database` suppresses the web purchasing
timer. Processing, dispatch, verified delivery and WAHA sending default to false.

## Manual procedure

1. Use Node 24, run `npm ci --ignore-scripts` and the appropriate regression checks.
2. Authenticate the Netlify CLI to the existing free account and link this existing
   site; do not create a new site for each release or link repository CI.
3. Supply the approved environment privately. Never commit environment files.
4. Run `netlify build --offline` locally, then `netlify deploy --no-build --prod`.
   A local build does not upload the app; inspect the deploy result before announcing it.
5. Run `GH_PRODUCTION_URL=https://gh-procurement.netlify.app node scripts/check-production.mjs`.
   Check the portal's no-store/no-referrer/noindex headers and unauthenticated worker
   rejection as well. The health endpoint recognizes Netlify's COMMIT_REF, with an
   explicit GH_MANUAL_RELEASE_REV taking precedence.

## Remaining functional release gates

- Verify a current restorable database backup before applying the four pending
  portal/conflict/scheduler migrations. The connected SQL tool does not supply a
  full database export; no backup was fabricated from catalog checks.
- Apply only the reviewed migration files in order, then perform hosted API and role
  checks. Keep the database scheduler control disabled and install the cron job inactive.
- Native PostgreSQL 17.11 regression, concurrency and actual pg_cron 1.6.4 replay now
  pass, including duplicate prevention, approval gates, disabled defaults and stop switch.
  Evidence: `verification/supplier-portal-native-scheduler-20261022.json`.
- Reconnect Google Sheets and WhatsApp server integrations securely before claiming
  feature parity. Railway private gateway DNS is not reachable from Netlify. Do not
  weaken the gateway allowlist or expose it publicly to make automatic dispatch work.
- A verified test recipient and actual WhatsApp delivered-message evidence remain
  necessary before dispatch activation. No supplier message was sent during this work.

References checked on 22 October 2026:
- https://www.netlify.com/pricing/
- https://www.netlify.com/blog/introducing-netlify-free-plan/
- https://www.netlify.com/pricing/personal-vs-free/
- https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/
