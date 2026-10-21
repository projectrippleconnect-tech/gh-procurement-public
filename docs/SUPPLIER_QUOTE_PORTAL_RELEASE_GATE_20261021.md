# Supplier Quote Portal — release gate

Branch: `feature/supplier-quote-portal-20261021`.

The intake, confirmed Prices synchronization, six-hour landed-cost allocation, guarded
supplier-wise pending POs, 24-hour residual round, Company separation, approval-bound
outbox and delivery reconciliation are implemented. Production remains unchanged and
background processing/dispatch are disabled by default.

**Release gate: HOLD.** Local unit, database, type, build and HTTP checks passed. Real mobile
browser checks, cross-session PostgreSQL races and an approved Supabase/PostgREST plus
WhatsApp test-supplier pilot remain required. Do not deploy, migrate production or activate
live purchasing without explicit approval.

See [the complete production-readiness report](SUPPLIER_PORTAL_PRODUCTION_READINESS_20261021.md)
for behavior, evidence, limits, environment gates and the controlled manual-release procedure.
