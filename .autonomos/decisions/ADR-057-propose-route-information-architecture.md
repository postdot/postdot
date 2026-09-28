# ADR-057 — Propose a route-oriented Herald workspace with progressive disclosure

- Status: accepted
- Scope: authenticated web route hierarchy and first-action contracts
- Provenance: WEB-118; ISSUE-063; independent Muse-1.3 and Luna-max audits
- Related specification: SPEC-006
- Related decisions: ADR-007, ADR-023
- Supersedes: none
- Owner amendment: 2026-09-28 — retain the calendar as Overview's main
  surface; replace the proposed action-first landing and separate Calendar
  route with a calendar-led Overview and compact current-work widgets.

## Context

Herald's accepted design direction describes a quiet dispatch desk in which one
source becomes several accountable publications. The initial proposal treated
Overview and Calendar as separate destinations, while the live application
keeps the calendar on Overview. The audit found that the current summary relies
on plain counters and that the first operational surfaces can look too similar
when empty.

Two independent read-only audits agree that the visual foundation is broadly
coherent but identify route hierarchy, progressive disclosure, shell context,
and responsive accessibility as the next product risks. The owner wants Herald
to hide complexity by ordering and grouping it, using icons and spatial
relationships where appropriate, without removing capabilities or turning the
application into an unexplained collection of compact controls.

## Decision

Retain the route-oriented workspace and assign each route one primary operator
job, one first useful action, and one distinct empty/data contract. Overview
owns the calendar as its primary planning surface, with a compact summary area
for current work. Queue remains lifecycle and human-action triage. Do not add a
separate Calendar route or turn Overview into a text-first task list.

The accepted hierarchy, as amended on 2026-09-28, is:

| Route | Primary job | First useful action | Must not become |
| --- | --- | --- | --- |
| Overview | Scan publication timing and understand the most important current work | Choose a date, inspect a calendar item, or follow a compact attention signal | A second Queue or a metric wall |
| Compose | Create one source and review its destination publications | Start with source content, then add/review destinations | A settings form or a tour of every capability |
| Queue | Prioritize publications by lifecycle and human action | Open the next due, failed, draft, or unscheduled item | A duplicate Overview summary |
| Channels | Manage destination identity and connection readiness | Add, inspect, connect, or repair a destination | A provider-internals or credential dump |
| Media | Manage reusable verified assets | Upload, inspect, select, or recover an asset | A second Compose surface |

The calendar is embedded in Overview, remains available when no publications
are scheduled, and keeps its date and reading-mode state in the Overview URL.
The compact summary highlights due manual publications, the next scheduled
publication (or latest published fallback), and activity in the selected week.
It orients the operator without claiming to be a complete Queue count.

The shell should distinguish project-scoped work from global instance settings.
The project selector and project navigation remain visible when a project is
selected; provider-application settings must visibly communicate their
instance scope and must not silently appear to belong to the first project.
Reduced navigation must preserve accessible names and tooltips even when labels
are hidden visually.

Progressive disclosure is part of the accepted contract:

- Keep the source, destination, lifecycle state, schedule, and next action
  visible when the route's job requires them.
- Remove repeated explanatory prose when the relationship is already clear
  from labels, grouping, icons, or established vocabulary.
- Move secondary explanation, provider details, and advanced options into
  contextual details, tooltips, drawers, or dedicated detail surfaces.
- Never hide an error, destructive-action consequence, accessibility name,
  recovery path, or capability limitation merely to reduce visual density.
- Use a compact action-oriented empty state per route rather than reusing one
  generic publication-empty card everywhere.

The calendar inside Overview keeps a date-oriented entry path when there are no
scheduled publications. The owner selected the existing calendar-led structure
over the proposed action-first landing; calendar composition and summary widgets
remain subject to rendered review with realistic data.

## Alternatives considered

### A. Collapse all work into one unified workspace

Overview, Queue, Calendar, and Compose would become modes or panels inside one
route. This could reduce navigation, but it would make deep links, browser
history, keyboard orientation, and the distinct time/prioritization contracts
less clear. It also risks recreating a dense dashboard with hidden modes.
Rejected for now; reconsider only if evidence shows route switching itself is a
dominant user cost after the contracts are clarified.

### B. Make Compose the only primary surface

Overview, Calendar, and Queue would become secondary filters around the editor.
This would emphasize the source-to-destination relationship, but would make
review, recovery, and scheduling feel like side effects of authoring. It would
also weaken the operational distinction between preparing work and operating
work already in flight. Rejected for the current product stage.

### C. Make Overview action-first and add a separate Calendar route

This was the initial recommendation for clearer route jobs. The owner rejected
it on 2026-09-28: the calendar remains the main Overview surface, and the
summary area should carry concise current-work widgets.

## Consequences

Positive:

- Preserves stable URLs, existing domain boundaries, and the current client
  architecture.
- Gives each route a measurable job and a reason to exist.
- Allows visual identity, typography, icons, and surfaces to support hierarchy
  instead of compensating for an unclear product model.
- Makes future notifications, analytics, and realtime updates easier to place
  against a known task surface.

Costs and risks:

- Widget content and visual hierarchy require review against populated and
  failure states; the current local project is sparse.
- Existing pages will need state-specific composition rather than one shared
  empty-state template.
- Route contracts must be reviewed with populated and failure data, not only the
  current sparse local project.

## Acceptance criteria for this proposal

- The owner explicitly retained the calendar as Overview's main surface,
  rejected an action-first landing and separate Calendar route, and requested
  useful compact widgets in the existing summary area.
- WEB-119 records representative empty, loading, populated, partial, failed,
  and recovery states for each route.
- The amended route direction is reflected in `DESIGN.md` and SPEC-007.
- The summary widget implementation is reviewed at desktop and narrow mobile
  widths; review against dense, failed, and multi-destination data remains open.
