# WEB-124 — Ambiguous publication recovery surface

- Status: implementation complete on `feat/web-124-ambiguous-recovery`
- Scope: expose the existing publication reconciliation contract in the web editor
- Related: `.autonomos/worklogs/2026-09-09-WEB-124-browser-matrix.md`, `SPEC-007`

## Change

- Added a compact editor outcome panel that appears only for an ambiguous
  publication.
- The operator can mark the outcome as published or failed without retrying the
  provider. A published URL is optional and is sent only for the published
  resolution; the existing durable ambiguity detail is used as the failed
  reason.
- Added the typed web client call for
  `POST /api/projects/:projectId/publications/:publicationId/reconcile`.
- Added matching English and French copy without exposing provider payloads or
  credentials.

## Validation

- `e2e/web-124-ambiguous-recovery.spec.ts` verifies the editor action in an
  isolated browser database, including both resolution choices, a failed
  reconciliation request, recovery after that error, and no provider call.
- The full `bun run check` gate passed: format, lint, typecheck, unit tests,
  six browser tests, and build.
- Both locale catalogs remain at 100% coverage (774/774 messages).

## Boundary

- The API remains the source of truth for allowed state transitions and
  project authorization.
- This surface does not add automatic retry or infer provider success from a
  timeout; it records only the operator's explicit decision.
- `WEB-124` remains open for the final independent visual audit and owner
  reconciliation; this work closes the previously documented editor recovery
  gap.
