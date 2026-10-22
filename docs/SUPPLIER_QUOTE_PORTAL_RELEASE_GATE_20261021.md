# Supplier Quote Portal — release gate

Updated: 22 October 2026. Branch: feature/supplier-quote-portal-20261021.

**Release candidate ready for controlled manual rollout review. Production purchasing and
dispatch activation remain on HOLD.** Development verification passed: 451 unit/contract
tests, 22 SQL suites in both isolated engines, eight native concurrency scenarios, eight
actual API/browser/gateway-simulator scenarios, mobile layouts, types, build and HTTP smoke.

Actual PostgREST 14 testing exposed a stale-revision retry loop. Business conflicts now use
HTTP 409, including affected staff Prices and Company directory entry points. Dedicated
supplier and worker requests have bounded timeouts. Historic migrations and business records
are preserved.

Production still requires explicit migration/manual deployment approval, hosted post-migration
smoke checks with automation disabled, and an authorized real gateway recipient before live
purchasing or dispatch activation. The local simulator does not certify WhatsApp delivery.

See [the production-readiness report](SUPPLIER_PORTAL_PRODUCTION_READINESS_20261021.md)
for evidence, pending migration order, limitations and activation gates.
