# Stage 3 completed — purchasing simplification

Completed 1 November 2026 (Asia/Colombo). The simplified Work / Stock / Receive / More interface is live at [GH Procurement](https://gh-procurement.netlify.app/).

## Release evidence

| Checkpoint | Verified result |
| --- | --- |
| Deployed application revision | `997dc54f5736e5e086a1e1f5ac4761fec7c08e6a` |
| Quality gate | [Run 501: all eight jobs successful](https://github.com/projectrippleconnect-tech/gh-procurement-public/actions/runs/41251717309) |
| Manual production release | [Run 8: successful](https://github.com/projectrippleconnect-tech/gh-procurement-public/actions/runs/41252031438), 7m 20s |
| Default manual-release pin | Updated on main by `13da80369d7d753a4fb34ddcbe4f2cf720e74139`; publication remains operator-triggered only |
| Independent live health response | Expected application revision, `ok=true`, database connected, schema ready |

The combined candidate retains production revision `4dff0444f6280d815ec5179bc9b286d2a88df92f`’s shared HTTPS WhatsApp gateway validation, redirect rejection and uncertain-delivery reconciliation, plus the current manual connection diagnostic workflow. Existing stock PDF, notification and directory behavior is preserved.

## Validation

The candidate passed TypeScript, the dependency audit, all 500 unit/integration tests, 23 isolated production-schema database suites, native PostgreSQL guards, all 20 existing browser modes, and Work/Receiving browser acceptance at 320, 390, 768 and 1366 pixels. The manual release repeated its build, database, supplier quotation, notifications, stock, company recount, Work and Receiving checks before publication.

Production checks passed for the exact revision, connected database and schema, login page, nonce-based CSP, no-store caching, OCR asset, supplier quotation route and rejection of unauthenticated sending. Work queries were additionally exercised under the authenticated application role with existing administrator permissions in a read-only transaction that was rolled back: every scope/tab combination returned the expected bounded shape and consistent scope totals. This was not a signed-in production browser acceptance session; browser business flows used isolated fixtures.

## Database rollout

Only the two verified additive, read-only migrations were applied. The service assigned the following production migration-history versions; retain this mapping when reconciling local migration history.

| Source migration | Production version | Name |
| --- | --- | --- |
| `20261031162540_purchasing_workspace_queues.sql` | `20261031231757` | `purchasing_workspace_queues` |
| `20261031175045_compact_work_ui.sql` | `20261031231802` | `compact_work_ui` |

All nine helper bodies match the verified source exactly. They are stable invoker functions with an empty search path, authenticated execution and no anonymous execution. The public REST endpoint returned HTTP 401 / PostgreSQL 42501 for an anonymous invocation. Existing table policies and the invoker requirements view remain in force. Security/performance advisor categories and finding counts did not increase; existing findings remain recorded in the Stage 2 report.

## Operating boundary and recovery

No production business rows or supplier messages were created as release tests. Unattended portal processing, dispatch, delivery verification and WAHA sending flags remain disabled. No new hosting service or paid resource was provisioned.

The previous deployment revision `4dff0444f6280d815ec5179bc9b286d2a88df92f` remains the rollback target. If needed, pin the existing manual workflow back to that reviewed revision and run the same publication and health checks. The additive read-only functions remain compatible with that frontend.

Browser evidence is attached to the quality and release runs with seven-day retention. GitHub reported existing runner/action runtime deprecation notices; they did not fail the release, whose application runtime is Node.js 24.
