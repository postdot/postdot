# ADR-072 — Use an External Transient Frame for Dense Calendar Slots

- Status: superseded
- Scope: ReUI Week/Day time-grid occupied-slot interaction affordance
- Provenance: ISSUE-095, owner feedback on 2026-09-13
- Supersedes: ADR-071 item 3 only, for the geometry of the occupied-slot frame
- Superseded by: ADR-073

## Context

The Week/Day grid needs a reliable create affordance when several
publications share a slot. A first implementation placed a new surface and
action header inside the cell. That solved z-order but spent more of the
already scarce content area and treated an incidental time label as a primary
piece of the interaction.

The owner’s intended pattern is an interaction envelope around the cell: it is
absent at rest, appears when the operator points at or focuses the cell, and
can carry actions without changing the cell’s normal content geometry.

## Decision

1. Keep the existing time-slot surface and publication stack in normal flow;
   do not add an occupied-only inset wrapper or header.
2. Render a non-flowing outer frame around the slot on hover and focus-within.
   The frame may use a restrained interaction outline because it communicates
   the active target, but it must not become a permanent border or shadow.
3. Place the `+` create action in the frame’s external action area. It remains
   a real keyboard target for an occupied slot and does not cover publication
   content.
4. Do not render an incidental slot-time label in the frame. The time gutter
   and the button’s accessible name already provide the temporal context.
5. Empty slots retain their compact baseline and reveal only their existing
   hover/focus create affordance; they do not receive an empty frame solely to
   reserve an action area.

## Alternatives considered

- **Keep the inner frame and header:** rejected; it protects z-order by adding
  an extra inset surface and consumes content space in the dense case.
- **Keep only an absolutely positioned `+` over the publication stack:**
  rejected; it can still be painted over or become difficult to target beside
  long publication content.
- **Reserve a permanent external action row:** rejected; it changes the
  geometry of every slot and conflicts with the compact empty baseline.

## Consequences

- Dense publication content keeps the same width and padding at rest.
- Hover and keyboard focus provide a visible cell-level target without a new
  card layer.
- The external action area can later host contextual actions, but no additional
  action is introduced by this decision.
- Browser tests must assert frame geometry and action ordering rather than an
  inner header’s layout.
