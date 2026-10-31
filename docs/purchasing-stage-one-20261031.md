# Purchasing simplification — stage 1

Prepared source only. This update does not deploy the app or apply production migrations.

## Revised implementation

- Main purchasing navigation is Work / Stock / Receive / More. Existing role permissions determine which destinations appear. Accounts without Work access retain their permitted document screens.
- Work combines the former Home and Purchasing entry points. Needs me contains actions permitted for the current account; In progress contains waiting cases; History retains completed, rejected and cancelled cases. Task queues, exceptions and totals remain expandable.
- Work defaults to All items. Its optional General / Company filter is independent of the saved Stock/document preference, so a previous stock selection cannot hide the other list's work.
- The existing requirement ID is the stable purchasing case reference. Read-only computed links attach its source count, every related quotation, purchase-order lines and receipt lines. Relationships use foreign keys, not item names. Documents can also be browsed separately.
- Each case shows both unreserved quantity still to buy and quantity still to receive on sent orders. Draft, pending-approval and approved-but-unsent quantities appear separately as reserved quantities. Buying and receiving actions can coexist.
- Every still-active quotation for outstanding work remains available. Creating a newer RFQ does not silently supersede an earlier one.
- Existing purchasing reservations retain duplicate-prevention behavior. Submission results distinguish draft, awaiting approval, approved but unsent, and ordered states rather than implying that every reserved quantity is awaiting delivery.
- Quantity-only orders explicitly state that quantity approval leaves prices unconfirmed. Priced approval prompts identify supplier, quantity, price, total and delivery terms. Existing authorization and sending controls remain in force.
- Navigation, guidance and progress labels share workflow-model.mjs. Legacy step IDs remain compatible with saved history and guideTo calls.
- The interactive explanation reflects the revised Work structure and concurrent balances.

## Prepared migration

20261031162540_purchasing_workspace_queues.sql adds six read-only computed fields. They use SECURITY INVOKER, retain row-level access, revoke PUBLIC/anonymous execution, and grant authenticated execution. This migration has not been applied to production. It must precede publication of the frontend. Existing release workflow pins remain unchanged.

## Stage-1 checks

TypeScript validation, JSX syntax parsing, patch whitespace checks, four focused Work behavior tests and one isolated-schema integration test pass. The integration test checks multiple active RFQs, linked order state, remaining quantity and invoker/anonymous access declarations. Preview navigation, filters, views and partial-quantity interactions pass a local DOM logic check.

Browser layout validation was not completed: the local Playwright browser executable is unavailable. These checks do not replace stage-2 acceptance testing.

## Stage 2 remaining

Update existing UI fixtures for Work navigation and independent scope. Run full regression, role/RLS checks, partial-order and posted-receipt scenarios, deep links, quotation drafts/history, approval and sending safeguards, receiving follow-ups, dataset-scale loading/pagination, and phone/tablet/desktop browser validation. Confirm that users with restricted receipt access receive accurate permitted case balances. Run database security advisors before release.

## Stage 3 remaining

Prepare a combined release against the then-current production source, apply the verified migration, pin the reviewed source in the manual Netlify workflow, publish, and verify the live revision. No deployment occurred in stage 1.
