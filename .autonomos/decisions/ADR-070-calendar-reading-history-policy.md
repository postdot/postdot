# ADR-070 — Use replacement history for calendar reading state

- Status: accepted
- Scope: authenticated project overview calendar URL state
- Provenance: owner direction on 2026-09-12; ISSUE-089, ISSUE-090
- Related decisions: ADR-057

## Context

The experimental calendar stores its reading mode in the overview URL and now
needs to persist the focused civil date as well. Month changes, view changes,
and the Today control are repeated reading operations inside one route. A
history entry for every one of those clicks would make the browser Back button
replay a user's scan rather than return to a meaningful application context.
At the same time, opening Compose or an explicit publication detail is a new
operator task and should remain a normal navigable destination.

## Decision

Use `replace: true` for URL updates that change calendar reading state:

- `view=month|week|day|agenda` view switches;
- `date=YYYY-MM-DD` focused-date changes from previous, next, Today, date
  selection, and keyboard navigation; and
- preserving the other overview search parameters while applying either
  update.

Use the default push behavior for explicit navigation to another task or
resource, such as Compose or the full publication page. In-context preview
surfaces do not change the route and therefore do not add history entries.

## Alternatives considered

### Push every calendar state change

This would make Back step through every month and view the operator inspected.
It preserves a detailed temporal trail, but it pollutes history during normal
scanning and makes one Back action unpredictable. Rejected for the current
single-route calendar reader.

### Store the state only in client storage

This avoids history noise, but it prevents copied links, reload-safe deep links,
and deterministic restoration across devices. Rejected as the primary source
of truth.

### Replace every navigation in the calendar

This would avoid history noise, but it would also make an intentional move from
the calendar to Compose or publication detail difficult to undo. Rejected;
task changes keep push semantics.

## Consequences

- Calendar reading remains shareable and reload-safe through the URL.
- Back returns to the previous meaningful route instead of traversing routine
  period and view exploration.
- A user cannot use Back to retrace every date scanned in one calendar route;
  explicit route transitions remain recoverable.
- Future multi-step calendar workflows may introduce a separate history policy
  if their actions represent committed decisions rather than reading state.
