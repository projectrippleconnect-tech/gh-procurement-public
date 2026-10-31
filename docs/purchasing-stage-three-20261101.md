# Stage 3 release — purchasing simplification

The release carries the Stage 2 Work, Stock and Receive simplification forward from production revision `4dff0444f6280d815ec5179bc9b286d2a88df92f`. It preserves that revision’s shared HTTPS WhatsApp gateway validation, redirect rejection and uncertain-delivery reconciliation, plus the current manual connection diagnostic workflow.

Stage 2 evidence: [quality run 41230937853](https://github.com/projectrippleconnect-tech/gh-procurement-public/actions/runs/41230937853), eight successful jobs, 497 unit/integration tests, 23 isolated database suites and all existing browser modes. The combined release candidate is checked again before publication.

## Rollout

1. Validate the combined release candidate.
2. Apply only the two read-only Work migrations after checking production schema and grants.
3. Pin the manual Netlify workflow to the validated candidate.
4. Publish to the existing gh-procurement site, with unattended sending flags disabled.
5. Check the exact live revision, database/schema health, login, CSP, quotation route and unauthenticated write boundaries.

No supplier messages or production business records are created as release tests. Existing project-wide security/performance advisory findings remain separately documented in the Stage 2 report. The previous deployment remains the rollback target; the additive read-only functions are compatible with it.

Release outcome and evidence will be recorded after production verification.
