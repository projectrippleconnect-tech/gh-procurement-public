# Procurement field and selector overlap review — 31 October 2026

Reviewed the item creation/editing surfaces, Company Lists, OCR/pasted imports,
stock counting filters, print setup, shared selection dialogs, supplier coverage,
company sections and RFQ/PO setup.

## Corrections

- Company quick create asks for Company once; saved category derives from the
  chosen existing or newly created company. Main group and Subcategory selectors
  are omitted in this mode. No existing master records are rewritten.
- General quick create uses the category picker's existing custom-entry action.
  The second inline New category form is removed. Custom category length remains
  100 characters and new options remain selectable after creation.
- Shared pickers collapse duplicate values and case/spacing variants of text
  options. Distinct record IDs with identical labels are retained, and the current
  stored selection is preferred. Custom entry recognizes both existing labels
  and values to prevent another apparent duplicate.
- Company List and print filters are omitted when they cannot narrow the data.
  Active filters remain available to clear, and populated-versus-blank values
  still offer meaningful filtering. Section filters are included in active count.
- Company OCR imports default to the selected company category. Classification
  overrides remain optional and imported row-specific categories are preserved.
- The previously prepared required-tables-per-page correction is retained in this
  release, preserving current per-column font and alignment behavior.

## Distinctions retained after review

General Item Category, Main group and Subcategory represent actual hierarchy.
Company sections can have supplier routing, so they are not merged with item
master classifications. Supplier coverage, company contacts and RFQ/PO modes
have different operational effects. Existing import columns and per-row editing
remain available for established categories and subcategories. No business rows,
companies, suppliers, counts, prices, orders or audit entries are deleted.

## Verification

Unit and component execution checks cover both item modes, existing/new company
saving, category derivation, Company List linking, duplicate selector values,
distinct supplier identities, blank filter values, active filters, and exact PDF
table counts. The manual release workflow also runs isolated database and browser
checks before publishing to the existing Netlify site. Deployment remains manual;
no new service, paid plan or Git auto-deployment is enabled.
