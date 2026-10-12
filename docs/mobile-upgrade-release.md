# Mobile procurement upgrade

Source publication only. Production deployment requires an explicit Deploy instruction.

Prepare request → Choose prices → Send orders. Each focused task retains Back navigation, saved drafts and a reachable main action. The order progress bar uses saved RFQ invitations, quotation lines and associated POs. Goods receiving stays separate.

Before deploying this source, apply the additive `20261012110046_procurement_quote_conflict_guard.sql` migration. It provides an RLS-respecting atomic snapshot and a save operation that rejects stale quotations under the same RFQ row lock used by existing saves. The app fails closed if these functions are unavailable. No records are reset or deleted by this migration.

Commercial terms are collapsed by default and survive editing, supplier switches and draft restoration. Quote attachments already saved remain intact. File bytes selected locally must be reselected after refreshing the browser; browsers cannot persist a file input through ordinary localStorage.

Bulk PO sending is offered only within a selected order batch. All-orders browsing does not send unrelated orders. WhatsApp opening and gateway acceptance are not treated as verified delivery. Vercel Git deployment is disabled in `vercel.json`; the quality workflows validate source and never deploy it.

Tests use intercepted fixture responses and a disposable PostgreSQL database. They do not sign in to production, send real messages or alter business records.
