# ADR-057 — Propose a route-oriented Herald workspace with progressive disclosure

- Status: proposed
- Scope: authenticated web route hierarchy and first-action contracts
- Provenance: WEB-118; ISSUE-063; independent Muse-1.3 and Luna-max audits
- Related specification: SPEC-006
- Related decisions: ADR-007, ADR-023
- Supersedes: none

## Context

Herald's accepted design direction describes a quiet dispatch desk in which one
source becomes several accountable publications. The current application has
separate routes for Overview, Compose, Calendar, Queue, Channels, and Media,
but the empty states for the first three operational routes are too similar.
The current Calendar implementation also renders the desktop month grid only
when at least one publication is already scheduled, which makes the planning
surface an endpoint instead of an entry point for an empty project.

Two independent read-only audits agree that the visual foundation is broadly
coherent but identify route hierarchy, progressive disclosure, shell context,
and responsive accessibility as the next product risks. The owner wants Herald
to hide complexity by ordering and grouping it, using icons and spatial
relationships where appropriate, without removing capabilities or turning the
application into an unexplained collection of compact controls.

## Decision

Propose retaining the route-oriented workspace, but assign each route one
primary operator job, one first useful action, and one distinct empty/data
contract. Do not collapse the routes into a single dashboard or start a broad
visual rewrite before these contracts are accepted.

The proposed hierarchy is:

| Route | Primary job | First useful action | Must not become |
| --- | --- | --- | --- |
| Overview | Answer what deserves attention or what to do next | Follow the highest-value next action: connect, compose, review, or recover | A second Queue or a metric wall |
| Compose | Create one source and review its destination publications | Start with source content, then add/review destinations | A settings form or a tour of every capability |
| Calendar | Scan time and choose a publication date | Select a date and enter Compose with that date | A second Queue or a dead empty-state card |
| Queue | Prioritize publications by lifecycle and human action | Open the next due, failed, draft, or unscheduled item | A duplicate Overview summary |
| Channels | Manage destination identity and connection readiness | Add, inspect, connect, or repair a destination | A provider-internals or credential dump |
| Media | Manage reusable verified assets | Upload, inspect, select, or recover an asset | A second Compose surface |

The shell should distinguish project-scoped work from global instance settings.
The project selector and project navigation remain visible when a project is
selected; provider-application settings must visibly communicate their
instance scope and must not silently appear to belong to the first project.
Reduced navigation must preserve accessible names and tooltips even when labels
are hidden visually.

Progressive disclosure is part of the proposed contract:

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

Calendar specifically should keep a date-oriented entry path when there are no
scheduled publications. The exact desktop composition (always-visible month
grid versus another equally direct date-scanning surface) remains a design
checkpoint, but the current condition of hiding the grid until data exists is
not the proposed target.

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

### C. Retain the current routes and only polish their styling

This is the smallest diff, but it leaves the duplicate empty states and the
Calendar entry problem intact. Rejected as insufficient.

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

- The exact Overview content and Calendar desktop composition still require a
  product checkpoint before implementation.
- Existing pages will need state-specific composition rather than one shared
  empty-state template.
- Route contracts must be tested with populated and failure data, not only the
  current empty local project.

## Acceptance criteria for this proposal

- The owner accepts or revises the route job table and the progressive-disclosure
  rules.
- WEB-119 records representative empty, loading, populated, partial, failed,
  and recovery states for each route.
- The accepted result is reflected in `DESIGN.md` or a linked normative spec;
  this proposed ADR remains non-normative until then.
- Implementation is reviewed at wide desktop, tablet, and narrow mobile sizes
  with English and French content before the route migration is considered
  complete.
