# Post-merge browser validation — 2026-09-10

## Scope

Read-only validation of the merged Postbot `main` branch after the policy and
Autonomos reconciliation PRs. No source, migration, Autonomos, or existing
database files were modified by the validation.

## Evidence

- Branch: `main`, commit `e0c7bf04`.
- Command: `bun run test:e2e -- --output=/tmp/postbot-validation-results`.
- Result: 12/12 tests passed in 31.6 seconds.
- Disposable E2E database and media were created under `/tmp/postbot-e2e-data`
  and removed during teardown.

The matrix covered authentication, project creation and isolation, overview and
calendar navigation, two destinations, mixed and media-only composition, media
library reuse, manual and scheduled queue persistence, notifications and
preferences, loading/error/retry states, realtime reconnect and resync, failed
and ambiguous recovery, and narrow responsive layouts.

## Boundary

No real provider OAuth or delivery was attempted. Provider credentials and
external side effects remain outside this deterministic validation and continue
to require the recurring, explicitly approved workflow tracked by ISSUE-021.
