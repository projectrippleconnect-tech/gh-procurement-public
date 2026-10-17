# Mobile guided workspace

The phone shell keeps Home, Stock, Orders, Receive and More within reach. Home uses a slightly smaller visual slot with a full touch target. Orders contains Review, Prices and Orders workspaces. The purchasing step indicator shows location, never a fabricated completion percentage.

The header and navigation stay outside the scrolling workspace. Primary stock, company count, PO and receiving actions remain above navigation. VisualViewport resize handling moves the action area above a software keyboard when the browser reports a keyboard inset. Physical Android keyboard behaviour still needs a device check.

Company counting opens with item rows, not administration panels. Setup opens separately, with Scope / Suppliers / Action steps. The old independent designated-contact editor is removed from this screen; previously saved contacts that differ from the route remain visible for deliberate reassignment. No supplier identities or order histories are changed by this presentation update. Existing category route tools remain under advanced setup.

Company count actions display a live count across the complete selected company, including rows hidden by filters. Zero is an entered quantity; blanks are skipped; sufficient flags count as entered. Existing draft and submission idempotency logic remains in place. Successful submission scrolls to the saved result and offers links to generated RFQs, POs or shortages needing review.

Delivery progress is the average accepted fraction across non-empty PO lines, using posted GRNs only. This prevents high-quantity lines dominating unrelated low-quantity lines. Cancelled units do not count as received. Mixed units show completed-line totals instead of adding unlike quantities together. Posting a draft receipt does not advance progress until its posted result is loaded.

## Validation

- Production build and TypeScript check.
- Node regression suite including posted/draft receipts, cancellation and mixed-size line completion.
- Isolated Playwright redesign flow at 320, 390, 768 and 1366 pixels: role-aware navigation, zero and blank company quantities, filtered-out counts, confirmed submission, supplier setup, single-supplier direct-PO eligibility, purchasing section navigation and receiving action placement.
- Existing focused quote-entry, commercial-draft recovery, award guards and order-creation browser flow.

Browser tests intercept application backends and do not submit production stock, send supplier messages or create real purchase orders. Deployment remains manual. Source is based on the full procurement certification branch rather than the older main branch, so its preceding fixes are retained.

## Dashboard phase

Home starts with Needs your attention, showing up to four queue groups with All tasks available inline. Urgent work and overdue documents come first, followed by review, approval, sending, supplier prices, receiving and scheduled counts. Each count comes from an exact queue query rather than the limited recent-record preview. Missing or failed counts stay unavailable with a retry action. Queues are scoped to permitted screens, and read-only users receive status labels instead of approval commands. Overview totals and recent records remain available in expandable sections.

Continue stores the current purchase-order or receiving selection, so the dashboard can reopen the actual selected record after a refresh. Browser checks cover both record types and queue failure recovery.

Stock resume also remembers General versus Company Items and the last valid company selection per user. A missing or inactive remembered company falls back to an available list; existing per-company quantity drafts remain separate.

## Workflow and supplier-routing phase

Company supplier assignments and outgoing recipients now save through one transaction. The full assigned list is retained even when an RFQ is sent to only some suppliers. Automatic direct PO configuration requires exactly one assigned supplier. A company-wide sole supplier also becomes the legacy default contact in the same save; multi-supplier configurations clear the ambiguous single default. Category saves retain company defaults and nearest-category precedence. Existing configurations are not bulk changed.

An optimistic route version rejects stale edits. Reload saved settings refreshes the configuration without discarding stock drafts. Privileged writes live in an authenticated, admin-checked private function; the public RPC remains an invoker. Advanced route/template editing uses the same atomic endpoint, and its independent contact-only save has been removed. Legacy manual RFQ/direct routes remain supported without automatic sending.

Stock submission results present one next action and put additional generated documents under Created documents. The next action distinguishes review, new RFQs/POs, active RFQs and existing PO tracking. PO screens display the actual supplier and next step; sending and confirming Sent remain separate, and receiving is reachable from the fixed action area.

