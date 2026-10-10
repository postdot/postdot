# Design direction — Herald

Status: accepted
Scope: product-wide visual direction for the authenticated app and future
public/documentation surfaces
Owner: project owner
Last accepted: 2026-09-02

This contract records the direction accepted after the H-06, H-08, H-09, and
H-10 disposable calibration studies. It is a product direction, not a promise
that every surface uses the same composition. Unresolved product decisions and
future landing-page decisions remain explicit below.

## Product truth

- Audience: people operating a self-hosted publication workflow who need to
  coordinate automated and manual destinations without losing the source of
  truth.
- Primary job: prepare, review, schedule, and publish one source post into
  accountable destination publications.
- Product objects and relationships: a `Project` owns `Channel` connections;
  a `Post` is the shared source; each `Publication` is a destination-specific
  version with its own state, schedule, draft, and execution history; media
  may be shared by the source and adapted for a destination.
- Content/data shape: content fans out from one source into several targets;
  target copy and capabilities can differ; the workflow includes queued,
  draft, published, due-manual, failed, and recovery states.
- Platform and input: browser SPA with pointer, keyboard, and narrow-screen
  use. The authenticated app is an operational workspace, not a centered
  marketing canvas.
- Known constraints: React/TanStack Router/Vite, Tailwind and `@herald/ui`,
  Base UI, Recursive Variable, Solar Icons Linear, native-first motion policy,
  English product copy, and the existing `Post` / `Publication` and `Channel`
  boundaries.
- Assumptions to validate: the exact first-run workflow, right-context surface,
  public audience, landing-page proposition, and primary conversion action.

## Direction thesis

- Thesis: Herald is a quiet dispatch desk where one source becomes several
  accountable publications, so the interface should make routing, state, and
  the next human decision visible without becoming a control-room stereotype.
- Emotional register: attentive, technical, calm, and deliberate; never
  sterile or theatrically futuristic.
- Domain anchor: a dispatch desk or routing board that tracks an instruction
  from its source to several destinations and records what still needs a human
  hand.
- Amplify: the source-to-publications relationship and the distinction between
  automated delivery and human-required work.
- Deliberately prohibit: interchangeable dashboard shells, universal rounded
  cards, borders used only to fill space, colored page foundations, arbitrary
  metric tiles, and the repeated `uppercase + wide letter-spacing` treatment
  when it is not required by the content or product vocabulary.
- Signature: the source post remains a first-class visible object whose
  destination publications and divergent states can be followed across
  Calendar, Queue, and Compose.
- Deliberate risk: a restrained dark workspace with Cobalt signals may become
  too familiar or too quiet. Revisit the hierarchy when real data shows that
  state, urgency, or category recognition is being lost; do not add decoration
  as the first remedy.

## System contract

- Composition and hierarchy: the desktop app uses the available viewport
  width and height. A product navigation rail, project/channel context, and a
  dominant task surface may coexist; a right contextual surface appears only
  when the current task gives it a concrete job. Calendar favors overview,
  Queue favors prioritization, and Compose favors source editing plus target
  review. Operational sections default to one clear title with compact
  metadata or an action; an overline, icon, and explanatory paragraph are
  optional content, not a heading formula.
  When a project page has a return control, place it at the left and center
  the page title independently of the optional action at the right. At narrow
  widths, keep the return and action controls on one row and give the centered
  title its own row so controls cannot compress it.
- Configuration composition: use the compact centered content column established
  by General and Account for personal and installation settings. Keep the shared
  page heading independent of that body width. A wider body needs a concrete
  comparison or management task, not merely a longer resource list. Group related
  fields and actions without enclosing every section and row in another box.
- Current shell candidate: the authenticated navigation uses the accessible
  shadcn/Base UI Sidebar primitive for project context, workspace navigation,
  channels, account actions, and a mobile drawer. Its default width, collapse
  behavior, and final information density remain subject to rendered review.
  The main scroll region includes the app header; the header stays sticky at
  the top of that region without a decorative bottom rule. A restrained
  shared surface shadow establishes its layer over the canvas.
