# Procurement pop-ups and pending-work reminders

Shared dismissible pop-ups now handle staff messages, common Err components, supplier quotation errors/success, and Supplier Links errors. Error messages remain until dismissed; other messages expire after eight seconds, paused during focus/hover. One global stack prevents overlapping duplicate message surfaces. Text is rendered as React text, not HTML.

The staff notification bell shows the latest 50 in-session notifications, unread counts, and links to the relevant RFQ/order/review screen. Authenticated, RLS-protected reads check the latest 200 updated RFQs/orders and latest 200 supplier replies every 30 seconds while the app is visible and online. Initial snapshots are silent; changed RFQ/order status and newly submitted/revised supplier prices generate pop-ups. Existing supplier confirmation synchronizes replies into proc_rfq_suppliers. No bearer-token intake tables are exposed.

Exact pending counts supply reminders for shortage review, PO approval, approved orders to send, and overdue supplier price requests. Counts refresh even during the four-hour per-user/per-browser pop-up cooldown. Only cooldown timestamps are persisted locally. Cleared queues disappear from the centre. Read errors show an unavailable indicator and retry; they are not interpreted as an empty queue. Notification access follows current navigation permissions and existing database RLS. Signing out clears displayed work notifications.

## Validation

- Full unit/contract suite: 460 passing.
- Targeted notification and syntax suites: 6 passing.
- TypeScript and production build: passed.
- Supplier browser regression: passed at 320, 360, 390, 768, 1280px with intercepted APIs, including draft, final confirmation, variation, photos, concurrency conflict and release safeguards.
- Staff notification browser regression: passed at 320, 390, 1280px, checking event pop-ups, duplicate suppression, queue reminders, unread state and viewport fit. The test is included in tests/ui-smoke.mjs under GH_UI_NOTIFICATIONS=1 and in the existing CI verify job.

## Release scope and limits

This is an in-app notification implementation, not background Web Push. It does not notify after the browser/app is closed. A durable server event/outbox and Web Push subscriptions/credentials would be needed for that follow-up. Event history here resets on reload; pending queues reload from the server. Updates are polled, not instantaneous. Bursts over the 200-row recent window can exceed event coverage, while reminder counts are exact.

No schema migration, business-record update, supplier message, automatic approval, automatic dispatch, or deployment setting change is included. Build on release/netlify-invoice-20261023-once; do not pull in the separate OTP release gates to publish this UI change. Manual Netlify publication and authenticated production delivery testing remain separate release steps. No production publication was performed in this task.
