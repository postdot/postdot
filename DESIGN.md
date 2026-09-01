# Design direction — Herald

Status: accepted
Scope: product-wide visual direction for the authenticated app and future
public/documentation surfaces
Owner: project owner
Last accepted: 2026-09-01

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
  Base UI, Solar Icons Linear, native-first motion policy, English product
  copy, and the existing `Post` / `Publication` and `Channel` boundaries.
- Assumptions to validate: the exact first-run workflow, navigation taxonomy,
  right-context surface, public audience, landing-page proposition, and
  primary conversion action.

## Direction thesis

- Thesis: Herald is a quiet dispatch desk where one source becomes several
  accountable publications, so the interface should make routing, state, and
  the next human decision visible without becoming a control-room cliché.
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
  review.
- Geometry: surfaces establish boundaries before lines. Use restrained,
  low-radius geometry; do not turn every region into a rounded rectangle. A
  line is allowed when it expresses an axis, relation, control grouping,
  focus/selection, or state. A shadow is rare and should communicate a layer
  or focal object rather than decorate every card.
- Density: density follows the reader's task. Calendar can be spacious enough
  to scan a month; Queue can be denser for comparison; Compose gives the
  source and destination versions room to be edited and checked.
- Type roles: use a humanist sans direction with clear display, heading, body,
  label, and data roles. The current Geist Variable implementation is
  provisional; type should support calm operational reading rather than act
  as a personality substitute. Do not use all-caps tracking as the default
  hierarchy device.
- Color roles: dark is the primary app theme with a neutral near-black canvas,
  grayscale surfaces, readable text tiers, and restrained semantic colors.
  `Cobalt instrument` is the provisional brand/action accent. Color belongs
  to actions, channel identity, selection, and publication state before it
  belongs to large backgrounds. A light companion must preserve the same role
  mapping rather than become a separate visual language.
- Surface/material: use value, spacing, and occasional depth to establish
  zones. Keep the main source object visually distinct because it carries the
  product's central relationship. Avoid gradients, glow, and shadow quotas
  unless a real content or interaction need earns them.
- Motion principles: follow ADR-024's native-first motion policy. Animate
  state or spatial change only when it improves orientation or feedback, and
  preserve the same meaning with reduced motion enabled.
- Component rules: promote primitives only when a pattern recurs across
  surfaces. Cards, pills, badges, dividers, tables, and panels are semantic
  tools, not universal grammar. Product composition stays in the consuming
  surface; shared primitives belong in `@herald/ui` only when their role is
  stable.

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
  primary and light companion checks; actual production responsive migration
  remains outstanding.
- Open visual questions: exact app navigation, the right-context surface's
  product value, final humanist sans choice, status treatment, landing-page
  audience/proposition/action, and whether the Cobalt accent needs a secondary
  brand companion.
- Accepted changes: 2026-09-01 — Cobalt accent, neutral surface-led
  foundation, purposeful lines, rare depth, and task-dependent density —
  accepted after H-10 owner review.

## Calibration

- Scenarios: disposable H-06 through H-11 records in the Autonomos DESIGN-02
  worklog; future production records belong in `.autonomos/worklogs/`.
- Baseline: the pre-direction Tailwind dashboard and the H-09 linework
  comparison, using the same Herald fixture and wide viewport.
- Current candidate: this contract plus Cobalt, neutral surface-led roles,
  and task-dependent composition.
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
  Production application and responsive evidence remain pending.
- Reference boundary: the archived HTML is calibration evidence, not a
  production route or component specification. Real landing proof, audience,
  proposition, and conversion decisions remain open.
- Next experiment: create an actual Herald app shell using this contract,
  then separately compare two landing-page compositions after the public
  proposition and audience are known.
