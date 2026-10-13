# Shelf stock entry

The Stock Entry search filters the actual entry rows by every search word, including name and size. A nonempty search loads all accessible active items across categories, movement groups and cycle-count dates. Results are paginated without a 30-result search cap. Clearing search restores the previous stock filters. Draft quantities and visual checks persist across searches.

Tick **Sufficient stock** only after visually checking that stock is above the reorder level. The checkbox replaces the draft quantity and disables quantity entry until unticked. Submission stores a visual status and a null quantity; it does not alter balances or create inventory transactions. It resolves an existing stock-count shortage using the existing recount rules while preserving quantities already ordered or received. History displays the status rather than a zero count.

Release order: apply `20261013081914_stock_sufficient_status.sql`, verify `tests/sql/stock-sufficient.sql` in a transaction, then deploy the web build. The migration preserves installed permission and access guards. Automatic deployments remain disabled.

Validation: `npm test`, `npm run lint`, `npm run build`, and `GH_UI_STOCK_SHELF=1 npm run test:ui`. Browser fixtures intercept all Supabase requests and never change production records.
