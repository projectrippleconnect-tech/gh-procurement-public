# Supplier OTP and document branding release — 23 October 2026

Status: implemented and locally verified; NOT deployed or enabled in production.
Official target: https://gh-procurement.netlify.app/
Source base: feature/supplier-invoice-quote-20261023 at 744df1cb4822b5f5c24782f93ac1bae965435434.

## Changes

Supplier quotations use a same-origin server API. The invitation token alone no
longer authorizes quotation reads or saves after the coordinated migration.
The server matches the entered Sri Lankan mobile number to the invitation's
supplier record, preferring its registered WhatsApp number. The browser cannot
choose another recipient. Local, +94 and 0094 mobile formats normalize consistently.
Missing, inactive, revoked, expired or mismatched records fail closed.

Codes use cryptographic randomness, expire after five minutes, and permit five
attempts. A phone-wide database lock enforces a 60-second resend cooldown and
five sends per hour across invitations and server instances. Only peppered code
hashes are stored. Wrong attempts commit even when verification fails. Replacing
a challenge invalidates its previous code; successful codes cannot be replayed.
Gateway timeouts or missing acceptance IDs never trigger an automatic retry.
The gateway acceptance marker only allows code verification; possession of the
actual code proves delivery to the registered number. No code is returned to the browser.

Verified access uses an opaque Secure, HttpOnly, SameSite=Strict, host-only cookie.
Sessions are bound to the invitation token hash, link ID and registered phone,
and expire within two hours or at the quotation deadline. Every read/save checks
current revocation, supplier activity, phone and link identity. Browser roles lose
EXECUTE on the previous bearer-only RPCs. The API refuses cross-origin requests,
bounds streamed body size, avoids logging credentials and sanitizes backend errors.
Staff authentication cannot substitute for supplier phone verification.
Unsaved form entries survive an expired verification session and stale saves.

The Supplier Links admin screen shows registered OTP numbers, prevents issuing a
link without a valid mobile number, exposes connectivity checks, and saves shared
RFQ/PO business headers, titles, image instructions and captions. For example,
the header can be G-E-N. Shared templates are staff-image defaults; existing
personal document edits override them. Company category routes retain their
existing saved templates. Background quoted POs use the shared PO template for
both PNG and caption, without a Direct PO label. The database approval snapshot
includes branding, so changing it invalidates a previously authorized unclaimed
dispatch. Existing quote/PO quantities and purchasing limits are preserved.

All gateway send paths now accept either their existing private address or an
explicitly pinned HTTPS relay origin, never a request-supplied destination.
Redirects are rejected. Netlify cannot resolve Railway private-network hosts.
Company automatic RFQ/PO sending additionally requires the delivery-verification
flag. Existing manual PNG/caption sharing remains independent of the gateway.

## Verification

- 469 unit/contract tests passed, including OTP API guards and shared PO branding.
- All 24 isolated database suites passed. New OTP checks cover wrong phone,
  normalization, anonymous bypass, resend/hourly limits, persistent failed
  attempts, expiry, challenge replacement, replay, forged/expired sessions,
  changed phone, revoked links, verified draft saves and branding permissions.
- TypeScript and production Next.js build passed. Dependency audit: zero findings.
- Chromium supplier UI passed at 320/360/390/768/1280 pixels: OTP gate, compact
  bill, optional photos/variations, drafts, confirmation, reload, no horizontal
  overflow and two-window stale-save preservation. Supplier API responses were
  intercepted fixtures; these are UI tests, not live delivery evidence.
- Staff manual PO sharing passed at 320/390 pixels with an unavailable gateway:
  PNG bytes, matching caption, download fallback, denied clipboard, cancellation,
  no gateway POST and no automatic Sent status. CSP nonce checks passed.
- Isolated tests roll back synthetic records. No hosted data was used as fixtures.
- Native PostgreSQL concurrency for this OTP extension, actual hosted API/cookie
  integration and real WhatsApp/phone delivery remain unverified.

## Concrete release blockers

The existing one-time Netlify publication run 39914421072 failed before build or
publish because all accepted Netlify deployment-token secrets were empty. Its
log explicitly states that nothing was deployed. The browser also shows the
Netlify sign-in screen. No Netlify connector was found in plugin discovery.
Railway discovery returned UNAUTHORIZED / reauthentication required; gateway
health and its current configuration therefore could not be certified.

A read-only hosted catalog check found the existing portal installed and three
portal links, but no OTP session table. This migration is intentionally unapplied:
revoking old RPC access before the replacement API and delivery path work would
interrupt those suppliers. No production records, grants, schedules or flags were
changed. No live supplier message or OTP was sent. No paid resource was created.

## Coordinated manual rollout

1. Restore access to the existing Netlify account. Keep Git continuous deployment
   disabled. Do not deploy a different app, create a paid host, or replace data.
2. Verify existing server-only SUPABASE_SERVICE_ROLE_KEY and a dedicated
   GH_PORTAL_OTP_SECRET of at least 32 random characters. The implementation can
   use the service key as a pepper fallback, but a dedicated secret is preferred.
   Never place these values in NEXT_PUBLIC variables, source, logs or chat.
3. Restore the existing gateway and verify its WORKING session. If using an
   HTTPS relay from Netlify, set WAHA_BASE_URL, GH_WAHA_HTTPS_ORIGIN to its exact
   origin, and server-only WAHA_API_KEY / WAHA_SESSION. Keep it authenticated.
4. Test the candidate in a controlled preview with its isolated schema. Verify a
   restorable current backup and live function prerequisites before applying only
   20261023070002_supplier_portal_otp_security.sql. Coordinate this with the new
   frontend/API release; old supplier pages must not remain the active entry point.
5. Manually publish this tested candidate to the existing Netlify site, configure
   GH_PORTAL_OTP_SENDING_ENABLED only after the code-delivery pilot is verified,
   and check the live SHA, permissions, cookie behavior, expiry and existing links.
   Keep GH_PORTAL_DISPATCH_ENABLED, GH_PORTAL_DELIVERY_VERIFIED and
   WAHA_SENDING_ENABLED false until their separate real-delivery gate is satisfied.
6. Test exact intended recipients, registered-number rejection, one OTP, protected
   quotation save, Prices synchronization and the approved PO/image/caption flow.
   Gateway acceptance alone is not evidence that an RFQ/PO image was delivered.
7. Netlify serverless runtimes do not provide a reliable long-lived setInterval
   dispatcher. Purchasing already has its independent database scheduler. A
   supported scheduled dispatch invocation and its stop switch must be configured
   and tested before calling unattended WhatsApp dispatch production-ready.

Do not certify full automation or expose an OTP bypass to work around missing
credentials, an unreachable gateway, scheduling or unperformed delivery checks.
