# RFQ sharing and supplier link visibility

Adds gateway-independent manual sharing for selected suppliers in Prices. Staff
select one or more suppliers, prepare each supplier-specific PNG, and explicitly
share its file and personalised caption using a supported phone share sheet.
Download, copy-caption and direct supplier-chat options remain available. Sharing
never calls gateway dispatch, marks a request sent or claims delivery. Users must
check WhatsApp before confirming Sent. The share sheet requires choosing its
recipient; opening a direct chat cannot automatically attach a file.

Prices now links directly to the current RFQ's private-link manager; manual entries
also link to the selected supplier. Missing portal RPC setup is explained clearly,
link creation is disabled and unavailable round controls are hidden.

Validation: TypeScript and production build passed; 454 unit/contract tests passed.
Bulk UI suite passed at 320/390/768/1366 pixels. Additional 320px checks passed for
one/two manual recipients, a PNG file and personalised caption passed to the native
share API, download fallback, zero gateway calls, supplier-specific manager URL and
missing-database setup handling. Native sharing was simulated; no supplier received
a message and no live business data changed. Edge inputs match the prior verified
bundle byte for byte; unchanged compiled edge middleware reused for manual release.

Live GH NEXUS read-only check found proc_portal_issue_link_v1 absent. Portal database
activation remains pending the previously recorded restorable-backup prerequisite.
No migrations or WhatsApp gateway/dispatch activation are included in this release.
