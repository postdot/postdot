# Local event calendar experiment

This directory contains the local copy of the public ReUI Event Calendar
primitive used for the calendar experiment. It is intentionally vendored so
Herald owns the implementation and does not depend on a runtime ReUI package or
future upstream updates.

Source: <https://reui.io/r/base-nova/event-calendar.json>

The first experiment keeps only the shared state, month view, recurrence, drag
engine, and event primitives needed by Herald. Week/day/resource views are not
enabled yet. Herald-specific styling and publication behavior live outside this
directory in `publication-calendar-experiment.tsx` and
`publication-calendar-experiment.ts`.