- Workspace routing: the authenticated shell is shared, with project-scoped
  routes for Overview, Compose, Queue, Channels, and Media. Overview owns the
  calendar as its primary time-planning surface; there is no separate Calendar
  destination. `/dashboard` resolves to the first available project overview,
  while `/dashboard/projects/:projectId/...` is the URL-authoritative context
  for a selected project. The publication editor remains nested under its
  project and returns to that project's Queue. Queue remains the lifecycle and
  human-action prioritization surface; the Overview calendar does not replace
  it or become a second scheduler.
  Queue defaults to individual publication order. Its optional By post view groups
  the currently loaded, filtered destinations by post, ordered by each group's
  first publication in the selected sort. Counts describe those visible results,
  not the post's total destinations. Filters, pagination and individual selection
  keep their publication scope; one group link opens the complete shared post.
  The view is URL-addressable and changing it preserves the current selection.
  The explicit Queue link to `/dashboard/projects/:projectId/posts/:postId`
  inspects the current shared source and all its destination publications. Post
  inspection retains Queue as its navigation context; individual publication
  links keep their editing and execution-inspection jobs. Source review is an
  explicit per-destination draft action, separate from publication or scheduling.
  The post page also owns explicit shared-source saving, independently of any
  destination lifecycle. Editing preserves historical targets and leaves destination
  adaptations unchanged; unsaved source work is not used for review or addition.
- Calendar planning contract (provisional): show one Monday-first month at a
  time on desktop and tablet, with previous/next/today controls. Scheduled
  publications are grouped by their local date and link to the existing
  project publication editor; unscheduled work remains explicit outside the
  date grid. On narrow screens, replace the compressed seven-column grid with
  an agenda grouped by day. Manual and automatic destinations share the same
  calendar, while delivery state and due-human work remain visible as state.
  In the experimental interaction model, an event opens an in-context
  publication preview, the day add control is the create entry point, and a
  day background or overflow affordance expands the selected cell and its week
  row to reveal the complete date context in the calendar itself rather than
  silently creating, opening a drawer, or nesting another inspection step.
  Month and agenda are distinct reading
  modes: month scans distribution, while agenda reads ordered work. The exact
  responsive transition remains provisional until it is reviewed with dense
  realistic data.
  Week and Day use a data-aware initial vertical position: when timed work is
  visible, the first frame opens near the earliest timed publication with a
  small context lead; when no timed work is present, the existing `00:00`
  baseline remains. This only chooses the initial position, never hides hours,
  and must not repeatedly override manual scrolling.
- Route job contract: Overview scans publication timing and surfaces only
  current manual work or an upcoming scheduled publication; the entire summary
  stays hidden when neither exists. Its calendar remains the primary surface.
  Compose creates and reviews one source fan-out; Queue prioritizes lifecycle
  and human-action work; Channels manages destination identity and connection
  readiness; Media manages reusable verified assets. These surfaces must not
  converge into interchangeable publication-empty dashboards.
- Composer interaction contract: `Publish to` controls only destination
  inclusion; a separate editor scope chooses shared or channel-specific copy.
  Selected destinations and muted available destinations remain visible as
  distinct adjacent groups, stacking on narrow screens. One activation moves a
  channel between groups; motion may clarify that transfer, but focus and the
  resulting selected state must remain clear without animation. Delivery and
  schedule controls start as a compact summary and expand when requested or
  when a connection problem needs attention.
  Adding a destination must not change that scope or delivery defaults. Removing
  the active destination returns to shared copy while preserving remaining
  selections and overrides. Recovery restores the exact editing scope. Quiet
  composition autosave remains distinct from creating a persistent draft, and
  final actions name the outcome and scheduled publication count. Successful draft
  and scheduled creation open the shared post page, with every created destination
  reachable through its own publication link. Refused creation stays in Compose
  with the working content preserved.
  When an interrupted composition blocks new editing pending a recovery choice,
  present a modal decision with a draft excerpt and explicit restore/discard
  actions. The background stays inert; dismissal must not silently choose an
  outcome. Recovery errors remain visible inside that decision surface.
