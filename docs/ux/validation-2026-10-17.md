# GH Procurement validation — 17 October 2026

Automated and read-only production checks passed. Physical-phone use and actual supplier receipt remain unverified.

## Completed checks

| Check | Evidence |
| --- | --- |
| Role navigation | Admin, stock handler, receiver, document assistant, stock checker, viewer and procurement at 320, 412 and 768 px: 21 role/width combinations |
| Role restrictions | Permitted screens open; restricted Dashboard/Admin entry points stay unavailable; actual live admin and stock-handler roles are enabled |
| Keyboard simulation | At 320 and 412 px, shrinking the visual viewport to 500 px keeps the counted-item Submit action above the simulated keyboard; closing restores layout |
| Receiving lifecycle | At 320 and 412 px: review cancellation, partial receipt, rejection, replacement, remaining delivery, closure, lost-response recovery and read-only protection |
| Access restrictions | At 320 and 412 px: location permission refusal, geofence, working hours, admin exemption and expired access lease |
| Database regression | All 17 isolated PostgreSQL suites passed; fixtures rolled back |
| Code checks | 254 automated tests, TypeScript and production build passed |
| Live HTTP checks | Healthy expected release; Content Security Policy present; unauthenticated stock/order/RFQ submission and WhatsApp access rejected |
| Live data consistency | Zero negative stock balances, invalid posted receipt quantities, over-received lines, closed orders with unresolved rejections, completed orders with outstanding lines, or active accounts with disabled roles |
| Gateway infrastructure | WhatsApp gateway service is running with its persistent session volume; this does not establish current pairing or supplier delivery |

Browser tests use intercepted backends and synthetic accounts. They are not real staff sign-ins. No real stock was submitted, no business order was created, and no supplier message was sent by these checks.

## Correction found and verified

Reports saved-layout controls overflowed the workspace at tablet width. The layout now puts the saved-layout picker on its own row from 701 through 1000 px. Each permitted section is checked for horizontal overflow in the expanded role suite. Existing report data and export behaviour are unchanged.

## Physical and business evidence still needed

These checks require the user's OnePlus and an intended business transaction:

1. Enter an actual stock count on the phone. Confirm that the keyboard leaves the active row and counted-item Submit button usable.
2. Review the supplier and generated document, including any existing order commitment.
3. For an intended order, verify that its image and caption reach the correct supplier and obtain receipt confirmation.
4. Record the actual delivery, including any genuine rejected quantities or partial balance.
5. Settle remaining cases and balances, then close the order.

Do not create a dummy production order or blindly resend an uncertain message to obtain test evidence. Hardware behaviour, real staff sign-in and actual supplier receipt cannot be marked passed from isolated browser fixtures.
