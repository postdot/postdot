# Local event calendar

This directory contains the local copy of the public ReUI Event Calendar
primitive used by Postbot. It is intentionally vendored so
Postbot owns the implementation and does not depend on a runtime ReUI package or
future upstream updates.

Source: <https://reui.io/r/base-nova/event-calendar.json>

The local copy keeps the shared state, month view, week/day publication time-grid,
recurrence, drag engine, and event primitives needed by Postbot. Week/day slots
delegate click-to-create to Postbot's new-publication flow while event positioning and
resizing remain read-only. Resource views remain intentionally out of scope.
Postbot-specific styling and publication behavior live outside this directory in
`publication-calendar.tsx` and `publication-calendar-events.ts`.
