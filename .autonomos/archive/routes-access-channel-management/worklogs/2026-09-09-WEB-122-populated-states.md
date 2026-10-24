# WEB-122 — Complete route composition and populated-state evidence

- Date: 2026-09-09
- Status: completed
- Base: `013381ea` (`main`, after PR #171)
- Branch: `feat/web-122-populated-states`
- Related issue: ISSUE-063
- Related specification: SPEC-007

## Implementation

- Kept Overview as the short operational orientation surface: it exposes the
  attention panel when human action is required, shows a bounded recent list,
  and sends the operator to Queue for the complete history.
- Kept Queue as the prioritization surface: it exposes complete publication
  data with explicit All, Needs attention, Scheduled, and Manual filters and
  filter-specific empty actions.
- Made the attention panel lead the publication history on narrow screens,
  while retaining the wide-screen main-list/sidebar composition.
- Preserved the calendar entry path and the existing route ownership for
  Compose, Channels, Media, and global provider settings.

## Validation

- `e2e/web-122-empty-states.spec.ts` verifies distinct first actions for empty
  Overview, Queue, and filtered Queue states.
- `e2e/web-122-populated-states.spec.ts` provides deterministic eight-publication
  data with automatic/manual, scheduled/draft, and due-human work; it verifies
  Overview truncation and handoff, Queue counts and filters, and narrow-screen
  attention ordering.
- Existing WEB-124 browser coverage continues to own failed, ambiguous, and
  recovery states; this task does not duplicate provider-outcome behavior.
- The complete repository gate is required before integration.

## Boundary

This closes WEB-122's accepted route-composition and differentiated-state
scope. It does not close ISSUE-063's broader visual/content work, redesign the
composer, add analytics, alter API/domain contracts, or replace the realtime
transport. Partial/loading/error and provider-outcome contracts remain covered
by their existing tasks and validation slices.
