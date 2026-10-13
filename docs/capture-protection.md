# Capture protection and searchable settings

## Supported protection

Ordinary Chrome, Edge and installed web apps do not give a website reliable
control over operating-system screenshots. Edge's `DisableScreenshots` policy
also warns that external capture methods can remain available:
https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/DisableScreenshots

For browser use on Android, the supported alternative is a managed work profile
or company-managed device with `DevicePolicyManager.setScreenCaptureDisabled`.
This requires a device/profile owner and device enrollment; it cannot be
activated by a GH website setting alone:
https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setScreenCaptureDisabled(android.content.ComponentName,%20boolean)

The existing protected Android in-app browser uses `FLAG_SECURE`. This update
keeps it enabled at startup, login, account changes, backgrounding and failed
policy verification. Only the protected Super Admin role can request an override
under **Admin → Screenshot Protection**. The override lasts five minutes,
belongs only to that signed-in session, and can be ended immediately.

The native client independently calls the backend with the session's JWT.
A JavaScript boolean or spoofed frontend role cannot clear `FLAG_SECURE`.
Each native permission lasts at most 20 seconds and must be renewed; the page
requests renewal every 10 seconds. Failed verification restores protection.
An updated APK is needed; older APKs continue blocking all captures and have
no override bridge. The ordinary browser displays the limitation and disables
the native-only override button.

This protection cannot prevent someone photographing a screen or taking control
of a compromised device. Downloaded/exported files are outside app-window
capture protection. Browser access on unmanaged devices remains an unresolved
capture path until managed-device access/enrollment is configured.

## Staff phone rollout

Staff use both personal and company-owned Android phones. Install the protected
GH Android app on either type for app-window capture protection. A Chrome shortcut
or installed PWA does not provide the native protection.

For browser sessions, enroll personal phones with an Android Enterprise work
profile and run GH in that profile's managed browser. Company phones can use a
work profile or full-device management. Set the management policy
`screenCaptureDisabled: true` within the managed scope. Personal-profile Chrome
is outside a personal phone's work-profile restriction. Enrollment and policy
deployment require the company's device-management service; neither is configured
by this application release.

A device/profile-wide capture ban also applies to Super Admin: the app's
five-minute override cannot override a management policy. If that override is
required, use the app's verified native capture control in a scope that does not
also impose a blanket device/profile capture ban.

To make browser protection an access requirement, device management must also
prevent access through unmanaged browsers (for example, through an integrated
compliance/conditional-access gateway). A user-agent string, JavaScript bridge,
or client-supplied boolean is not proof of enrollment. Until that infrastructure
exists, unmanaged-browser access remains available and screenshot prevention is
not complete across every access route.

Management policy reference:
https://developers.google.com/android/management/reference/rest/v1/enterprises.policies

## Settings search

Search visible, authorized settings sections by title, labels, descriptions
and accessibility labels. Multiple search words can match anywhere in one
section. Title matches come first. Results filter the sections; selecting a
result or pressing Enter expands and scrolls to it. Clearing restores all
permitted sections. Search does not grant access to hidden role controls.

## Release

Apply `20261013065345_procurement_capture_controls.sql` and deploy the updated
web client only after a Deploy command. Build/install the updated Android APK
separately. All sessions start with capture overrides disabled. Automatic
production deployment remains disabled.

## Protected work-session clause (web app)

The sign-in screen and Screenshot Protection settings now display the requested
work-session policy: non-Super-Admin users must use an authorized protected
work-browser session and must not capture the interface. Personal phones are
permitted; a dedicated phone or GH APK is not a prerequisite. Super Admin capture
exceptions must be authorized in the browser-management policy.

**This release adds a policy notice, not technical enforcement.** No Intune/Entra
management connection is currently configured by this release. The notice explicitly
states that ordinary browser screenshots remain possible. It does not reject logins,
claim a session is verified, or let a frontend control bypass capture restrictions.

Before enforcing the requirement:

1. Configure a work-browser protection policy that blocks screen capture on each
   supported platform. For Android, Intune Company Portal and a work account are
   required for app-protection policies. Test Microsoft Edge on the actual phones.
2. Register/integrate GH Procurement with Entra and configure Conditional Access
   requiring the protection policy. Confirm support for the chosen platform and
   custom web application before rollout; policies vary by platform.
3. Enforce the verified session requirement in GH's backend/data access. Its
   existing direct Supabase login and APIs must not remain an alternate bypass.
   A user agent, browser flag, local storage value or password alone is insufficient.
4. Provision/test a Super Admin recovery path and separately managed exceptions,
   then test staff, Super Admin, personal-browser, direct-API, revoked-session and
   screenshot behavior. Keep the website in the pending state until those checks pass.

References:
- https://learn.microsoft.com/en-us/intune/app-management/protection/ref-settings-android
- https://learn.microsoft.com/en-us/deployedge/microsoft-edge-enabling-dlp-features
- https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-grant

Deploy only after the owner's Deploy command. Publishing this clause does not
activate a browser-management service or require device enrollment by itself.
