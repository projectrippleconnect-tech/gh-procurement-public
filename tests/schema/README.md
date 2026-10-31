# Full database regression fixture

`npm run test:database` starts a fresh in-memory PostgreSQL database, loads the captured production definitions and applies every migration file added after the baseline. It never accepts a production connection URL. Each scenario rolls back; the runner checks that all fixture table row counts return to their seeded values.

The baseline contains 60 procurement tables, the schema of the shared `app_users` bridge, 192 function definitions, 13 views, constraints, triggers, policies, grants and the seven standard role configurations. It contains no business rows, real account records, tokens, passwords or WhatsApp credentials. Supabase `auth.users` and request-claim functions have a minimal synthetic adapter; external Auth, Storage, Google Sheets and WhatsApp services are not simulated as successfully delivered integrations.

`procurement-baseline-meta.json` identifies the source release and checksums the snapshot and historic migration files. Changing an already-captured migration fails the test; add a new migration instead. To refresh the baseline, use the read-only catalog queries in `export-queries.json` and page `pg_get_functiondef` over procurement functions in `public` and `private`. Review the export for schema-only contents, preserve view options and identity columns, then regenerate the metadata from the matching source release. Actual business records must never be added to the baseline.

The separate PostgreSQL 17 CI job additionally runs genuinely concurrent different-token recounts. Browser tests use intercepted fixture APIs and real browser rendering/export logic. Neither proves delivery to a supplier's physical phone.
