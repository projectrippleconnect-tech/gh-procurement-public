# Requirements completion — Stage 3

Scope: directory-phone OTP, revocable reusable supplier accounts, versioned standing prices and controlled draft reuse. Extends application revision `5b2535b39489be784e3fe0932ea722f2d21de1f1`. Stage 2 production route selections are configuration and are not overwritten by this release.

## Supplier access

- Staff generate RFQ-specific verified links from Supplier quotation links. A new reusable link is generated per supplier from Supplier access. Only SHA-256 hashes of 32-byte random bearer tokens are stored. Links leave the browser address bar after initialization. Revocation and link replacement invalidate associated access immediately.
- A supplier enters the directory phone (local Sri Lankan or +94 format). Requests with an incorrect link/phone pair disclose no supplier data or phone number. No quotation items or prices are exposed before verification on protected links.
- The initial zero-cost OTP method is staff-assisted WhatsApp. The authenticated RFQ manager generates a six-digit cryptographically random code and sees the exact directory number. They send it manually, then mark directory-number delivery. This action is not a claim that the app sent a message. No paid SMS or WhatsApp API or card-verified service is introduced.
- Codes expire five minutes after the request, are single use, and allow at most five verification attempts. Requests have a 60-second supplier cooldown and six-per-hour supplier cap. Only a salted hash is stored; anonymous callers cannot obtain codes or access challenge tables. Wrong attempts return a failure result so counters commit rather than rolling back.
- Verified supplier sessions expire after 12 hours and bind the access token, supplier and directory phone. Phone/WhatsApp/active-status changes revoke outstanding challenges and sessions, including when a number is later changed back. Lock portal revokes the server session. Expired sessions are pruned on successful verification; old supplier challenges are pruned after seven days on subsequent requests.
- Reusable access exposes only that supplier's invitations and previously invited active items. Opening an existing invitation keeps its original link deadline/revocation; creating a link for an invitation without one opens a six-hour window. Existing item whitelists, revisions, stale-write protection, images, drafts, final confirmation, history and synchronization remain in the existing intake core.

## Standing prices

- Suppliers can maintain up to five drafts, at most 100 exact previously invited items per version, with explicit current UOM, positive finite rates/availability and validity within 90 days. Submitting freezes the version. New versions do not silently edit a submitted or approved version.
- Staff with order-approval authority inspect and approve or reject an exact submitted version. A new approval supersedes the previous approved version for that supplier. Reviews are audited.
- Staff with RFQ-management authority choose a matching open supplier request from a selector. Reuse requires an approved unexpired version, an empty current draft/revision, matching supplier, unchanged specifications/UOM and exact invited items. Reuse is audited and fills a supplier draft only, preserving remarks and version provenance. Supplier final confirmation and staff commercial review remain required. No order, reservation, approval, award or sending flag is created or enabled.

## Compatibility and publication

- Existing unverified RFQ links are grandfathered rather than silently invalidated by an additive migration. They keep their original deadlines/revocation; staff can explicitly revoke and reissue verified links. New links from the updated staff screen require OTP. There is no fallback to an unverified link if issuing a protected link fails.
- Authentication uses the existing staff permissions and scoped supplier capabilities. All new private tables have RLS and no anonymous/authenticated table grants. Private core/helper functions have no supplier execute grants. Public OTP and supplier functions explicitly validate capabilities; staff functions separately require permissions and staff access rules.
- Screens: `/supplier-access` (staff), `/supplier/portal` (reusable supplier account), `/supplier/quote` (existing quotation form plus phone gate). Essential supplier controls support EN/TA; staff administration remains English.
- Verification uses the full isolated production-schema adapter, real anonymous SQL calls and hosted browser fixtures. Fixture WhatsApp numbers and codes are never sent to a live supplier. Actual directory-number OTP delivery and physical-phone acceptance remain separate from automated verification.

## Release status

Implementation and automated acceptance are being verified. No claim of live publication or real supplier delivery is made by this source document until a successful release record is appended.
