# ADR-073 — Use In-Cell Calendar Actions and a Sticky Time Gutter

- Status: accepted
- Scope: ReUI Week/Day time grid and its local reading toolbar
- Provenance: ISSUE-096, owner feedback on 2026-09-13
- Supersedes: ADR-072 for the geometry and placement of the Week/Day create action; ADR-071 item 2 for the visible shortcut set

## Context

The external transient frame introduced by ADR-072 still adds a visual
envelope outside the cell and places the create control on its boundary. The
owner's intended dense interaction is more direct: the existing cell remains
the spatial owner, and a small `+` can temporarily sit above its publications
when the operator points at or focuses that cell. The action must not push a
publication down or become a second card layer.

The first shortcut disclosure also exposed every calendar reading key in the
toolbar. In daily use, the `[`, `T`, and `]` keycaps compete with the controls
instead of helping the operator. The view switcher is the one local group
where a compact disclosure remains useful. Finally, the Week view can scroll
horizontally; losing the hour gutter while reading a later column breaks the
time-axis relationship.

## Decision

1. In Week/Day, render the `+` as an absolutely positioned child of the
   existing time slot, near its inline-end/start corner according to the
   writing direction. It is hidden at rest and revealed on slot hover or
   `focus-within`; it has a higher interaction z-index than the publication
   stack, remains inside the slot's bounds, and does not add layout space.
   Occupied-slot background clicks remain inspection/no-op while the explicit
   `+` creates; empty-slot behavior and date/time routing remain unchanged.
2. Keep visible `Kbd` disclosure only in the local view switcher (`M`, `W`,
   `D`, `A`). Remove the navigation keycaps from Previous, Today, and Next
   for now. Preserve `aria-keyshortcuts` and the existing calendar-scoped
   hotkey behavior so accessibility and keyboard operation do not depend on
   visible decoration.
3. Make the shared `Kbd` compact and readable with a distinct semantic field
   surface and foreground contrast. A shadow must not be its sole visual
   boundary; no explanatory shortcut legend is added by this decision.
4. Make the time-gutter cells sticky at the inline start of the Week/Day
   scroll surface. Give the empty header intersection the highest local layer,
   keep the day header sticky on the vertical axis, and use the gutter surface
   to obscure horizontally passing day content without adding decorative
   borders.
5. Do not add a global shortcut-help surface, new commands, drag/resize, or
   a permanent action row to empty slots. Each is a separate product decision
   that requires usage evidence.

## Alternatives considered

- **Keep the external frame and action band:** rejected; the owner found the
  boundary placement visually confusing and contrary to the dense in-cell
  interaction model.
- **Put the button in normal flow above the events:** rejected; it consumes
  vertical space in every occupied slot and changes the content geometry just
  to disclose one action.
- **Render a permanently visible button or key legend:** rejected; it adds
  daily chrome and weakens progressive disclosure.
- **Show all shortcut keycaps in a dedicated toolbar legend:** deferred; the
  current pilot needs a smaller, local disclosure before a separate help
  surface can be justified.
- **Duplicate the hour labels in a frozen overlay:** rejected; a sticky grid
  gutter preserves one temporal axis and avoids redundant markers.

## Consequences

- Dense cells keep their existing content width and vertical rhythm while the
  create action is directly available on hover or focus.
- The view switcher remains self-documenting for its own commands without
  turning period navigation into a row of cryptic symbols.
- The sticky gutter consumes the same column it already owns and improves
  horizontal scanning at the cost of a small stacking rule at the scroll
  surface's corner.
- Tests must verify action layering and geometry neutrality rather than an
  external frame. Future contextual actions must earn their place and must
  not silently expand this overlay into a toolbar.
