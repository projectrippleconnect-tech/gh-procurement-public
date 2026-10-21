# Supplier Quote Portal — GH Procurement (development branch)

## Current status — NOT DEPLOYED

Source branch: `feature/supplier-quote-portal-20261021` based on production's
`release/uppercase-items-on-live-20261019` at `d9fd03ef`.
Production Railway configuration and Supabase production database were **not changed**.
No WhatsApp message or purchase order was sent. Do not publish a supplier link until
the additive migration, regression tests and permission checks pass on an isolated test instance.

## Implemented, pending migration

1. **Staff workspace** at `/supplier-links` and a link in the current Prices/RFQs navigation.
   Staff can select a General RFQ and invited suppliers, issue random 256-bit private links,
   choose a 2/4/6/12/24/48-hour window, launch a prepared WhatsApp invitation,
   revoke links, review submissions, and explicitly import confirmed exact-match price lines.
2. **Mobile supplier form** at `/supplier/quote?token=...` with search, in-stock/no-stock answers,
   price, available quantity, notes, product photo, up to four separately priced alternatives
   with photos, Save Draft, final confirmation, and editable revisions until the deadline.
   Even when the requested size is out of stock, alternatives can be quoted.
3. **Additive Supabase migration** with hash-only bearer tokens, restricted anonymous RPCs,
   optimistic revision handling, server-enforced closing time, historical response summaries,
   atomically validated exact item scopes, confidential JSON response storage and staff-only
   import through existing `proc_save_quote_guarded_v1`.
4. **Security controls**: anonymous users have no direct read/write privileges on portal tables,
   nor access to purchase orders. Referrer policy prohibits leaking quote tokens; direct-entry
   data is revocable and not indexed by search engines. Images are compressed in-browser and
   capped per photo, with a 1.5 MB total per submission.

## Not yet implemented — DO NOT CLAIM FULL AUTOMATION

- Company Items RFQ routing and permanent supplier catalogue prices.
- Automatic import into `proc_quotes` immediately on supplier confirmation. Currently staff
  must press **Import confirmed prices** to preserve existing permission guards and prevent
  anonymous access to official purchasing records. A supplier can still confirm without staff present.
- Automatic job to close round 1, select eligible lowest **landed** cost (unit rate alone is
  insufficient), safely create and approve supplier-wise POs, and dispatch them.
- Automatic 24-hour **residual-only** follow-up round. This must track uncovered *quantities*,
  not merely missing products, handle partial availability and alternatives, and avoid
  overlap with any direct PO or concurrently placed order.
- A retry-safe messaging worker with receipt/unknown-state reconciliation, approved WhatsApp
  channel, and explicit purchase limits. The current app must never assume a generated WhatsApp
  deep link was sent.
- Signed private object storage for larger supplier images. The first implementation uses
  small compressed data URLs within restricted private quote data. Do not increase the limits
  until object storage policies are designed and verified.

## Required automated-buying protections

- Configurable maximum total, maximum per-PO, supplier restrictions, validity, branch and
  category allowlists; manual approval for abnormal prices or specs.
- Accept offers only with enough supplier quantity, appropriate UOM, valid expiry,
  confirmed delivery terms, MOQ, order multiple and landed cost.
- Make round-close and award idempotent, with unique persistent keys for round/RFQ/PO.
  Use `FOR UPDATE` or advisory locks on RFQ and requirements. An existing ordered or direct-PO
  allocation must always win; never order the same quantity twice.
- If no valid offer at six hours, create an unfulfilled queue, not an invented zero-price PO.
  Create a separate 24-hour invitation round only for uncovered quantities.
- Exact item matches can be ranked automatically; variations need equivalence approval.
- Keep old manual Prices, General Items and Company Items screens and records unchanged.

## Acceptance tests before deployment

1. Run `npm ci`, `npm run lint`, `npm test`, `npm run test:database`,
   `npm run build`, and mobile smoke checks in a free, isolated test environment.
   CI has not been run in this branch to avoid unapproved GitHub Actions spend.
2. Apply the migration in test and verify anonymous read rejects invalid/revoked tokens,
   cross-supplier IDs, huge photos, malformed numbers, item swaps, stale revisions,
   edits after expiry, and unauthorized import/revoke/issue calls.
3. Verify staff import against existing quote revision guard, and that alternatives do not
   masquerade as exact-stock items. Verify manual quote fallbacks are unchanged.
4. Test simultaneous mobile submissions and staff import/revocation, late messages,
   zero-available suppliers, partial availability, no-stock-only quotations and refunds/returns.
5. Inspect local Sri Lankan timestamps and exact round expiry server-side.
6. Approve backend migration, application deployment and live supplier test separately.
   Keep Railway manual deployment, preserve current Supabase data, and avoid paid products.

## Operations

- The migration filename is
  `supabase/migrations/20261021212000_supplier_quote_portal_intake.sql`.
- New backend functions are disabled in production until an explicit release.
- The Railway service currently deploys another release branch and watches the manual
  deploy trigger. Merely committing this feature branch does not put the portal online.
- No background scheduler or automatic message sender was started.
