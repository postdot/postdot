# ADR-071 — Make Calendar Reading Affordances Explicit Without Adding Noise

- Status: accepted
- Scope: authenticated ReUI calendar toolbar and Week/Day time-grid slots
- Owner: project direction
- Provenance: ISSUE-093, ISSUE-094; owner feedback on 2026-09-13
- Superseded by: ADR-073 for item 2; item 3 was superseded by ADR-072 and is
  now governed by ADR-073

## Context

The calendar already supports a small, scoped keyboard reading pilot, but its
controls do not show the associated keys. The Week/Day grid also places its
create button absolutely inside a slot while dense publication content paints
over it. Both issues reduce discoverability at exactly the point where the
operator needs to understand the current reading mode and act on a dense
schedule.

## Decision

1. The selected calendar view uses a clearly filled semantic surface and a
   readable foreground contrast. Its state must be understandable without
   relying on shadow or a barely perceptible tonal difference.
2. Visible `Kbd` keycaps are shown only beside controls that own the current
   calendar reading shortcuts: `T` with Today, `[`/`]` with previous/next, and
   `M`/`W`/`D`/`A` with the corresponding view choices. The keycaps are a
   compact disclosure aid, not a second label or a new global help system.
3. In Week/Day, an occupied time slot renders a content-driven frame with a
   compact time/action header above its publication stack. The add action is
   in that header. Empty slots do not receive an always-visible header solely
   to host the add action; their hover/focus affordance remains compact.
4. Existing interaction intent remains authoritative: `+` creates, event
   content inspects in context, and clicking an empty Week/Day slot continues
   to create with that slot's time. No drag/resize or global keyboard command
   is introduced by this decision.

## Alternatives considered

- **Keep the tonal active state and document shortcuts elsewhere:** rejected;
  it leaves the selected mode ambiguous and makes the existing pilot invisible
  during the task where it is useful.
- **Show a permanent global shortcut legend or every shortcut everywhere:**
  rejected; it adds instructional chrome to a daily operational surface and
  conflicts with the progressive-disclosure contract.
- **Reserve a fixed action row in every time slot:** rejected; it wastes
  vertical space in the overwhelmingly empty schedule and would reproduce the
  density problem the time-grid work just addressed.
- **Keep `+` absolutely over the event stack:** rejected; z-index can make the
  button visible but does not establish a stable action area or protect it from
  long/dense content.

## Consequences

- The view switcher becomes self-explanatory for both pointer and keyboard
  users without introducing a new help surface.
- Keycaps add a small amount of toolbar width; the responsive group may wrap,
  while labels and accessible names remain authoritative.
- Occupied Week/Day slots become slightly taller because their header is
  earned by content. Empty slots retain the compact baseline.
- A future shortcut-help surface or user customization still requires usage
  evidence and a separate decision.
