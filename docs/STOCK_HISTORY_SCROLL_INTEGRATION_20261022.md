# GH Procurement stock fixes — 22 October 2026

## Latest outcome — live release verified

The UI update is live at https://gh-procurement.netlify.app/ on 22 October 2026.
Successful deployment: `6ada137695ff439257bf5b0e`.
Verified application version: `73f6128c837e9c8fbf422b887b8181d844698dc5`.
This latest outcome supersedes the earlier deployment and authentication blockers
recorded below. Supplier portal database/activation gates are unchanged.

Fresh hosted checks passed:
- Public application login screen; approved GH accounts only, registration disabled.
- HTTP 200 health, connected existing database and ready existing schema; exact version above.
- Login CSP nonce and no-store; local OCR language asset HTTP 200.
- Unauthenticated RFQ sending and supplier-portal worker both rejected with HTTP 401.
- Supplier entry/link pages HTTP 200 with private/no-store and no-referrer headers.
- Hosted JavaScript `2s7e-40c0064_.js` and CSS `0x7itexm_-15r.css`
  have exactly the SHA-256 hashes of the tested release files, including General
  history controls and scrolling styles. No live staff login or business write used.

The user explicitly approved the Netlify CLI access scope after automatic review
rejected its earlier authorization. CLI authentication then succeeded. Production
is public; non-production deployments retain Netlify SSO. Repository linking remains
off. Account checks showed no payment method, 300 included credits and disabled
overage accumulation. No paid plan, billing method or automatic deployment was added.

Packaging and corrections:
- Next build and TypeScript passed. Netlify optional type/dependency lookups stalled;
  bounded local fetch/process timeouts were tried without changing application code.
- The new middleware inputs and ESZIP are byte-identical to the verified prior build:
  SHA-256 `f827d2904647fb4eefccaed5799da420674cb08c8f79e57a52c3478881d8d9b3`.
  That unchanged artifact was reused, with fresh app/static files and deployment blobs.
- An initial published package omitted routing metadata and returned 404. A corrected
  package routed requests but failed initialization because its generated archive base
  still pointed to the build directory. Both defects were fixed in the final package:
  source/manifest paths aligned, includedFilesBasePath rebased, cached functions bypassed,
  and the runtime module successfully imported locally before the successful release.
  Server ZIP: 1,348 entries; CRC check passed; root handler and runtime modules present.
- An attempted restore of the previous deployment was rejected by automatic approval
  review because rollback was not explicitly authorized. No alternate rollback occurred;
  the approved new deployment was corrected and passed all hosted checks above.
- The generated static directory was explicitly deployed, resolving the OCR-file 404
  observed on the old review deployment. Do not upload the restored raw .next build
  directory after a separate adapter build; retain the adapter's generated static assets,
  function source/config/manifest paths, deployment blobs and edge bundle together.

Purchasing, dispatch, verified-delivery and WAHA sending flags are false in this
release; database scheduler mode is selected. No production migration or business-row
change occurred. The four portal migrations still require a verified restorable backup
and hosted permission checks. Real WhatsApp delivery and Google Sheets/WhatsApp server
integration checks are still pending; this UI release does not certify those features.

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

## Publication and current authentication blocker

Approved code publication succeeded through the connected GitHub app at commit
`73f6128c837e9c8fbf422b887b8181d844698dc5`. Shell Git authentication was absent;
no additional CI or auto-deploy was enabled.

Netlify CLI reported NOT_LOGGED_IN and the browser showed the normal Netlify
login screen. The user selected Google and the existing account through secure
browser authentication. Google advanced to its security-code challenge; a
secure code request returned user_took_over, and the last observed page remained
on that challenge. Manual authentication handoff is open. No live deployment or
Netlify access change has occurred in this continuation. Resume by verifying
Netlify's signed-in state, then deploy the tested candidate and run hosted checks.
