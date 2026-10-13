# Working hours and location restrictions

All enabled procurement roles inherit the default restriction. The protected
Super Admin role is exempt. Super Admin can edit the default or customize one
user under **Admin → Time & Location Restrictions**.

Initial defaults:

- Monday–Friday and Sunday, 07:30–18:30 in `Asia/Colombo`.
- General Hardware, No. 14 Kandy Road, Nawalapitiya.
- Map pin: `7.0552571, 80.5345549`, radius 100 metres.
- Saturday is initially excluded and can be selected in settings.

The database checks its own clock on each protected request. Location
verification is bound to the authenticated user's JWT session ID and expires
after 90 seconds. The open app refreshes verification every 30 seconds, locks
when verification expires, and rechecks when returning from the background.
Denied permission, insufficient accuracy, unavailable GPS and failed network
checks keep the workspace locked. No precise device-location history is stored.

An accuracy of at most 50 metres is accepted, and the reported uncertainty must
fit inside the configured radius. Indoor GPS may need a retry near a window.
Rule edits invalidate existing location leases. User overrides can be removed
to resume inheriting the default. Only Super Admin can change these rules.

Existing RLS permissions remain required. Restrictive RLS policies protect
procurement tables and the `gh-procurement` storage bucket. Existing definer
RPCs receive entry guards, including stock-history reads. The shared GH Nexus
tables, other storage buckets and worker service-role execution are unchanged.
Future procurement tables or definer RPCs must receive the same access guard.

The Android companion sets `FLAG_SECURE` on every app window, preventing normal
Android screenshots, recordings and unsecured display output. It requests
location permission only for the trusted first-party origin. This requires an
updated APK; an installed older APK does not receive native changes from a web
deployment. Web browsers cannot reliably block OS screenshots. Exported or
downloaded documents are outside app-window protection. Device-location reports
can be falsified; this feature is not physical-presence attestation.

## Release order

The migration initially stages the default rule with both checks disabled, so
the previous web client remains usable during rollout. Apply
`20261013041517_procurement_access_restrictions.sql`, deploy the new web client,
then activate `time_enabled` and `location_enabled` on the default rule and
invalidate location leases as the final release step. The previous web client
cannot acquire a lease once restrictions are active and must be refreshed.
Super Admin stays available throughout. Build and install the new Android companion separately.
Automatic deployment remains disabled; the manual Railway trigger is unchanged.

## Validation

`npm test`, `npm run lint`, `npm run build` and `GH_UI_ACCESS=1 npm run test:ui`.
Run `tests/sql/access-restrictions-isolated.sql` only in a disposable PostgreSQL
database. The fixture tests opening/closing boundaries, Sunday/Saturday, direct
table and RPC denial, custom roles, inaccurate/outside locations, expired and
different sessions, disabled accounts, overrides and Super Admin exemption.
