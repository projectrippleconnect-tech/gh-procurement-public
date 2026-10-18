# Company supplier routing — micro-level rectification (18 Oct 2026)

## 1. Root cause

Company Workflow Checklist previously reused one `ids` list for both `p_assigned_ids` and `p_recipient_ids` in `proc_company_save_supplier_setup`. A contact list of Supplier 1 / Supplier 2 / Supplier 3 could be reduced to the single PO recipient when the workflow was saved. The database also rejected automatic Direct PO when the broader assigned list had more than one contact.

## 2. Correction

- Split **Assigned** contacts from **Send** recipients. Assigned means selectable for future requests; Send means an intended actual RFQ/PO destination.
- Direct PO: preserve 1–15 assigned contacts but require exactly one selected recipient. RFQ: allow several recipients, all drawn from assigned contacts. Manual: no automatic dispatch.
- Saving a parent workflow carries designated child supplier pools and existing child-specific recipient overrides. It must not replace child assignments with parent recipients.
- Readback checks both lists and prevents silent loss. A conflict remains a visible failed/skipped setting, not an implicit supplier replacement.
- Existing company directory edits remain scoped to that company. If an edited number was routed before, the interface offers a button to open RFQ/PO workflow settings for deliberate reassignment.
- Legacy company-wide fallback automation is placed under a separate collapsed panel. It remains active only where no explicit company/category route exists.
- The server change only relaxes an over-restrictive Direct PO assigned-count guard, retaining the exactly-one-recipient, recipient-subset, company/admin permission, WhatsApp number, optimistic concurrency, and advisory-lock checks.

## 3. No data destruction

No supplier, contact, group route, quotation, purchase order or historical document is deleted or merged by these changes. The server migration is `CREATE OR REPLACE FUNCTION` only and does not migrate any row data.

## 4. Verification

- Updated supplier-plan tests and workflow checklist tests.
- Added targeted tests for 3 assigned contacts / 1 PO recipient, preserving child override contacts, mapping stored recipient separately, no WhatsApp API call during settings save, and retained SQL security constraints.
- Production gate: npm audit, lint, tests and Next production build; Railway /api/health; database migration must be applied before new multi-contact automatic PO saves are expected to succeed.
