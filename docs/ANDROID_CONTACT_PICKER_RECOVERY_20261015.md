# Android contact picker fallback — 15 October 2026

## Observed device behavior
Android's native Select a contact view may display No contacts found and close during search. This screen belongs to Android. A web Contact Picker API cannot list all contacts or control native search, permissions, visibility, or account/profile filters.

## Improvements
- Both group supplier editor and designated company contact now treat picker cancellation, errors and empty results as recoverable.
- The existing typed name, phone, and selected RFQ/direct PO route remain intact after picker cancellation.
- The editor displays actionable guidance and a collapsible import instructions panel.
- Use Android Contacts → Share / Export as vCard (.vcf) → save file → Import .vcf → local search → Choose → edit → Save.
- Only explicitly saved supplier data is stored in Supabase; the vCard file is parsed locally, not uploaded.
- Accepts vCard exports up to 5 MB with at most 5000 contacts.

## Limitations and verification
Website code cannot force the native Android contact picker to show entries or remain open while searching. Confirm that Contacts on device displays the supplier in the correct personal/work profile and that contacts are synchronized. Test native Android behavior on the physical device; CI verifies browser-independent cancellation and import behavior.

## Deployment
No database migration, order creation or stock data changes. Railway deployment stays manual-only until explicitly approved.