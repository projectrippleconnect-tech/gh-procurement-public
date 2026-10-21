# Isolated native PostgreSQL verification

The runner tests real overlapping PostgreSQL sessions without contacting Supabase,
Railway, WhatsApp, or any cloud API. It is opt-in and does not run during installation,
build, normal unit tests, or application startup. It requires a **new disposable local
PostgreSQL cluster**, not an existing developer or production database. Do not tunnel a
hosted database to localhost for this test.

On a development machine with Docker and Node 24, from the repository root:

```sh
# Local test credentials only. The port is bound exclusively to loopback.
docker run --name gh-portal-qa --rm -d \
  -e POSTGRES_PASSWORD=local-portal-qa-only \
  -e POSTGRES_DB=gh_portal_qa_concurrency \
  -p 127.0.0.1:55432:5432 postgres:17
# Wait until PostgreSQL reports ready before continuing.
docker exec gh-portal-qa pg_isready -U postgres -d gh_portal_qa_concurrency
npm ci --ignore-scripts
GH_PORTAL_QA_ALLOW_BOOTSTRAP=1 \
GH_PORTAL_QA_DATABASE_URL=postgres://postgres:local-portal-qa-only@127.0.0.1:55432/gh_portal_qa_concurrency \
  npm run test:portal:concurrency
# Remove only the disposable container after collecting the result.
docker stop gh-portal-qa
```

The runner refuses hosted URLs, URL options, ordinary database names, existing public
objects, additional schemas and existing Supabase roles. It never falls back to
`DATABASE_URL` or application credentials. It creates synthetic roles, schema definitions,
reference permissions, and fixtures in that empty database. Failed setup leaves that
container for inspection; recreate it before retrying. No database is dropped or truncated
by the runner. The only new dependency is the development-only `pg` client.

The schema bootstrap is shared with the existing PGlite regression runner and verifies
historic migration hashes before loading anything. Its fixture is exercised by the normal
SQL regression suite. The native test entry point has syntax and connection-guard tests;
its actual concurrent scenarios must still be executed on a machine with native PostgreSQL.

Scenarios:

- Two supplier saves at the same revision: one winner and one SQLSTATE 40001.
- Submit blocked on an RFQ lock: deadline is checked again after the lock is acquired.
- Two workers on the same closed round: identical persisted result, one PO and award.
- Existing requirement reservation versus automatic processing: only the balance is ordered.
- Two different RFQs at the same daily limit: one succeeds and the other rolls back.
- Two dispatch claims: one persistent send reservation, including after commit.
- Recipient changed after verification: dispatch blocked without a send-ledger entry.

Lock waits are observed through `pg_stat_activity`, rather than assuming a sleep created
an overlap. Each client owns its own transaction. A 15-second statement timeout bounds
lock failures. Results are written to `test-results/portal-native-concurrency.json`.

This verifies PostgreSQL behavior only. A separate isolated Supabase/PostgREST pilot must
still verify request JWT/role mapping, anonymous RPC access, RLS, schema-cache reload,
image payloads and browser round trips. Actual gateway delivery also requires a specifically
authorized test recipient. This runner never sends any message and never enables purchasing.
