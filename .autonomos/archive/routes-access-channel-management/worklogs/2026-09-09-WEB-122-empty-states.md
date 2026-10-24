# WEB-122 — Differentiate Overview and Queue empty states

- Date: 2026-09-09
- Status: completed for this bounded slice; WEB-122 remains in progress
- Base: `54867043` (`main`, after PR #166)
- Branch: `feat/web-122-differentiated-empty-states`
- Related issue: ISSUE-063
- Related specification: SPEC-007

## Changes

- Overview keeps its source-first empty state and exposes a direct
  `New publication` action when the project has no publications.
- Queue now names its own empty state and offers the same creation path only
  for the unfiltered queue.
- Empty queue filters expose a nearby `Show all` action instead of repeating a
  creation explanation that does not match the selected filter.
- English and French copy was shortened while preserving the route-specific
  distinction.

## Validation

- Added `e2e/web-122-empty-states.spec.ts`.
- The focused Playwright test passes at the supported browser viewport.
- The complete repository gate is required before integration.

## Boundary

This slice changes only web composition and localized copy. It does not change
the API, domain model, route hierarchy, data fetching, provider behavior, or
the remaining Overview/Queue populated, partial, failed, and recovery states.
Those remain part of WEB-122 and will be handled in later bounded slices.