- Publication detail candidate (UX-250, pending owner review): editing and
  inspection should have different first frames. An editable publication keeps
  source controls beside the destination preview; a locked publication leads
  with the rendered content and keeps source revision, target payload, provider
  contract, and activity behind secondary disclosure. Show channel identity
  once in the first frame and reserve full-width state surfaces for a real
  lifecycle action or problem. A media-only draft starts with its images and
  offers text as an explicit addition. This candidate is based on the reviewed
  published manual item and media-only draft; due-manual, failed, and connected
  platform examples still need an owner checkpoint.
- Progressive disclosure contract: hide complexity through ordering, grouping,
  contextual detail, and meaningful iconography rather than removing capability.
  Keep required state, accessibility names, recovery guidance, and destructive
  action consequences available. Repeated explanation is optional; the next
  meaningful action is not. When invocation already establishes the context,
  the contextual surface should lead with the invoked object instead of adding
  a label that merely says what the surface is. A dismissible contextual
  surface uses the primitive's close behavior and does not add a second close
  action without a distinct task reason. One fact should have one visual
  marker; a status component that owns its marker must not receive a second
  decorative dot.
- Sidebar menu buttons that render a trailing status badge reserve the badge's
  width before the channel label truncates. Collapsed icon mode overrides that
  reservation so the icon control remains centered in the rail.
- Component source versus visual system: shadcn/Base UI supplies accessible
  behavior and composable primitives; it is not Herald's visual default. The
  shared UI package owns the final radius, surface, typography, control, and
  shadow tokens. Consuming pages should express product hierarchy rather than
  repeatedly undoing generic component styles with local overrides.
- Brand mark: the owner-supplied Herald bird is the shared product mark. Its
  source belongs in `@herald/ui` under `src/assets/brand`, while the reusable
  inline `HeraldLogo` component uses `currentColor` so the mark follows the
  surrounding theme and surface. Brand placements must not fall back to an
  invented lettermark. In the app rail, the mark is standalone and uses the
  semantic brand color; a filled container is not part of the default chrome
  treatment.
- Geometry: surfaces establish boundaries before lines. Use restrained,
  low-radius geometry; do not turn every region into a rounded rectangle. A
  line is allowed when it expresses an axis, relation, control grouping,
  focus/selection, or state. A shadow is rare and should communicate a layer
  or focal object rather than decorate every card.
- Density: density follows the reader's task. Calendar can be spacious enough
  to scan a month; Queue can be denser for comparison; Compose gives the
  source and destination versions room to be edited and checked.
- Type roles: use Recursive Variable as the accepted primary family with clear
  display, heading, body, label, and data roles, followed by Inter Variable,
  Adwaita Sans, Noto Sans, and system fallbacks. The current calibration uses
  approximately 600 weight with tight tracking and near-unit line-height for
  primary display headings, approximately 580 for secondary headings, and
  approximately 650 with compact tracking for action labels. Type should
  support calm operational reading rather than act as a personality
  substitute. Do not use all-caps tracking as the default hierarchy device.
- Color roles: dark is the primary app theme with a neutral near-black canvas,
  grayscale surfaces, readable text tiers, and restrained semantic colors.
  `Cobalt instrument` is the provisional brand/action accent. Color belongs
  to actions, channel identity, selection, and publication state before it
  belongs to large backgrounds. The explicit light companion must preserve the
  same role mapping rather than become a separate visual language. The
  accepted surface palette is Graphite/Ash: near-achromatic charcoal roles in
  dark mode and neutral ash roles in light mode, with a restrained warm-neutral
  bias instead of blue-slate surfaces.
- Surface/material: use value, spacing, and occasional depth to establish
  zones. Keep the main source object visually distinct because it carries the
  product's central relationship. Avoid gradients, glow, and shadow quotas
  unless a real content or interaction need earns them. Use explicit semantic
  roles for canvas, raised surfaces, inset surfaces, fields, and overlays; a
  restrained surface shadow or overlay shadow may distinguish levels without
  turning every region into a bordered card.
  Surface separation is evaluated against the actual adjacent host, including
  translucent layers. Near-black shades and black shadows alone must not be
  relied on to separate navigation from the work page. A restrained structural
  edge is permitted at that boundary, with the same geometry and placement
  in both themes; only its contrast follows the theme. It does not imply borders around every
  content region. Numerical token differences supplement visual review rather
  than establishing perceptual clarity by themselves.
