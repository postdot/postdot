# DESIGN-121 — Provider applications first-visit density

## Scope

Reduce the visual weight of the empty instance-level provider application
screen while keeping the OAuth setup context and all application-management
behavior intact.

## Changes

- Shortened the page description and the application form's instance-scope
  note.
- Replaced the large empty application card with a compact dashed row beside
  the already-visible creation form.
- Kept the instance-settings badge and the OAuth relationship visible so the
  scope is not hidden behind the density pass.
- Added shorter English and French empty-state copy.
- Extended the existing authenticated E2E journey to visit the provider
  applications screen and assert its first-visit state.

## Boundaries

- No provider application API, OAuth, credential, database, or routing changes.
- No changes to provider-specific fields, secret handling, default selection,
  enable/disable behavior, or edit flow.
- `DESIGN-121` remains open for any remaining shell/configuration review.

## Validation

- `bun run check`
- `bunx playwright test e2e/publication-media.spec.ts`
- i18n coverage: 779/779 messages in `en` and `fr`

