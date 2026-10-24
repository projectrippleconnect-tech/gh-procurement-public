# Manual Netlify release candidate — 24 October 2026

Combines PR 140 (compact pop-ups and in-app work notifications) with the supplier-form simplification from PR 139. Includes the CI regression fix that keeps destructive-confirmation errors inside their dialog, accessible to the active focus scope.

The supplier form contains item description, requested quantity, available quantity, rate, optional variations and photos. Removed delivery and extra-charge sections remain absent. Existing hidden commercial data is preserved, but the simplified supplier form does not falsely confirm unseen delivery/validity terms. Automatic award eligibility therefore remains subject to the existing review gates.

Verified locally on the combined candidate:
- 460 unit/contract tests pass.
- Production Next.js build and TypeScript pass.
- Supplier portal browser regressions pass at 320/360/390/768/1280px, including drafts, price entry, variations/photos, confirmation, reload and concurrent-edit conflict handling.
- Destructive confirmation regression passes at 320/390/1366px before the supplier-only integration.
- Staff notification regression previously passed at 320/390/1280px; supplier-only integration does not alter notification code.

Target: the existing gh-procurement Netlify project. Automatic deployments remain disabled. No migration or production business-record changes are part of this release. PR 138 OTP/authentication changes are excluded pending their coordinated API/migration/delivery gates.

Netlify dashboard sign-in was verified. CLI publication is blocked on explicit authorization: Netlify CLI requests permission to create/manage projects across the user's teams. Automatic approval review rejected granting that broader scope without specific user approval. No production publication has occurred.

Closed-app Web Push remains unimplemented; this release provides visible-app polling and reminders only.
