# Company and category stock automation

Select Company Lists → company → Company / category contacts & automatic RFQ / PO. Configure the entire-company default or override a category/subcategory. Add/select suppliers by business name, optional contact person and +94 WhatsApp number.

- RFQ: one or several suppliers. Optional automatic creation and sending after a stock handler submits a count. This requests prices; it does not award or order anything.
- PO: exactly one supplier. Optional automatic approval, creation and sending of quantity-only orders after submission.
- Both are opt-in. Existing routes retain their settings. Saving the configuration alone sends nothing.
- Child category settings override the nearest parent, then the entire-company route. Unconfigured companies retain their legacy routing.

Outgoing image and WhatsApp message settings are stored on each route, shared across devices, and snapshotted for prepared automatic documents. Business heading, document title, instructions, caption, row numbers, UOM, blank unit-rate column and item remarks are configurable. Description and quantity remain required. Quantity-only orders never invent prices.

Stock submission runs server-side automation using only requirements from that submitted count. Automatic RFQ dispatch explicitly filters to RFQ IDs returned by this stock submission, so previously pending or failed RFQs cannot be sent incidentally by a new stock count. The separate intentional queue-processing action can still process older pending RFQs. A submission UUID prevents repeat requests from creating another count or documents. A changed payload with an already-used UUID is rejected rather than silently discarded. Admin permission is checked when configuring automation; stock operators can send only queued documents authorized by those saved routes. RFQs use an active admin's permissions within a bounded transaction and restore the original caller afterward.

WhatsApp must be enabled and linked. Offline messages remain queued. Use Company settings → Automatic RFQ / PO sending to inspect and process queued images. Accepted means gateway acceptance. Interrupted/unknown attempts remain held for review; existing RFQ attempts are never retried automatically. Route/recipient and current RFQ quantities are revalidated before the send claim. Manual sending shares the RFQ dispatch uniqueness guard with automatic sending.

Deployment dependency: apply `20261016020752_company_stock_auto_rfq_templates.sql` before releasing the matching web code. No existing routes, contacts or stock quantities are rewritten by the migration. Validate with `tests/sql/company-stock-auto-rfq-isolated.sql` in a disposable PostgreSQL database, alongside the normal Node and browser suites.
