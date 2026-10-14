# Company Items integration

Company Items is a tab in Stock Entry and remains available through Company Lists. Counts share the normal stock history, requirements, orders and receiving tables.

## Stock and catalog

- Company maximum stock is separate from the Item Master target. Reorder is always exactly 50% of company maximum; fractional thresholds are retained.
- A blank source maximum becomes `max_stock_review`, never an assumed zero. An administrator enters its maximum before it can create a shortage.
- Sufficient Stock is a visual check: no invented quantity, balance update or stock-ledger transaction.
- Size, colour, variation, brand, category, subgroup, movement and remarks are editable. Group moves retain item IDs and transaction references.
- Company stock tables fit the viewport without horizontal scrolling. Item names and enabled optional fields wrap within the description column; current quantity and sufficient-stock inputs remain visible. The calculated Order column is omitted from stock entry; procurement still computes shortages on submission. Admin editing and removal expand within each item row. Optional fields are configured per company.
- The existing stock PDF dialog supports company categories, subcategories, individual selections and FAST/NORMAL/SLOW filters. Footer fields remain Stocks Checked By, Stocks Verified By, Order Approved By and Date.

## Company suppliers and ordering

Company contacts are a separate supplier type. A default contact is assigned to the company; brand overrides can route individual brands to different contacts. Contacts must use +94 numbers.

The normal quotation route remains unchanged. The direct route skips quotations, creates quantity-only purchase orders and either waits for admin approval or uses the explicit company auto-approve setting. POs are grouped by company supplier. Repeated approval locks the remaining requirement quantity, preventing duplicate ordering. Automation is audited under the active administrator who enabled it; staff stock-count identity remains on the submission and is restored after the scoped automation operation.

Approved company orders are persisted to a dispatch queue when auto-send is enabled. The stock submission API processes newly created orders on the server. Manual approval through Review likewise invokes dispatch. WhatsApp receives a generated PDF; no price or misleading zero total is shown. Explicitly selected supplier-facing price-list/order files follow the PO, with their discount/remarks captions. Unselected company documents are not sent.

A dispatch is claimed before contacting WAHA. Definite failures may be retried through Company settings. Interrupted, uncertain or partially completed multi-file sends remain `unknown`; do not automatically resend them. Gateway acceptance updates the order to `sent` for the existing receiving workflow, but does not claim recipient delivery or reading. Pending/failed jobs can be processed with the Company settings action; this release does not install an independent scheduled worker.

## Attachments

Procurement or company managers can attach PDFs, JPEGs, PNGs or WebP files up to 10 MB, link them to a company, contact, quotation, item or PO, and record percentage/fixed discounts and remarks. A linked attachment is checked against its company/item/supplier. Storage is private. Stock handlers may read only explicitly selected supplier documents during their own automatic dispatch.

## Google Sheets connection

The application connection is separate from ChatGPT's Google Drive connection. Configure server-only Railway variables:

- `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON`: credentials for a dedicated service account, kept out of the repository and client bundle.
- `COMPANY_ITEMS_SPREADSHEET_ID`: the existing Company Items workbook ID.

Enable the Google Sheets API and share only the intended workbook with the service account as Editor. No domain-wide delegation is needed.

Import new tabs and rows through Company settings. Sheet IDs plus semantic source item IDs prevent repeat-import duplication. Explicit zero maxima remain zero; blank matrix entries remain for review. Fevicol Rain Coat colour continuations inherit the maximum for each colour independently. Wire columns become brand subcategories. Original wording is preserved; optional unit/variation fields remain admin editable.

Existing app edits are retained by incremental imports; changed existing source rows are not silently overwritten. New app companies publish their own normalized tab when the connection is configured. Publishing a company imported from a handwritten matrix creates a separate app-managed tab instead of replacing that original layout. Publishing app-managed tabs updates them in place. The sheet is a catalog source/export, not a live stock-balance store.

## Release and verification

Apply the additive Company Items migration together with the source release. Import the current workbook using the configured connection or an authorized connector-generated payload; never commit source business rows, supplier contacts or credentials to this public repository. The migration keeps Super Admin delete previews and reset scopes aware of the new linked records.

Checks:

- `npm run lint`, `npm test`, `npm audit --audit-level=high`, `npm run build`
- `GH_UI_COMPANY_ITEMS=1 npm run test:ui`
- Prepend the new migration to `tests/sql/company-items.sql` inside a transaction and roll back. The integration suite exercises real authenticated roles, stock checks, approval, group moves, repeat imports and duplicate dispatch prevention without contacting suppliers.

Keep automatic Railway deployments disabled and retain the current commit pin. Deploy only on explicit command. Live Google Sheets sync and WhatsApp recipient delivery require configured runtime credentials and separate live verification.
