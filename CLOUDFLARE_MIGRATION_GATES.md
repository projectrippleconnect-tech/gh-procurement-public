# GH Procurement — Manual Cloudflare Migration Gates

**Environment:** non-production build proof branch only; no Cloudflare project or production deployment created by this work.

## Verified architecture

- Next.js 16 static export, client-side Supabase SDK; PostgreSQL RPC, RLS, Auth, cron and Storage remain in existing Supabase.
- The public mirror now combines both browser image+full RFQ text pre-rendering and the public Android companion's native supplier recipient bridge.
- Native WhatsApp attachment sharing can hand off an image and text to WhatsApp; WhatsApp may ignore the undocumented recipient hint, and the application **cannot automatically press Send**.
- The separate GH Nexus private-source GitHub Actions proof was blocked before a runner started. This public-mirror build is the safe reproducible CI method for the current feature combination.

## Release-blocking conditions

1. **Android companion origin:** `android-companion/app/src/main/java/lk/generalhardware/procurement/MainActivity.java` pins `SITE` and its `isTrusted()` check to `gh-procurement-production.up.railway.app`. Before any switch, update both to the actual new Cloudflare production hostname, validate the origin lock, rebuild and test the APK. Otherwise the installed companion still opens Railway. Do not allow arbitrary origins in the privileged WebView bridge.
2. **Authentication:** Add the eventual Cloudflare origin to Supabase Auth approved redirect URLs. Test sign-in, password recovery, sign-out and return URL; no hardcoded service-role key in a browser.
3. **Static monitoring:** A static `/health/` page makes an RPC request in the browser only. Ordinary GET uptime checks of the HTML do **not** verify Supabase connectivity.
4. **Business workflows:** Test stock-entry drafts and submissions, last submitted stock/history, quote matching, RFQ approvals, supplier selection, purchase orders, receiving, file uploads, permission boundaries and SQL cron automation.
5. **Sharing:** On user's own WhatsApp number, test Android native supplier addressing and Chrome share sheet with image+full text. Check cancellation, missing number, permission denial, duplicate taps, file size, and ensure user verifies recipient before pressing Send. **Never** assume the image and text were actually sent merely because the native intent returned.
6. **Backups/security:** Confirm database and private file backups, successful restore, RLS review, and privileged SQL RPC access before handling material business data.
7. **Cutover:** Disable automatic deployments. Prepare a tested rollback URL and owner-approved release checklist, then migrate only after an explicit deployment instruction.

## Read-only verification

GitHub Actions job in `.github/workflows/static-export-proof.yml` performs locked install, typecheck, contract tests, static export and asset checks, then a local headless Chromium login/health rendering check. No production deployment is configured in that workflow.

## Free hosting limitations

Cloudflare Pages reduces frontend server costs, not Supabase costs, storage quotas, login limits, or the need for a supportable backup/monitoring plan. The Android wrapper requires a new trusted origin and APK re-release if the website domain changes.
