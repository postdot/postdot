# DESIGN-121 — Calendar and shell surface refinement follow-up

- Date: 2026-09-09
- Status: implementation complete on `fix/design-calendar-shell-surfaces`
- Scope: owner-requested refinement of the calendar density and dashboard shell layering
- Related issues: ISSUE-063, ISSUE-064, ISSUE-065
- Related task: DESIGN-121

## Owner feedback addressed

The first implementation corrected the calendar affordance and shell geometry,
but it still made the month view feel like a collection of cards and left the
header visually attached to the raised page. This follow-up corrects those
remaining perception problems without changing the page information
architecture or interaction model.

## Changes

- Reduced the calendar perimeter and cell gutters to a compact one-unit gap.
- Removed individual day-cell radii and field shadows so days read as one
  continuous calendar surface with separation provided by the inset background.
- Kept the empty-day create action constrained to its grid cell.
- Moved the dashboard header outside the scrollable raised page surface, so the
  header and inset sidebar share the outer canvas while the page alone carries
  the elevated surface treatment.
- Preserved sidebar collapse, mobile navigation, route scrolling, and existing
  calendar semantics.

## Verification

- `bunx playwright test e2e/design-121-shell.spec.ts e2e/publication-media.spec.ts` — passed.
- The shell browser test now verifies that the header and scroll region are
  siblings and that the raised page starts below the header.
- `bun run check` — passed: format, lint, typecheck, unit tests, 12 E2E tests,
  and production build.
