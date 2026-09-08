# SPEC-006 — Herald web UX and information architecture sprint

- Status: draft
- Scope: authenticated web application information architecture, interaction
  hierarchy, shared UI foundations, responsive behavior, and validation
- Provenance: independent Muse-1.3 and Luna-max UX/UI audits; owner discussion
  on progressive disclosure and the limits of default shadcn presentation
- Related issues: ISSUE-051, ISSUE-052, ISSUE-063, ISSUE-064, ISSUE-065, ISSUE-066
- Related tasks: WEB-117, WEB-118, WEB-119, DESIGN-97, DESIGN-98, DESIGN-120,
  DESIGN-121, WEB-122, WEB-123, WEB-124, AUDIT-125
- Related decisions: ADR-057 (accepted)
- Related specifications: SPEC-007 (draft)
- Normative reference: `DESIGN.md` remains the accepted visual direction. This
  document is a sprint target draft and does not silently amend that contract.

## Intent

Herald should hide operational complexity through ordering, progressive
disclosure, and clear relationships rather than removing capabilities or
explaining every capability at once. The authenticated application should feel
like a calm dispatch desk: the source, its destinations, their states, and the
next meaningful decision remain discoverable without turning every route into a
dashboard of cards and prose.

The sprint exists to resolve the product and interaction structure before a
large visual rewrite. It must preserve stable API and domain contracts and must
not become a landing-page or branding exercise.

## Proposed principles

- Every route has one primary operator job and one visually dominant next
  action. Secondary capability remains available through deliberate context,
  not through repeated explanatory blocks.
- Complexity is organized and progressively disclosed. Required state,
  recovery guidance, accessibility names, and destructive-action consequences
  must never be hidden merely to make a screen look simpler.
- The source-to-publications relationship is Herald's product anchor. Overview,
  Compose, Calendar, Queue, Channels, and Media may use different compositions,
  but they must preserve that mental model and avoid competing as duplicate
  publication creators.
- Empty, loading, partial, failed, and populated states are part of the
  experience contract. A route must teach its own first useful action when no
  data exists.
- shadcn/Base UI supplies accessible behavior and composable code, not Herald's
  final visual identity. Shared tokens and primitives should be rewritten or
  extended at the root when the default grammar conflicts with Herald; pages
  must not accumulate local CSS that repeatedly undoes generic defaults.
- Icons, logos, imagery, grouping, and spatial hierarchy may carry meaning that
  would otherwise require prose. They supplement copy; they do not replace
  accessible names, state descriptions, or recovery instructions.
- The logo, colors, exact radius, and visual treatments remain revisable. The
  sprint should preserve recognizable identity while allowing evidence to
  replace provisional choices.
- Desktop should use available space without forcing density, while tablet and
  mobile should recompose the task rather than shrink a desktop dashboard.

## Proposed route contracts

These are hypotheses to validate during WEB-118 and must not be treated as
implementation instructions until accepted:

- Overview answers what needs attention or what the operator should do next.
- Compose creates and reviews one source fan-out into destination publications.
- Calendar scans time and provides an obvious date-oriented entry into
  scheduling, including when the project has no scheduled publications.
- Queue prioritizes work by lifecycle and required human action rather than
  duplicating Overview's summary.
- Channels manages destination identity and connection readiness without
  leaking provider internals into the primary view.
- Media manages reusable assets and their verification state without becoming a
  second publication editor.
- Global settings are visibly distinct from project-scoped navigation and do
  not silently impersonate the first project.

## Cross-cutting acceptance conditions

- English and French preserve hierarchy, control geometry, and meaning.
- Dark and light themes preserve semantic roles while allowing appropriate
  contrast and surface treatment.
- Reduced and expanded navigation retain accessible names, focus order, and
  discoverability.
- Notifications remain compatible with the durable inbox, SSE/realtime update
  contract, unread state, and future external transports.
- The primary workflows are tested with empty and realistic data, not only
  static empty screenshots.
- Browser evidence covers wide desktop, tablet, narrow mobile, direct route
  navigation, reload, keyboard use, loading, and representative failure
  states.

## Open decisions before broad implementation

- The exact first action and information architecture of Overview, Calendar,
  Queue, and Compose.
- Whether desktop Calendar always renders a selectable month grid or uses a
  different date-oriented entry pattern.
- The final user-facing glossary for Channel, Connection, Provider, Account,
  Publication, and Source.
- The desktop and mobile form of the non-blocking notification surface.
- Which provider settings are global instance settings and how that context is
  represented in navigation.
- Which current visual tokens and logo treatments remain after calibration
  against populated workflows.

## Out of scope

- Landing pages, marketing narrative, billing, or hosted onboarding.
- Removing capabilities merely to reduce visible complexity.
- Replacing React, TanStack Router, Base UI, Paraglide, or the current realtime
  transport without a separate technical decision.
- Introducing a new UI library solely to obtain a different default aesthetic.
- Implementing analytics dashboards or external notification adapters as part
  of this sprint.
