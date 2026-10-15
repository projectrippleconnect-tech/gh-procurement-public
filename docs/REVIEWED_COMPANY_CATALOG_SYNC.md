# GH Procurement: reviewed company catalogue synchronization

Status: STAGED ONLY. No production deployment or live item-master updates.

## Safety
- Reuses the signed-in Super Admin bearer token and company_lists.manage permission.
- First matches exact original source keys to existing item IDs. A separate fallback for simple company lists verifies unchanged item ordering, maximum stock, brand, colour and name overlap; the Super Admin must explicitly acknowledge all verified-legacy matches.
- Holds ambiguous identities and lists with changed ordering for manual review; no new stock records or deactivations.
- Applies up to 25 reviewed existing item descriptions and category labels at a time, guarded by a preview fingerprint.
- Does not update maximum stock, reorder level, source keys, ledger, stock-count history, or purchase history.
- Existing audit triggers and row-level security remain enabled.
- Parses only original stock columns; sidecar naming and category columns are read only.

## Railway connection required
The current Railway production service has neither GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON nor COMPANY_ITEMS_SPREADSHEET_ID.
Supply a legitimately authorized Google service account for the original COMPANY ITEMS workbook and set both variables securely on the service. Do not put secrets in GitHub or chat.

## Safe release sequence
1. Validate all branch tests and build.
2. Obtain explicit approval before deployment.
3. In Company Settings, use Preview reviewed catalogue for one company.
4. Review names, categories, unmatched IDs, and any supervised legacy-key matches. The original source key is never overwritten.
5. A logged-in Super Admin acknowledges verified legacy matches separately, applies at most 25 updates per click, then previews again.
6. Verify original stock totals, link IDs, item IDs, and transaction/audit history did not change.

## Boundaries
The legacy Import new tabs and items action is not a substitute for reconciliation of renamed items.
MODULAR labels and other nested section hierarchies still need a separate authorized section-tree sync.
No production records were changed from ChatGPT, because database item updates require a genuine signed-in admin identity and Railway is missing its Google service account connection.

## Sheet-side validation
All 648 populated stock cells across the 19 reviewed tabs were checked against their corresponding reviewed name columns (648 matched). This does not itself validate database item-ID correspondence; the administrator preview does that.
