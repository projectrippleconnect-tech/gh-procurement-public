# Company Lists setup: duplicate-field, action and interface audit
Date: 2026-10-18
Repo: projectrippleconnect-tech/gh-procurement-public
Scope: Company Lists > Setup and linked supplier/route interfaces
Baseline used for safe integration: 520442ec86eb17c4ea900c964708de65f103d0a2

## Audit decisions

| Scope | Repeated or distinct? | Result |
| --- | --- | --- |
| Company Supplier Directory | Authoritative company contact directory, one-at-a-time save | Kept |
| Company Workflow Checklist | Authoritative company/category RFQ vs PO checklist, supplier selection and batch save | Kept under RFQ & PO Workflow Settings |
| Company suppliers & automation wizard | Repeated scope, supplier, mode controls; calls same save-setup RPC as checklist | **Removed from displayed setup**; underlying component and database retained for rollback |
| Advanced supplier tools | Repeated group-route editor, plus unique template, approved request send, override, and WhatsApp status actions | Moved inside workflow as Advanced group sending & document templates |
| WhatsApp Audit Groups | Audit group connection and verification, not a supplier-route editor | Kept |
| Global list display customization | List appearance, not route logic | Renamed Company Display Settings and kept |
| Company settings, groups, contacts & attachments | Partly legacy fallback fields, plus company metadata, sheets, attachments, queued job recovery | Kept separately; clearly labelled legacy fallback & attachments |
| Supplier contact edit in workflow advanced settings | Writes shared supplier contact; directory contact edit writes a company-scoped display entry | Kept both with separate meanings, avoid automatic merging |
| Directory and workflow search | Different target sets | Intentional, kept |
| Automatic RFQ / PO sending queue | Processes pending background queues; distinct from single approved-document send now | Kept |

## Screen-level cleanup

Four primary expandable sections in the setup area:

1. Company Supplier Directory
2. RFQ & PO Workflow Settings (checklist and nested advanced actions)
3. WhatsApp Audit Groups
4. Company Display Settings

Other company configuration and attachments remain below these sections to preserve their independent functions. No underlying procurement business logic is changed.

## Database inspection (read-only)

- Found one phone shared by different supplier record names: **+94 77 979 2078**: Main (active company supplier), Sample Supplier (inactive general supplier), and Sample supplier (active general supplier). The two Sample Supplier labels also differ by capitalization.
- Initial count of company directory entries: 54. Same phone may intentionally appear under multiple companies; do not merge on number alone.
- No exact duplicate company+supplier directory key, company+section route key, group contact key, or route+recipient key was seen.
- 21 explicit company section route records in inspected data. Two had different counts between *assigned contacts* and *sending recipients*: this is supported and should not be collapsed.
- Company directory/routes were being updated independently during the check. Initial routing-link readback contained 55 records; a later readback contained 56 and showed zero links missing from the directory. Re-check live before any future migration; do not use the initial transient count as a current error.
- Legacy brand-contact links: zero in the inspected snapshot; preserved in code nevertheless.

## Duplicate number safety

The current active source branch already includes `lib/contact-duplicates.mjs` and review-confirmation warnings in both the company directory and general supplier management screens. This change *reuses that existing implementation*; it intentionally does not introduce a second duplicate-number helper or a competing warning panel.

## Safety and verification

- Source-only UI changes plus a static regression test.
- No database migration, directory merge, supplier update, routing write, RFQ/PO generation or WhatsApp sending was performed during this cleanup.
- Unique route exceptions and manual send actions remain discoverable.
- Build, automated tests, mobile visual smoke verification and Railway deployment verification must complete before claiming the new UI is live.
