# Isolated native PostgreSQL verification

The runner first runs all 22 SQL regression suites, checks fixture rollback, and then tests real overlapping PostgreSQL sessions without contacting Supabase,
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
the complete native regression and concurrency scenarios passed on PostgreSQL 17.11 in an isolated software VM on 22 October 2026.

Scenarios:

- Two supplier saves at the same revision: one winner and one SQLSTATE PT409 / HTTP 409.
- Submit blocked on an RFQ lock: deadline is checked again after the lock is acquired.
- Two workers on the same closed round: identical persisted result, one PO and award.
- Existing requirement reservation versus automatic processing: only the balance is ordered.
- Manual award finalization versus automatic ordering, with both paths winning once.
- Two different RFQs at the same daily limit: one succeeds and the other rolls back.
- Two dispatch claims: one persistent send reservation, including after commit.
- Recipient changed after verification: dispatch blocked without a send-ledger entry.

Lock waits are observed through `pg_stat_activity`, rather than assuming a sleep created
an overlap. Each client owns its own transaction. A 15-second statement timeout bounds
lock failures. Results are written to `test-results/portal-native-concurrency.json`.

## Real PostgREST / SDK / browser verification

Keep the disposable database after the native run. Run PostgREST 14.18 locally with this
configuration, using the test-only credentials shown below. These values must never be used
for an application deployment. The API runner creates the limited login role, grants only
its synthetic API roles, and waits for PostgREST to connect and load its schema cache.

```toml
db-uri = "postgres://qa_authenticator:qa-local-only-20261022@127.0.0.1:55432/gh_portal_qa_concurrency"
db-schemas = "public"
db-anon-role = "anon"
db-extra-search-path = "public, extensions"
jwt-secret = "gh-portal-isolated-postgrest-test-secret-20261022"
server-host = "127.0.0.1"
server-port = 55301
db-pool = 6
```

```sh
# In a second terminal: postgrest /path/to/qa-only-postgrest.conf
# API test from the repository root after the production build:
npm run build
GH_PORTAL_QA_ALLOW_BOOTSTRAP=1 \
GH_PORTAL_QA_DATABASE_URL=postgres://postgres:local-portal-qa-only@127.0.0.1:55432/gh_portal_qa_concurrency \
GH_PORTAL_QA_BROWSER_EXECUTABLE=/path/to/chromium \
  node scripts/qa/portal-postgrest.mjs
```

If no explicit browser path is supplied, /tmp/chromium is used when present. The API checks
run without a browser otherwise; absence of the browser scenario must not be reported as a
browser pass. The script requires the disposable fixture marker and accepts only loopback
PostgREST URLs. It starts a loopback API-prefix proxy and a fake WAHA gateway. It performs
real SQL-backed SDK calls, including conflicting Prices and Company contact edits, and
uses the actual worker and PNG renderer. The optional browser loads the actual production
page; its Supabase requests are forwarded to local PostgREST with a QA JWT. Response data
comes from the real database. No production API call or supplier message is allowed through.

Outputs: test-results/native-full-database.json, portal-native-concurrency.json and
portal-postgrest.json. The verified runtime was PostgreSQL 17.11 / PostgREST 14.18 / SDK
2.117.2. Eight native concurrency and eight API/browser scenarios passed. A local software
VM can replace Docker; keep QEMU, PostgreSQL and the runner in one execution namespace if
the host isolates loopback networking per command.

Actual hosted Supabase post-migration configuration and WhatsApp delivery still require the
controlled release checks and an explicitly authorized recipient. Local simulation never
activates production purchasing or proves a real delivered message.
