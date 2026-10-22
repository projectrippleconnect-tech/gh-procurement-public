# GH Procurement stock fixes — 22 October 2026

Branch: `feature/supplier-quote-portal-20261021`
Base: `3ed39372d40ffdb8ac21ea0748084e479ea2b2e1`

Integrated the existing General history fix and mobile scrolling fix into the
latest supplier portal candidate, preserving its Netlify adapter, scheduler and
native verification work. No production records, migrations or settings changed.

## Result

- General stock history has a shortcut beside Back/Forward, independent of item
  search, paging and movement filters. Its dialog loads up to 100 recent submissions,
  filters Company counts out, displays count details and offers refresh/retry.
- Escape and the close button dismiss the dialog; focus returns to its opener.
- The General filter summary and Company stock search header scroll normally on
  mobile instead of covering stock rows. Existing submit controls are preserved.
- Company history and item-level history/recount remain separate.

## Fresh verification

- Locked dependency installation with lifecycle scripts disabled: passed.
- Unit/contract suite: 454 passed, zero failures or skipped tests.
- TypeScript check and production build: passed.
- Isolated PGlite database regression: all 23 suites passed.
- New browser mode `GH_UI_STOCK_HISTORY=1`: passed at 320, 390, 768 and 1366 px.
  It opens the General shortcut, checks Company exclusion, expands stored detail,
  dismisses with Escape, verifies focus return, switches to Company Items and
  checks mobile computed positioning. No stock submission occurs in this flow.
- Browser also checked response-specific CSP nonces and client override refusal.
- JavaScript syntax and whitespace checks: passed.

Browser fixtures intercept database requests and use synthetic records. These
checks do not certify hosted permissions or real supplier messaging. Chromium
was extracted from the existing local serverless-browser package for this run;
the application dependencies were not changed.

## Deployment status

This integration has not been deployed. The existing Netlify deployment remains
the private review build described in `NETLIFY_MANUAL_RELEASE_20261022.md`.
The earlier automatic approval review rejected removing site-wide Netlify SSO
without specific public-access approval. That boundary was not changed or bypassed.
Public production access still requires that explicit approval while retaining
the application's own authentication and database authorization.

The four supplier-portal production migrations remain pending a verified
restorable backup and hosted checks. Purchasing, dispatch and supplier messaging
remain disabled. Google Sheets and WhatsApp server integrations still require
verification on the alternative host. No new hosting charge or CI run was requested.

The changes are committed locally. Automatic approval review rejected the GitHub
push because explicit external publication authorization was required; it warned
that publishing code to the remote could expose sensitive content. No alternate
push/API upload was attempted. Explicit permission to push this integration is
required before updating the remote development branch.

## Approved live release continuation

The user subsequently explicitly approved making the tested changes live, in
response to the request to publish the code and enable public Netlify production
access while retaining app authentication. The release can proceed within that
scope. Database backup, migration and messaging gates above remain unchanged.
