# GH Procurement Android companion (experimental)

## Direct phone contacts (new in v0.3 test)

This APK now provides a **native searchable phone-contact list** for GH Procurement suppliers. It does not use Chrome's failing `navigator.contacts` picker, Google Contacts account sync, VCF files, or a Google service account.

1. Install the test APK on an Android phone and open it.
2. Tap **TEST CONTACTS** in the slim bar at the top. On the first run, allow **Contacts** for GH Procurement. Search for a local contact by name or number, tap one, and confirm the app shows the chosen name and number. This independent test requires **no changes to the live website**.
3. Once the corresponding web interface changes are reviewed, validated and intentionally deployed to Railway, sign in *inside this APK* and open **Company Lists → Group suppliers** or **Designated company contact**. Tap **Pick from phone**. The Android app displays its own search and returns **only your selected contact** to the editable name/number form. Tap Save contact and then Save group route where applicable.
4. Ordinary Chrome at the Railway URL will continue to use Chrome's browser picker. Android cannot grant a normal webpage direct access to the local phonebook when that picker fails. **The native behavior requires using the APK.**

Privacy: `READ_CONTACTS` permission is requested **only on tapping the native contact selection**. Matching contact results never leave the phone. The selected name/number is supplied to the GH Procurement form, and it is saved to the database **only after the user taps Save**. The app neither exports the address book nor requests a Google Contacts sign-in. Only contacts exposed by Android's contacts provider to this app are searchable; isolated work-profile/SIM contacts may depend on device configuration.

This is an **unsigned-for-production, debug test APK**, not an installed Google Play app. The owner must verify contact selection on their OnePlus/Android device before a release build or Play Store publishing. Existing security/screenshot policies remain enforced in the native wrapper.

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
- `READ_CONTACTS` is requested only for the native pick/search action. The native app reads contact choices locally; only one user-selected contact enters the web form. No external-storage or accessibility permission and no access to passwords or WhatsApp session data.
- **Test build only.** Before production release, perform Android device testing and security review; the debug APK is not a Play Store release.
