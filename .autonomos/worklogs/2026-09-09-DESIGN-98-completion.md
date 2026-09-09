# DESIGN-98 — Operational copy density completion

- Date: 2026-09-09
- Status: completed
- Base: `0bbc44ba` (`main`, after PR #160)
- Scope: reduce repeated explanatory UI copy and operational surface weight

## Completed slices

- Composer hierarchy and source/target density were simplified while keeping
  source, destination, delivery, schedule, validation, and recovery state.
- Media was kept inline with authoring and its reusable picker preserved.
- Access and provider-application configuration became progressively disclosed:
  essential actions stay visible, while longer security and capability context
  is available on demand.
- Overview, Queue, and Channels now use a compact operational empty row instead
  of a large generic empty card. Each row retains its title, recovery guidance,
  live status semantics, and existing primary action.

## Boundary decisions

- The generic `Empty` primitive remains available for workflows where a centered
  composition is meaningful; this task does not globalize the compact row.
- Media-library, picker, notification, loading, partial, failed, and recovery
  states remain governed by their own contracts.
- No API, domain, route, provider, realtime, or localization contract changed.

## Verification

- Full local `bun run check` passed.
- English and French catalogues remained at 778/778 messages.
- The six Playwright scenarios passed in the final validation.
- PRs #157, #158, #159, and #160 are merged into `main`.

## Follow-up

The next UX work is not another copy sweep. Continue with the remaining
explicit workstreams: `DESIGN-120` (shared foundation), `DESIGN-121` (responsive
shell/accessibility), `WEB-119` (state contracts), and `WEB-122` (route IA).