- Transient feedback: use a toast for a short confirmation of an explicit action
  when the initiating context has closed or the result otherwise lacks feedback.
  Keep validation and recovery errors beside the relevant fields or task. Quiet
  autosave does not need a toast. Durable notifications record events worth finding
  later, not every UI action; combining both requires a purpose rather than an
  automatic copy. Toast text must not contain credentials.
- Popup sizing: menus and option panels use their content width, at least the
  trigger width, bounded by available screen space. Ordinary action labels should
  not wrap merely because the trigger is a small icon; exceptionally long content
  wraps at the available-space boundary.
- Controls: fields use the field surface and its inset shadow as their default
  boundary. A visible border is reserved for focus, invalid state, or a real
  control grouping. Repeated form controls in one row share the same control
  height and must not be vertically displaced by optional helper copy. A
  secondary action should use the same shared control geometry as its peers;
  media-library actions use a padded, rounded region rather than a border-only
  strip.
- Desktop density: prioritize the current authoring or review task and keep
  secondary management surfaces compact. Reduce explanatory repetition before
  reducing readable input space; mobile may stack the same information when
  the viewport requires it.
- Motion principles: follow ADR-024's native-first motion policy. Animate
  state or spatial change only when it improves orientation or feedback, and
  preserve the same meaning with reduced motion enabled.
- Component rules: promote primitives only when a pattern recurs across
  surfaces. Cards, pills, badges, dividers, tables, and panels are semantic
  tools, not universal grammar. Product composition stays in the consuming
  surface; shared primitives belong in `@herald/ui` only when their role is
  stable.
- Shared-foundation implementation checklist: a new or materially changed
  shared primitive must preserve a visible or programmatic name, keyboard
  focus and activation, dark/light semantic roles, and English/French copy
  boundaries. Its default geometry must tolerate long labels through a
  deliberate wrap, scroll, or truncation strategy; `min-w-0` and truncation
  are preferred to viewport overflow, while the complete value remains
  available to assistive technology or an intentional affordance. Product
  pages own the meaning and copy of a control; the shared primitive should
  not add explanatory prose by default.
- Progressive-disclosure implementation checklist: keep the first layer to
  the current task, its required state, and the next meaningful action. Put
  per-destination overrides, provider details, media metadata, and other
  secondary choices behind an explicit action or contextual surface. Do not
  hide validation, recovery, destructive consequences, or capability limits.
  A shorter screen is not a successful simplification if the operator loses
  the reason for a state or the path to recover it.

## App viewport and responsive contract

- Desktop: the authenticated app is full-bleed within the browser viewport;
  do not constrain the operational shell to a marketing-style `max-w-*`
  container. The work surface should benefit from additional width instead of
  leaving a large unused margin.
- Tablet: preserve the primary task surface and readable content measure;
  collapse or temporarily hide secondary navigation/context before squeezing
  four columns into an unusable strip. The exact drawer and breakpoint
  behavior remains an implementation decision.
- Mobile: one task at a time remains primary. Product navigation, channels,
  and contextual details may become explicit drawers or stacked regions, but
  they must remain discoverable and retain the source/publication relationship.
  Do not treat a shrunken desktop dashboard as the mobile design.
- Evidence required: render the actual dashboard at a wide desktop, an
  intermediate tablet width, and a narrow mobile width before accepting the
  production migration.

## Public and documentation surfaces

The future landing page and documentation site inherit the system roles, not
the dashboard shell. They must not reproduce the sidebar, calendar grid, or
operational card stack as a marketing template. The landing page should make a
proposition, audience, proof, and next action legible through a more narrative
composition while retaining Cobalt as a signal, neutral foundations, and the
source-to-destinations mental model as its product-specific anchor.

Transactional email is a compact public-surface adaptation of the same system:
the Herald mark and Recursive Variable remain recognizable, while Ash and the
near-flat raised surface provide the quiet canvas and Cobalt is reserved for the
mark and primary action. It deliberately avoids a decorative dark banner,
oversized depth, and rounded notice cards. Email clients that do not support the
webfont or inline SVG must still receive a deliberate, readable fallback rather
than an unbranded default template.

