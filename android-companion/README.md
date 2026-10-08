# GH Procurement Android companion (experimental)

An Android WebView wrapper for the GH Procurement Railway deployment. It uses the saved supplier phone number, the actual RFQ PNG, and the full RFQ text to attempt to open the **specific supplier's WhatsApp image-send preview** without the usual contact picker.

**WhatsApp's recipient `jid` extra is undocumented and may be ignored on some versions.** Sending to the wrong recipient must never happen: verify the phone number and image in WhatsApp before tapping Send. The app does not send silently, use unofficial WhatsApp Web automation, or require an extra WhatsApp number.

## Use

1. Install the test APK from GitHub Actions on your Android phone.
2. Tap **TEST WHATSAPP (MY NUMBER)** at the top of the APK and enter YOUR OWN WhatsApp number.
3. The APK generates a sample PNG plus text and attempts to open that WhatsApp chat. Check whether it opens your own conversation directly or still shows **Send to...**. You may send the sample to yourself.
4. If WhatsApp still shows its contact picker, the experimental recipient hint is not supported on your installation. Do not deploy this feature as a guaranteed supplier-direct shortcut.
5. **Only after a successful test** should the Railway RFQ integration branch be merged and intentionally deployed. Until then, the APK's main RFQ button still uses the current live website's older sharing behavior.
6. After intentional Railway deployment, open GH Procurement inside this APK, sign in, and use RFQs -> Send Request -> **Send PNG + Text (Android)**. Verify the supplier and real PNG in WhatsApp, then tap Send.

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
