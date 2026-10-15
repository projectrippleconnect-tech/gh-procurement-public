# Company Section Procurement Routing — 15 October 2026

## User workflow
Company Lists → Group suppliers & RFQ / direct PO routing → search an existing section, such as Alkathene → Configure.

- **Direct purchase order** selects exactly one existing or newly added company supplier contact. Automatic sending is enabled by default when the administrator saves a new direct group route. That explicit save enables the existing admin-controlled automatic approval used after submitted stock counts. Quantity-only POs follow the established WhatsApp dispatch queue and do not ask suppliers for prices.
- **Request quotation / RFQ** selects one or several suppliers (typically 2–3). Approved outstanding shortages from that section are prepared as a single RFQ and the admin is taken to the existing RFQ sending interface. No supplier transmission is claimed when a draft/prepared RFQ is created; each invitation must go through the existing sending workflow.
- A child section inherits its nearest configured ancestor's rule. Explicit child overrides take priority. Unconfigured sections retain company-wide legacy settings; no historical documents or item IDs change.
- Admins may edit the supplier selections, switch modes or clear a section override. Existing purchase orders, RFQs and stock history are preserved.

## Safety and boundaries
- Configuration changes require admin + `company_lists.manage`. RFQ preparation additionally requires `procurement.rfq.manage`; manual POs require `procurement.orders.approve`.
- Changes to each route and supplier assignments occur in one database transaction.
- Direct POs with different auto-send settings are never combined in the same purchase order.
- Auto-send only queues quantity-only approved direct POs. The dispatcher rechecks group mode, designated supplier and auto-send before transmitting; changed routes require manual review.
- RFQs are created only for approved shortages without an active RFQ. Supplier scope mismatches are marked with an explicit admin group assignment override rather than bypassed silently.
- The existing WhatsApp gateway must be enabled and connected for actual sending; queued means queued, not delivered.
- Existing company-wide auto-approval settings remain unchanged unless an administrator saves a direct route with auto-send on.
- The schema change is additive and must be applied **before** releasing a matching web build. No migration is applied to production as part of preparing this branch.
- Railway remains pinned to its last approved production commit. Do not deploy until explicitly instructed.

## Verification
- `tests/company-section-routing.test.mjs`: route defaults, RFQ/direct validity, closest configured ancestor, loop protection.
- Existing company stock, supplier dispatch, RFQ/PO and role-policy checks in the repository test suite.
- Follow-up staging test before production: create two groups with 1 and 3 suppliers, submit shortages, confirm only the direct group produces an approved queued PO; approve RFQ group shortages, prepare RFQ, verify 3 unsent invitations, send via RFQ UI, verify audit receipts and no duplicated orders.
