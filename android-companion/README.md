# GH Procurement Android companion (experimental)

An Android WebView wrapper for the GH Procurement Railway deployment. It uses the saved supplier phone number, the actual RFQ PNG, and the full RFQ text to attempt to open the **specific supplier's WhatsApp image-send preview** without the usual contact picker.

**WhatsApp's recipient `jid` extra is undocumented and may be ignored on some versions.** Sending to the wrong recipient must never happen: verify the phone number and image in WhatsApp before tapping Send. The app does not send silently, use unofficial WhatsApp Web automation, or require an extra WhatsApp number.

## Use

1. Install the test APK (built by GitHub Actions) on your Android device.
2. Open **GH Procurement** from the installed companion app, not Chrome.
3. Sign in to your usual GH Procurement account.
4. Open RFQs -> Send Request -> **Send PNG + Text (Android)**.
5. Confirm the intended supplier and actual image attachment in WhatsApp; tap Send.
6. If WhatsApp opens a contact picker, the WhatsApp build does not accept this recipient hint. Do not assume it will be fixed by relaunching. Report the result.

There is no automatic transmission and no programmatic confirmation of delivery; mark RFQ Sent only once actually sent.

## Build

Open `android-companion/` in Android Studio or use JDK 17 / Gradle 8.9 / Android SDK 35:

```bash
cd android-companion
gradle :app:assembleDebug :app:testDebugUnitTest
```

APK: `app/build/outputs/apk/debug/app-debug.apk`.

## Privacy and security

- The WebView loads only `https://gh-procurement-production.up.railway.app` within the app. Other links open external apps.
- The native JavaScript bridge verifies the top-level URL is trusted before accepting a request.
- Images are stored temporarily inside the app's private cache and exposed to WhatsApp with read-only content URI permissions.
- No contact, external storage or accessibility permission; no passwords or WhatsApp session data accessed.
- **Test build only.** Before production release, perform Android device testing and security review; the debug APK is not a Play Store release.
