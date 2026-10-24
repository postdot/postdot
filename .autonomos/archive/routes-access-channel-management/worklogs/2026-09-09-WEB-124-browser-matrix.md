# WEB-124 — Populated browser validation matrix

- Status: validation pass in progress on `feat/web-124-browser-validation`
- Parent: the previously merged UX/composer passes on `main`
- Scope: extend deterministic browser evidence without provider side effects.

## Added evidence

- English → French → English switching remains usable from the authenticated shell.
- The language switcher now announces the language it will switch to, rather than
  repeating the locale already active.
- A populated publication flow now exercises two distinct channels, shared defaults,
  a per-channel content override, and an automatic delivery override.
- The same populated composer is checked at a narrow viewport for horizontal overflow
  and readable destination tabs before returning to desktop.
- Existing coverage continues to exercise media upload/reuse, queue and calendar
  projections, notification loading/failure/retry, SSE reconnect, update signals,
  and explicit resynchronization.

## Boundaries

- The test database and media directory are isolated by Playwright.
- No real provider credentials or provider publication is used.
- No production API, schema, provider, or realtime contract changes are introduced.

## Remaining WEB-124 work

- Review visual evidence for populated failed/ambiguous publications and recovery
  actions at desktop, tablet, and mobile sizes.
- Perform the final post-sprint comparison and reconcile the independent audit.

## Outcome-state fixture pass

- Added `e2e/web-124-outcome-states.spec.ts` with deterministic failed and
  ambiguous publication summaries. The fixture intercepts only the exact
  project publication read and never calls a provider or changes the database.
- Queue and calendar now have browser evidence for `Failed` and `Needs review`
  states at 1280, 768, and 390 pixels, including English/French labels and a
  no-horizontal-overflow assertion.
- The full repository gate passes: format, lint, typecheck, unit tests, five
  browser tests, build, and 766/766 messages in both locales.

This closes the populated state-visibility part of WEB-124. The browser still
does not expose a dedicated ambiguous-publication reconciliation control from
the editor; the API contract exists, so that remains a separate product/UI
follow-up rather than being hidden by this validation fixture.
