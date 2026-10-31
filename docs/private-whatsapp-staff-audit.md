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

## 2026-10-18: owner-provided invite resolution
The owner supplied three distinct private WhatsApp invitation codes (one other link was repeated). GH Procurement may store these **temporarily in a server-only environment variable** \`GH_WA_AUDIT_PENDING_INVITE_CODES\`, never in public source or browser storage. The signed-in admin \`Check my WhatsApp groups\` action performs \`GET /api/{session}/groups/join-info?code=...\` for each code using the private WAHA connection. This is read-only: it never joins, posts, creates, or changes any WhatsApp group. The API returns the resolved subgroup ID/name and whether WAHA identifies it as a community; the private codes are omitted from responses. The archive remains OFF until destination IDs, actual members, sending ability, and the database migration are verified. Remove the temporary codes from Railway after successful resolution.

## 2026-10-18: verified destinations and owner-only safety
The owner confirmed the WAHA invite-link mappings in the signed-in procurement UI:
- RFQ: 120363430251121456@g.us — one member reported
- PO: 120363414257107130@g.us — one member reported
- Gh Procurement Community: 120363428850631487@g.us — NEVER USE as an audit-document destination

Railway has the four RFQ/PO group ID and name variables, plus GH_WA_AUDIT_OWNER_ONLY=true. The temporary invite code value was cleared. GH_WA_AUDIT_ENABLED is deliberately unset.

The owner-only mirror checks GET /api/sessions/{session}/me, and requires exactly one active member matching the linked session's JID. Unknown identity or mismatched members block group copying but not supplier sending. A reported count of one alone is insufficient.

The read-only admin group checker reports owner verification and audit-table readability. Do not activate until the correct GH Procurement production database receives migration 20261017223000_private_whatsapp_audit_group.sql and audit-table readback passes. The connected Supabase accounts list GH NEXUS, GH LEDGER, Muslim Lanka, and LWP, but no GH Procurement project; do not apply to unrelated databases. Run a controlled test only after all gates pass.

## 2026-10-18: production audit database migration verified
The correct shared procurement database is hosted in the connected GH NEXUS Supabase project; 68 public tables use the proc_ prefix. The private WhatsApp audit migration was successfully applied and read back. Validation confirmed one RLS policy, enabled RLS, a unique per-source/per-page constraint, zero audit-copy records, an authenticated-only claim RPC (anon execute denied), and the finish RPC.

Automatic WhatsApp copies stay disabled pending verified owner-only identity for BOTH configured group IDs and a controlled send test. Read-only diagnostics now query exact configured IDs and use WAHA participant.pn or verified GET /api/{session}/lids/{lid} for owner-only JID mismatches. Under no circumstance trust a group simply because its name matches RFQ or PO when its ID differs. Temporary invite codes were cleared after the direct destinations were confirmed.
