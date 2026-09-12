---
name: herald-operational-ux
description: Review and build Herald's authenticated operational UI with disciplined hierarchy, progressive disclosure, and unambiguous interaction intent.
metadata:
    short-description: Apply Herald's operational UX rules
---

# Herald operational UX

Use this skill for authenticated Herald surfaces, especially calendar,
queue, compose, contextual panels, drawers, dialogs, and responsive shell
changes. It turns the product direction into an operational review gate; it
does not replace the route contract in `DESIGN.md` or decide unresolved product
meaning without an owner checkpoint.

## Before changing a surface

Read the root `DESIGN.md`, the target scope's `AGENT.md`, and the relevant
accepted route or domain contract. Identify the surface's one operator job,
the object being acted on, and the next meaningful action. Inspect the actual
populated, empty, loading, and failure states at the widths affected by the
change before choosing composition.

## Hierarchy and copy rules

- Let invocation establish context. A panel opened by clicking a publication
  should lead with that publication; do not add a visible label such as
  “Preview” or “Details” when the title and content already establish it.
- Remove copy that only announces what the surrounding control already makes
  obvious. Keep text that communicates state, capability limits, recovery, or
  a consequence the operator could otherwise miss.
- A title names the object or task. A subtitle is earned by useful metadata,
  not by a heading formula. Do not stack eyebrow, title, description, and
  empty-state prose by default.
- Use one visual representation for one fact. A status label may have one
  semantic marker or chip; do not combine an extra decorative dot with a
  status component that already includes a dot.
- A dismissible contextual surface has one primary dismissal affordance. Use
  the primitive's close button plus its established outside-click/Escape
  behavior; do not add a second “Close” action unless the task has a distinct
  reason to place it in the action row.

## Interaction intent

Classify each target as inspect, create, navigate, or destructive action before
implementing it. Adjacent targets with different intent must have distinct
hit areas and outcomes.

- Clicking an existing calendar event inspects it in context and must not
  navigate away by default.
- A calendar add control creates a publication for that date. The containing
  day cell must not silently perform the same create action when the add
  control is present.
- Clicking a day background is an inspection action: expand the day's scheduled
  publications in the calendar itself, or switch to an explicit day/agenda
  view. Do not open a separate drawer just to repeat the current calendar
  context, and do not make the day an accidental alias for creation.
- Overflow is a density mechanism, not a second navigation maze. The first
  interaction with “+N” should reveal the complete date context; avoid making
  the operator open a list and then another redundant wrapper before they can
  inspect a publication.
- A path to the full page is useful only when it is explicit and singular;
  label it with the object/action rather than a generic close or continue
  control.

## Density and responsive composition

- Do not force a seven-column month grid into a narrow viewport. Prefer an
  agenda/day composition at mobile widths; if month view remains available,
  preserve a readable minimum width with deliberate scrolling rather than
  shrinking labels and event content into noise.
- Avoid a fixed event cap chosen only for visual neatness. If events overflow,
  provide a direct date-level inspection path and keep the full set available.
- Treat calendar and agenda as different reading modes: month scans temporal
  distribution; agenda reads the ordered work for one or more days. The view
  switch and transitions must preserve the selected date and not discard
  context.
- Render at wide desktop, intermediate/tablet, and narrow mobile sizes. Check
  long titles, multiple events on one day, keyboard focus, outside-click,
  Escape, and reduced motion.

## Review tests

Use these as diagnosis before accepting a change:

1. Necessity: if the element is removed, does the operator lose state,
   hierarchy, continuity, accessibility, or a meaningful action?
2. Intent: can a reasonable operator predict the result of clicking each
   adjacent target without reading helper prose?
3. Subject swap: would the composition still look natural for an unrelated
   SaaS dashboard, or does it express Herald's source-to-destinations work?
4. Continuity: after opening a contextual surface, does the underlying date,
   publication, and return path remain clear?

Record unresolved visual/product questions as provisional evidence in the task
worklog. Promote stable owner-accepted rules to `DESIGN.md`; do not turn one
screen's temporary styling into a universal rule.
