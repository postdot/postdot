# DESIGN-121 — Localized sheet close affordance

- Date: 2026-09-09
- Status: completed for the shared sheet accessibility slice; DESIGN-121 remains open
- Base: `8eb64f19` (`main`, after PR #162)
- Branch: `feat/design-121-localized-sheet-close`

## Changes

- Added an explicit close-label prop to the shared Sheet primitive.
- Passed the application locale through the mobile workspace drawer and the
  notification inbox, so the close control uses the active locale instead of
  the primitive's English fallback.
- Extended the responsive shell scenario to switch to French, verify the
  localized drawer close control, close the drawer, and reopen navigation.

## Boundary

This slice only hardens shared dialog/drawer accessibility and localization.
It does not close the broader shell task: narrow Queue/Compose composition,
long channel labels, focus-order review, and tablet visual review remain open.

## Verification

- `bunx playwright test e2e/design-121-shell.spec.ts` passed.
- `bun run check` passed: format, lint, typecheck, unit tests, E2E, and build.
- English and French catalogs remained at 778/778 messages.
