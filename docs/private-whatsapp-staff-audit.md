# GH Procurement — Private WhatsApp Staff Audit Trail

## Purpose
After an RFQ or PO image has been **accepted by the supplier WhatsApp gateway**, GH Procurement optionally copies the same image into two private **RFQ** and **PO** groups inside the **Gh Procurement** WhatsApp Community, adding the supplier name, document number, dispatch record and timestamp. This applies to:
- Direct/manual supplier RFQs via `/api/integrations/whatsapp/rfq`
- Direct/manual supplier purchase orders via `/api/integrations/whatsapp/po`
- Automatic company RFQs via `/api/company-items/rfqs`
- Automatic company POs via `/api/company-items/orders`

Multi-page images are individually mirrored. The company PO workflow can also send supplier attachments; this audit currently mirrors the document PNG pages, **not standalone non-PNG attachments**.

## Group creation and onboarding (no sending during configuration)
1. On the phone, create the **RFQ** and **PO** subgroups within your **Gh Procurement** Community, restricted to the owner's own WhatsApp account and any account that operates the private WAHA session. Do not invite supplier contacts. It can be placed inside a Community, but use the staff-only subgroup rather than a community-wide announcement group.
2. Add the WhatsApp account that is already paired with the private Railway WAHA GOWS service. That account needs permission to post.
3. Confirm the selected group ID using the WAHA private API `GET /api/{session}/groups`. Group identifiers end in `@g.us`, **not** a phone number (`@c.us`) or community newsletter/channel ID.
4. Identify and review **every currently active participant ID** from `GET /api/{session}/groups/{id}/participants/v2`. All members must be authorized by the owner. A **single participant** is accepted by the GH audit configuration, but WhatsApp itself may require adding another account before the group can send/receive normally, as indicated by **Add members to start chatting**. If necessary, use a second WhatsApp number controlled by the owner (for example, the WAHA-linked account), not a supplier or staff member. Some numbers may be `@lid` instead of `@c.us`; use the exact IDs WAHA reports.
5. Apply additive database migration `20261017223000_private_whatsapp_audit_group.sql` to the **correct GH Procurement database**, not any other project. This is necessary for immutable duplicate protection; do not enable the mirror before migration.
6. Set these server-only Railway variables, **after** verifying the group:
   - `GH_WA_AUDIT_ENABLED=true`
   - `GH_WA_AUDIT_RFQ_GROUP_ID=120363...@g.us` (exact verified RFQ subgroup)
   - `GH_WA_AUDIT_RFQ_GROUP_NAME=RFQ` (exact WAHA-reported name)
   - `GH_WA_AUDIT_PO_GROUP_ID=120363...@g.us` (exact verified PO subgroup)
   - `GH_WA_AUDIT_PO_GROUP_NAME=PO` (exact WAHA-reported name)
   - `GH_WA_AUDIT_ALLOWED_MEMBERS=947...@c.us` (all group participants, one or more; `@lid` when WAHA reports it)
7. Until the explicit opt-in, `GH_WA_AUDIT_ENABLED` is unset and mirroring remains disabled. Do not invent the group ID or automatically add contacts.

## Safeguards
- Every RFQ or PO send independently verifies its own exact subgroup ID, subgroup name, and active participant IDs. If a member joins/leaves, or WAHA cannot verify membership, the archive copy is **blocked** while supplier sending remains unaffected.
- The group is never used for the original RFQ/PO supplier recipient. Staff-only images have a separate caption explicitly noting gateway acceptance is not proof of delivery.
- A unique database claim is written **before** the group gateway send. Unique key is (source kind, supplier dispatch or company queue ID, page number). A timeout/unknown response is never automatically retried.
- No sending occurs at group configuration time, during migration, during tests or deployment.
- Group copies are attempted **only after** the supplier send has been accepted and the existing dispatch history was successfully updated; cannot manufacture a supplier send by saving a group rule.
- Any group gateway/migration issue is reported separately as `privateGroupCopy` or `privateGroupCopies` status in the API and does not change supplier status. If a group post is unknown, check WhatsApp manually before any exceptional resend.
- The existing private Railway WAHA connection, auth checks, supplier identifiers, automatic order routing and zero-cost stack remain unchanged. WAHA is an unofficial WhatsApp Web bridge, not an official Meta Business API, so long-term account availability is not guaranteed.

## Deployment gate
Execute locked install, audit, TS, tests and build on an isolated release branch. Pin a single verified commit to Railway, with existing manual-only watch pattern. Release the code with `GH_WA_AUDIT_ENABLED` unset. Verify production health.

**Activation is separate from code deployment.** Do not enable until the WhatsApp group exists, the staff-only participant allowlist is reviewed, and the SQL migration has been applied and verified in the actual GH Procurement database. No live test message should be sent without choosing a controlled test document and authorized recipients.

## Current WhatsApp Community layout
The user-created community already contains **RFQ**, **PO**, **General**, and **Announcements**. No new groups are required. The automation routes RFQ documents to RFQ and PO documents to PO. General is reserved for future low-sensitivity status reports and exception alerts; it is **not automatically used for sending supplier documents**. Announcements is not used.
