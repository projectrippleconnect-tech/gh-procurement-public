# Flat Alkathine company category

ALCATINE is the company list. Its single top-level section is ALCATHINE.
All 10 Alkathene hose item records are directly assigned to the main section.
ALCATHINE HOSE is not a child section and the proc_items subgroup is empty.

The Google Sheets legacy parser retains its original source-key hash, then
normalizes subgroup metadata to empty. App-format Sheets are normalized too.
This prevents future sync from recreating a subgroup without duplicating items.

Existing category supplier routes stay on ALCATHINE. Multi-recipient RFQ and
single designated supplier direct PO rules are unchanged.

Apply the paired Supabase migration with admin authority before verifying the
production UI. The migration archives the redundant child and keeps item IDs,
list IDs, quantities, history, and route IDs untouched.