The landing-page audience, proposition, proof assets, and conversion action
are open questions. A separate direction comparison is required before
building it; the current app contract must not silently decide those choices.

## Content and state contract

- Vocabulary and voice: direct English operational language. Prefer `Post`,
  `Publication`, `Channel`, `Source`, `Destination`, `Queued`, `Draft`,
  `Published`, and `Needs attention` over invented marketing labels.
- Required content: show the source post, destination channel, publication
  state, schedule, and the next meaningful action wherever the surface's job
  requires them.
- Empty/loading/error/partial-failure states: explain what is missing and how
  to recover. A missing project, channel, publisher, media asset, or target
  capability is a product state, not an empty decorative card.
- Long-content and high-density behavior: preserve source and target content
  distinctions; wrap or truncate with an intentional affordance; never hide a
  state or action only because copy is long.
- User feedback and destructive actions: show save, recovery, conflict,
  publish, and failure states with explicit status and reversible paths where
  the domain allows them.

## Anti-default tests

- Subject-swap test: replacing Herald with an unrelated SaaS dashboard should
  make the source-to-destinations composition feel wrong.
- Necessity test: every border, shadow, card, label treatment, metric, and
  effect must clarify content, hierarchy, state, continuity, or interaction.
- Distinction test: a generic project-management or analytics product should
  not naturally produce the same focal relationship or vocabulary.
- System-purity test: Calendar, Queue, Compose, the landing page, and future
  documentation should share role tokens and the source/publication mental
  model while changing composition to fit their jobs.
- Known exceptions: lines are allowed for real temporal axes, control groups,
  focus/selection, and semantic status markers; a contextual right surface is
  allowed only when its content gives it a concrete operator job.

## Evidence and change record

- Reference surfaces: owner-provided captures of Omarchy Plugin Marketplace
  and Tala Web; the useful evidence was the difference between a coherent
  domain-specific material system and a personal product rendered with common
  AI-era surface vocabulary.
- Calibration artifacts: H-06 identity-first study, H-08 role-based palette
  atlas, H-09 surface grammar study, H-10 multi-surface holdout, and H-11
  landing transfer holdout. The static HTML references are archived under
  `docs/design/examples/`; the associated renders and observations are
  recorded in the Autonomos DESIGN-02 worklog.
- Rendered checks: disposable local browser studies at 1280 × 720, with dark
  primary and light companion checks; the first authenticated production
  candidate has desktop, collapsed-sidebar, mobile-drawer, and light-theme
  evidence in the DESIGN-35 worklog. The current shared-token revision still
  requires a fresh owner visual checkpoint before it is treated as accepted.
- Open visual questions: the right-context surface's product value, the future
  calendar composition, font-axis and weight fine-tuning, status treatment,
  landing-page audience/proposition/action, and whether the Cobalt accent needs
  a secondary brand companion.
- Owner review note: the first authenticated shell candidate is directionally
  valid but visually unfinished. A shared token/primitive correction is
  required before treating its spacing, type, header, sidebar, and surface
  treatment as a stable design-system expression.
- Owner review note: the latest dashboard review rejected the repeated
  marketing-style overline/icon/title/description stack as a default for an
  operational app. The channel creation form also exposed inconsistent
  surface corners, visible field borders, mismatched control heights, and
  alignment caused by uneven helper text. These are system rules, not isolated
  page exceptions.
- Owner review note: 2026-09-12 — the owner rejected redundant preview labels,
  duplicate dismissal affordances, and a second status marker. For the
  project calendar, day inspection must remain in the calendar flow: the
  selected cell grows with its week row and reveals all scheduled publications,
  while the add control remains the singular create entry point. Mobile
  density and the final month/agenda transition remain open for the WEB-156
  checkpoint.
- Owner review note: 2026-09-28 — the owner rejected an action-first Overview
  and a separate Calendar route. Overview remains calendar-led; its existing
  summary area surfaces real current work without zero counters or empty-state
  messages, and disappears when no useful item is present. Queue remains the
  triage surface.
