# Purchasing simplification — stage 1

Current release status: [Stage 3 is completed and deployed](purchasing-stage-three-20261101.md). The stage-specific preparation statements below describe the state at that checkpoint.

Prepared source only. This update does not deploy the app or apply production migrations.

## Revised implementation

- Main purchasing navigation is Work / Stock / Receive / More. Existing role permissions determine which destinations appear. Accounts without Work access retain their permitted document screens.
- Work combines the former Home and Purchasing entry points. Needs me contains actions permitted for the current account; In progress contains routine supplier/delivery waits with optional follow-up/receiving actions; History retains completed, rejected and cancelled cases. The old dashboard queues, recent lists and pipeline are removed. Standalone stock/new-item tasks and sending failures remain accessible. Business totals load only when opened in Reports.
- Work defaults to All items. Its optional General / Company filter is independent of the saved Stock/document preference, so a previous stock selection cannot hide the other list's work.
- The existing requirement ID is the stable purchasing case reference. Read-only computed links attach its source count, every related quotation, purchase-order lines and receipt lines. Relationships use foreign keys, not item names. Documents can also be browsed separately.
- Each case shows both unreserved quantity still to buy and quantity still to receive on sent orders. Draft, pending-approval and approved-but-unsent quantities appear separately as reserved quantities. Buying and receiving actions can coexist.
- Every still-active quotation for outstanding work remains available. Creating a newer RFQ does not silently supersede an earlier one.
- Existing purchasing reservations retain duplicate-prevention behavior. Submission results distinguish draft, awaiting approval, approved but unsent, and ordered states rather than implying that every reserved quantity is awaiting delivery.
- Quantity-only orders explicitly state that quantity approval leaves prices unconfirmed. Priced approval prompts identify supplier, quantity, price, total and delivery terms. Existing authorization and sending controls remain in force.
- Navigation, guidance and progress labels share workflow-model.mjs. Legacy step IDs remain compatible with saved history and guideTo calls.
- The interactive explanation reflects the revised Work structure and concurrent balances.

## UI cleanup

- One Work filter, three views and a bounded server page of 25 records; counts are computed against the same scope and permissions. Full document/receipt details load on expansion.
- Mobile navigation retains Work / Stock / Receive / More; duplicate header home/menu/utilities and persistent Forward controls are removed. Contextual Back remains on purchasing and receiving screens. More contains document browsing, language, appearance, help and security.
- Work rows show a human-readable status, nonzero buying/receiving balances, one primary action and at most one simultaneous action. Unsent reservations and technical references remain in Details & history.
- Stock keeps submission history in Options and per-item history beside items. Review has Back to counting and Submit, with honest draft save/failure state and retry.
- Receiving uses one responsive row, explicit All accepted, expanded inspection for unaccepted/rejected goods and an explicit confirmation before accepting all remaining delivery quantities. Existing retry keys, quantity validation and final receipt review remain intact.

## Prepared migrations

20261031162540_purchasing_workspace_queues.sql adds six read-only computed fields. They use SECURITY INVOKER, retain row-level access, revoke PUBLIC/anonymous execution, and grant authenticated execution. This migration has not been applied to production. It must precede publication of the frontend. 20261031175045_compact_work_ui.sql adds read-only invoker helpers and the scoped, permission-aware Work pagination RPC. It is also unapplied and must precede frontend publication. Existing release workflow pins remain unchanged.

## Stage-1 checks

The extended suite now contains 497 automated tests, including the isolated-schema integration checks. TypeScript validation, the production build, full isolated database regressions and patch whitespace checks pass. Focused coverage verifies concurrent buying/receiving, partial quotations, unsent reservations, completed-case history, role-based actions, independent All-items scope, multiple active RFQs, linked order state, and invoker/anonymous access declarations. The primary next action follows blocking/overdue/approval priorities. One concurrent receiving or buying action can remain visible; other actions live inside the record.

Rendered receipt rows pass server-render checks for unique inputs, explicit acceptance and visible rejection details. Browser layout validation was not completed: the Playwright browser download fails in this environment. These checks do not replace stage-2 browser acceptance testing.

## Stage 2 verification

The full acceptance scope, corrections, evidence location and existing advisory notes are recorded in [the Stage 2 acceptance record](purchasing-stage-two-20261101.md). The current result is tracked by the PR's checks. Production release remains a separate stage.

## Stage 3 remaining

Prepare a combined release against the then-current production source, apply the verified migration, pin the reviewed source in the manual Netlify workflow, publish, and verify the live revision. No deployment occurred in stage 1.
