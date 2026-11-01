# Requirements completion — stage 1

Scope: supplier-form simplification, compact phone rows, essential EN/TA controls and GEN document branding. Prepared against the current performance release. Production publication remains part of the final release stage; this change does not enable supplier sending, automatic approval or purchasing, issue OTPs or change category routes.

## Result

- Supplier rows keep description/size, requested UOM/quantity, available quantity and rate. Photos, remarks and up to four alternatives remain expandable. Supplier actions span the row rather than stacking in the narrow description column.
- Removed common delivery/validity controls and the optional discount/tax/freight/MOQ/order-multiple/delivery section. Final confirmation requires valid prices/availability or explicit no-stock responses, not hidden delivery fields.
- Confirmation explicitly covers price and availability only. The payload retains previous commercial values in response/history but sets `terms_confirmed=false` and records the scope. Staff response review and imported line notes identify the outstanding commercial review. Existing SQL excludes unconfirmed terms from unattended allocation; no hidden default is treated as supplier-confirmed. The later automation stage must complete the commercial-review handoff before claiming fully unattended purchasing.
- Draft save, final confirmation, image compression, alternative details, link deadlines/revocation, stale revision guards and official-price synchronization remain.
- Work actions and history share a compact row. Supplier-link records use simple divided rows. Focused supplier price/quantity entry hides nonessential summary/header content on phone-sized screens, without a fixed overlay.
- Added persistent EN/TA switching to the supplier form, translated essential supplier validation/confirmation labels and Work/navigation/stock-review/receiving/approval controls. Business descriptions, internal statuses, permissions and record IDs are not translated or changed. Advanced administration and every server error are outside this essential-label pass.
- New document branding helper defaults the original General Hardware header to GEN without changing the stored business name. RFQ text/PNG, PDF headers, supplier PO images and company route templates use the revised branding. Existing genuinely custom headers remain available. Admin Company & Security now exposes a separate Document header setting; document-template overrides remain editable. Historical stored business records are untouched.

## Validation

- 516 unit/integration tests pass locally, including a real isolated anonymous supplier submission that synchronizes rates with null/unconfirmed commercial terms, legacy-value preservation, branding, Tamil controls and rendered receiving acceptance.
- TypeScript, changed JSX parsing and production build pass. No production database migration is required.
- Supplier browser scenarios now confirm without delivery/charge fields, assert unconfirmed commercial scope, preserve images/drafts/stale-conflict behavior, and exercise English/Tamil at 320, 360, 390, 768 and 1280 pixels.
- Local browser installation failed because the downloaded archive was invalid. The branch's existing hosted quality gate runs the updated supplier browser cases and all Work/Receiving/stock/directory/access/performance regressions. Its checks are the authoritative browser acceptance result; do not infer a completed hosted run from this local checkpoint.

## Remaining stages

Category-route corrections, supplier OTP/permanent portal, device notification activation, WhatsApp/audit delivery, unattended purchasing and full remaining-gap acceptance remain separate from stage 1. No live supplier contact or purchasing test is included here.