Release ordering: apply the new supplier-route migration before releasing the UI that calls the new RPC. It is prepared and isolated-tested only; no live migration, message dispatch or deployment is performed by these checks.

## Receiving and closure phase

Receive separates Deliveries and Follow-ups into two workspaces. The delivery action stays above mobile navigation and includes the number of entered lines across the order. Entry leads to a per-item review, then a saved result with an order-tracking or rejection-follow-up action. Cancelling the review posts nothing. Accepted and rejected quantities must account for the entered delivery before a new receipt is submitted. Partial deliveries leave the remaining balance open.

An uncertain receipt retains its exact key and payload, even if another browser has since changed the outstanding balance. A retry can therefore confirm an already-posted receipt without being blocked by fresh-entry validation. Orders referenced by an uncertain saved attempt stay available for recovery even after they become received or closed. Saved results clear the selected receiving record, and an already handled navigation filter cannot reopen the completed draft automatically.

Rejected-goods cards use one Update follow-up action. A two-step dialog collects the plan, date, reference and notes, explains stock/balance effects, then asks for review. Cancel and Escape save nothing. Replacement receipts explicitly add the full rejected quantity; quantities already recorded through Deliveries must be settled using Resolve another way with a reason, rather than received twice. Returns alone leave the case open. Credits and accepted losses add no stock and leave outstanding delivery balances for a deliberate order decision. Search and ten-case pages keep follow-ups manageable. Failed refreshes show unavailable with retry rather than a false empty result.

Orders offers Complete order after the delivery balance is received, and a direct link to that order's follow-ups. Final closure requires both editing and approval permissions, posted accepted receipts or audited cancellations covering every line, and no unresolved rejected-goods cases. These conditions are checked by a database trigger, including direct status updates and automatic balance-action closure. The closure RPC locks the order and safely replays a completed request. Cancellation and buy-elsewhere reasons use the app's review dialog instead of browser prompts. Progress remains the actual accepted fraction; cancelled quantities never inflate it to 100%.

The closure migration must be applied before deploying this UI. No live database changes, supplier notifications or deployment are performed during local verification.

Verified for this phase: production build, TypeScript check, 254 Node tests, all 17 isolated database suites, receiving lifecycle at 320 / 390 / 768 / 1366 px, company-stock handoff at 390 px, and focused purchasing regression at 320 px. Browser fixtures cover cancelled reviews, partial receipt inspection, replacement follow-up, failed-refresh recovery, final closure, saved-receipt confirmation after order closure, and read-only permissions. A final 320 px rerun includes the bounded receipt-review list so its confirmation controls remain reachable. Physical-device keyboard and touch checks remain a release verification step.


## Final validation pass

The 17 October 2026 expanded validation passed 21 role/viewport combinations, two keyboard simulations, receiving lifecycle and access-restriction checks at 320 and 412 px, all 17 isolated database suites and read-only live consistency checks. It found and corrected a tablet-width Reports saved-layout overflow. See [the validation report](validation-2026-10-17.md) for exact evidence and the physical/business checks that remain unverified.

## Five fixed purchasing tabs — 17 October 2026

Replaced the floating step chooser and duplicate purchasing-section row with one
five-destination journey bar: Stock, Review, Prices, Order, Receive. On mobile it
replaces the usual bottom navigation only within these workspaces. On other
screens the normal main navigation remains. Home (where permitted) and the full
menu are available in the header. Each journey destination opens its own screen;
Order opens purchase orders directly. Existing guided actions still handle
approval, supplier selection, quotes and award review within those screens.

The mobile bar has five equal columns and at least 48px-high targets. Unavailable
workspaces remain disabled according to existing permissions. The primary action
stays above the bar, including with the simulated keyboard, and the central
workspace scrolls independently. Switching destinations preserves mounted drafts.
No business or automation rules changed. Stage selection indicates location,
while existing saved quantities determine delivery progress.

Validation: production build, TypeScript, all 254 unit tests; focused browser
checks at 320, 412 and 768px; seven role/permission cases at 320px. Keyboard checks
are simulated, not a physical OnePlus test. No production business records or
supplier messages were created. Release remains manual, pending deployment.
