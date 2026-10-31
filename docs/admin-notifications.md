# Admin phone notifications

Stock counts (General and Company Items) generate one durable alert per submitted count and active admin. Purchase orders generate alerts when submitted for approval and when marked sent. Drafts and repeated saves do not generate duplicates. Notifications are recorded in the transaction, so rolled-back submissions produce no alerts.

The admin Notifications control enables each phone independently. The browser permission prompt must be accepted on that phone. Test and disable controls are provided. Notifications open the relevant Stock or PO screen and display the document reference; the inbox retains unread/read history. It polls every 20 seconds while visible and refreshes on focus.

`supabase/admin-notifications.sql` is an additive installation script, applied to GH NEXUS on 2026-10-26. Do not rerun it. The `proc-admin-push` Edge Function authenticates admin requests using Supabase Auth and worker requests with a private Vault credential. The minute scheduler uses pg_cron and pg_net. Private VAPID keys are service-role-only. Notifications and subscriptions have owner/admin RLS; staff cannot read admin alerts or register devices. Endpoint hosts are restricted to browser push providers.

Delivery uses an atomic two-minute lease per notification/device, five attempts with exponential backoff, cleanup of expired subscriptions (404/410), a stable OS notification tag, and a maximum batch size of 100. It sends alerts created after device registration within the past 24 hours. Browser push acceptance is not proof of phone display. Device notification permissions, connectivity, battery restrictions and Do Not Disturb can delay or suppress pop-ups. No phone subscription existed during server verification; physical phone delivery needs the admin to enable and send a test.

Validation: TypeScript, production build and all 464 tests passed, including three worker behavior tests. Rollback-only database check verified draft suppression, admin fanout, duplicate prevention, submitted PO alerts and sent PO alerts. Production data was preserved.
