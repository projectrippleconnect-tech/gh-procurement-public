# GH Procurement — Company Supplier Setup Duplication Audit
Date: 2026-10-18
Scope: Company Lists > Setup; linked company routing, supplier directory, legacy company controls, and WhatsApp audit groups.
Baseline: live pinned commit `3f0e23cdcd3e6d693497ebcc5a4a562a8292a29f`.
Change branch: `codex/company-settings-dedupe-20261018`.

## Confirmed frontend duplication

1. **Three route editors:** `CompanyWorkflowDirectory`, `CompanyAutomationSimple`, and `CompanySectionRouteManager` all call `proc_company_save_supplier_setup` and expose overlapping RFQ/PO action and recipient settings. **Resolved presentation:** Removed the duplicate wizard from Company Lists; workflow checklist is the standard route editor; advanced group send/template exception tools remain in a nested section. No route/RPC/data deletion.
2. **Two contact-editing concepts:** `CompanyContactDirectory` edits scoped company directory labels and numbers using directory RPCs; `GroupSupplierContactEditor` changes actual `proc_suppliers` records for routing. They look similar but can affect different references. **Kept both** with distinct functions; no silent synchronization across routed suppliers because existing order recipients must not change.
3. **Company legacy fallback fields:** `CompanyControls` exposes `order_route`, `auto_approve`, `auto_send`, and brand-contact overrides. These overlap semantically with group-level route actions but apply only without explicit routes. **Kept and labelled legacy fallback.**
4. **Advanced manual dispatch and templates:** `CompanySectionRouteManager` also edits routes but adds image templates and manual approved-request sending. **Preserved** as advanced rather than a fifth top-level supplier panel.
5. **Global display controls:** `CompanyRowLayoutControls` is distinct from routing; **retained** as the fourth top-level section.
6. **WhatsApp audit groups:** `WhatsAppAuditGroups` reads audit group connection/verification; it does not perform supplier routing. **Retained** as the third top-level section.
7. **Automatic RFQ/PO queue controls:** `CompanyControls` has queued-work processing buttons, distinct from sending an approved individual request. **Retained** in company attachments/settings to avoid loss of recovery actions.
8. **Per-panel searches** intentionally have distinct contexts: company directory search, category/item search, workflow search and advanced supplier search. **Retained**, not data duplicates.

## Final top-level navigation

- Company Supplier Directory
- RFQ & PO Workflow Settings (includes nested advanced sending and document template controls)
- WhatsApp Audit Groups
- Company Display Settings

Outside these four, Company details, legacy fallback & attachments remains available for selected companies because it stores company metadata, attachments, integrations and operational recovery actions.

## Read-only database findings

- Initial database scan: 54 company contact-directory entries, 51 active company-type supplier records, 21 explicit company routing records.
- One supplier number with **different names** across supplier types: +94 77 979 2078 — `Main` (company, active), `Sample Supplier` (general, inactive), `Sample supplier` (general, active). Review only; could be intentional and name-case duplicates exist.
- Directory grouping displayed three reused phone numbers but none had conflicting directory display names at the time of the scan.
- No exact duplicate company/supplier directory keys, company/section route keys, group contact keys, or route/recipient keys in the inspection.
- Route-recipient link counts changed while this audit ran (55 then 56). An earlier join showed four links absent from directory and two directory-only entries; repeat readback showed **zero** in both groups. Treat the earlier transient result as unconfirmed, not as a persistent defect.
- Two route rows had differing *assigned contact* versus *sending recipient* counts. This is not inherently an error: assigned contacts can be broader than chosen RFQ/PO recipients. Never coerce the two lists into one automatically.
- Legacy brand-specific contact links: zero. Legacy company-wide automatic approval/send flags were disabled on the records inspected.

## Safety and verification rules

- Never merge records just because phone numbers match; surface conflicting labels as a warning.
- Do not change stored supplier numbers, company directory memberships, historical RFQ/PO recipients, templates, routes, or prior orders in a visual consolidation.
- Do not send RFQs, POs, or audit WhatsApp messages during duplicate inspection.
- Preserve supplier directory edits and deletion workflows, company-level fallback and per-group advanced dispatch.
- New `company-settings-dedupe.test.mjs` covers menu consolidation and normalized phone warning logic. A real build and mobile smoke check are required before marking the release verified.
