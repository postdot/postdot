# DESIGN-121 — Access first-visit density

## Scope

Reduce the amount of explanatory copy and visual weight on the project Access
page without changing token permissions, secret handling, revocation, or API
contracts.

## Changes

- Kept the page-level explanation behind the existing disclosure so the title
  and primary action remain immediately visible.
- Removed the repeated create-panel description and field help copy; the form
  label and placeholder now carry the required context.
- Removed the repeated token-list metadata note; each token row still exposes
  its non-secret prefix, expiry, creation date, and active/revoked state.
- Replaced the large first-visit empty card with a compact dashed row that
  points to the visible create form.
- Kept the one-time secret panel unchanged because its warning and copy action
  are safety-critical.
- Added the shorter empty-state copy in English and French.
- Extended the existing E2E workflow to assert the initial no-token state
  before creating a token.

## Boundaries

- No API, database, token, authorization, or routing changes.
- No changes to populated token rows or revoke behavior.
- `DESIGN-121` remains open for the provider-application first-visit pass and
  the remaining shell/configuration density work.

## Validation

- `bun run --cwd apps/web format`
- `bun run --cwd apps/web lint`
- `bun run --cwd apps/web typecheck`
- `bunx playwright test e2e/publication-media.spec.ts`
- i18n coverage: 779/779 messages in `en` and `fr`

