# Reviewed Stock Entry company section hierarchy — 15 Oct 2026

## What was wrong
The company-item naming update did not update `proc_company_list_items.section_id`. The Stock Entry UI groups by `proc_company_sections`, not merely `proc_items.main_group/subgroup`. BOARD ITEMS consequently displayed all 67 items under a single old section.

## What is implemented
A guarded SQL migration defines:
- `private.proc_reviewed_section_plan_v1()` — deterministic read-only mapping of existing active company items to nested section paths.
- `public.proc_apply_reviewed_company_hierarchy_v1(p_preview boolean)` — preview and transactional, Super Admin-only apply.

The migration was installed in the connected Supabase project on 15 Oct 2026; **installing it did not move any company items**.

An administrator UI is added at **Company Lists → Manage sections & nested categories → Reviewed product grouping — all company lists**. The Super Admin previews then applies the update. Applying is a separate authenticated action.

## Verified scope (SQL readback)
- 637 unique active company items across 15 company lists require extra section groups.
- BOARD ITEMS: 67 items, 11 destination leaf sections across Plywood, MDF, Melamine (4 finishes), Film-Faced, Shuttering, Cladding, Hardboard and PVC.
- FEVICOL: 52 products grouped by 4 product categories and 14 series.
- KEVILTON: 81 items retain finish branches and gain product category branches.
- ORANGE: 73 items; Akoya/Casablanca remain modular, Alpha/Sigma and extension/tape items move out of Akoya White.
- WIRE CABLES: 150 records retain 5 brand branches, each adding the confirmed wire/cable family sections.
- PANEL SHEETS: only I PANEL variants gain subheadings; existing hand-built ceiling fittings branches are untouched.
- Additional groupings: BIXTON, BOLT & NUTS, CASING, KOBE, MULTI BOND, POLYCHROME, ROCKER, RUBBER HOSE and WURTH.
- ALCATINE, CEMENT BASED, PE+ and REGIFOAM already had appropriate category branches and are preserved.

## Safety controls
- Actual item moves require `auth.uid()`, active Super Admin role and `company_lists.manage`; direct unauthenticated SQL invocation of preview is rejected.
- Existing section IDs are reused by name/parent and items are reassigned by their existing company-list link ID; no products, links, historical counts, quantities, source keys, or stock maxima are added/deleted.
- Before/after database row snapshots of affected links are compared inside the same transaction. A mismatch throws and rolls the complete operation back.
- Existing `proc_company_reorder_guard` is harmless for these updates: read-back showed all 723 active company links already have their required 50%-of-target or null reorder setting.
- `proc_items` Item Master records are *not* altered; an unrelated Item Master trigger would recalculate reorder levels on any item update. This grouping work avoids that risk.
- 66 maximum-stock-review flags remain outstanding and should be handled separately, never invented from blank source cells.
- Color palette on newly created section headings: blue for category and teal for third-level headings.

## Deployment status and continuation
Feature source: `feature/reviewed-stock-section-hierarchy-20261015`, PR #87.
Do not merge or deploy without an explicit deployment command. After CI is green, stage for deployment. When deployed, a signed-in Super Admin must preview and apply once. Check BOARD ITEMS shows nested leaf branches, ORANGE Alpha/Sigma are separated, 723 active link IDs and stock values unchanged, and no products remain unassigned.
