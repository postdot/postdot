# SPEC-007 — Postbot web route state contracts

- Status: accepted
- Scope: authenticated web shell and project route states
- Provenance: WEB-119; ISSUE-063; ISSUE-064; Muse-1.3 and Luna-max audits
- Related specification: SPEC-006
- Accepted: 2026-09-09, after review against ADR-057's route jobs and the
  representative empty, populated, partial, failed, and recovery states listed
  below.
- Related decision: ADR-057
- Amendment: 2026-09-28 — Overview remains calendar-led; compact summary widgets
  provide current-work context. There is no separate Calendar route.

## Intent

The UI must remain understandable when data is absent, loading, incomplete,
stale, failed, or changing. Empty screenshots are not sufficient evidence for
an operational publication workspace. Each route should expose the next useful
operator decision without inventing metrics or repeating a generic dashboard
template.

## Shared shell states

| State | Required behavior |
| --- | --- |
| Boot/loading | Preserve the shell, route context, and accessible landmarks; use a restrained pending representation instead of a blank page. |
| No project | Explain the project prerequisite and expose project creation or selection; do not render project actions as if the first project were selected. |
| Project loaded | Keep project identity and scope visible; show route-specific content and one primary action. |
| Project error | Explain the failed scope, offer retry or a safe navigation path, and do not silently substitute another project except for the explicit `/dashboard` default resolution. |
| Background update | Preserve the operator's current interaction; update the affected query or surface through the realtime boundary without resetting unrelated form state. |

## Route state contracts

### Overview and calendar

- No channel: make connecting or adding the first destination the next useful
  action; keep the date-oriented calendar available and do not lead with
  zero-valued publication metrics.
- Channels but no publications: make the first source composition action clear
  and show enough channel readiness to prevent a dead-end; keep the calendar
  available as a planning entry point.
- Publications present: keep the calendar as the primary surface. The compact
  summary shows only due manual work or the next scheduled publication. Omit
  zero counters, empty-state copy, stale published history, and the summary
  itself when neither widget has useful content.
- Partial or failed data: identify which summary or publication list is
  incomplete and offer recovery without hiding the rest of the project.
- No scheduled publications: retain useful date views and lead to Compose with
  the selected date.
- Scheduled publications: scan the month/agenda by local project time zone and
  keep delivery state and human-due work visible without turning Overview into
  a second Queue.
- Unscheduled publications remain discoverable through Queue or the publication
  editor, outside the date grid.
- Loading/error: preserve the selected calendar period and explain whether the
  calendar dates or publication data are unavailable.

### Compose

- Empty source: focus the source input and explain only the relationship needed
  to begin.
- Source present: make destination review, target-specific copy, media, mode,
  and schedule discoverable in a deliberate sequence.
- No active channel: explain the missing prerequisite and link to channel setup
  without losing any draft source content.
- Validation or save failure: preserve user input, identify the affected field or
  destination, and make retry/recovery explicit.
- Pending or saved: distinguish local draft state from publication/scheduling
  success; do not imply an external effect before the server confirms it.

### Queue

- No publications: explain what enters the queue and provide the composition
  path without duplicating Overview's entire empty state.
- Publications present: prioritize due-human, failed/recovery, draft, and
  scheduled work through filters and readable state; keep the source/destination
  relationship visible in each row.
- Filter empty: explain the selected filter specifically and provide a nearby
  way to change or clear it.
- Realtime update: preserve filter and scroll context where possible and show
  meaningful state changes without a full-page reset.

### Channels

- No channels: explain that destinations are required before automatic delivery
  and expose the add-channel action.
- Channel without connection: distinguish destination identity from connection
  readiness and explain the next setup action.
- Connected channel: show the user-facing destination name and provider account
  without leaking internal profile/version identifiers into the primary view.
- Connection error or disconnect: state the scope and consequences before any
  destructive action and preserve channel history where the domain allows it.

### Media

- No assets: show a clear upload/import action and the verification expectation
  without a second full explanatory essay.
- Verifying/failed: retain the asset identity, progress or failure reason, and
  a retry/recovery action.
- Assets present: make selection, reuse, and destination capability differences
  visible without turning Media into a second editor.

### Global provider settings

- Instance scope must be visible and distinct from the selected project.
- No applications: explain that this is provider application configuration, not
  a connected channel, and expose the creation action once.
- Existing applications: distinguish list, active/default state, and creation
  or editing actions without duplicate headings or ambiguous buttons.
- Error/loading: preserve the global settings context and never silently route
  the user through the first project.

## Accessibility and localization requirements

- Every icon-only control keeps an accessible name and a discoverable tooltip
  where visual context is insufficient.
- Truncated labels expose their full value without changing the layout.
- English and French preserve the same state distinctions and action hierarchy;
  translated copy must not be used as a reason to truncate a critical value.
- Keyboard focus, reduced motion, loading announcements, and error recovery are
  part of the route state rather than a final polish step.

## Validation requirements

- Test each route with empty, representative populated, loading, partial,
  failed, and recovery fixtures.
- Test at wide desktop, tablet, and narrow mobile widths in both locales and
  both themes.
- Test direct navigation, reload, focus traversal, realtime update, reconnect,
  and preservation of unsaved Compose input.
- Do not use real provider publication or destructive account actions as a
  substitute for deterministic UI fixtures.

## Out of scope

- This draft does not choose the final component composition, copy wording,
  visual token values, or data-fetching implementation.
- It does not change API/domain contracts or add new provider capabilities.

## Implementation boundary

This specification is normative for the meaning of route states and the
operator's next useful action. It does not claim that every route already
implements the contract.

- `WEB-122` owns route composition and differentiated empty states.
- `DESIGN-121` owns shared shell, navigation context, and responsive behavior.
- `WEB-123` and `WEB-124` own the already identified accessibility, responsive,
  localization, fixture, and browser-validation slices.

Those implementation tasks may refine wording or composition, but they must
preserve the state distinctions, recovery paths, and scope boundaries defined
here. A route is not considered migrated merely because its empty screenshot
looks shorter.
