# MEDIA-182 — Recoverable media deletion

- Status: Complete
- Branch: `chore/reconcile-autonomos-ledger`
- Related issue: [ISSUE-104](../ISSUES.md#issue-104-define-the-scalable-project-media-library-contract)
- Decision: The owner chose a Trash view with restoration during the configured retention period; the existing 24-hour default remains.

## Delivered

- Normal library reads exclude deletion-requested assets; a separate bounded `view=trash` API read lists them and returns the active Trash count and configured retention duration.
- Deletion confirmations state that the asset moves to Trash and give the exact configured duration. Trash cards show their localized permanent-deletion deadline.
- Eligible assets can be restored to their saved asset and representation states, including failure details. The UI does not offer restoration for legacy or incomplete entries whose original state cannot be safely recovered.
- The purge worker claims irreversible deletion before removing stored bytes. Reconciliation can retry interrupted object cleanup, and restore/purge state changes are serialized by SQLite.
- English and French UI strings cover the Trash view, restoration, expiry, and deletion confirmation.
- ADR-019, ISSUE-104, and MEDIA-182 now record the accepted behavior and evidence.

## Verification

- `bun run --cwd packages/db test src/media-asset-store.test.ts` — passed.
- `bun run --cwd apps/api test src/modules/media/routes.test.ts` — passed.
- `bun run test:e2e --grep "keeps dashboard and composer media journeys reliable"` — passed, including deletion, Trash listing, expiry display, restoration, and return to the library.
- `bun run check:quick` — passed repository formatting, lint, spelling, and typechecks.
- `bun run test:unit` — passed across all 17 packages and repository scripts.
- `bun run build` — passed for all packages, including the production web bundle.
