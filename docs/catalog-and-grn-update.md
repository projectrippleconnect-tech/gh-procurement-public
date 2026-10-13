# Catalog and goods-receipt update

- Admin-only supplier deletion requires its supplier code and rejects every foreign-key reference, including cascading references. Existing item deletion retains its stock/history guard. Deactivation remains available for referenced suppliers and items.
- Quick Add Item is available in Item Master, Stock Entry and Company Lists. Category, size and UOM are visible; brand, category groups, subcategory, movement and maximum stock expand on demand. The server checks item permissions, serializes duplicate requests and returns an existing matching item.
- GRN/delivery-note OCR accepts photos and PDFs. Suggestions remain unselected; every selected row needs a PO item and a positive received quantity. Duplicate PO-row mappings are rejected. Applying rows requires confirmation and resets their accepted/rejected draft quantities for inspection. Stock changes only through the existing confirmed GRN posting operation.
- Company-list OCR accepts plain item lists and price lists, with editable rows and optional selection. Categories/subcategories can be applied to selected draft rows. Admin imports link selected items to the chosen company list; procurement imports create/check Item Master records. Existing OCR price-list review remains available.
- Company Lists now filter/search by item category, subcategory, brand and category groups. Quick-add returns to the list picker. Re-adding a removed list item restores it. Removing a company list requires confirmation and retains price lists and count history.

Validation: 107 JavaScript/contract tests, TypeScript, production build, dependency audit (zero vulnerabilities), and isolated PostgreSQL tests for permission checks, duplicate handling and history-safe deletion. Browser checks run through the repository's GitHub workflow; no authenticated production records are changed during verification.

Release: deployment remains manual. Apply `20261013010350_procurement_catalog_management.sql` with the next explicitly authorized deployment, before serving the updated client.
