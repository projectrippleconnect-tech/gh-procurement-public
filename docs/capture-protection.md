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