- Accepted changes: 2026-09-01 — Cobalt accent, neutral surface-led
  foundation, purposeful lines, rare depth, and task-dependent density —
  accepted after H-10 owner review; 2026-09-02 — Graphite/Ash low-chroma
  surface palette accepted as the neutral refinement; 2026-09-02 — Recursive
  Variable as the owner-selected type family, Solar Icons Linear as the shared
  icon weight, and reserved sidebar badge space to prevent channel labels from
  overlapping their status; 2026-09-02 — the owner-supplied Herald bird mark
  accepted as the product logo, with an inline current-color implementation for
  themed application surfaces and standalone app-rail treatment; 2026-09-11
  — the transactional email adaptation accepted as a compact brand surface
  with the shared mark, Recursive Variable progressive enhancement, a near-flat
  Ash/raised composition, restrained surface depth, Cobalt action, and
  client-safe fallbacks.

## Calibration

- Scenarios: disposable H-06 through H-11 records in the Autonomos DESIGN-02
  worklog; future production records belong in `.autonomos/worklogs/`.
- Baseline: the pre-direction Tailwind dashboard and the H-09 linework
  comparison, using the same Herald fixture and wide viewport.
- Current candidate: this contract plus Cobalt, neutral surface-led roles,
  Recursive Variable, Solar Icons Linear, the Herald bird mark, and task-
  dependent composition.
- Observable rubric: product category is clear; source/publication relation is
  visible; each surface has one primary task; shared identity survives layout
  changes; borders and depth have a reason; wide and narrow layouts remain
  usable.
- Known corrections: generic card/border grammar → surface-led primitive and
  visual review; colored foundations → neutral role tokens; abstract panel
  choice → task-specific contextual content; single-screen validation →
  multi-surface holdout.
- Holdout result: H-10 passed the owner checkpoint for cross-surface identity;
  H-11 showed that the identity can transfer to a non-dashboard composition.
  Production application evidence remains provisional and is refined through
  the DESIGN-35 owner checkpoint.
- Reference boundary: the archived HTML is calibration evidence, not a
  production route or component specification. Real landing proof, audience,
  proposition, and conversion decisions remain open.
- Next experiment: render the corrected authenticated shell against real
  publication data, then separately recompose the long workflow forms to
  reduce unnecessary scroll while preserving the source-to-destination
  relationship. Compare landing-page compositions only after the public
  proposition and audience are known.

## Action hints and authoring focus

Icon-only application actions use shared UI tooltips and explicit accessible
names, without native `title` tooltips. Tooltips supplement the action; they
are not the only way to identify it, especially on touch devices. Compose
actions form one toolbar above the content, with distinct attachment and
external-image glyphs. The writing area uses the caret without an enclosing
focus ring; retain visible keyboard focus on toolbar controls and shared field
styles for popup inputs. Emoji loading reserves the final panel dimensions.

## Global dashboard search

The header search uses a Command palette, opened by its explicit control or
Ctrl/Cmd+K. It is navigation only: pages/settings, projects, channels, media and source
posts have consistent icon/title/context rows. Settings entries respect existing
administration capabilities. Content search defaults to all currently accessible
projects; the current-project scope is an explicit alternative. Source posts
appear once regardless of destination count and open their shared-post page;
channels open their existing row in Channels. Ready, non-archived media are
matched by filename or accessibility text. Images have visual thumbnails, while
other result kinds retain appropriate icons. Media results open the existing
viewer; information is a secondary inspection surface. Closing consumes the
inspection parameter so a later selection reopens it. Search errors and retry stay inside
the palette. Search does not publish, modify content or replace Queue filters.

The search trigger combines an icon and compact keyboard shortcut, with an
accessible name and shared tooltip. The input has its own inset surface and a
short placeholder. A compact footer shows result navigation shortcuts.
The palette keeps its input anchored near the top of the viewport and reserves a
stable, viewport-bounded result area across loading, populated and empty states.
Use spacing rather than separator lines; keep the dark palette close to the
raised workspace surface. A direct All projects switch controls scope when a
current project exists. Empty results use the shared illustration vocabulary.
