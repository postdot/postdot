# DESIGN-121 — Calendar and shell surface refinement

- Date: 2026-09-09
- Status: implementation complete on `feat/design-calendar-shell-surfaces`
- Scope: authenticated calendar geometry and shared dashboard shell surfaces
- Related issues: ISSUE-063, ISSUE-064, ISSUE-065
- Related task: DESIGN-121

## Owner feedback addressed

The owner identified two visible problems in the current authenticated UI:

1. The calendar's empty-day create affordance was larger than its day cell.
2. The month grid read as a set of lines rather than a set of distinct,
   calm work surfaces, and the shell did not clearly separate its outer canvas
   from the raised page surface.

## Changes

- Empty calendar days are now direct grid-cell links. The negative margin that
  made the hover target exceed the cell was removed.
- The month grid uses a neutral inset surface, explicit gutters, rounded day
  surfaces, and restrained field shadows instead of a border-colored grid.
- The authenticated sidebar uses the existing Base UI `inset` variant so the
  collapsed rail behavior and mobile drawer remain shared primitives.
- The dashboard page is a raised surface over the canvas; the sticky header
  remains part of that surface instead of appearing as a second floating strip.
- No API, domain, route, provider, localization, or responsive agenda behavior
  was changed.

## Verification

- `bunx playwright test e2e/design-121-shell.spec.ts` — passed.
- `bun run check` — passed: format, lint, typecheck, unit tests, 12 E2E tests,
  and production build.
- The browser test now verifies non-zero calendar gutters and padding, zero
  day-cell margin, inset sidebar semantics, and continued mobile navigation.
- The existing media/publication browser flow was updated for the intentional
  inset-shell geometry and passed without a regression.
