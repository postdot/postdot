# DESIGN-121 — Queue filter overflow contract

- Date: 2026-09-09
- Status: completed for this validation slice; DESIGN-121 remains open
- Base: `3aaddc94` (`main`, after PR #167)
- Branch: `fix/design-121-queue-filter-overflow`
- Related issue: ISSUE-064
- Related finding: AUDIT-125 P2 queue filter strip

## Changes

- Horizontal tab lists now clip the vertical overflow axis while preserving
  their horizontal scrolling contract.
- Vertical tab lists retain vertical scrolling when their orientation requires
  it.
- Queue no longer overrides the shared vertical overflow rule.

## Validation

- Added `e2e/design-121-queue-filters.spec.ts`.
- The browser matrix checks the Queue filter strip at 1280, 768, and 390 px.
- The complete repository gate is required before integration.

## Boundary

This slice removes a layout affordance; it does not change filter semantics,
route navigation, publication data, or the remaining shell and responsive work.
