# Purchasing simplification — stage 1

Prepared implementation only. Production remains on source 9a5c5528f2a48b55447258b8ed25d9589d1485ad.

## Implemented

- Mobile and desktop Purchasing entry, with Review / Quotes / Orders inside it. Stock and Receive keep their own workspaces. All destinations still check the existing screen permissions.
- Home work lists link to the same lists and use the same predicates and selected item type for counts.
- One shared General Items / Company Items selector across Home purchasing shortcuts, Stock, Review, Quotes and Orders. The preference is retained for the signed-in user; documents, drafts and records remain separate.
- Review defaults to outstanding quantities with no active RFQ. Quotes defaults to the latest active request owning an outstanding requirement. Older and completed quotations remain accessible through history. Orders retain their existing statuses and filters.
- Attention is an expandable badge on the affected submission, held requirement, overdue/missing supplier response, or affected order. It does not create another purchasing route.
- Stock sufficient and shortage covered by existing orders use “No new purchase needed” with separate reasons and existing-order tracking. Unknown results remain neutral Saved with an attention badge.
- One Direct PO route with its existing approval rule; no purchasing or approval permissions were expanded.
- Updated interactive explanation prepared in docs/previews/purchasing-stage-one.html.

## Prepared database migration

20261031162540_purchasing_workspace_queues.sql adds five read-only computed fields. All use SECURITY INVOKER, retain row-level security, revoke PUBLIC/anonymous execution, and grant authenticated execution. No production migration has been applied.

This migration must precede publication of the new frontend. Do not deploy this branch without it. Existing release workflow pins are intentionally unchanged.

## Stage-1 sanity checks

TypeScript validation, patch whitespace checks, and isolated schema parsing of the migration completed. These do not constitute the full stage-2 acceptance checks.

## Stage 2 remaining

Update the UI fixtures/assertions for the new navigation, shared list selector, and neutral/no-new-purchase outcomes. Verify role boundaries, global scope changes and deep links, old quote drafts, partial and existing orders, RFQ history, attention badges, approval controls, pagination/count accuracy, and phone/tablet/desktop layouts. Exercise the new SQL helpers against isolated records and run the database security advisors before release.

## Stage 3 remaining

Prepare a fresh combined release against the then-current production source, apply the verified migration, pin the reviewed source in the manual Netlify workflow, publish, and verify the exact live revision and production checks. No deployment was performed in stage 1.
