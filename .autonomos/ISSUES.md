# Project Issues

## [ISSUE-021] Validate the central publication loop through real use

- Type: proposal
- Status: open
- Evidence: The repository has deterministic unit, integration, browser, and
  provider tests, but the continuous product direction has not yet been validated
  through a sustained real workflow using multiple destinations and the dashboard,
  API, and CLI together. EVAL-53 established and exercised the safe local
  validation loop; the automatic-provider stage remains gated by an explicit
  destination and action-time approval.
- Impact: Technical foundations can appear complete while the real publication
  manager still requires a parallel tracker or awkward manual workarounds.
- Desired outcome: Postbot periodically exercises and records the complete intended
  publication workflow in realistic use, including automatic and manual channels,
  failures, edits, and recovery, without reintroducing a release-oriented MVP
  boundary.
- Tasks: EVAL-53 (completed; repeat periodically), EVAL-54 (completed), PUB-55 (completed), EVAL-57 (completed; repeat periodically)
- EVAL-54 completed the automatic-provider stage with an operator-approved,
  organization-scoped LinkedIn smoke test. The provider acknowledged the text
  publication, Postbot persisted the successful job and publication outcome, and
  the dashboard displayed the target as published. This issue remains open as
  a recurring validation practice rather than a one-time implementation task.
- EVAL-57 completed the automatic image-provider stage with an operator-approved
  disposable publication. The provider acknowledged the image delivery, Postbot
  persisted the successful media checkpoint and publication outcome, and the
  dashboard displayed the target as published. This remains a recurring
  validation practice rather than a release gate.
- The 2026-09-11 validation completed the same controlled loop with the Bluesky
  provider: the local loopback OAuth flow was accepted on the real provider,
  the project-owned connection was restored, and an automatic text publication
  was acknowledged by Bluesky and displayed as published in the Postbot queue.
  The validation also corrected two provider-boundary defects found during the
  run: the OAuth grant now requests the granular repository/blob permissions
  required for publication, and a revoked credential is reactivated with the
  scopes from a fresh grant instead of being rejected by the uniqueness guard.
  The publication scheduler is explicitly woken after a reschedule so the
  requested run time is applied without waiting for the previous timer.

- Remaining scope (ALPHA-578, 2026-10-24): Recurring real publication-loop validation; retain actual provider/action authorization. Not a missing publisher implementation.

## [ISSUE-029] Prove visible control for app-managed worktree missions

- Type: problem
- Status: declined
- Evidence: The Codex app-managed worktree task path previously returned
  preparation identifiers without a durable task identity that the orchestrator
  could use for status, cancellation, attribution, visibility, and cleanup.
- Current experiment (2026-09-04): the multi-agent control plane returned an
  orchestrator-side agent identifier and accepted an interruption request, but
  the agent did not appear in the Codex task list and the final result was
  reported as technical `completed` while its report was marked interrupted.
  This proves neither operator visibility nor unambiguous cancellation.
- Recheck (2026-09-05): the Codex app worktree creation route returned only a
  preparation identifier (`clientThreadId`) for the Postbot project. After
  approximately 50 seconds, no corresponding task appeared in the Codex task
  list and no new Postbot worktree appeared in `git worktree list`. The
  preparation identifier could not be used to inspect, interrupt, or clean up
  the mission through the available control surface.
- Impact: The orchestrator cannot safely promise that a delegated worktree task
  is observable or controllable by the operator, even though the explicit
  worktree fallback is traceable and safe.
- Desired outcome: A controlled mission proves durable task identity, observable
  progress and final status, cancellation, attribution, operator visibility,
  and cleanup for an app-managed worktree task without granting it shared
  server, browser, credential, or merge ownership.
- Tasks: META-62 (retired; see META-228)
- Related issues: ISSUE-024
- Resolution (owner direction, 2026-09-26): The app-managed worktree control
  investigation is no longer relevant to current Postbot work and is retired to
  stop it from distracting the project. This is a scope decision, not a claim
  that the Codex control-plane limitation was fixed. Preserve the experiments
  above as historical evidence; general delegation and worktree safeguards
  remain in `AGENT.md`.

## [ISSUE-036] Provide an intentional MCP operator surface

- Type: proposal
- Status: open
- Evidence: The domain and API contracts already provide reusable validation,
  publication, project, channel, and audit operations, while the repository does
  not yet provide a first-class MCP server for those operations.
- Impact: External agents cannot use Postbot through a dedicated protocol surface
  without building their own API integration and reproducing authentication and
  validation assumptions.
- Desired outcome: A future MCP surface reuses the API/domain contracts, preserves
  project-scoped authorization and actor attribution, and exposes only operations
  whose external side effects and confirmation semantics are explicit.
- Tasks: none until the owner reopens the deferred scope
- Owner direction (2026-09-25): Defer creating the MCP client until the web
  application and its workflows are sufficiently organized and stable. This is
  a deferral, not a permanent rejection. Do not create an implementation task
  until the owner reopens this scope.
- Review evidence (2026-10-22): the public README now positions the product for people and their agents; ISSUE-190 links the timing of this surface to provider tiering and product positioning. The deferral stands until the owner reopens it.

- Owner direction (2026-10-15): Humans and external agents are first-class audiences
  from launch. Present MCP as a planned access surface alongside Studio, CLI and
  API; do not imply it is already shipped. Priority: high, with launch inclusion
  to assess after the existing stability deferral. This intake does not authorize
  implementing the server or silently lift the prior stability prerequisite.
- Related: ISSUE-157 (public narrative), ISSUE-158 (launch agent skills),
  ISSUE-163 (client workflow coverage).

- Remaining scope (ALPHA-578, 2026-10-24): Owner-deferred MCP surface. A new scoped decision is needed to lift the stability prerequisite; no MCP server is claimed delivered.

## [ISSUE-063] Recompose Postbot's route information architecture and progressive disclosure

- Type: problem
- Status: accepted
- Evidence: Two independent read-only UX/UI audits found that Overview,
  Calendar, and Queue become near-identical empty states, while Compose carries
  most of the source-to-destination relationship. The audits also found that
  repeated headings, helper paragraphs, counters, and generic empty cards make
  the application harder to scan than the underlying workflow requires.
- Impact: Users can see the available capabilities without understanding which
  surface owns the next decision. Reducing copy locally would risk hiding
  necessary state, while adding more dashboard summaries would increase the
  problem. The same ambiguity would make later analytics, notifications, and
  provider features harder to place coherently.
- Desired outcome: Define and validate one primary operator job, first action,
  information hierarchy, and empty/loading/error/populated contract for
  Overview, Compose, Calendar, Queue, Channels, and Media. The design must hide
  complexity through ordering and progressive disclosure without removing
  capabilities, required state, accessibility information, or recovery paths.
  Calendar must have an explicit date-oriented entry path even when no
  publication is scheduled, and Queue must remain a prioritization surface
  rather than a second Overview.
- Scope boundary: This is an authenticated application IA and interaction
  workstream. It does not redesign public marketing surfaces, change domain/API
  ownership, remove the source/publication model, or implement provider or
  analytics features.
- Tasks: WEB-117, WEB-118, WEB-119, WEB-122, DESIGN-98, UX-240, UX-244, UX-254
- Related issues: ISSUE-042, ISSUE-050, ISSUE-052, ISSUE-064, ISSUE-066
- Related decision: ADR-057 (accepted)
- Related specification: SPEC-007 (accepted; amended 2026-09-28)
- Related specification: SPEC-006
- Follow-up: The accepted route contracts are implemented, but the remaining
  empty-state and density observations stay as a bounded UX follow-up rather
  than being treated as a completed visual redesign.

- Browser audit follow-up (2026-09-28): The 2026-09-28 browser audit found that Overview primarily presents a calendar, Queue also contains completed work, and channel identity and connection readiness appear in separate repeated sections. Instance and workspace membership pages require careful reading to distinguish their scopes. The owner requested phased follow-ups; the audit alone did not authorize route or access-contract changes. UX-240's later owner amendment explicitly retains calendar-led Overview and is recorded below.
- New evidence: [UX-239 worklog](worklogs/2026-09-28-UX-239.md).
- UX-246 follow-up completed (2026-09-29): Seven mixed operational states, long destination names, six representative locale/theme/viewport combinations, keyboard filtering/return navigation and responsive approval now supplement the existing recovery/media/realtime journeys. The complete local gate passed 42 browser scenarios plus 2 password-reset scenarios. Presentation defects and remaining composition work are recorded in [UX-246](worklogs/2026-09-29-UX-246.md); synthetic outcomes still do not establish real-provider behavior.
- UX-240 owner decision and implementation (2026-09-28): keep the calendar as Overview's main surface; show only due manual work or an upcoming scheduled publication in the summary band, and omit it entirely when neither exists. The owner rejected an action-first Overview, separate Calendar route, empty counters, stale history, and decorative activity summaries. Broader populated/failure-state review remains open. See [UX-240 worklog](archive/calendar-queue-delivery/worklogs/2026-09-28-UX-240.md).
- UX-244 evidence (2026-09-29): the same disconnected LinkedIn destination appears in the channel list and the connection section, with “connection required” repeated. The latter also shows a zero-connection counter, an explanatory sentence, a “Connect LinkedIn” action, and a second page-connection form. Preserve both channel and publisher concepts, but resolve their hierarchy and primary action in UX-244 rather than adding another local copy patch. See [UX-249 worklog](worklogs/2026-09-29-UX-249.md).
- UX-244 bounded pass (2026-09-29): removed the zero-connection counter and repeated explanatory copy, kept connection repair available per built-in channel, and disclosed the optional LinkedIn organization/page path. The persistent project/workspace selectors retain search, creation, and configuration actions; permission and route contracts are unchanged. The identity/readiness/administration relationship remains open for a reviewed information-architecture decision. See [UX-244 worklog](worklogs/2026-09-29-UX-244.md).

- UX-254 access candidate (2026-09-29): centered titles and one return per
  access page; workspace selection remains in the persistent header; invitations
  name their scope and omit empty pending sections. Compact workspace group
  surfaces retain permission consequences and project effective-access sources.
  Instance role/status enum values now use localized labels. Routes, permissions,
  invitation acceptance, and recovery contracts remain unchanged. See
  [UX-254 worklog](worklogs/2026-09-29-UX-254.md).

- Remaining scope (ALPHA-578, 2026-10-24): Resolve the remaining project identity/readiness/administration relationship. Route/state contracts and earlier route implementation are delivered; do not rebuild them.

## [ISSUE-064] Harden the authenticated shell, navigation context, and responsive accessibility

- Type: problem
- Status: accepted
- Evidence: Both independent audits found that reduced navigation loses or
  obscures labels, and one audit found truncated section labels without a
  reliable tooltip or accessible name. The audits also found tablet Compose
  controls and mobile Queue tabs losing readable geometry, plus a potential
  ambiguity between global provider settings and project-scoped navigation.
- Impact: The shell is shared by every workflow, so a navigation or context
  failure is multiplied across the application. A user can lose the project
  context, misunderstand a global setting as project-specific, or be unable to
  reach a filter or control at a narrow viewport. Cosmetic fixes in individual
  pages would not protect the shared interaction contract.
- Desired outcome: The authenticated shell has an explicit global/project
  navigation distinction, stable URL context, accessible icon-only controls,
  usable reduced and mobile navigation, preserved focus order, clear loading
  behavior, and responsive rules that recompose controls before truncating
  meaningful values. Long channel names and status badges must remain
  distinguishable without leaking layout or accessibility semantics.
- Scope boundary: This does not replace the current Sidebar/Base UI foundation,
  introduce a new UI library, or change the project authorization model. It
  includes the provider-settings context and shared pending/error shell only
  insofar as they affect navigation comprehension.
- Tasks: DESIGN-121, WEB-123, WEB-124, UX-243
- Related issues: ISSUE-042, ISSUE-051, ISSUE-059, ISSUE-060
- Related specification: SPEC-006
- Resolution: DESIGN-121, WEB-123, WEB-124, and WEB-126 established the shared
  shell, project-context, reduced-navigation, responsive, labeling, and
  instance-settings boundaries. The browser regression matrix confirms the
  resulting navigation remains reachable at supported widths.

- Browser audit follow-up (2026-09-28): Reopened after the 2026-09-28 browser audit: at 820 pixels the persistent sidebar leaves approximately four month columns visible; mobile authoring places actions below a tall editor and preview. Channel names remain heavily truncated in the sidebar. Preserve the earlier completed navigation fixes; this follow-up targets responsive composition and readable identity.
- New evidence: [UX-239 worklog](worklogs/2026-09-28-UX-239.md).
- UX-246 follow-up completed (2026-09-29): Seven mixed operational states, long destination names, six representative locale/theme/viewport combinations, keyboard filtering/return navigation and responsive approval now supplement the existing recovery/media/realtime journeys. The complete local gate passed 42 browser scenarios plus 2 password-reset scenarios. Presentation defects and remaining composition work are recorded in [UX-246](worklogs/2026-09-29-UX-246.md); synthetic outcomes still do not establish real-provider behavior.

- Remaining scope (ALPHA-578, 2026-10-24): UX-243 still owns real mobile virtual-keyboard and long-document review plus any demonstrated responsive defects. Earlier width-matrix fixes are delivered.

## [ISSUE-065] Make Postbot's visual and content foundation operational beyond default shadcn grammar

- Type: proposal
- Status: accepted
- Evidence: The owner explicitly wants shadcn/Base UI to remain a source-code
  foundation rather than Postbot's visual identity. The independent audits found
  that the current visual tokens are mostly coherent, but also identified
  inconsistent button geometry, repeated card/form grammar, redundant provider
  headings, copy density, and terminology that weakens the intended calm
  dispatch-desk identity.
- Impact: Continuing to style each new surface locally will recreate the very
  default SaaS/shadcn look the project is trying to avoid. Reversing defaults
  with page-level CSS will make the system harder to maintain and harder for
  agents to understand. Over-simplifying copy without a content rule could hide
  important recovery or state information.
- Desired outcome: Define a small, explicit Postbot foundation for surface
  roles, geometry, typography, control sizes, icon usage, borders, shadows,
  focus, empty states, and progressive-disclosure copy. The foundation must
  state when the shadcn/Base UI primitives are reused, rewritten, or promoted
  into shared Postbot primitives. It must support the current themes and locales
  while allowing the logo, colors, and provisional treatments to evolve from
  evidence.
- Scope boundary: This does not freeze the current logo or palette, build a
  public brand site, add animation dependencies, or replace Base UI. It is not
  a visual polish pass detached from route jobs and real data.
- Tasks: DESIGN-120, DESIGN-98, WEB-124, UX-242
- Related issues: ISSUE-004, ISSUE-042, ISSUE-052, ISSUE-063
- Related specification: SPEC-006
- Follow-up: DESIGN-120 and the UX sprint establish the accepted foundation;
  remaining Access/provider-configuration and empty-state calibration should be
  handled as small evidence-driven passes, not a broad branding rewrite.

- Browser audit follow-up (2026-09-28): The 2026-09-28 browser audit found large headings and unused areas competing with small muted operational labels, closely valued dark surfaces, and premature truncation. UX-242 is a bounded visual calibration against real content, preserving the current brand and theme roles until a reviewed comparison supports a change.
- New evidence: [UX-239 worklog](worklogs/2026-09-28-UX-239.md).
- UX-246 follow-up completed (2026-09-29): Seven mixed operational states, long destination names, six representative locale/theme/viewport combinations, keyboard filtering/return navigation and responsive approval now supplement the existing recovery/media/realtime journeys. The complete local gate passed 42 browser scenarios plus 2 password-reset scenarios. Presentation defects and remaining composition work are recorded in [UX-246](worklogs/2026-09-29-UX-246.md); synthetic outcomes still do not establish real-provider behavior.
- UX-242 (2026-09-28): Dashboard titles now stay at 30 px through tablet widths, and Queue selection headers use 12 px sentence case. Sampled muted-text contrast passes in both themes; dark surface-value separation remains under review without a global token change. Evidence: [UX-242 worklog](archive/calendar-queue-delivery/worklogs/2026-09-28-UX-242.md).

- Remaining scope (ALPHA-578, 2026-10-24): Resolve the remaining dark-theme surface separation and visual acceptance. Foundation rules and typography/control corrections already exist; this is not a fresh design-system implementation.

## [ISSUE-066] Validate UX against realistic data, transitions, and realtime feedback

- Type: problem
- Status: resolved
- Evidence: The audits were correctly read-only and therefore did not exercise
  populated publications, failed or ambiguous outcomes, media uploads, multiple
  channels, network failures, loading states, notification state changes, or
  realtime reconnect behavior. One audit reported a possible transient blank
  loading state; a separate local observation previously saw a route-context
  error before a full reload, although neither is currently a confirmed
  production defect.
- Impact: Empty-state screenshots can make a workflow look coherent while
  hiding the real density, hierarchy, truncation, and recovery problems that
  appear as soon as several destinations, statuses, or notifications exist.
  Fixing the UI without this evidence would repeat the previous incremental
  drift.
- Desired outcome: Establish deterministic representative fixtures and a
  browser validation matrix for empty, populated, loading, partial, failed,
  manual, scheduled, notification, and realtime-updated states across desktop,
  tablet, and mobile. Verify direct navigation, reload, keyboard access, theme,
  locale, reconnect, and no-subscriber behavior. Capture evidence before and
  after the IA and shell changes, without requiring real provider side effects.
- Scope boundary: This does not publish to a provider, add analytics
  dashboards, replace SSE/Query, or treat synthetic fixtures as proof of
  provider behavior. Real-provider validation remains a separate controlled
  activity.
- Tasks: WEB-117, WEB-119, WEB-124, AUDIT-125, UX-246
- Related issues: ISSUE-050, ISSUE-051, ISSUE-052, ISSUE-063, ISSUE-064
- Related decisions: ADR-047, ADR-048, ADR-050
- Resolution: WEB-124 and the post-merge browser validation matrix now cover
  authentication, project isolation, two destinations, media upload and reuse,
  manual and scheduled delivery, queue filters, notification loading/error/
  retry, SSE reconnect/resync, failed and ambiguous recovery, and responsive
  layouts. The disposable run passed 12/12 tests without real provider side
  effects; recurring real-provider validation remains under ISSUE-021.
- Related specification: SPEC-006

- Browser audit follow-up (2026-09-28): Recurring validation follow-up requested after the 2026-09-28 browser audit. The current first-impression visit used sparse existing data and did not exercise provider dispatch, approvals, failures, or dense scheduling. UX-246 reuses the existing deterministic browser fixtures after the new passes; prior test evidence remains valid for its original scope.
- New evidence: [UX-239 worklog](worklogs/2026-09-28-UX-239.md).
- UX-246 follow-up completed (2026-09-29): Seven mixed operational states, long destination names, six representative locale/theme/viewport combinations, keyboard filtering/return navigation and responsive approval now supplement the existing recovery/media/realtime journeys. The complete local gate passed 42 browser scenarios plus 2 password-reset scenarios. Presentation defects and remaining composition work are recorded in [UX-246](worklogs/2026-09-29-UX-246.md); synthetic outcomes still do not establish real-provider behavior.

## [ISSUE-062] Define Postbot human account, instance administration, and invitation policy

- Type: proposal
- Status: accepted
- Evidence: Postbot currently supports local email/password account creation and
  human sessions, while project ownership initially belongs to the creating user.
  `ISSUE-013` and ADR-030 deliberately deferred memberships and invitations, but
  the first real local onboarding exposed the unanswered product questions around
  who may create the first account, whether registration stays open, and how a
  self-hosted instance is administered.
- Impact: Without an explicit policy, a future hosted or shared self-hosted
  deployment could accidentally expose open registration, make the first account
  impossible to promote to an instance administrator, or introduce invitations,
  email delivery, password recovery, and project membership with incompatible
  ownership semantics. The current local single-operator flow must remain simple
  while those broader modes are evaluated.
- Desired outcome: Define distinct deployment and access profiles (local
  single-operator, shared self-hosted, and any future hosted mode), including
  bootstrap/first-admin behavior, registration policy, human roles, project
  membership and invitations, email verification and password recovery, account
  deletion, and abuse/rate-limit boundaries. The decision must state which parts
  are required before exposing Postbot beyond a trusted local operator and must
  preserve project-owned publisher credentials and machine-token attribution.
- Scope boundary: The accepted access policy does not add organization billing,
  SSO, or user deletion/anonymization. It adopts
  Better Auth Admin, Organization, and API Key plugins for the applicable access
  lifecycle; project-member administration is now delivered by ACCESS-134, while
  the UI deliberately remains a Postbot surface over those Better Auth records.
  Invitation re-send rotation and the optional transport-neutral email hook are
  delivered by ACCESS-136. ACCESS-137 adds an optional SMTP transport and
  ACCESS-138 extracts React Email templates with a local Mailpit development
  relay for invitations, signup verification, and password reset; the
  local/manual-link profile remains usable without mail.
- Tasks: ACCESS-116 (policy), ACCESS-131, ACCESS-132, ACCESS-134, ACCESS-136,
  ACCESS-137, ACCESS-138, ACCESS-219, ACCESS-220
- Related issues: ISSUE-013, ISSUE-059
- Related decisions: ADR-012, ADR-030, ADR-056, ADR-061, ADR-063, ADR-066, ADR-067
- Resolution: ADR-061 establishes the local single-operator bootstrap and the
  shared self-hosted boundary: the first account claims an empty instance and
  becomes its administrator, later registration is closed by default, and instance
  and project membership are distinct. ADR-063 implements the access lifecycle with
  Better Auth Admin, Organization, and API Key plugins: each project has one
  organization, its member rows authorize project access, invitations expire after
  seven days, and new project keys expire after 180 days by default. Postbot retains
  instance membership and actor projections, while ACCESS-134 exposes the project
  member and invitation workflow through the dashboard. ACCESS-131 through
  ACCESS-138 are complete. ACCESS-219 adds localized web password-reset request
  and completion screens over Better Auth, preserves the same public response for
  known and unknown accounts, and verifies the configured email path through an
  isolated Mailpit browser test. Without SMTP, the UI states that password
  recovery is unavailable; ACCESS-220 provides the operator-controlled offline
  password reset for an existing account, including a protected pre-change backup
  and session/reset-link invalidation. Offline admin-role reassignment is separate
  from this password-reset command. User deletion/anonymization, ownership transfer
  policy, and post-retirement physical cleanup remain explicit follow-ups.

- Remaining scope (ALPHA-578, 2026-10-24): User deletion/anonymization, ownership transfer and post-retirement physical cleanup remain unimplemented or undecided. Bootstrap, invitations and password recovery are delivered.

## [ISSUE-077] Make Queue summary counts complete across paginated history

- Type: problem
- Status: resolved
- Evidence: The publication list is intentionally bounded to 100 rows and
  returns a continuation cursor, while `PublicationQueuePage` derives total,
  manual, automatic, and scheduled counts from the rows currently held in the
  browser. The foundation audit reproduced 101 stored publications with only
  100 returned by the first page, so the visible counts are not the project's
  complete Queue counts until the user loads another page.
- Impact: Queue tabs, summary bars, accessible labels, and empty/filter context
  can report partial numbers as if they were authoritative. A user can therefore
  make an incorrect triage decision without any visible indication that the
  counts are incomplete.
- Desired outcome: The paginated publication contract returns explicit,
  authorization-scoped aggregate counts for the Queue summary, with filter and
  range semantics defined at the API boundary. Loading another page must append
  rows only; it must not change already-known aggregate counts except after a
  deliberate refresh or mutation.
- Scope boundary: This issue does not remove pagination, expose unbounded
  history, introduce a second read model, or make calendar range counts pretend
  to be global Queue counts.
- Tasks: WEB-152
- Related issues: ISSUE-019, ISSUE-063, ISSUE-070
- Related decisions: ADR-002, ADR-032, ADR-057
- Resolution: Publication summary pages now return an explicit aggregate for
  the same authorized project, tag filter, and half-open scheduled range as
  the row query. The Queue stores that aggregate separately from its bounded
  rows and uses it for summary bars, tabs, accessible counts, and unfiltered
  section metadata. Loading another page only appends rows; a refresh or
  mutation is responsible for replacing the known aggregate.

## [ISSUE-078] Keep issue completion state aligned with task evidence

- Type: problem
- Status: resolved
- Evidence: The task ledger recorded completed work for several accepted
  issues, while the issue register still presented those same issues as merely
  accepted. Other accepted issues intentionally retained unimplemented or
  explicitly deferred scope, so a bulk status change would have hidden real
  follow-ups.
- Impact: The owner could not reliably tell whether the next action was a bug
  fix, an already-delivered decision, an operational validation, or a deferred
  product choice. This makes backlog prioritization and handoff less precise.
- Desired outcome: Issue status reflects the evidence available in completed
  tasks and resolutions. Residual scope remains explicit, and open harness or
  deliberately deferred work is not presented as complete.
- Tasks: META-153
- Resolution: The accepted issues whose scoped outcomes are implemented have
  been reconciled to `resolved`, with concise closure evidence and bounded
  follow-ups where applicable. ISSUE-052, ISSUE-058, ISSUE-062, ISSUE-063, and
  ISSUE-065 remain accepted because their records explicitly retain product,
  UX, account-lifecycle, or scale scope that is not fully implemented. ISSUE-029
  was later declined by the owner as no longer relevant to current Postbot work;
  this is not a claim that the platform limitation was fixed. ISSUE-021 and
  ISSUE-036 remain open; the MCP workstream is intentionally deferred by the
  owner.

## [ISSUE-098] Clarify publication authoring entry points and user vocabulary

- Type: design
- Status: resolved
- Evidence: The authenticated project shell exposes `Composer` as a persistent
  peer in Work navigation, while Overview, Calendar, Queue, and empty states
  expose creation actions such as `New publication` or `Create a publication`.
  The destination route is a real multi-channel authoring flow, but it presents
  the internal relationship as `Source`, `Destinations`, `targets`, channel
  overrides, delivery modes, and schedules before the operator has chosen a
  mental model for that work.
- Impact: Users may not know whether Composer is a separate kind of work, a
  duplicate entry point, or simply the place to make a publication. The
  distinction between shared content, channel-specific copy, delivery, and
  scheduling is useful to the product but currently leaks implementation/domain
  vocabulary into the first reading of the task. Renaming one label in isolation
  could leave the sidebar, page title, back links, empty states, and existing
  publication editor inconsistent.
- Desired outcome: Define the primary authoring job, the role of the dedicated
  creation route, and the entry-point hierarchy before implementation. Choose
  user vocabulary for a new publication, shared content, channel-specific
  adaptations, delivery, and scheduling; retain source/target semantics in the
  domain and expose them only where they help a decision. The result must make
  the existing multi-destination capability understandable without adding
  explanatory prose or removing useful shortcuts.
- Scope boundary: This is an IA, interaction, and content-design investigation
  for authenticated publication authoring. It does not change the publication
  domain/API, remove the multi-destination model, redesign the calendar, or
  implement a visual preview/editor rewrite until the authoring contract is
  accepted. The final visible label is intentionally not predetermined.
- Tasks: DESIGN-173, WEB-174
- Related issues: ISSUE-063, ISSUE-080, ISSUE-081
- Related decisions: ADR-057
- Decision: The dedicated creation route remains the reusable authoring surface,
  but it is not a peer destination in the Work navigation. The canonical route
  is `/dashboard/projects/$projectId/publications/new`; `/compose` is removed
  rather than retained as a compatibility alias because this private development
  application has no migration obligation. The sidebar exposes one primary
  `New publication` action when a project is active, while project creation is
  available from the project selector instead of occupying a persistent slot.
  The product vocabulary uses `publication` consistently; the exact hierarchy
  of the authoring form (`Source`, channel adaptations, delivery, and schedule)
  remains a bounded follow-up and is not re-litigated by this routing slice.
- Resolution: WEB-174 implements the accepted entry-point contract. The route and
  authoring module now use `/publications/new`, all in-scope links, copy, route
  artifacts, and browser contracts were updated, and the former `/compose` route
  and Composer navigation peer were removed. The project selector is labeled
  the project-context label, contains the inline project-creation action, and the
  active-project sidebar exposes one prominent `New publication` /
  `Nouvelle publication` action. The authoring form hierarchy remains deferred
  to a separate UX slice.
- Verification: The authenticated browser inspection confirms the French sidebar
  hierarchy and selector behavior. `bun run check` passes format, lint, typecheck,
  unit tests, 17 Playwright scenarios, and the production build; i18n coverage is
  100% for English and French.
- Acceptance: A concise authoring IA brief maps every current entry point to one
  user job, states whether the dedicated route remains a navigation destination
  or only an action target, proposes vocabulary alternatives with rationale, and
  records the chosen direction and deferred questions. No code rename is made
  solely to test a label before that contract is accepted.

## [ISSUE-099] Reframe new-publication authoring around the operator’s job

- Type: design
- Status: resolved
- Evidence: The canonical new-publication route still opens with two visually
  equal sections named `Source` and `Destinations`. The first reading therefore
  exposes the internal fan-out model before answering the operator’s two
  sequential questions: what should be published, and where should it go?
  The target editor also presents channel selection, shared delivery defaults,
  and channel-specific overrides as one undifferentiated settings surface.
- Impact: The page can be technically correct while making a normal publication
  feel like a technical composition workflow. Repeated source/destination
  vocabulary and peer panels dilute the primary writing task, while default
  settings and optional channel adaptations compete for the same attention.
- Desired outcome: Make the publication itself the primary object of the page.
  Use user-facing `Content` and `Publish to` language, give the content editor
  the dominant visual weight, let channel selection precede delivery settings,
  and keep per-channel adaptation and delivery overrides available without
  making them the default reading path. Preserve the existing multi-channel
  API and draft behavior.
- Scope boundary: This slice changes the new-publication information hierarchy,
  labels, and progressive disclosure only. It does not add a social-network
  preview, rich-text editing, new scheduling semantics, or a redesigned
  publication detail editor.
- Tasks: DESIGN-175, WEB-176, UX-241
- Related issues: ISSUE-098, ISSUE-063
- Related decisions: ADR-057
- Acceptance: An operator can identify the content editor and the channels to
  publish to from the first frame, understands that shared delivery settings
  apply to all selected channels, and can still select, remove, customize, and
  schedule multiple channels. The page has no user-facing Source/Destinations
  headings, no duplicate “destination” framing in the active channel card, and
  remains usable at narrow widths with localized English and French copy.
- Resolution: DESIGN-175 and WEB-176 implement the accepted authoring contract.
  The page now leads with its content section, uses an explicit channel-scope
  section, gives the editor the dominant column, puts channel selection
  before shared delivery settings, and keeps channel-specific changes in the
  active channel card. User-facing Source/Destinations and duplicate destination
  framing were removed without changing the multi-channel API or draft behavior.
- Verification: Focused browser coverage and the full repository gate pass for
  the localized route, including the narrow multi-channel and media scenarios;
  English and French i18n coverage remains 100%. The authenticated integrated
  browser was inspected on the local `/publications/new` route.

- Browser audit follow-up (2026-09-28): Reopened after the 2026-09-28 browser audit: selected destinations, the active editing destination, and shared content use similar controls; removing a destination is separate from activating it. Saved composition feedback and explicit publication-draft creation need distinct meanings. Preserve the completed entry-point and preview work; propose and validate a focused interaction revision before implementation.
- New evidence: [UX-239 worklog](worklogs/2026-09-28-UX-239.md).
- UX-246 follow-up completed (2026-09-29): Seven mixed operational states, long destination names, six representative locale/theme/viewport combinations, keyboard filtering/return navigation and responsive approval now supplement the existing recovery/media/realtime journeys. The complete local gate passed 42 browser scenarios plus 2 password-reset scenarios. Presentation defects and remaining composition work are recorded in [UX-246](worklogs/2026-09-29-UX-246.md); synthetic outcomes still do not establish real-provider behavior.
- UX-241 implementation (2026-09-28): the owner approved the interaction
  contract. `Publish to` now controls inclusion only; a separate accessible
  selector controls shared versus channel-specific editing and its preview.
  The exact editing scope survives route changes and browser/server recovery;
  removing its destination falls back to shared content. Destination labels
  wrap, autosave is distinct from creating a persistent draft, and scheduling
  names the publication count. Six focused Playwright scenarios, the quick
  repository checks, and the production build pass. The local integrated API
  was unavailable for a separate manual visual pass.
- New evidence: [UX-241 worklog](worklogs/2026-09-28-UX-241.md).

- Closure (ALPHA-578, 2026-10-24): UX-241 implemented the owner-approved inclusion/editing-scope contract, recovery and distinct draft/scheduling actions. Six focused browser scenarios and retained integration coverage establish the bounded authoring outcome. Further platform preview calibration belongs to UX-248, not this issue. [Evidence](worklogs/2026-09-28-UX-241.md). Historical test claims were reviewed, not rerun by this ledger correction.

## [ISSUE-100] Give publication authoring a contextual output preview

- Type: design
- Status: resolved
- Evidence: The new-publication route now makes shared content, selected
  channels, and channel-specific overrides legible, but the operator still has
  to mentally translate that draft into the output of the active channel. The
  page exposes no immediate indication of how a title, adaptation, or selected
  media will be presented for the channel currently being configured.
- Impact: Multi-channel authoring remains an abstract configuration task. An
  operator can select a different channel or write an override without getting
  quick feedback that the content being reviewed has changed, which preserves
  the uncertainty the new hierarchy was intended to reduce.
- Desired outcome: Add one contextual, live preview for the selected channel.
  It should identify the active channel, show the effective channel content
  (override when present, otherwise shared content), show the publication title
  where the known profile uses one, and render selected media when available.
  The preview must remain content-led, use the existing surface grammar, and
  stay honest as an approximation rather than pretending to reproduce every
  provider’s final renderer.
- Scope boundary: This slice does not add a server-rendered preview endpoint,
  provider-perfect rendering, rich-text editing, character/media compliance
  validation, new scheduling behavior, persistence, or a second authoring
  flow. Custom and manual channels use the generic content/media treatment.
- Tasks: DESIGN-177, WEB-178
- Related issues: ISSUE-098, ISSUE-099
- Related decisions: ADR-057
- Acceptance: The preview follows the active channel tab without navigation;
  shared content, a channel override, title changes, and selected media update
  immediately; the known DEV.to title/body distinction is represented while
  other profiles remain generic and truthful; an empty draft does not display
  fake content; no-channel and narrow layouts remain actionable and localized;
  no API or publication-domain contract changes are required.
- Resolution: DESIGN-177 and WEB-178 add a contextual draft preview below the
  selected-channel controls. The preview identifies the active channel, uses
  the effective channel content, shows DEV.to titles where that profile owns a
  title field, and renders selected media through the existing media primitive.
  It stays local to the page and makes no API or publication-domain changes.
- Verification: The focused new-publication browser scenario covers no-channel,
  shared content, channel override precedence, active-channel switching, and
  narrow layout. The media scenario confirms selected media is visible in the
  preview. Web unit tests cover the pure preview model; localization coverage
  remains 100%; the full repository gate passes with 17 Playwright scenarios;
  the authenticated integrated browser was inspected in light and dark themes.
- Owner follow-up (2026-09-29): The owner wants a much closer visual simulation
  of the destination feed, beginning with LinkedIn, using a recognizable stock
  mockup identity and illustrative engagement rather than a channel logo,
  repeated platform label, generated portrait, or the connected user's actual
  identity. UX-247 implements that focused correction; UX-248 tracks careful
  provider-by-provider calibration. Illustrative figures remain preview-only
  and must not be presented as real analytics.

## [ISSUE-101] Establish a Postbot-owned media authoring and editing boundary

- Type: proposal
- Status: resolved
- Evidence: The current web picker combines library reads, upload orchestration,
  selection, accessibility text, ordering, and compact previews in one
  application component. It has no reusable image viewer or editor, and its
  current order controls are a fallback rather than the intended dense media
  workflow. Uppy offers a mature upload core and a prebuilt image editor, but
  its Dashboard is an opinionated surface that does not belong in Postbot's
  visual system; the editor is documented primarily around that Dashboard.
  The project therefore needs an evidence-backed choice for the editor and the
  composition boundary, not a skin applied to a vendor dashboard.
- Impact: Choosing an upload/editor stack without separating orchestration from
  presentation could either force Postbot to inherit a foreign UI or recreate
  fragile upload, preview, crop, reorder, and recovery behavior inside the
  publication form. Editing an existing asset in place could also destroy a
  reusable original or make provider-specific variants impossible to introduce
  later.
- Desired outcome: Prove a reusable, Postbot-owned media workflow that supports
  the existing reserve/upload/finalize lifecycle, library selection, full-size
  preview, non-destructive image editing, dense ordered attachments, keyboard
  and pointer access, and light/dark responsive presentation. Compare a
  headless upload orchestrator with a React-oriented standalone editor, record
  the bundle and accessibility trade-offs, and define whether edited output is
  a new asset or a durable representation before integrating it into
  publication authoring.
- Scope boundary: This is a media-system and editor investigation. It does not
  adopt Uppy Dashboard, change provider contracts, invent per-destination crop
  semantics, or replace the publication editor before the prototype has
  demonstrated a stable contract. Existing assets must remain immutable during
  the experiment.
- Tasks: MEDIA-179
- Related issues: ISSUE-003, ISSUE-007, ISSUE-099, ISSUE-100
- Resolution: MEDIA-179 establishes the first Postbot-owned boundary. The web
  picker keeps API upload orchestration and uses a lazy Postbot viewer/editor
  with `react-easy-crop` for crop, zoom, and rotation. Saving creates a new
  verified asset and replaces a selected source only after verification; native
  drag ordering has focus-visible/mobile arrow fallbacks. Uppy Dashboard is
  explicitly not adopted, and Uppy core/headless remains a future option only
  if upload orchestration needs exceed the current API lifecycle. The proven
  composition remains in `apps/web` until a second consumer justifies a
  generic `@postbot/media-ui` package.
- Verification: The focused publication-media browser scenario and the full
  repository gate pass; the authenticated integrated browser was reviewed in
  light and dark themes. The production build splits the editor into a 41.48
  kB (13.81 kB gzip) lazy chunk and keeps the picker at 24.31 kB (8.45 kB
  gzip). Provider-specific transforms, touch-first sortable interaction, and
  generalized media packaging remain explicit follow-up scope.

## [ISSUE-102] Make the Media route a first-class library and introduce a headless Uppy intake boundary

- Type: proposal
- Status: resolved
- Evidence: The Media route reused the publication editor's project-scoped
  selection state, so it presented a library as if it were an attachment
  picker and carried selection affordances without a publication consumer.
  The picker also owned the browser file input and upload orchestration
  directly, despite the need to evaluate Uppy for reusable intake behavior
  without adopting its opinionated Dashboard surface.
- Impact: Treating the library and attachment workflow as the same interaction
  makes the standalone Media page ambiguous and makes a future upload/editor
  evolution harder to isolate. Adopting a vendor UI wholesale would instead
  make Postbot inherit foreign surfaces and styling.
- Desired outcome: The Media route manages reusable project-scoped verified
  assets with preview and editing actions, while publication contexts retain
  attachment selection. Uppy Core and React headless hooks should orchestrate
  file intake, and a Postbot adapter should preserve the existing
  `reserve → raw upload → finalize/verify` contract and its error semantics.
- Scope boundary: This slice does not adopt Uppy Dashboard or vendor CSS,
  change the media API, migrate the current Postbot-owned image editor, add
  cancellation/resumability, or introduce a generic `@postbot/media-ui`
  package before a second API-independent consumer exists.
- Tasks: MEDIA-180
- Related issues: ISSUE-003, ISSUE-101, ISSUE-099, ISSUE-100
- Resolution: MEDIA-180 adds a testable Postbot upload adapter around Uppy Core,
  uses `@uppy/react`'s headless file-input, dropzone, context, and state hooks,
  and keeps Postbot responsible for reservation, raw transfer, verification
  polling, and typed diagnostics. The Media route now runs in explicit manage
  mode: it has no publication-selection toggles, retains preview/edit/upload
  actions, and offers a direct New publication entry point. Publication
  attachment contexts keep their existing selection behavior.
- Verification: The focused Uppy orchestration tests cover ready, pending, and
  failed verification; the publication/media browser scenario covers import,
  editing, reorder, the manage-only Media route, and return to authoring. The
  full repository gate passes with localization coverage, 17 Playwright
  scenarios, and the production build. Uppy remains headless and the existing
  editor remains unchanged pending a dedicated editor proof.
- Follow-up: Evaluate Uppy Image Editor as an isolated Postbot dialog adapter,
  then separately assess real progress, cancellation, retry, and resumability
  against the current API lifecycle before changing the editor or extracting a
  shared media package.

## [ISSUE-103] Define safe external media sources for the project library

- Type: proposal
- Status: resolved
- Evidence: The first Uppy integration deliberately supports local device
  selection and drag-and-drop only. Uppy documents remote sources such as
  Google Drive, Dropbox, OneDrive, Unsplash, and URL import as separate
  provider plugins; those integrations require Companion to authenticate with
  the remote service and transfer the selected file. The current Postbot API
  has no Companion boundary or remote-source ownership model.
- Impact: Adding source buttons without deciding which providers Postbot
  supports, where OAuth credentials live, and which service downloads the
  bytes would create misleading UI and an unreviewed security/deployment
  boundary. Installing the all-in-one remote-sources preset would also pull in
  most provider plugins when the product may only need a small subset.
- Desired outcome: Choose a deliberately small first set of external sources,
  define their authentication, privacy, network-egress, byte-transfer,
  failure, and self-hosting contracts, then expose them through a
  Postbot-owned source picker that feeds the same verified media lifecycle as
  local files.
- Scope boundary: This investigation does not add Uppy Dashboard, enable a
  hosted Companion by default, store third-party OAuth tokens in the media
  domain, or install every remote-source plugin. Local device/drop handling
  remains available while the source contract is evaluated.
- Tasks: MEDIA-181
- Related issues: ISSUE-003, ISSUE-101, ISSUE-102
- Acceptance: The supported-source list and deployment mode are explicit; each
  selected provider has a reviewed OAuth and transfer boundary; unsupported or
  unconfigured sources are absent from the UI; imported bytes enter the same
  Postbot reserve/upload/finalize/verification lifecycle; focused security,
  failure, and browser coverage exists before any source is enabled.
- Resolution: The first supported set is local device selection, browser-owned
  webcam capture, and an explicitly configured server-side URL importer. URL
  transfers use controlled egress, bounded redirects, bytes, content types, and
  timeouts; all accepted bytes enter the shared verified upload lifecycle.
  OAuth-backed cloud providers, Companion, and Unsplash remain optional future
  work, not a permanent exclusion or a prerequisite for the delivered sources.

## [ISSUE-104] Define the scalable project media library contract

- Type: proposal
- Status: resolved
- Evidence: Media management uses bounded cursor reads, stable ordering, search,
  persisted gallery/compact/list modes, an upload-policy endpoint, usage
  categories, and guarded deferred deletion. The owner chose recoverable
  deletion: requests immediately remove assets from the library and place them
  in a separate Trash view for the configured retention period (24 hours by
  default). The UI states that duration before confirmation, shows each item's
  permanent-deletion deadline, and offers restoration while its saved lifecycle
  snapshot remains eligible. Database, API, and browser tests cover listing,
  expiry, restoration, and the normal-library boundary. See the
  [MEDIA-182 trash recovery worklog](worklogs/2026-09-24-MEDIA-182-trash-recovery.md).
- Impact: Files do not linger in the normal media library after deletion, while
  users can recover eligible files until their configured deadline. Permanent
  cleanup remains protected by the reference check and backup fence, with
  reconciliation retrying partial object deletion.
- Desired outcome: An accepted product, API, and operational contract for the
  project media library covering the default browse mode and density options,
  the minimum useful metadata and actions, supported file constraints and
  diagnostics, bounded search/filter/sort reads, usage/reference semantics, and
  a safe deletion state machine. The contract must keep local intake, future
  external sources, publication attachment selection, and media management
  distinct while allowing them to share verified assets.
- Scope boundary: This issue does not adopt Uppy Dashboard or vendor CSS, add
  remote-provider controls (tracked by ISSUE-103), replace the current image
  editor, add blind deletion, or introduce virtualization before a bounded API
  and measured rendering need exist.
- Tasks: MEDIA-182
- Related issues: ISSUE-003, ISSUE-101, ISSUE-102, ISSUE-103
- Acceptance: The repository records the accepted browse/metadata/action model,
  a cursor-based or otherwise bounded media-read contract, explicit usage
  categories and deletion outcomes, upload constraints, and test/measurement
  targets. The contract identifies which decisions are product defaults and
  which remain intentionally deferred before implementation work begins.
- Current classification: The browse, upload, usage, guarded deletion, Trash,
  and restore contracts are implemented and covered. No additional layout
  benchmarking or virtualization is justified without observed performance
  problems.
- Follow-up: None for this issue. Future changes to retention policy remain an
  operational configuration choice, not an unresolved product decision.

## [ISSUE-105] Define the integration state of the external audit branch

- Type: problem
- Status: resolved
- Evidence: The supplied external audit reports a branch materially ahead of `main`, while the current checkout also contains user-owned working-tree changes.
- Impact: Without an explicit integration state, later work can be evaluated against the wrong baseline and unrelated user changes can be mistaken for audit output.
- Desired outcome: The audit has a reproducible baseline and a clear owner decision for integration, without discarding or silently absorbing unrelated work.
- Tasks: OPS-191, OPS-192
- Resolution: The owner selected `codex/reui-calendar-spike` as the integration
  source. `main` was advanced to `f557a37b` with a fast-forward, preserving all
  80 commits without rebasing or squashing. The current checkout's uncommitted
  changes remain untouched and are not represented as committed integration
  output.
- Current classification: `main` and `codex/reui-calendar-spike` now resolve to
  the same commit. The current checkout still contains user-owned working-tree
  changes, which remain separately identifiable.

## [ISSUE-106] Make untracked audit-era work classifiable

- Type: problem
- Status: resolved
- Evidence: The supplied audit reports many untracked paths, including migrations, API files, design artifacts, and UI primitives whose ownership and intended lifecycle are not uniformly obvious.
- Impact: Ambiguous ownership makes review, integration, cleanup, and recovery unsafe.
- Desired outcome: Every audit-relevant untracked path has an explicit classification as retained project work, generated output, disposable runtime data, or owner-controlled follow-up.
- Tasks: OPS-191
- Resolution: The current 81 untracked paths are retained source, migrations,
  tests, UI assets, Autonomos records, or reviewed spelling configuration. No
  untracked path was classified as disposable runtime output, and none was
  deleted or silently absorbed into a different change set.

## [ISSUE-107] Reconcile branch and worktree hygiene

- Type: problem
- Status: resolved
- Evidence: The supplied audit reports stale branches and multiple worktrees, including references to removed branches and a prunable worktree.
- Impact: Stale parallel state increases collision risk and makes it difficult to identify the authoritative checkout.
- Desired outcome: Repository lifecycle state can be inventoried, ownership is clear, and cleanup can be performed safely when the owner authorizes it.
- Tasks: OPS-192
- Resolution: After the owner selected `main` as the integration baseline, 18
  clean worktrees whose HEADs were already ancestors of `main` were removed.
  The missing `/tmp/postbot-review-discord` worktree was pruned from Git's
  administrative metadata. Local branch refs were then evaluated against
  `main` and removed only when their work was integrated or superseded.
- Current classification before the final cleanup pass: the detached
  `/home/hakim/.codex/worktrees/7ae0/postbot` and branch-backed
  `/home/hakim/.codex/worktrees/taxonomy-130-backend` each contained one commit
  not reachable from `main`, while
  `/home/hakim/Documents/Codex/2026-09-02/in-app-browser-context-source-ambient`
  contained two uncommitted changes. The first two were retained pending a
  content-level evaluation rather than being assumed abandoned.
- Final classification: `7ae0` was superseded by `b0027ac5`, which carries the
  same disabled-profile and worker-clock corrections plus the corresponding
  Autonomos record; `main` passes the focused workflow boundary tests. The
  taxonomy worktree's patch is identical to `c3df184a`, already present in
  `main`, and its focused API, client, domain, and database tests pass. Both
  worktrees were therefore removed. The dirty
  `/home/hakim/Documents/Codex/2026-09-02/in-app-browser-context-source-ambient`
  worktree was an old calendar MVP. The owner confirmed that the calendar has
  since been built in the canonical checkout, so the entire secondary worktree
  and its untracked files were removed.
- Branch classification: 47 local branches were already ancestors of `main`;
  their work is integrated and their local refs were removed, excluding the
  authoritative `main` ref and the checked-out `codex/reui-calendar-spike` ref.
  Four non-ancestor branches were evaluated individually: `codex/taxonomy-130-
backend` is an exact patch duplicate of `c3df184a`, `docs/analytics-storage-
posture` is an exact patch duplicate of `aa889111`, and
  `feat/analytics-112-bluesky-observations` is an exact patch duplicate of
  `57f09e0f`. `feat/provider-bluesky-loopback-oauth` is superseded by the
  integrated `ce962f20` implementation and its follow-up access-policy records.
  Those four local refs were removed; no remote branch was modified.

## [ISSUE-109] Reconcile task, issue, and worklog completion states

- Type: problem
- Status: resolved
- Evidence: The supplied audit identifies accepted issues with apparently incomplete follow-up tasks and a worklog whose task identifier does not match its subject.
- Impact: The Autonomos ledger can claim closure without a matching implementation or can route future work to the wrong boundary.
- Desired outcome: Issue status, task status, worklog identity, and completion evidence agree without rewriting historical evidence.
- Tasks: OPS-195
- Resolution: Current protocol status reports valid artifacts and the new audit
  tasks link back to their issues. Historical worklogs remain unchanged; the
  earlier mismatched record is retained as history and is not used as current
  closure evidence.

## [ISSUE-110] Revalidate historical audit closure evidence

- Type: problem
- Status: resolved
- Evidence: The supplied audit reports that prior H-01 through H-07 findings are marked corrected, but the supporting evidence may predate the current source tree.
- Impact: Historical closure labels can create false confidence about current security, reliability, cleanup, or quality-gate behavior.
- Desired outcome: Each historical finding is explicitly classified as current, corrected, not reproduced, or historical-only using current source and tests.
- Tasks: AUDIT-196
- Resolution: H-01 through H-07 are classified in the current audit evidence as
  current, corrected, not reproduced, or historical-only. The original records
  remain historical and are not rewritten.

## [ISSUE-111] Define publisher encryption key lifecycle

- Type: problem
- Status: resolved
- Evidence: The supplied audit reports one deployment-owned publisher encryption key without a demonstrated rotation or re-encryption lifecycle.
- Impact: Key compromise, planned rotation, or secret-provider migration may require manual reconnection of every publisher or create recovery ambiguity.
- Desired outcome: Postbot has an accepted key lifecycle covering rotation, active-version selection, re-encryption, rollback, recovery, and operator evidence without exposing secret values.
- Tasks: SECURITY-197
- Current classification: ADR-012 and the implementation already establish the
  current contract: one deployment-owned key, key/version identifiers in
  encrypted envelopes, and a separate backup requirement. Key rotation,
  keyrings, and re-encryption are not supported. Losing or replacing the key makes
  existing stored credentials unreadable, so affected publisher accounts must be
  connected again. This is an accepted current limitation, not an unanswered
  product decision; revisit rotation tooling if an actual deployment needs it.

- Closure (ALPHA-578, 2026-10-24): ADR-012 and SECURITY-197 settled the current deployment-owned key and recovery policy. Unsupported rotation/keyrings are an accepted limitation, not an unfinished implementation commitment. Reopen only for a concrete rotation requirement. [Evidence](worklogs/2026-09-24-AUDIT-189-closeout.md). Historical test claims were reviewed, not rerun by this ledger correction.

## [ISSUE-114] Define and connect external notification delivery

- Type: problem
- Status: resolved
- Evidence: The supplied audit reports a durable notification-delivery store that is exported and tested but not connected to an external transport.
- Impact: The repository can persist delivery intent without providing an operator-visible path to deliver or reconcile it.
- Desired outcome: Supported external notification destinations, ownership, transport, retry, ambiguity, and observability semantics are explicit and exercised end to end.
- Tasks: NOTIFY-199
- Current classification (META-576 reconciliation): NOTIFY-354 subsequently delivered
  optional personal per-project SMTP alerts for failed and ambiguous publication
  outcomes, sent to the current verified account email with explicit enrollment.
  The production executor uses durable delivery state and preserves uncertain
  SMTP outcomes rather than blindly retrying them. This does not implement Ntfy,
  Telegram or arbitrary external destinations; their earlier deferral remains
  applicable. Authentication email remains separately best-effort under ISSUE-115.
  The issue stays accepted for its broader transport contract; this scoped
  delivery does not close every requested destination or reliability outcome.
  [Delivery evidence](worklogs/2026-10-08-NOTIFY-354.md).

- Closure (ALPHA-578, 2026-10-24): NOTIFY-354 delivers the accepted personal, per-project SMTP destination for failed/ambiguous outcomes with explicit enrollment, current access checks and durable send states. The supported destination contract is implemented; other transports were deferred, not promised by this delivery. [Evidence](worklogs/2026-10-08-NOTIFY-354.md). Historical test claims were reviewed, not rerun by this ledger correction.

## [ISSUE-115] Define durable email failure handling

- Type: problem
- Status: resolved
- Evidence: The supplied audit reports that authentication email delivery is fire-and-forget without durable retry or dead-letter handling.
- Impact: Because SMTP sends are non-blocking and are not retried, invitations, verification messages, or password-reset messages may not reach their recipients after a transport failure. The API logs the failure, but there is no durable reconciliation queue.
- Desired outcome: Email delivery has an explicit reliability contract for acceptance, retry, ambiguity, permanent failure, and operator reconciliation.
- Tasks: NOTIFY-200
- Current classification: SMTP delivery is intentionally optional,
  asynchronous, and best-effort. Transport failures are logged without message
  payloads, but there is no durable retry or dead-letter behavior; Mailpit is
  development-only. ADR-066 already accepts this behavior for the current
  product. A durable queue is future work only if a deployment needs guaranteed
  delivery and operator reconciliation; this is not an open decision or blocker.

- Closure (ALPHA-578, 2026-10-24): ADR-066 explicitly accepts optional asynchronous best-effort authentication email with redacted failure logging. NOTIFY-200 verified that policy. Guaranteed authentication-email retry/dead-letter handling was not accepted work; personal publication alerts have a separate durable executor. [Evidence](worklogs/2026-09-24-AUDIT-189-closeout.md). Historical test claims were reviewed, not rerun by this ledger correction.

## [ISSUE-119] Reduce web component maintenance debt without changing behavior

- Type: problem
- Status: accepted
- Evidence: The supplied audit reports oversized UI modules and duplicated responsibilities across page, data, and interaction components.
- Impact: Future corrections become slower and more likely to introduce regressions or inconsistent behavior.
- Desired outcome: High-risk web modules have coherent ownership boundaries and measurable extraction targets without speculative abstraction.
- Tasks: WEB-204, WEB-224
- Current classification: Large modules remain, including the calendar, access,
  and publication editor surfaces. The first bounded seam is now implemented:
  management-mode rendering has moved into
  `MediaLibraryManagementSurface`, while upload, attachment selection, and
  dialog orchestration remain explicit in `MediaAttachmentPicker`. The issue
  remains accepted for future seams; no compatibility wrapper was retained for
  the extracted internal structure.

- Remaining scope (ALPHA-578, 2026-10-24): Choose a measured, behavior-preserving next extraction only if current component complexity warrants it. WEB-204/224 and later feature ownership refactors are delivered; no broad rewrite is committed.

## [ISSUE-120] Close confirmed accessibility and responsive gaps

- Type: problem
- Status: resolved
- Evidence: The supplied audit reports incomplete keyboard behavior, touch affordances, overflow handling, and narrow-layout coverage in calendar, media, and composer surfaces.
- Impact: Some users cannot discover or operate important workflows reliably across input methods and viewport sizes.
- Desired outcome: Supported surfaces have explicit keyboard, touch, focus, overflow, and responsive contracts verified by targeted evidence.
- Tasks: A11Y-205
- Resolution: The shared shell now exposes one top-level main landmark and an
  aside landmark for the sidebar. Axe coverage now passes on Overview, Queue,
  and Media, while existing browser checks cover keyboard calendar commands,
  touch media navigation, narrow calendar behavior, and responsive queue and
  publication surfaces.

## [ISSUE-121] Expand browser coverage for high-risk workflows

- Type: problem
- Status: resolved
- Evidence: The supplied audit reports missing browser scenarios for notifications, calendar interactions, bulk actions, media editing, offline/error recovery, and accessibility.
- Impact: Regressions can pass unit and type checks while breaking the workflows users actually operate.
- Desired outcome: High-risk states and transitions have deterministic browser coverage with isolated runtime ownership and actionable failure artifacts.
- Tasks: WEB-206
- Resolution: The browser inventory covers notifications, calendar interactions,
  bulk actions, media, realtime, and recovery scenarios. A standard Axe smoke
  test covers the core project surfaces, and the complete serial suite passes
  28/28 in the isolated runtime.

## [ISSUE-124] Keep project documentation aligned with implemented boundaries

- Type: problem
- Status: resolved
- Evidence: The supplied audit reports stale provider lists, incomplete LinkedIn scope language, and documentation that may no longer match accepted specifications or current routes.
- Impact: Contributors and operators can follow obsolete instructions or misunderstand ownership and capability boundaries.
- Desired outcome: Public project documentation reflects current supported providers, routes, recovery procedures, accepted vocabulary, and explicit deferrals.
- Tasks: DOCS-209
- Resolution: README and deployment documentation now match the provider
  packages, LinkedIn member scope, user-owned API-key boundary, recovery flow,
  and explicit deferred capabilities verified in the current source.

## [ISSUE-126] Apply authoritative X text validation throughout publication authoring

- Type: problem
- Status: resolved
- Evidence: `packages/x/src/profile.ts` limits both the JSON schema and the text
  capability to 280 raw characters/graphemes, while `packages/x/src/text.ts`
  applies X weighted counting only in the delivery adapter and documents
  approximate URL extraction and invalid-character handling. A 320-character
  URL is rejected by the profile although the weighted parser accepts it; 200
  CJK characters pass the profile although the weighted parser rejects them.
  Draft editing and scheduling use profile validation, while the provider
  rejects overweight text later in the worker.
- Impact: Users can be prevented from authoring valid X posts, or can schedule
  posts that only fail when delivery runs. The local parser can also disagree
  with X on URL and Unicode edge cases.
- Desired outcome: The same X-compatible text contract governs editing,
  persistence, scheduling, and delivery; invalid content is rejected before it
  is scheduled, valid content is not rejected by a raw-character approximation,
  and parser behavior is covered by the upstream conformance cases.
- Tasks: X-214
- Decision: Adopt the official `twitter-text` npm package at the exact upstream
  release `3.1.0`. Its age alone is not a reason to fork or reimplement it: X's
  current developer documentation still recommends the library. Reassess
  ownership only if the package causes a concrete maintenance or compatibility
  problem; if that happens, maintain only the functions Postbot needs and test
  them against upstream conformance.
- Dependency note: The release depends on legacy `core-js` 2 and `punycode`
  packages; npm reported no known advisories on 2026-09-25 and warns that
  `core-js` 2 is unmaintained. Keep the dependency direct, exact-pinned, and
  limited to the X provider/browser counter instead of spreading it through
  generic core.
- Validation boundary: The provider-owned weighted-text rule must run in the
  authoring UI, the shared profile validation used before persistence and
  scheduling, and the delivery worker. A raw schema/resource bound may remain
  for safety, but it must not be presented as X's character limit or reject
  otherwise valid weighted text.
- Resolution: X now uses the exact-pinned official `twitter-text@3.1.0` parser.
  The X profile v2 advertises a separate raw resource ceiling and its weighted
  count algorithm; a provider validation adapter also upgrades stored v1 X
  profile constraints at runtime without rewriting persisted profile snapshots.
  The live weighted counter appears in the new-publication source and X target
  override, as well as the publication target editor. The shared validator
  blocks invalid scheduled content before persistence/promotion, and the worker
  retains a final pre-dispatch check.
- Verification: Upstream behavior tests cover URL weighting, punctuation,
  emoji sequences, CJK, NFC normalization, invalid characters, and the 280
  weighted-character boundary. API tests cover scheduling and draft promotion;
  a browser test verifies the live counter for both shared and per-channel
  content. `check:quick`, all unit tests, the production build, the full existing
  Playwright suite, and the focused X composer browser test passed. See the
  [X-214 worklog](worklogs/2026-09-25-X-214.md).
- References:
  [X character counting](https://docs.x.com/fundamentals/counting-characters),
  [official twitter-text JavaScript implementation](https://github.com/twitter/twitter-text/tree/master/js),
  [twitter-text v3 configuration](https://github.com/twitter/twitter-text/blob/master/config/v3.json).

## [ISSUE-127] Recover safely after an abrupt runtime termination

- Type: problem
- Status: accepted
- Evidence: ADR-068 deliberately uses a database-specific sidecar marker and
  fails closed when it remains after forced termination. The operator must
  establish that no Postbot process is using the database and then remove that
  exact marker manually before restarting.
- Impact: A normal host crash or forced stop can turn the next startup into a
  manual recovery procedure, adding friction to the self-hosted operating
  model even though the marker correctly prevents concurrent restore.
- Desired outcome: Runtime exclusion is released after process death while
  restore remains unable to race an active Postbot process. Recovery must not
  depend on marker age or PID checks alone.
- Tasks: OPS-217
- Related issue: ISSUE-026
- Related decision: ADR-068
- Scope note: The current fail-closed behavior is intentional, not a newly
  reproduced regression. OPS-217 is an evaluation task only; changing the lock
  contract requires a separately accepted decision.
- Evaluation (OPS-217, 2026-09-26): A forced-stop experiment on the current
  sidecar confirmed that SIGKILL leaves the marker and blocks restore, while a
  Linux `flock` prototype on the repository's local ext4 filesystem excluded a
  concurrent process and released after SIGKILL. This proves feasibility on this
  Linux host, not Bun integration or cross-platform behavior. The documented
  container is Linux, but the project has no explicit host-platform support
  matrix. Keep the existing contract until the owner chooses whether direct
  Windows/macOS deployment is supported and accepts a platform-tested kernel
  lock implementation; do not use heartbeat expiry or PID-only reclamation as a
  substitute. See the [OPS-217 worklog](archive/runtime-recovery-observability/worklogs/2026-09-26-OPS-217.md).

- Remaining scope (ALPHA-578, 2026-10-24): Choose host-platform support and accept/test a kernel-lock contract before replacing the fail-closed sidecar. OPS-217 evaluated feasibility only; automatic stale-marker removal is not implemented.

## [ISSUE-131] Decide whether operational analytics needs a web surface

- Type: question
- Status: resolved
- Evidence: Postbot has a project-authorized operational analytics API and
  read-model implementation, but no authenticated web analytics route. The
  accepted foundation explicitly did not require a dashboard, so the missing
  page is not automatically a defect.
- Impact: Users may not discover useful publication and execution insights in
  the primary client, or a dashboard may add product and maintenance scope
  without a demonstrated workflow need.
- Desired outcome: Compare the value and cost of a concise web view, keeping
  analytics API-only for now, or deferring the decision until real use supplies
  evidence. Record the owner's choice before building charts or new metrics.
- Tasks: ANALYTICS-223
- Related issues: ISSUE-054, ISSUE-056
- Related decision: ADR-051
- Resolution (owner decision, 2026-09-26): Defer a web page for Postbot's internal
  delivery/execution analytics for now. This is not a permanent rejection of
  the page. The project-authorized API remains available while its purpose,
  persisted source data, overlap with instance telemetry, and access boundary
  are clarified under [ISSUE-135](#issue-135).

## [ISSUE-132] Maintain a cross-surface capability and verification matrix

- Type: proposal
- Status: resolved
- Evidence: The diagnostic found several different backend/frontend gaps and
  noted that their meaning differs: some may be intentional API-only
  capabilities, while account recovery and provider onboarding leave user
  journeys incomplete. The current issue ledger does not give one concise view
  of capability availability and end-to-end evidence across surfaces.
- Impact: Backend implementation or a completed task can be mistaken for a
  finished user journey, causing unfinished capabilities to disappear from
  planning or be rediscovered repeatedly.
- Desired outcome: A small, maintained inventory distinguishes web, API,
  existing CLI, and future protocol availability, plus end-to-end evidence and
  intentional deferrals. It must not imply that new clients should be built.
- Tasks: META-221
- Resolution (META-221, 2026-09-26): Added the [capability availability and
  verification matrix](archive/root-documentation-2026-10-25/source/docs/capability-evidence.md), covering current web,
  HTTP API, and shipped CLI surfaces with named end-to-end and API-test evidence.
  It distinguishes API availability from finished client journeys, records the
  incomplete X web connection and API-only analytics, and preserves MCP as an
  owner-directed deferral rather than an implementation commitment.
- Verification: Reviewed the dashboard routes, API modules, CLI command table
  and mocked-fetch tests, linked Playwright scenarios, and the current analytics
  and MCP task/issue records. The matrix explicitly limits what each test proves.

## [ISSUE-133] Reconcile proposed decision records with implemented behavior

- Type: problem
- Status: resolved
- Evidence: The diagnostic found decision records still marked `proposed` for
  areas with implemented code and tests, including runtime packaging, realtime,
  provider adapters, analytics, and runtime quiescence. A proposed record is
  not owner acceptance, so code presence alone cannot justify changing its
  status.
- Impact: Readers cannot tell whether a record is an unaccepted design, an
  implemented but unratified mechanism, or current normative guidance.
- Desired outcome: Inventory only the affected records, compare each with
  current source and owner decisions, and request explicit owner acceptance or
  retain the proposed status with a clear explanation. Do not promote records
  automatically.
- Tasks: META-225
- Related issue: ISSUE-109
- Resolution (META-225, 2026-09-26): Compared ADR-010, ADR-044, ADR-045,
  ADR-048, ADR-051, ADR-052, ADR-055, ADR-068, and ADR-069 with current source,
  tests, and their linked worklogs. Their mechanisms are implemented, but the
  repository does not record explicit owner ratification of these complete
  technical decisions. All nine statuses remain `proposed`; feature or
  implementation approval is not treated as ADR acceptance. Corrected ADR-010's
  obsolete release framing and runtime-version detail to match accepted
  continuous-development scope and the repository-pinned Bun runtime.
- Owner clarification: The internal Postbot operational-analytics UI deferral
  does not defer publication-performance analytics such as views and comments.
  The decision inventory and remaining ratification choices are recorded in the
  [META-225 worklog](worklogs/2026-09-26-META-225.md).

## [ISSUE-134] Contain the Better Auth and Elysia type-integration seam

- Type: problem
- Status: resolved
- Evidence: The Better Auth plugin integration maintains a local type contract
  and conversions around framework inference limitations. The diagnostic
  identified this as a concrete maintenance seam, not evidence that Elysia or
  the current architecture should be replaced.
- Impact: Framework or authentication dependency updates may widen the adapter
  or cause unsafe type drift if this boundary remains implicit.
- Desired outcome: Characterize the seam with focused contract coverage and
  document its upgrade constraints; keep the adapter narrow and change
  frameworks only if concrete incompatibility justifies it.
- Resolution: Added an Elysia-mounted sign-up/session-cookie contract test and
  explicit Better Auth/Elysia upgrade checks to the owning package guidance.
  Existing auth types and adapters remain narrow; no framework incompatibility
  was reproduced.
- Evidence: [MAINT-226 worklog](worklogs/2026-09-26-MAINT-226.md).

## [ISSUE-135] Clarify operational analytics data, retention, and access

- Type: question
- Status: resolved
- Evidence: Postbot has both a process-level Prometheus scrape endpoint and a
  project-level operational analytics API. The latter computes aggregates on
  demand from current publication/job state and the durable `audit_events`
  journal; it does not persist query snapshots. That journal is also consumed
  by realtime and notification projections. ADR-037 already accepts retaining
  journal rows for the lifetime of their project; no automatic TTL job exists.
  The API is project-scoped and exposes aggregate results to authenticated
  project actors without an editor-only role check.
- Impact: The analytics API may look like another stream of stored metrics,
  although its reads create no such stream. Separately, durable event history
  can grow with real workflow activity, and pruning it could affect analytics,
  realtime replay, and notification records. The process metrics and project
  report overlap only on a subset of worker outcomes and durations; their
  scopes and data lifecycles differ.
- Desired outcome: Establish which operational questions belong in Prometheus,
  the project analytics API, or a future web surface; make the journal's
  consumers, storage growth, retention, and project-role visibility explicit;
  and recommend whether the API should remain API-only. Do not add sampling,
  retention deletion, or UI before the owner accepts the relevant boundary.
- Tasks: ANALYTICS-227, ANALYTICS-229, ANALYTICS-230
- Related issues: ISSUE-054, ISSUE-056, ISSUE-131
- Related decisions: ADR-051, ADR-054
- Retention review (ANALYTICS-229): Keep the accepted project-lifetime policy
  unchanged. Individual-event deletion cascades to source-linked inbox and
  delivery history, truncates analytics, and has no realtime retention-floor
  contract to signal a required resynchronization. The 100,000-row disposable
  fixture measured about 75.39 MiB; that demonstrates growth, not a deployment
  capacity problem. A finite window or archive needs a separate accepted design.
- Resolution (owner direction, 2026-09-26): Keep the current authenticated,
  read-only, project-scoped analytics API available to actors who can access the
  project; do not add an editor-only check. API-key requests remain subject to
  the key's existing project scope. The response is aggregate-only and does not
  expose journal payloads. Keep operational analytics API-only for now; the web
  surface is deferred, not permanently rejected. Do not add sampling or change
  the accepted project-lifetime event retention policy in ADR-037. This closes
  the current boundary review, not future analytics evolution; revisit with a
  concrete workflow or measured data-lifecycle constraint.

## [ISSUE-136] Scope a source-backed product capability comparison

- Type: proposal
- Status: resolved
- Evidence: The owner wants a broad, fresh comparison of Postbot with Postiz,
  Mixpost, and OpenPost after the current sprint is complete. Existing
  competitor work under ISSUE-056 is limited to provider-engagement analytics
  and does not describe product-wide capability coverage. On 2026-09-27, the
  owner explicitly authorized proceeding directly to the full comparison and
  requested coverage of public product messaging, documentation, and source.
- Impact: Repeatedly refining existing surfaces without a grounded view of the
  product landscape risks missing foundational capabilities and makes it hard
  to distinguish important product gaps from optional competitor differences.
- Desired outcome: Deliver a readable, grouped,
  Postbot-versus-Postiz-versus-Mixpost-versus-OpenPost matrix based on public
  product messaging, official documentation, and current upstream source.
  Each cell must
  distinguish present, partial/limited, absent, and unverified behavior, note
  material edition or plan limits, and link dated authoritative evidence.
  Missing documentation must not be treated as proof of absence, and the report
  must not imply that Postbot should implement every competitor feature.
- Tasks: PRODUCT-231
- Related issues: ISSUE-056, ISSUE-132
- Scope boundary: Research only. Begin after the active sprint is complete.
  The owner has authorized the full comparison without a separate row-set
  approval step. No feature implementation or parity commitment is authorized
  by this issue.
- Resolution: Completed the grouped capability matrix across Postbot, Postiz,
  Mixpost, and OpenPost using public product messaging, official documentation,
  and pinned upstream source snapshots. The report distinguishes verified,
  partial/edition-gated, not-found, and unverified evidence; documents important
  provider and self-hosting limits; and recommends evaluating publication-
  performance analytics as a separate product workflow without committing to
  feature parity.
- Evidence: [PRODUCT-231 worklog](worklogs/2026-09-27-PRODUCT-231.md).

## [ISSUE-137] Define a useful publication-performance analytics workflow

- Type: proposal
- Status: resolved
- Evidence: The product comparison found that Postbot distinguishes operational
  publication/execution reporting from provider-owned performance data, but the
  latter currently has only a bounded Bluesky API collector and no dashboard
  experience. The owner explicitly clarified that the desired analytics are
  publication outcomes such as views and comments, not internal Postbot
  telemetry. Existing provider research covers six publishing integrations,
  but no product workflow, initial measure set, or collection policy has been
  accepted.
- Impact: Implementing a generic “analytics” page or scheduling snapshots
  before choosing what users need could create a misleading cross-network
  score, amplify provider API costs, and accumulate historical rows without a
  user-visible purpose. Conversely, leaving the existing API-only slice
  disconnected from the web does not fulfill the intended product capability.
- Desired outcome: Recommend a concrete first publication-performance
  workflow based on current provider capabilities, account permissions,
  metric semantics, freshness/history, and self-hosted storage cost. Clearly
  separate comparable measures from provider-specific ones and identify the
  smallest coherent implementation follow-up.
- Tasks: ANALYTICS-233
- Related issues: ISSUE-056, ISSUE-131, ISSUE-135, ISSUE-136
- Related decisions: ADR-051, ADR-052, ADR-055
- Scope boundary: This is product and technical discovery only. It does not
  authorize a dashboard, additional provider collectors, background polling,
  new OAuth scopes, retention changes, or changes to operational analytics.
- Acceptance: The task will compare current supported-provider paths and
  access barriers, inspect Postbot's existing observation schema and collection
  flow, compare viable user workflows and collection/storage policies, and
  record a source-backed recommendation plus explicit implementation follow-up
  boundaries. An unknown or approval-gated metric must not be presented as
  universally available.
- Resolution: ANALYTICS-233 recommended a project-level Performances experience
  with provider-specific results per published destination, separate from
  operational telemetry and without cross-network totals. The owner approved
  that direction on 2026-09-27. Its bounded first implementation is tracked and
  completed under ISSUE-138: DEV.to/Forem lifetime views, reactions, and comments
  plus existing Bluesky observations, with cached reads and explicit refresh.
  Recurring collection and provider-native history remain separate future work
  requiring an accepted cadence, cost, and retention boundary.
- Evidence: [ANALYTICS-233 worklog](worklogs/2026-09-27-ANALYTICS-233.md).

## [ISSUE-138] Deliver provider-backed publication performance in project workspaces

- Type: accepted proposal
- Status: resolved
- Evidence: The owner approved the ANALYTICS-233 recommendation on 2026-09-27. Postbot already stores bounded Bluesky observations but has no user-facing performance workflow. Forem documents per-article lifetime totals for views, reactions, and comments, plus ranged historical data, using the existing connected API key.
- Impact: Without a project-facing experience, users cannot assess the outcomes of publications they create in Postbot. A generic analytics surface or cross-network totals would conflate provider-specific metrics with Postbot's operational reporting and could misstate incomparable measures.
- Desired outcome: Let project members inspect provider-owned performance for published destinations, understand which measures each provider reports and when the data was fetched, and explicitly refresh supported data without making page reads call external providers. The first collection slice records Forem lifetime totals; provider-native date-range history is a later extension, not a prerequisite for displaying the requested views/reactions/comments.
- Related issues: ISSUE-056, ISSUE-137
- Related tasks: ANALYTICS-234, ANALYTICS-235
- Related decisions: ADR-051, ADR-052, ADR-055
- Accepted boundaries: Place Performances in the normal project work space, separate from operational analytics. Begin with Forem's article views/reactions/comments and the existing Bluesky observations. Preserve provider names and metric semantics; never invent missing values or cross-provider scores. Reads use stored observations; refresh is explicit and bounded. Do not add scheduled collection, new provider scopes, new services, or change the existing observation retention lifecycle in this issue.
- Acceptance: Provider refresh is project/channel/publication-scoped and role-checked; only known published destination IDs are queried; API keys remain inside the provider boundary; raw responses and secrets are not persisted or returned; lifetime totals are represented as cumulative snapshots; provider errors and absent metrics remain explicit; the web surface presents cached values and freshness and offers explicit refresh; operational analytics remains unchanged. Forem date-range history is deferred because the current observation store retains every fetched snapshot indefinitely and the returned time-series would multiply writes per refresh; do not disguise this as a retention decision.
- Resolution: Implemented DEV.to/Forem lifetime totals for known published Postbot destinations, authenticated project-scoped API reads and editor-gated explicit collection, and a localized project Performances page that combines cached DEV.to and Bluesky measures per destination. Page reads do not call providers. No recurring collection, historical chart, new credential scope, or retention policy was added.
- Evidence: [ANALYTICS-233 workflow recommendation](worklogs/2026-09-27-ANALYTICS-233.md); [ANALYTICS-234 worklog](worklogs/2026-09-27-ANALYTICS-234.md); [ANALYTICS-235 worklog](worklogs/2026-09-27-ANALYTICS-235.md).

## [ISSUE-139] Separate publication preparation from approval and dispatch

- Type: product requirement
- Status: resolved
- Evidence: Postbot project access currently distinguishes `owner`, `editor`, and
  `viewer`. Publication mutations, including scheduling and recording manual
  publication, require the `editor` role; there is no per-publication approval
  state. The domain's `review_required` value means a destination needs a
  compatibility reassessment after a channel-profile change, not editorial
  approval. The proposed workspace/access record describes Reviewers as having
  review/read access, but does not define a publication approval gate.
  Competitor evidence is mixed: Mixpost documents a Pro/Enterprise approval
  flow and says MCP-created scheduled or queued posts enter `needs_approval`
  when the workspace requires it ([Mixpost MCP documentation](https://docs.mixpost.app/mcp/),
  [Mixpost features](https://mixpost.app/features)). Postiz documents
  human review of agent-created posts in its calendar and approval for its
  WordPress editorial workflow, but the reviewed public evidence does not
  establish an equivalent gate for ordinary social publications ([Postiz product overview](https://postiz.com/about),
  [Postiz WordPress workflow](https://postiz.com/channels/wordpress)). OpenPost
  documents human review in the agent client flow and explicitly says it does
  not add a separate server approval step before each allowed change ([OpenPost agent-assisted publishing](https://docs.openpo.st/usage/agent-assisted-publishing)).
- Impact: A team that expects one member to draft and another to authorize an
  external publication cannot enforce that separation in Postbot today. Adding
  it would affect the publication lifecycle and must apply consistently to the
  web app, REST API, current CLI, and any future client; it also requires clear
  rules for approval identity, edits after approval, and already scheduled work.
  Competitor presence alone does not establish that Postbot users need this
  policy.
- Desired outcome: Allow an external client with limited publication
  permissions to prepare a publication and propose a delivery time without
  being able to schedule or dispatch it. A human must explicitly approve the
  exact content and authorize the real schedule or immediate dispatch.
- Tasks: [PUB-237](TASKS.md), [PUB-238](TASKS.md)
- Related issues: ISSUE-136
- Related decisions: ADR-074, ADR-075
- Owner direction (2026-09-27): This is a real product need, especially for
  external agents that may prepare publications but must not be able to publish
  or schedule them. Postbot must not classify the external client as an AI
  agent; the boundary is expressed through generic user-owned API-key actions
  and an explicit approval workflow.
- Accepted requirements:
    - A client with `publication:manage` but without `publication:dispatch` may
      prepare content and submit a proposed delivery time for human review.
    - A proposed time is not a schedule: while approval is pending it must not
      populate the executable schedule, create a worker job, or trigger provider
      activity.
    - Only an authenticated human session with project editing authority may
      approve, reject, or authorize dispatch. A bearer API key cannot approve.
    - If the proposed time passes without approval, nothing is published or
      scheduled automatically; the request remains visibly pending.
    - Approval must refer to the exact content revision reviewed. A later edit
      invalidates that approval and requires another review.
    - Ordinary human-authored publications retain the existing direct schedule
      and publish flow unless explicitly submitted for approval.
    - No new CLI/MCP client or agent-specific identity is part of this work.
- Specification recommendation: If approval happens after the proposed time,
  require the human to choose a new time or explicitly publish now; never
  silently catch up a missed request. Rejection returns the publication to an
  editable draft. See [PUB-237](worklogs/2026-09-27-PUB-237.md).
- Resolution: Implemented a persisted approval request tied to the immutable
  target revision and exact draft revision. A `publication:manage` key can
  submit an unscheduled draft and proposed delivery time; pending requests
  create no executable schedule or worker job. Only a project-editor session
  can review, reject, or approve. Approval creates scheduled work for the
  reviewed revision; a late request requires a new future time or explicit
  publish-now action, with the server timestamp chosen inside the promotion
  transaction. Rejection leaves the draft editable, and subsequent edits
  supersede the request. The publication queue includes a localized review
  surface. Direct API-key scheduling requires `publication:dispatch`; no
  agent-specific identity, CLI, or MCP client was introduced.
- Evidence: [PUB-238 worklog](worklogs/2026-09-27-PUB-238.md),
  [user API key policy](archive/root-documentation-2026-10-25/source/docs/security/user-api-keys.md).

## [ISSUE-141] Keep operational feedback and publication identity truthful across screens

- Type: problem
- Status: resolved
- Evidence: The 2026-09-28 browser visit reproduced a blank-composition validation error on Channels with a channel-action heading. Overview counted a published item as scheduled, while Queue showed no scheduled work. The same item appeared as its channel name in Calendar, as untitled in the preview, and as its content excerpt in Queue. API-key expiration displayed a raw number without its unit. Mobile preview dates and performance titles were truncated.
- Impact: Operators must reinterpret state and identity between screens and may attribute an error to an unrelated operation.
- Desired outcome: Action errors stay with the navigation entry that initiated them; lifecycle counts and publication identities agree across surfaces; essential dates, units, and composition-save feedback are explicit.
- Resolution: UX-239 aligned action feedback, state counts, publication identity, expiration units, composition-save copy, and bounded text wrapping; full local verification passed.
- Tasks: UX-239
- Related issues: ISSUE-063, ISSUE-064, ISSUE-099
- Evidence record: [UX-239 worklog](worklogs/2026-09-28-UX-239.md).

## [ISSUE-142] Complete user-facing localization and operational terminology

- Type: problem
- Status: resolved
- Evidence: The French browser visit displayed an English delivery notification, Body/Headline/Language fields, Provider metadata, and English accessibility labels on the date picker and mobile navigation. These are observations of specific surfaces, not a claim that all notifications or profiles behave identically.
- Impact: Mixed vocabulary increases interpretation effort and makes the application feel unfinished, including for assistive-technology users.
- Desired outcome: Built-in user-facing content and accessible names follow the selected locale; provider-owned or custom schema identifiers remain truthful and distinguishable from built-in labels. Account, installation, workspace, and project scopes use consistent names.
- Tasks: UX-245
- Related issues: ISSUE-065, ISSUE-099
- Boundary: Do not rewrite historical event data, user-defined group names, custom schema keys, or provider payloads as a translation shortcut.
- Evidence record: [UX-239 worklog](worklogs/2026-09-28-UX-239.md).

- Resolution: UX-245 localizes canonical notification presentation and built-in bound fields, supplies complete date-picker locales and mobile navigation names, and aligns owned French platform terminology. Custom copy, schema titles, payload keys, and stored events remain unchanged. The bilingual journey and full local gate passed; see [UX-245 worklog](worklogs/2026-09-29-UX-245.md).

## [ISSUE-143] Integrate interrupted-composition recovery without risking current work

- Type: problem
- Status: resolved
- Evidence: On the new-publication page, an interrupted draft is offered in a full-width bordered alert above a narrower composer. Its title and explanatory sentence repeat the same idea. The recovery action remains present after the operator starts typing; the current handler replaces the current title, content, media, targets, and schedule without a preservation or confirmation step.
- Impact: The recovery cue competes with the writing surface, and an operator can unintentionally lose newly typed content by restoring the previous session.
- Desired outcome: Present one compact, recognizable recovery cue within the composer width. Make the recovered and current compositions distinguishable before a replacement, and keep either path recoverable through the decision. Preserve project-scoped local and server draft behavior, scheduling, and media references.
- Tasks: UX-249
- Related issues: ISSUE-099, ISSUE-100
- Acceptance: At desktop and mobile widths the cue fits the composer, uses minimal copy and a useful draft visual; restoring after typing never silently destroys the current composition; discard and restore are explicit and keyboard accessible; local/server recovery and autosave are verified with an isolated browser journey.

## [ISSUE-144] Recompose publication detail around state and the next decision

- Type: design problem
- Status: resolved
- Evidence: The 2026-09-29 authenticated review compared a published manual publication with a media-only editable draft. Both open with an oversized title, a separate save indicator, a full-width lifecycle strip, a second destination strip, and a source card beside a feed preview. In the published state, identical content appears in the source card and preview, while read-only revision and source format occupy prominent space. The media-only draft is titled “Untitled publication” here but “Media · 2” in Queue; it shows a large empty body field before its media and a separate delivery panel. The details and activity disclosures each carry helper subtitles.
- Impact: The operator must scan repeated identity and content before finding the publication's state or next action. The same page behaves like a form even when the publication cannot be edited, and its information hierarchy differs from the accepted new-publication composer.
- Desired outcome: Give published, draft, scheduled, due-manual, and failed states a clear primary object, status, and next meaningful action. Reuse the recognizable post presentation where it helps inspection, preserve editable controls only where needed, and move revision, format, payload, and history into deliberate secondary access. Keep the return path and source-to-destination relationship intact.
- Tasks: UX-250
- Review update (2026-10-02): Current simulated failed-detail mobile captures retain stacked lifecycle and background-update notices before the source editor. Further hierarchy review should distinguish urgent delivery failure from passive freshness information while keeping conflict/recovery decisions explicit.
- Related issues: ISSUE-063, ISSUE-099, ISSUE-100, ISSUE-141
- Acceptance: Review representative states at wide and narrow widths before implementation; no duplicated content or status in the first frame; editable and read-only modes have distinct hierarchy without losing capability; real lifecycle actions, media, accessibility, and route continuity pass browser checks.

- UX-246 review: Long detail titles now remain centered separately from return controls on narrow screens, and mobile lifecycle actions no longer squeeze errors into a narrow column. The expanded editable Delivery form remains part of the ongoing UX-250 composition review.

- Latest scoped correction (2026-10-02): Background freshness now appears as a quiet line after the composer, while save errors and conflicts retain their priority and resolution action. Detail and realtime tests verify the distinct ordering and announcement roles. See worklogs/2026-10-02-UX-250-hierarchy.md.

- Delivery composition update (2026-10-02): Detail scheduling and promotion use the existing shared composer settings/action slots instead of nesting inside the source column. Disclosure and lifecycle behavior are unchanged; full browser/build validation passed. See worklogs/2026-10-02-UX-250-delivery.md.

- Destination inspection update (2026-10-02): Read-only fields use a responsive description list instead of individual cards. Advanced JSON disclosures share keyboard behavior and a right chevron. Full repository validation passed. See worklogs/2026-10-02-UX-250-readonly.md.

- Closure (ALPHA-578, 2026-10-24): UX-250 closure reviewed every original criterion and retained regressions; no defect or follow-up remained in that bounded detail-composition task. Owner visual approval remains a governance reserve, not an unimplemented task. Provider rendering calibration remains UX-248. [Evidence](worklogs/2026-10-07-UX-250-closure.md). Historical test claims were reviewed, not rerun by this ledger correction.

## [ISSUE-145] Reduce Queue scan noise while preserving lifecycle lookup

- Type: design problem
- Status: resolved
- Evidence: In the populated project, Queue begins with a project name and UTC subtitle although the project is already in the header. It shows a zero-count Scheduled tab, repeats publication state next to the destination, and gives drafts a long “pending draft changes” phrase. The published item appears alongside actionable drafts under All, with identical row weight. The date and action compete with the publication title rather than forming a clear triage order.
- Impact: Queue remains functional but takes more reading than necessary to identify which publication needs action now. Finished work and inactive filters can dominate the same visual plane as due or failed work.
- Desired outcome: Preserve all lifecycle states and explicit filters while making action priority, publication identity, destination, and timing scannable. Remove context already carried by the shell and copy that merely restates a visible state.
- Tasks: UX-251, UX-255
- Related issues: ISSUE-063, ISSUE-141
- Acceptance: Test due-manual, failed, scheduled, draft, and published rows together; verify useful filtering and bulk actions at desktop and mobile widths; demonstrate that an operator can distinguish actionable from historical items without reading an explanatory sentence per row.

- UX-246 follow-up: Mixed long destination names and variable lifecycle actions expose desktop header/row column drift. UX-255 tracks a shared grid correction; compact stacking remains readable. Narrow detail lifecycle actions were corrected during UX-246.

- Completed partial delivery (META-573 reconciliation): UX-251 established action-priority Queue ordering, removed repeated project/timezone and draft-state copy, and retained lifecycle filters, tags, bulk actions and historical lookup. The staged issue status is unchanged; its broader acceptance is not inferred from the completed task. [Delivery evidence](archive/calendar-queue-delivery/worklogs/2026-09-29-UX-251.md).

- Closure (ALPHA-578, 2026-10-24): UX-251 delivered action-priority reading; UX-255 completed the remaining shared-column correction. Mixed-state checks cover long identities, locale/theme/width combinations, bulk selection and mobile stacking. This closes the specified Queue outcome, not every possible future redesign. [Evidence](worklogs/2026-10-01-UX-255.md). Historical test claims were reviewed, not rerun by this ledger correction.

## [ISSUE-146] Make Performance meaningful when provider data is unavailable

- Type: design question
- Status: resolved by UX-252; current route retained, unsupported rows excluded and collection errors localized per publication
- Evidence: The authenticated project has one published manual publication and no supported connected statistics provider. Performance still shows a permanent subtitle naming Bluesky and DEV.to, then one wide row whose main outcome is “stats are not available for this platform,” leaving the rest of the page blank. Its tab remains a peer to Overview and Queue.
- Impact: The route's current first frame offers neither a metric nor an actionable decision for this project, while calling attention to capability limits that the operator cannot change from this screen.
- Desired outcome: Decide whether unsupported publications should be hidden, grouped as context, or given a useful route to connection setup, and when the Performance navigation entry earns persistent prominence. Preserve truthful provider support and access to any collected stats.
- Tasks: UX-252
- Review correction (2026-10-02): The September 29 implementation already excludes unsupported publications. The previous source review overstated that finding. This pass verifies empty, unsupported, uncollected, disconnected and populated states, retains measured zero versus absent data, and attaches collection failures to their publication. See worklogs/2026-10-02-UX-252.md. Separate these current findings from the older visit evidence.
- Related issues: ISSUE-063, ISSUE-135
- Acceptance: Compare no-data, unsupported-only, supported-but-unconnected, and populated provider cases before choosing a layout or navigation change. Do not imply that manual or unsupported platforms expose metrics they do not provide.

## [ISSUE-147] Keep channel identity usable in compact authoring and navigation

- Type: design problem
- Status: resolved by UX-256; optional color customization and server-enforced naming remain explicit future considerations
- Evidence: Owner review on 2026-09-30 identifies redundant sidebar inventory, missing creation access while composing, difficult six-channel rails, indistinguishable same-platform logos and duplicate names, and creation fields ordered before platform choice.
- Impact: Channel routing becomes ambiguous at intermediate widths; creation interrupts writing and names do not reliably distinguish targets.
- Desired outcome: Compact, recognizable channel selection with a persistent non-notification identity cue for repeated platforms, meaningful custom identities, guided naming, and channel creation that preserves the composition in place.
- Tasks: UX-256
- Boundaries: Preserve existing stored names and API contracts. Suggested naming and creation-dialog collision validation do not claim a database-wide uniqueness constraint; such a constraint needs a separately accepted migration policy for existing duplicates. Owner permits alternative solutions and name customization. Color customization remains an optional future proposal, not a hidden new persisted setting.

## [ISSUE-148] Keep account credential editing consistent and inspectable

- Type: interface problem
- Status: resolved by UX-274; see worklogs/2026-10-02-UX-274.md
- Evidence: Current account/password isolated captures show a bright default dialog body and contrasting footer, while OAuth/API-key dialogs use a subdued raised surface. PasswordChangeDialog uses three password Input fields without the visibility controls already present in AuthForm.
- Impact: Credential editing has an inconsistent material hierarchy; mobile users cannot inspect typing before committing a password change.
- Desired outcome: A coherent account dialog with deliberate credential visibility controls; retain current-password verification, confirmation, pending guards and session consequences.
- Tasks: UX-274
- Acceptance: Review both themes at desktop/mobile widths, preserve autocomplete, masked defaults and keyboard labels; verify failed submission retains input and success preserves the accepted session contract. Do not generalize this correction into another global palette change.

## [ISSUE-149] Make notification follow-up reachable and touch-friendly

- Type: interaction problem
- Status: resolved by UX-275; owner selected opening without marking read; see worklogs/2026-10-02-UX-275.md
- Evidence: NotificationItem presents its title as plain text and exposes only mark-read/archive buttons. These buttons use icon-xs, which is a 24-pixel square in the shared primitive. Notification subjects and project context exist in the domain; the component currently has no route-opening action.
- Impact: A failure notification does not provide a direct path to inspect the affected work; small adjacent targets can be awkward on touch screens.
- Desired outcome: An operator can identify a relevant notification and reach actionable context while read/archive remain unambiguous and safe. Revoked access and removed subjects must not produce broken links or disclose restricted content.
- Tasks: UX-275 (review first)
- Acceptance: Test published, failed and ambiguous subjects, removed/inaccessible projects, narrow touch layouts and keyboard behavior. Resolve whether opening also marks read before implementation; preserve recipient-owned notifications and server authorization.

## [ISSUE-150] Refresh publication editors after concurrent draft saves

- Type: problem
- Status: resolved by UX-292
- Evidence: UX-291 opened two authenticated browser contexts on sibling publications. Saving a changed shared source advanced the server source revision, but the other open editor did not display the stale-source conflict until reloaded. Normal draft saves currently emit no journal fact in publication-authoring-store; the project SSE allowlist includes rebase, but not draft saves.
- Impact: Server revision guards prevent stale writes, but an operator can keep seeing apparently actionable controls before discovering the conflict on save or reload.
- Desired outcome: Open editors discover concurrent changes promptly, preserve unsaved local work, and expose the explicit reconciliation decision. Decide on a bounded refresh mechanism without logging every autosave indiscriminately or introducing automatic content merges.
- Tasks: UX-291 (evidence), UX-292 (in-flight save correction and mechanism review). The new deterministic incoming-SSE test exposed a stuck saving state; corrected without changing draft-save transport. Owner accepted ephemeral SSE draft hints. Implementation, focused visibility/reconnection journeys and the full root gate pass (69 browser journeys, two password-reset journeys, 17 builds). See ADR-076 and UX-292.

## [ISSUE-152] Unexpected external-effect messages cross a durable diagnostic boundary

- Type: question
- Status: resolved by PROVIDER-308
- Evidence: executor.ts includes unexpected Error.message in an ambiguous outcome; workflow-store persists outcome.errorMessage. This is source-level raw text propagation, not proof of an actual credential leak. See worklogs/2026-10-04-OPS-305.md.
- Impact: Caller-controlled diagnostics may contain sensitive material and reach durable history or user-visible responses; exact exposure remains to be established.
- Desired outcome: Establish whether diagnostic boundaries preserve useful failure context without exposing secrets, and retain conservative ambiguity handling.
- Tasks: AUDIT-307 (diagnosis only; no implementation approach accepted), PROVIDER-308 (bounded adapter redaction)
- Reopened: independent probes demonstrate that a rogue-echoing server reaches Mastodon/X/Discord outcome messages verbatim with the in-scope bearer/bot token (kept Mastodon test pins it). Bounded adapter-level redaction is proposed as PROVIDER-308 (not started, implementation not authorized). See worklogs/2026-10-04-AUDIT-307.md.
- Resolved by PROVIDER-308: request tokens are redacted (raw and URL-encoded, before truncation) from Mastodon/X/Discord remote diagnostics including X media processing errors; codes, types, classification, retry, and ambiguity semantics unchanged. No core changes and no generalized filtering. See worklogs/2026-10-04-AUDIT-307.md.

## [ISSUE-153] Authorization enforcement needs a targeted cross-surface audit

- Type: question
- Status: open
- Evidence: Role-matrix enforcement (ACCESS-143), SSE reauthorization (REALTIME-144), API-key action ceilings (ACCESS-236), and analytics access (ANALYTICS-230) were each verified in isolation. No current artifact confronts server controls with UI possibilities and test coverage in one matrix, particularly for cross-project access, post-removal permissions, and session versus API-key differences.
- Impact: Unknown whether the three surfaces agree; a UI-only gate or a stale-membership path could expose or deny operations inconsistently.
- Desired outcome: A permission matrix of actually-enforced controls, reproducible evidence for inconsistencies, classification into demonstrated defects, documented intent, and product questions, plus one bounded fix proposal. No permission changes in the audit pass.
- Tasks: AUDIT-309 (diagnosis only, completed), ACCESS-309 (bounded fix, completed)
- Findings: one demonstrated defect (D2 was withdrawn after re-examination). D1 (high): a user-owned API key keeps project read access after its owner is removed from the project, because read routes authorize against the retained `actors` attribution row while the key path checks only stored scope and action ceilings; mutations stay denied. D2 (medium): `GET /api/projects` is actor-based, so removed members and non-member workspace managers still see projects whose routes answer 404. Reproduced with isolated fixtures and pinned by `apps/api/src/modules/projects/access-revocation-regression.test.ts`.
- Documented intent confirmed: hidden 404 for non-membership, dynamic inheritance for unrestricted keys, approval never available to limited keys, workspace-admin reach on the access surface, recipient-owned notifications, analytics readable by any project actor.
- Resolution: ACCESS-309 makes the key path reuse the session authorization callback, so a key is limited to its owner's live project access, intersected with its stored scope and still bounded by action ceilings; hidden 404 masking, historical actors, and other-project access are preserved. No global key revocation, no role change, no UX change.
- Product questions still open for the owner: automatic key revocation versus scope-down on removal; workspace-manager project visibility in the list; an explicit removed-from-access dashboard state.

- Remaining scope (ALPHA-578, 2026-10-24): Remaining owner decisions: key revocation versus scope narrowing, workspace-manager list visibility and access-loss presentation. ACCESS-309 fixed the reproduced live-access bypass; do not reimplement it.

## [ISSUE-156] Dashboard state after live loss of project access is undefined

- Type: problem
- Status: open
- Evidence: WEB-310 and WEB-311 established the static viewer experience, and ACCESS-309 established that the server stops answering reads for a removed project (hidden 404). Nothing establishes what the already-open dashboard does when access disappears mid-session: whether an open Overview, Queue or editor notices, what previously fetched data remains on screen, whether stale mutating controls stay armed, how the SSE stream reacts, and whether an unsaved local draft survives.
- Impact: A user can keep consulting, and possibly acting on, a project they no longer have. The server still refuses, so this is not an authorization failure, but the interface can misrepresent both what data is visible and what is still possible.
- Desired outcome: The post-revocation behavior of an open session is diagnosed with reproducible evidence, and the correction is bounded to removal of interface data plus preservation of local work, without polling or a general cache purge.
- Tasks: WEB-312 (completed), WEB-313 (completed), WEB-314 (proposal), WEB-315 (implementation), WEB-316 (hardening)
- Resolution: diagnosis delivered with two-session browser evidence and deterministic stream tests. Server protection is immediate and complete; the stream announces access loss within one heartbeat and is silent on a role narrowing; refused refetches empty the list surfaces and a navigation drops the project entirely, but the project identity, the cached editor role and the open editable publication survive because a refused refetch cannot replace the last successful data. Unsaved local work is preserved by the existing recovery buffer. No behavior was changed. The proposed correction removes project-scoped caches on the existing signal without purging the client, and leaves copy, disposition of local work, stay-or-navigate, and role-change announcement as owner decisions.
- Follow-up: WEB-313 qualifies that cache removal as unproved. Router-loader snapshots, context fallbacks, scheduled refreshes, raw in-flight writes, autosave timers, and local buffers can survive it, while `access-revoked` conflates genuine revocation with authorization-control failure. WEB-313 instead models an unverified-access interaction state, without deciding transport, copy, navigation, retention, or announcement policy.

- Remaining scope (ALPHA-578, 2026-10-24): Editor-only verification/suspension and late-response hardening are delivered by WEB-315/316. Remaining scope is the other project surfaces and explicit role-change/local-work behavior; no global cache purge is accepted.

## [ISSUE-157] Structure the public site around usage, core capabilities and self-hosting

- Type: proposal
- Status: open
- Priority: high — next public-site design work
- Evidence: The owner wants the site to establish humans and agents as equal audiences from day one. A separate scheduling illustration would repeat the shared-post distribution story. Current automation presentation is dominated by CLI details, while core capabilities and deployment options lack a coherent hierarchy.
- Impact: Visitors may mistake Postbot for a technical CLI utility or fail to understand its access surfaces and operational depth.
- Desired outcome: A visual usage section shows existing and planned access paths to the same workspace, with no false availability claims; a distinct core-capability section groups scheduling, image/video media, local/S3 storage, access administration, built-in/manual/custom channels, workspaces/projects and interface languages. A concise technical/open-source/self-hosting section leads to verified guides and supported image artifacts. Scheduling may enrich the existing publication story rather than receive a redundant standalone chapter. Layout, animation and final copy remain proposals, not approved card grid/carousel choices.
- Tasks: SITE-441 (design proposal), SITE-442 (isolated interactive prototype; homepage replacement not approved)
- Source: owner direction, 2026-10-15; public-site planning captured in
  [public positioning](archive/root-documentation-2026-10-25/source/docs/project/public-positioning.md).

- Design proposal: [shared-workspace scene](../apps/docs/design/HUMANS-AND-AGENTS.md).

- Remaining scope (ALPHA-578, 2026-10-24): Owner review of the remaining public usage/capability narrative and prototype. The live site and alpha notice do not imply approval of SITE-441/442 or availability of a released image.

## [ISSUE-158] Provide agent skills for the first public launch

- Type: proposal
- Status: resolved
- Priority: high — explicit launch requirement, after workflow stabilization
- Evidence: The owner intends agent skills to be available for the first launch, but has deliberately delayed authoring until the first version is stable enough to avoid repeated rewrites. A CLI and API exist; launch-facing agent skills are not established in the current repository.
- Impact: Agents may use valid endpoints without understanding review, permissions, destination differences or the boundary between draft creation and publication.
- Desired outcome: Versioned, discoverable agent guidance covers the stable supported workflows and safe effect boundaries, validated with representative natural-language requests. The owner launch requirement is retained without beginning authoring before stability. Target harnesses, skill distribution and evaluation scope remain to be selected.
- Tasks: AGENT-580
- Source: owner direction, 2026-10-15; public-site planning captured in
  [public positioning](archive/root-documentation-2026-10-25/source/docs/project/public-positioning.md).

- Resolution (AGENT-580, 2026-10-24): Three portable first-alpha skills cover installation, API-backed use and troubleshooting, with complete selective installation, runnable helpers and scoped operational references. Published-image manual workflows and helper invariants pass. [Installation](../README.md#agent-skills). [Validation](worklogs/2026-10-24-AGENT-580.md). Fresh-model/cross-model and live provider validation remain unclaimed.

## [ISSUE-159] Establish a supported n8n integration path

- Type: proposal
- Status: open
- Priority: medium — after core access surfaces stabilize
- Evidence: The owner named n8n among intended ways to use Postbot. The API can be called programmatically, but that alone does not establish a tested n8n experience or an official node.
- Impact: Promoting an integration without a documented, reproducible workflow would shift authentication, error and publication semantics onto users.
- Desired outcome: Users can connect and run representative Postbot workflows from n8n with explicit permissions, outcomes and documentation. Determine whether documented HTTP workflows, a native node or another route is warranted; do not select a package or promise a native node at intake.
- Tasks: none — recorded for triage; no implementation authorized by intake
- Source: owner direction, 2026-10-15; public-site planning captured in
  [public positioning](archive/root-documentation-2026-10-25/source/docs/project/public-positioning.md).

- Remaining scope (ALPHA-578, 2026-10-24): n8n integration remains a proposal; define the supported workflow before implementation.

## [ISSUE-160] Explore a mobile Postbot client

- Type: proposal
- Status: open
- Priority: later — exploratory, not a first-launch commitment
- Evidence: The owner envisages a future mobile client alongside Studio and machine-facing tools. No dedicated mobile app workspace exists; the responsive website is not a shipped mobile application.
- Impact: Future marketing could overstate availability or a mobile implementation could duplicate domain behavior without a clear user need.
- Desired outcome: Define the mobile audience, high-value workflows, platforms and access boundaries before choosing delivery technology. Keep mobile visibly future-facing until implemented and validated; this issue does not authorize building an app.
- Tasks: none — recorded for triage; no implementation authorized by intake
- Source: owner direction, 2026-10-15; public-site planning captured in
  [public positioning](archive/root-documentation-2026-10-25/source/docs/project/public-positioning.md).

- Remaining scope (ALPHA-578, 2026-10-24): Mobile client remains an exploration proposal, not an alpha release prerequisite.

## [ISSUE-161] Broaden documented self-hosting paths without implying unverified support

- Type: proposal
- Status: open
- Priority: medium — Docker/Compose first; orchestrators considered separately
- Evidence: The owner wants quick-start guides and resources for Docker, Compose, potentially Swarm, Kubernetes, Helm and other relevant hosts. Dockerfile and Compose files already exist; no Swarm/Kubernetes/Helm deliverables were found in the current repository. Release policy already targets GHCR and linux/amd64 plus linux/arm64 under RELEASE-303.
- Impact: A long list of deployment logos could misrepresent supported installation paths and dilute the lightweight single-service starting point.
- Desired outcome: Provide a concise Docker/Compose default, then independently scoped, exercised operator guides for justified additional environments. Helm is a possibility, not a selected architecture or launch requirement. Documentation points to public versioned AMD64/ARM64 artifacts only after acceptance and publication. Preserve the single-service/local-storage baseline; optional S3 and orchestrators must not become prerequisites. Public release remains separately authorized.
- Tasks: none — recorded for triage; no implementation authorized by intake
- Source: owner direction, 2026-10-15; public-site planning captured in
  [public positioning](archive/root-documentation-2026-10-25/source/docs/project/public-positioning.md).

- Related work: RELEASE-303 remains the active image-release task. Do not duplicate it or treat this issue as authorization to publish.

- Remaining scope (ALPHA-578, 2026-10-24): Verify each additional self-hosting route before documenting it as supported. Existing source/Compose installation is delivered.

## [ISSUE-162] Expand interface language coverage beyond English and French

- Type: proposal
- Status: open
- Priority: medium — staged after the existing language foundation
- Evidence: The owner wants broader international accessibility. Paraglide currently declares en and fr; the localization foundation tracked by ISSUE-049 is resolved, while additional languages and their quality/maintenance process remain future work.
- Impact: Advertising multi-language support broadly could imply catalogs that do not exist, while adding catalogs without translation and delivery checks could degrade quality or loading behavior.
- Desired outcome: Prioritize additional locales with translation ownership, fallback and formatting checks, and evidence of their delivered-page/bundle cost. Distinguish interface locale from publication content language and public-site localization. Do not reopen the already completed foundation or promise a language count.
- Tasks: none — recorded for triage; no implementation authorized by intake
- Source: owner direction, 2026-10-15; public-site planning captured in
  [public positioning](archive/root-documentation-2026-10-25/source/docs/project/public-positioning.md).

- Additional owner direction, 2026-10-16: evaluate two further locales after product expansion, with delivered-bundle and interaction measurements. The pair is not selected. PRODUCT-477 found generated static EN/FR imports and an emoji-data locale list that must be included in the scope. See [expansion plan](archive/root-documentation-2026-10-25/source/docs/project/product-expansion.md).

- Remaining scope (ALPHA-578, 2026-10-24): Additional interface locales remain proposed; English/French are implemented.

## [ISSUE-163] Define intentional workflow coverage across Postbot clients

- Type: proposal
- Status: open
- Priority: medium — before expanding client promises
- Evidence: Studio, API and CLI exist, while MCP, agent skills, n8n and mobile have different readiness and audience roles. The existing docs/capability-evidence.md records partial CLI coverage, including administration. The owner wants these surfaces to feel like ways to use one product, not disconnected products.
- Impact: An undifferentiated list of client logos could imply equal availability or full parity, while new clients might reimplement domain rules.
- Desired outcome: Maintain a workflow-oriented coverage map for human and programmatic clients; identify actual gaps, intentionally unsupported operations and planned surfaces. Separate a direct client (Studio/mobile), an access protocol/interface (API/CLI/MCP), orchestration (n8n) and agent guidance (skills). Preserve shared permissions, project ownership, revisions and effect boundaries; do not require every client to implement every screen.
- Tasks: none — recorded for triage; no implementation authorized by intake
- Source: owner direction, 2026-10-15; public-site planning captured in
  [public positioning](archive/root-documentation-2026-10-25/source/docs/project/public-positioning.md).
- Related evidence: [client coverage](archive/root-documentation-2026-10-25/source/docs/capability-evidence.md), ISSUE-036, ISSUE-158, ISSUE-159 and ISSUE-160.

- Remaining scope (ALPHA-578, 2026-10-24): Decide intentional capability coverage among Studio, API, CLI and planned MCP; backend availability alone is not client completion.

## [ISSUE-164] Generate a version-matched OpenAPI reference for the static docs

- Type: proposal
- Status: resolved
- Priority: medium — after documentation structure review
- Evidence: Elysia already exposes `/openapi/json` and an instance explorer at `/openapi`. SITE-455 adds a distinct API reference space and checks the current official Fumadocs OpenAPI integration, but endpoint pages are not generated yet.
- Impact: Authored guides cannot replace request/response contracts; manually duplicating those contracts would drift. Fetching a live production instance during docs rendering would couple the static site to deployment state.
- Desired outcome: Reproducible schema extraction from an isolated matching runtime, reviewed operation IDs/tags/security annotations, generated grouped reference pages through the official Fumadocs integration, and a static build that does not need a running app or private credentials. Session-only routes must remain distinguishable from API-key routes. Interactive requests need an explicit target and must not silently authorize publication.
- Plan: [documentation structure and OpenAPI boundary](../apps/docs/DOCUMENTATION.md).
- Tasks: SITE-455 (structure), SITE-456 (isolated export and generated static reference).
- Resolution: 160 route-derived operations are generated into 16 domains through the official Fumadocs integration. An in-memory exporter and temporary media adapter avoid shared resources; per-operation fragments limit page payload. Public, inherited bearer/session and explicit session-only declarations are preserved. The static renderer has no request playground or proxy. Dynamic Better Auth and optional monitoring routes remain explicitly outside coverage.

## [ISSUE-165] Add a Telegram publishing destination

- Type: proposal
- Status: open
- Evidence: No Telegram publishing adapter or built-in channel was found; the owner requests broader network coverage.
- Desired outcome: A verified bot/account connection and bounded text/media publication flow, preserving project ownership, content validation, durable effects and stored remote identity. Polls and further native formats are separately scoped.
- Plan: [product expansion](archive/root-documentation-2026-10-25/source/docs/project/product-expansion.md).
- Tasks: PRODUCT-477; TELEGRAM-498 (official capability review and implementation proposal).
- Proposal: [SPEC-008](specs/SPEC-008-telegram-publishing.md); owner selected text plus one media on 2026-10-17, albums deferred.
- Implementation: TELEGRAM-499 adds the isolated provider protocol; TELEGRAM-500 adds the encrypted connection API and versioned profile; TELEGRAM-501 registers execution with pinned media and durable delivery handling. TELEGRAM-502 adds Studio creation, connection and conditional native editor limits. TELEGRAM-503 verifies photo/video storage-to-worker delivery and fixes MIME preservation under Bun. Live acceptance remains pending.
- Source: owner product direction, 2026-10-16.

- Remaining scope (ALPHA-578, 2026-10-24): Telegram publishing, polls and albums are implemented; remaining scope is owner-authorized real bot/account publication acceptance. No live Telegram outcome is claimed.

## [ISSUE-166] Establish Facebook and Instagram integration scope

- Type: proposal
- Status: open
- Evidence: The owner requests mainstream networks beyond the existing six. No first-party Meta publishing adapters were found. Official documentation access in PRODUCT-477 was rate-limited.
- Desired outcome: Verify supported account types, permissions, app review/development access and initial publication formats before implementation. Record unknowns instead of promising personal-profile support or universal content formats.
- Plan: [product expansion](archive/root-documentation-2026-10-25/source/docs/project/product-expansion.md).
- Tasks: PRODUCT-477 (initial discovery), META-505 (current official access and architecture review), FACEBOOK-506 (isolated Pages discovery and text/link/photo protocol), FACEBOOK-507 (isolated content profile and granted-permission Page selection), FACEBOOK-508 (confidential OAuth adapter), FACEBOOK-509 (authenticated callback and connection persistence), FACEBOOK-510 (encrypted application settings and gated Studio Page picker), FACEBOOK-511 (native capability and worker completion). FACEBOOK-511 registers the native profile, validation, Studio creation and production worker after owner acceptance of an explicitly unknown text maximum. Synthetic creation-to-connection and worker tests pass. FACEBOOK-512 verified live OAuth, explicit Page selection and text/single-PNG publishing on an owner-authorized test Page. INSTAGRAM-535 adds the isolated single-image protocol/profile after the owner selected direct Instagram Login in ADR-088; INSTAGRAM-536 adds distinct encrypted application settings, direct-login OAuth and project account connection with targeted synthetic security, storage and HTTP verification. INSTAGRAM-537 integrates durable single-JPEG delivery, bounded container processing, safe token refresh and Studio creation/connection. Canonical synthetic worker, HTTP and browser checks pass; Instagram live account access, signed-media fetching and App Review remain unverified (INSTAGRAM-538).
- Research: [Meta integration discovery](archive/root-documentation-2026-10-25/source/docs/project/meta-integration-discovery.md); current account/login boundaries, review requirements, media lifecycle and first-lot recommendation.
- Source: owner product direction, 2026-10-16.

- Remaining scope (ALPHA-578, 2026-10-24): Facebook live validation is delivered. Instagram synthetic integration is delivered; INSTAGRAM-538 remains blocked on operator access, with live media fetching/App Review unverified.

## [ISSUE-167] Replace normal Studio JSON authoring with a structured channel builder

- Type: proposal
- Status: open
- Evidence: Custom creation and profile editing expose JSON text fields. Impact/adoption views also show raw serialized values. Current schema, field bindings, media/text capabilities and profile revision lifecycle already exist.
- Desired outcome: A usable form for content capabilities, a separate execution setup and field-level impact/validation. Preserve richer existing profiles without silent data loss. Agree unsupported-rule behavior and reuse the existing runtime contract before replacing UI.
- Plan: [product expansion](archive/root-documentation-2026-10-25/source/docs/project/product-expansion.md).
- Tasks: PRODUCT-477 (discovery), PRODUCT-478 (detailed builder proposal), CHANNEL-479 (isolated text-rule preservation spike), CHANNEL-480 (guarded content controls and local preview), CHANNEL-481 (before/after content comparison). Bounded mapped HTTP controls now cover method/static paths, response classification/extraction, simple JSON properties and fixed query parameters; CHANNEL-497 records authenticated draft persistence, impact and activation without external dispatch. Advanced expression/transport authoring, arbitrary field removal and full adoption cleanup remain pending. See the [current builder reference](archive/root-documentation-2026-10-25/source/docs/project/channel-builder.md).
- Source: owner product direction, 2026-10-16.

- Remaining scope: Advanced request expression/transport authoring and arbitrary profile-field removal remain. Bounded lossless controls and CHANNEL-497 persistence/impact/activation are delivered. CHANNEL-591 (2026-10-26) adds readable previous draft fields, explicit matching reuse, changed-format/unmatched-field guidance and complete-content disclosure to the accepted ADR-079 adaptation flow; saved history and explicit validation/selection boundaries remain intact.

## [ISSUE-168] Expand provider information, performance and comment workflows

- Type: proposal
- Status: resolved
- Evidence: Bluesky and DEV.to collectors expose bounded observations. Reply/comment counts do not provide a conversation UI or reply execution path. The owner asks for richer information and comments.
- Desired outcome: An explicit provider capability/read-access matrix and scoped stored-data workflows for useful metadata, metrics and comments. Treat reading, replying and moderation as distinct permissions and external effects; preserve metric meanings and freshness.
- Plan: [product expansion](archive/root-documentation-2026-10-25/source/docs/project/product-expansion.md). PRODUCT-540 records [current provider coverage](archive/root-documentation-2026-10-25/source/docs/project/provider-capabilities.md), including code versus live evidence and the next account-free format recommendation.
- Tasks: PRODUCT-477 and ENGAGEMENT-525 (discovery); BLUESKY-526 (public thread reader); ENGAGEMENT-530 (stored latest Bluesky comment snapshot, editor refresh and read-only Studio panel). ENGAGEMENT-531 extends the same public stored-view workflow to Mastodon. ENGAGEMENT-532 adds public text replies on Bluesky with conversation-owned history and durable send outcomes. ENGAGEMENT-534 extends these replies to Mastodon with original-instance and account checks. ANALYTICS-539 adds anonymous public Mastodon counters, stored manual snapshots and Performance presentation. Further providers and moderation remain outside the delivered slice.
- Source: owner product direction, 2026-10-16.

- Closure (ALPHA-578, 2026-10-24): The provider capability matrix and stored read/metric/comment workflows are implemented. Bluesky/Mastodon comment reads and durable replies are delivered under ENGAGEMENT-530/531/532/534, with Mastodon metrics under ANALYTICS-539. Other providers and moderation were outside the accepted slice; future expansion needs its own concrete scope. [Evidence](archive/root-documentation-2026-10-25/source/docs/project/provider-capabilities.md). Historical test claims were reviewed, not rerun by this ledger correction.

## [ISSUE-169] Support provider-native publication formats and public text entities

- Type: proposal
- Status: resolved
- Evidence: Existing profiles expose provider-specific fields. MASTODON-533 adds native polls with typed destination controls, preview and instance-limit validation. The owner also requests questions and hashtag integration; broader provider formats remain open.
- Desired outcome: Discover feasible formats per provider and expose typed editor controls, validation, preview and execution. Distinguish plain questions from native polls and provider hashtags from internal tags; do not force identical support across networks.
- Plan: [product expansion](archive/root-documentation-2026-10-25/source/docs/project/product-expansion.md).
- Tasks: PRODUCT-477 (discovery); MASTODON-533 (owner-authorized native Mastodon polls); TELEGRAM-541 (ordinary anonymous Telegram polls, typed authoring and durable delivery, synthetic acceptance). [Current provider coverage](archive/root-documentation-2026-10-25/source/docs/project/provider-capabilities.md). Other formats remain proposed.
- Source: owner product direction, 2026-10-16.

- Closure (ALPHA-578, 2026-10-24): The selected native-format deliveries are complete: Mastodon polls, Telegram anonymous polls and ordered photo/video albums have typed authoring, validation and durable execution. Current supported coverage is explicit per provider. No promise of every upstream format or identical provider support remains in this issue. Live Telegram acceptance stays under ISSUE-165. [Evidence](archive/root-documentation-2026-10-25/source/docs/project/provider-capabilities.md). Historical test claims were reviewed, not rerun by this ledger correction.

## [ISSUE-170] Preserve user-defined organization through free publication tags

- Type: proposal
- Status: resolved
- Evidence: ADR-062 and ISSUE-053 already deliver publication tags and filtering. The owner suggests campaign-related internal tags; no separate campaign lifecycle is established.
- Desired outcome: Validate concrete campaign organization/reporting needs against existing tags first. The owner clarified that a campaign is an example of tag meaning, not a requested entity. Preserve free tags; any future campaign proposal needs separate evidence and approval.
- Plan: [product expansion](archive/root-documentation-2026-10-25/source/docs/project/product-expansion.md).
- Tasks: PRODUCT-477 (discovery); implementation scope remains proposed.
- Source: owner product direction, 2026-10-16.

- Closure (ALPHA-578, 2026-10-24): Existing free project tags and filters satisfy the clarified organization scope; current-tag performance filtering is delivered under ANALYTICS-547. The owner explicitly did not request a campaign entity. No separate campaign lifecycle or undefined implementation remains to track here. [Evidence](archive/root-documentation-2026-10-25/source/docs/project/provider-capabilities.md). Historical test claims were reviewed, not rerun by this ledger correction.

## [ISSUE-171] Evaluate scheduled comments beneath owned publications

- Type: proposal
- Status: resolved
- Evidence: The owner distinguishes a prepared first comment from replying to an incoming comment. Postiz documents delayed first-comment publishing.
- Desired outcome: Verify support and constraints per provider. Design a dependent delivery after confirmed parent publication, with remote parent identity, explicit timing, independent failure state, retry safety and duplicate prevention. A failed parent cannot trigger its comment. Do not imply an inbox or AI author is required.
- Plan: [product expansion](archive/root-documentation-2026-10-25/source/docs/project/product-expansion.md).
- Tasks: PRODUCT-478 (discovery); ENGAGEMENT-542 scoped the first slice. The owner selected Bluesky, overdue catch-up after revalidation and suspension on enabling-editor access loss. ENGAGEMENT-543/544 implement that [first-comment workflow](archive/root-documentation-2026-10-25/source/docs/project/first-comments.md) for Bluesky and Mastodon; other providers remain open. Local injected/browser acceptance does not claim live delivery.
- Source: owner clarification, 2026-10-16.

- Closure (ALPHA-578, 2026-10-24): ENGAGEMENT-543/544 deliver the accepted Bluesky/Mastodon dependent first-comment contract with confirmed-parent timing and independent durable outcomes. ENGAGEMENT-545 additionally records real Mastodon parent/comment acceptance. Other providers were not accepted deliverables of this slice. [Evidence](archive/root-documentation-2026-10-25/source/docs/project/first-comments.md). Historical test claims were reviewed, not rerun by this ledger correction.

## [ISSUE-172] Define shared-post and tag-based performance reports

- Type: proposal
- Status: resolved
- Evidence: Current collectors cover bounded Bluesky and DEV.to observations. The owner requests destination, shared-post and tag views.
- Desired outcome: Compare documented competitor metrics with stored Postbot observations. Define aggregation, compatible metrics, coverage and freshness; avoid double-counting fan-out or overlapping tags. Resolve current versus historical tag attribution before implementing reports. Keep account metrics separate from post metrics.
- Plan: [product expansion](archive/root-documentation-2026-10-25/source/docs/project/product-expansion.md).
- Tasks: PRODUCT-478 and ANALYTICS-524 (scope); ANALYTICS-527/528 deliver bounded latest observations and source-post grouping. ANALYTICS-539 adds Mastodon favourites, boosts and replies to the same destination/source view without combined totals. Owner selected current-tag attribution; ANALYTICS-547 adds the corresponding Performance filter without summed metrics or historical claims. Historical attribution and aggregation remain separate decisions.
- Source: owner clarification, 2026-10-16.

- Closure (ALPHA-578, 2026-10-24): ANALYTICS-527/528 deliver bounded latest observations and source grouping; ANALYTICS-547 implements the owner-selected current-tag attribution and ANALYTICS-550 exports the filtered stored report. Metrics retain provider meaning and freshness without cross-provider totals. Historical attribution and aggregation are separate future decisions, not incomplete accepted work. [Evidence](archive/root-documentation-2026-10-25/source/docs/project/provider-capabilities.md). Historical test claims were reviewed, not rerun by this ledger correction.

## [ISSUE-173] Make the free-tag lifecycle discoverable in Studio

- Type: proposal
- Status: resolved
- Evidence: New publication, editing and Queue hide the picker when tags are absent. The shared picker only selects. Static searches found no Studio tag creation form or API wrapper for creation.
- Desired outcome: Provide a first-tag path and project-scoped creation, rename and archive/restore using existing domain permissions. Retain user-defined meaning without adding a campaign entity. Verify actual empty and populated UI states.
- Plan: [product expansion](archive/root-documentation-2026-10-25/source/docs/project/product-expansion.md).
- Tasks: PRODUCT-478 (discovery and scope); TAGS-522 (owner-authorized Studio lifecycle implementation, 2026-10-20).
- Resolution: TAGS-522 adds project tag management and first-tag creation directly in publication authoring. Existing API permissions, stable identifiers and archived assignments are preserved; four focused browser scenarios verify the lifecycle, error recovery, read-only access and project isolation.
- Source: owner clarification, 2026-10-16.

## [ISSUE-174] Verify built-in provider constraint updates across retained work

- Type: proposal
- Status: resolved
- Evidence: The owner asks what happens if a platform reduces its text limits. ADR-020, ADR-078 and ADR-079 establish versioned profiles, impact review and explicit adoption. Packaged presets are snapshots; their existence is not automatic detection or rollout of upstream changes.
- Desired outcome: Audit the operational update path for built-in constraints and execution support. Prove behavior for new work, editable drafts, pending selected targets, retries and historical/in-flight revisions using a synthetic limit reduction. Preserve content and history; do not silently truncate, migrate, deliver known-incompatible work or claim automatic upstream detection. Identify any missing operator update/review entry.
- Tasks: CHANNEL-482 (intake); CHANNEL-523 (gap diagnosis); CHANNEL-529 (explicit shipped-template loading, verified local save/impact/activation). Automatic upstream discovery and a full retained-work lifecycle proof remain outside the delivered slice.
- Related: [profile evolution](decisions/ADR-020-version-and-assess-channel-profile-changes.md), [ordinary approval compatibility](decisions/ADR-078-explicit-superseded-profile-approval.md), [draft adoption](decisions/ADR-079-explicit-draft-profile-adoption.md).
- Source: owner direction, 2026-10-16.

- Remaining scope (ALPHA-578, 2026-10-24): Complete the synthetic retained-work lifecycle proof across drafts, pending targets, retries and history. Explicit template loading is delivered; automatic upstream discovery is not.

- Resolution (2026-10-26): CHANNEL-590 completes the synthetic retained-work lifecycle proof and corrects three gaps before effect start and automatic/manual retry. Content, targets and historical/in-flight snapshots remain intact; compatible old targets continue, incompatible work requires review. Eight final targeted cases, broader worker regressions, full unit integration, built-production profile/adoption browser checks and container recovery pass. Automatic upstream discovery remains outside this manual update-path acceptance; no automatic rollout or incompatible-profile consent override is claimed. [Evidence](worklogs/2026-10-26-CHANNEL-590.md).

## [ISSUE-175] Investigate a development API shutdown that retained SQLite

- Type: defect
- Status: open
- Evidence: CHANNEL-488 found the server process alive with the database and runtime-lock descriptors open after its earlier SIGTERM drain log, while port 3002 had no listener. A second explicit termination ended it. The exact retained marker was removed only after verifying its owner and that no process held the database, WAL, shared-memory or marker files.
- Desired outcome: Reproduce and identify which shutdown step can remain pending. Preserve fail-closed runtime exclusion; do not introduce automatic stale-lock reclamation or infer quiescence from a missing listener.
- Tasks: CHANNEL-488 (recovery and evidence); root-cause repair remains pending.

- Remaining scope (ALPHA-578, 2026-10-24): Reproduce the later retained-process incident and identify its pending drain step. Earlier hangup fixes and the WAL fixture correction do not establish this cause.

## [ISSUE-176] Exclude generated test and runtime data from production build contexts

- Type: defect
- Status: resolved
- Evidence: TELEGRAM-499 observed the default Docker context transferring over 4.9 GB before cancellation. Local test-results occupied 7.4 GB and data occupied 218 MB; neither directory is excluded by .dockerignore. These are local/generated inputs rather than production sources. The successful check used a tar context containing tracked files plus the new provider package.
- Desired outcome: Keep routine production contexts bounded and exclude generated test outputs and runtime data without hiding required workspace manifests or fixtures. Verify the normal Docker build with representative local outputs present. No runtime data was deleted during discovery.
- Tasks: TELEGRAM-499 (evidence); BUILD-556 (implementation and acceptance).

- Resolution (2026-10-23): BUILD-556 excludes root data, browser results and reports, and makes existing generated-output/dependency patterns recursive across workspaces. A real Docker context audit checks all workspace manifests and representative tracked fixtures while generated local data remains present. The audited copy falls from 1.6 GB after initial root exclusions to 47 MB after recursive exclusions. Normal production builds, complete container recovery and static gates pass. No existing runtime data or test results were deleted. [Evidence](archive/runtime-recovery-observability/worklogs/2026-10-23-BUILD-556.md).

## [ISSUE-177] Verify publication detail refresh after automatic delivery

- Type: defect investigation
- Status: resolved
- Evidence: FACEBOOK-512 observed the open publication detail still displaying Queued after its isolated database recorded a successful automatic Facebook publication. Reloading showed Published. The remote post was independently visible on Facebook. The cause and exact update delay have not been isolated; a proxy stream or route subscription is a hypothesis, not a conclusion.
- Desired outcome: Reproduce the subscribed detail transition through a controlled local worker event and, if relevant, a TLS proxy. Preserve authoritative publication state and avoid adding polling without evidence.
- Follow-up: REALTIME-513 repaired a deterministic overlapping-refresh defect: project refreshes could discard publication-editor invalidation and later signals. Regression tests fail with the previous coalescing behavior. An isolated manual publication updated the rebuilt Studio without reload. The original automatic Facebook/proxy sequence has not been replayed, so this issue remains open until that acceptance check.
- Local worker acceptance: REALTIME-516 exercises a real automatic webhook delivery to an isolated loopback receiver, durable journal/native SSE, overlapping project reads, browser editor refresh without navigation, and unsaved local-copy protection. Both clean and dirty cases pass. This does not replay the original Facebook/TLS proxy sequence or establish its exclusive cause; the issue remains open for that outstanding provider/proxy acceptance. [Evidence](worklogs/2026-10-19-REALTIME-516.md).
- Local TLS acceptance: REALTIME-517 reuses the actual worker/SSE flow through an isolated HTTPS reverse proxy. Both clean and unsaved-editor scenarios pass, including secure session cookies and actual TLS event-stream details. The stale-editor negative control still fails when overlapping refresh signals are discarded. No TLS-specific failure was found in this controlled proxy; the original native Facebook/tunnel sequence remains unverified. [Evidence](worklogs/2026-10-19-REALTIME-517.md).
- External tunnel diagnosis: FACEBOOK-519 verified the Meta test login, then measured the actual Postbot SSE generator through a fresh Cloudflare Quick Tunnel before attempting provider writes. Direct access delivered opening/heartbeat frames immediately and each second; the tunnel delivered the finite stream's frames together only at closure and no frames from an open stream within six seconds. Cloudflare explicitly documents that Quick Tunnels do not support SSE. This establishes a transport limitation in the measured setup, not the exclusive cause of the original observation. Native acceptance now needs a streaming-capable HTTPS path; no new Facebook post was made. [Evidence](worklogs/2026-10-19-FACEBOOK-519.md), [Cloudflare limitation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/#limitations).
- Source: live acceptance observation during FACEBOOK-512; partial follow-up in REALTIME-513.

- Resolution: FACEBOOK-519 completed the owner-approved split-origin acceptance after ADR-087 integration: native OAuth through the temporary callback, then two real Facebook text deliveries with Studio on loopback. Clean editor adopted Published without reload; dirty editor retained its exact local copy and showed the expected conflict while its real editor GET returned published. Both native posts were independently visible; each job succeeded on one attempt. REALTIME-516/517 cover overlap and TLS separately. The Quick Tunnel SSE limitation remains an infrastructure constraint, and no exclusive historical cause is claimed. [Final evidence](worklogs/2026-10-19-FACEBOOK-519.md).

## [ISSUE-178] Investigate Facebook token responses without expiration

- Type: problem
- Status: resolved
- Evidence: During FACEBOOK-519, a fresh native OAuth flow using the existing test application and previously granted settings returned HTTP 200 from both code exchange and long-lived-token exchange. A private diagnostic recorded access-token presence, bearer type, absence of `expires_in`, and absence of a provider error on both responses, without recording token values or request query strings. Postbot rejected the callback before permission discovery or Page selection. The attempt was consumed within its valid time window; repeated fresh authorization produced the same callback refusal.
- Impact: The native refresh acceptance cannot proceed to a project connection or automatic publication. The application secret is now stored encrypted in the isolated fixture; further secret entry is not the missing prerequisite.
- Desired outcome: Establish the actual token type, validity and expiration semantics of this provider response, then support or explicitly classify it without guessing a lifetime or treating missing expiration as proof of non-expiration. Preserve OAuth state, actor/project checks and single-use attempts.
- Context: The [official long-lived-token guide](https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived) describes a typical long-lived User token duration and a separate Page-token lifecycle; neither alone establishes the identity or lifetime of this observed response. At observation time the guards in `packages/facebook/src/oauth.ts` and the connection flow required a known bounded User-token lifetime for pending Page selection. ADR-087 supersedes that refusal for omitted metadata.
- Resolution: Owner adopted [ADR-087](decisions/ADR-087-unknown-facebook-pending-token-expiration.md) on 2026-10-19. FACEBOOK-521 integrated explicit unknown expiration under existing encrypted attempt TTL and permission checks, with 30 focused tests and parent mutation controls. FACEBOOK-519 then verified live permission discovery, the exact Page connection and two successful real deliveries. Actual exchanged-token class/lifetime remains explicitly unknown; success does not imply non-expiration.

## [ISSUE-179] Coordinate the final product identity as Postdot

- Type: proposal
- Status: accepted
- Evidence: On 2026-10-21 the owner selected Postdot and reported reserving postdot.app. The current product is named Postbot while the local checkout still uses Herald. The owner also reports reserving the npm postdot namespace, GitHub postdot organization and Docker Hub ID postdot; these are future publication targets, not evidence of package/image releases. The owner requested durable planning, without starting the rename immediately.
- Impact: Mixed active names confuse users, contributors and release operators.
- Desired outcome: Adopt Postdot consistently across active branding, packages, executable/configuration names, docs, workspace and checkout identity, GitHub repository and release artifacts. Inventory internal, external and persisted identifiers before changing them; explicitly resolve compatibility and data migration needs. Preserve factual historical records and third-party attribution rather than rewriting evidence blindly.
- Tasks: BRAND-551 (namespace/display/repository/checkout delivered; deployment compatibility transition remains); PUBLIC-553 (history-preserving preparation complete).
- Review evidence (2026-10-22): outside `.autonomos/`, 2,426 case-insensitive `postbot` occurrences remain in tracked files, including exported types (`PostbotDatabase`, `createPostbotClient`), `POSTBOT_*` environment variables, the Compose service, image and volume names, and the `postbot` script. The repository is already public, so external dependence on these identifiers can start before the compatibility transition completes.

- Remaining scope (ALPHA-578, 2026-10-24): Decide and implement the remaining deployment-variable, volume/database and persisted-identity compatibility transition. Source namespace/display/repository renaming is delivered.

## [ISSUE-180] Evaluate site and documentation hosting after the reference migration

- Type: proposal
- Status: resolved
- Evidence: The owner intends to validate TanStack Start with Cloudflare on solar-icons.dev first, then report whether that recipe should be reused here. Avoid additional OCI compute allocation for the site/docs. No migration is authorized to start now.
- Impact: Public site/docs hosting needs a sustainable path before launch.
- Desired outcome: After the owner's successful reference result, scope a suitable deployment and framework plan. apps/docs now uses TanStack Start/Fumadocs; apps/web Studio uses Vite/TanStack Router. Distinguish these surfaces and preserve the self-hosted API, SQLite, scheduler and worker boundary. Validate documentation capabilities and actual hosting constraints at that time; owner-provided quota expectations are not verified deployment guarantees.
- Tasks: DOCS-567 (apps/docs ported in place to TanStack Start and deployed as prerendered Cloudflare Workers static assets at postdot.app). The separate self-hosted application runtime is unchanged.

- ISSUE-180 update (2026-10-23): the owner reported the solar-icons.dev migration as successful and asked for the same port here. Because Postdot never deployed the Next site, the conversion is in place with no compatibility layer or cutover.

- Closure (ALPHA-578, 2026-10-24): DOCS-567 completed the scoped TanStack Start/Cloudflare migration and actual postdot.app deployment. The deployed c0f7b2a97 workflow and local production export checks pass. Public website hosting is delivered; self-hosted Studio/API remain unchanged. First versioned application distribution remains PROJECT-302/RELEASE-303 and ISSUE-181. [Evidence](worklogs/2026-10-23-DOCS-567.md). Historical test claims were reviewed, not rerun by this ledger correction.

## [ISSUE-181] Prepare a separately authorized public repository and site launch

- Type: proposal
- Status: open
- Evidence: The owner anticipates making the repository public and publishing the site/docs under postdot.app, but explicitly deferred both actions.
- Desired outcome: Coordinate final identity, hosting readiness and existing release/license requirements before an owner-authorized public launch. Do not change repository visibility, DNS, deployment or registry publication during routine product work.
- Tasks: PUBLIC-552 (owner-authorized README and disclosure readiness review); links BRAND-551, ISSUE-180 and existing RELEASE-303 readiness work. Owner selected preserving history, branches and PRs; PUBLIC-553 prepares the existing repository transition with targeted current-record corrections.

- ISSUE-181 source-publication update (2026-10-22): owner explicitly authorized PUBLIC-554. Pushed the reviewed local main and made the existing postdot/postdot repository public; repository identity and history are preserved, anonymous API/page access verified. Subsequent owner-authorized site deployment is recorded in DOCS-567; the docs-deploy workflow passed at e7a0d2dd9. The broader launch issue stays open for its remaining release/identity acceptance; no package or image release is inferred.

- Remaining scope (ALPHA-578, 2026-10-24): Complete PROJECT-302/RELEASE-303 acceptance and separately authorize first versioned image publication. Public source and website deployment are already complete.

## [ISSUE-182] Keep Autonomos artifacts proportionate to active work

- Type: problem
- Status: open
- Evidence: On 2026-10-22 a fresh-eyes review measured `.autonomos/` at 5.3 MB. `TASKS.md` is 231 KB with 581 tasks, of which 572 are done and 8 are active or open; `ISSUES.md` is about 4,400 lines with 26 open issues; `worklogs/` holds 634 files; 88 decision records were accepted in about eight weeks (more than one per day). Several records cover UI interaction choices (for example ADR-071 to ADR-073 for calendar affordances) rather than costly-to-reverse technical boundaries. The protocol defines creation rules for tasks, issues, worklogs and decisions but no archival lifecycle once work is complete.
- Impact: Every session bootstrap reads or searches artifacts dominated by completed history, which consumes agent context, slows orientation and dilutes the records that still constrain work (for example ADR-001, ADR-002, ADR-009, ADR-037). Low-threshold decision records also make it harder to tell which choices are structural.
- Desired outcome: Current-state artifacts stay small enough for routine sessions to read entirely, completed history remains preserved and traceable without being loaded by default, and the threshold for a decision record distinguishes structural choices from local design choices. Because Autonomos is owner-designed, the outcome may include protocol-level doctrine changes (lifecycle, archival, thresholds), not only a one-time cleanup.
- Related: ISSUE-183, ISSUE-109
- Tasks: META-572, META-573

- Upstream intake (2026-10-23): The owner requested protocol-level archival design in the Autonomos repository. Local Autonomos ISSUE-03 now records artifact lifecycle criteria, bounded indexes/discovery, AGENT.md drift and the relationship with reconcile/crystallize. No consumer protocol artifact was edited and no archival design was selected here.

- Progress (2026-10-24): META-572 installs published Autonomos 0.7.0 / protocol 0.7.0-alpha and pilots a bounded realtime/foundation archive. Applicable decisions and open follow-ups stay current. This issue remains open for the rest of the task/issue registries and scoped guidance.

- Progress (2026-10-24): META-573 archives 38 completed calendar/Queue tasks, 26 settled issues and 36 worklogs, with reference repairs and two documented viewer-issue status corrections. Current contracts and staged follow-ups remain visible. Broader registry and guidance cleanup remains open. [Evidence](worklogs/2026-10-24-META-573.md).

- Remaining scope (ALPHA-578, 2026-10-24): Bulk archival is stopped by owner direction. Published lifecycle tooling and the bounded consumer batches are delivered; future concrete context defects should be investigated individually, not as a permanent archival sprint.

## [ISSUE-183] Prevent AGENT.md files from accumulating journal-style entries

- Type: problem
- Status: open
- Evidence: PROTOCOL.md requires AGENT.md to contain only stable guidance and to replace obsolete entries instead of appending history. The root AGENT.md (13.6 KB) nevertheless mixes stable rules with dated owner directives and situational status, for example naming/hosting progress tied to BRAND-551, ISSUE-180, ISSUE-181 and PUBLIC-554, the stopped delegation experiment, GHCR and licensing review scope. The owner reports repeatedly observing agents turning AGENT.md files into journals.
- Impact: Guidance read at every session grows with transient context, which lowers signal and leaves agents unsure which directives are still current. The format rule exists but is neither enforced nor easy to apply when a directive is both dated and still in force.
- Desired outcome: Root and local AGENT.md files contain only current, stable guidance with a clear place for time-bound owner directives and their expiry, and the protocol makes drift detectable (for example during `/crystallize` or `/reconcile`) rather than relying on agent discipline alone. Existing files are brought back to that standard without losing still-active directives.
- Related: ISSUE-182
- Tasks: META-572, META-573

- Upstream intake (2026-10-23): The owner requested protocol-level archival design in the Autonomos repository. Local Autonomos ISSUE-03 now records artifact lifecycle criteria, bounded indexes/discovery, AGENT.md drift and the relationship with reconcile/crystallize. No consumer protocol artifact was edited and no archival design was selected here.

- Progress (2026-10-24): META-572 installs published Autonomos 0.7.0 / protocol 0.7.0-alpha and pilots a bounded realtime/foundation archive. Applicable decisions and open follow-ups stay current. This issue remains open for the rest of the task/issue registries and scoped guidance.

- Progress (2026-10-24): META-573 archives 38 completed calendar/Queue tasks, 26 settled issues and 36 worklogs, with reference repairs and two documented viewer-issue status corrections. Current contracts and staged follow-ups remain visible. Broader registry and guidance cleanup remains open. [Evidence](worklogs/2026-10-24-META-573.md).

- Remaining scope (ALPHA-578, 2026-10-24): General scoped-guide drift review has not been completed. This cleanup work is deferred after the owner ended bulk housekeeping; no claim that every guide has been reconciled.

## [ISSUE-184] Validate the product with sustained real use before widening scope

- Type: problem
- Status: open
- Evidence: SPEC-001 defined a falsifiable hypothesis: one real project uses Postbot as its only publication source of truth for four consecutive weeks, including an automatic and a manual channel. SPEC-005 superseded the release framing with continuous development and did not carry over a validation milestone. No task, issue or worklog records that test being run. In about eight weeks the repository reached roughly 1,000 commits, nine built-in providers, analytics, replies, first comments, approvals, workspaces/groups, an image editor and webcam capture.
- Impact: Scope grows from internal design logic rather than observed demand, and every feature added before real use increases maintenance and later rework. Real friction (onboarding, provider setup, daily workflow) remains unknown.
- Desired outcome: A recorded, time-boxed period of real operation (for example the Postdot launch communication itself) produces evidence that drives prioritization, and an explicit owner decision states how new scope is admitted relative to that evidence.
- Related: ISSUE-181, ISSUE-190
- Tasks: none

- Remaining scope (ALPHA-578, 2026-10-24): Run a time-boxed real project workflow and prioritize from observed friction. This is product validation, not additional provider breadth.

## [ISSUE-185] Provider-specific knowledge leaks into shared API and web layers

- Type: problem
- Status: resolved
- Evidence: SPEC-005 requires each provider or channel module to own its destination-specific knowledge. On 2026-10-22, 52 non-test files in `apps/api/src`, `apps/web/src`, `packages/db/src` and `packages/core/src` branch on literal provider names. Commits for the Telegram provider touched 34 non-test source files outside `packages/telegram`, including API routes, publisher runtime, `models.ts`, and about 20 web files (composer, previews, target editor, connection panel, dashboard context). `ProjectDashboardContextValue` in `apps/web/src/lib/dashboard-context.tsx` exposes provider-specific callbacks (`onStartLinkedInConnection`, `onStartBlueskyConnection`, `onStartXConnection`, `onConnectDiscordPublisher`, ...) alongside composer draft state. A server-side `BuiltInProviderRegistry` already exists for execution.
- Impact: The cost and regression risk of each additional provider grows with the number of providers, and the shared layers become a de facto central catalog that SPEC-005 explicitly rejects.
- Desired outcome: Adding or changing a provider is confined to that provider's module plus a minimal registration point on the server and in the web client, and shared layers consume provider capabilities through a described contract rather than name checks. Measure progress by the files outside the provider module that a new provider must touch.
- Related: ISSUE-188, SPEC-005
- Tasks: PROV-569

- Resolution (2026-10-23): PROV-569 implements owner-approved ADR-091 across all nine integrations. Static browser/server modules own connection setup, application and engagement policies, authoring, preview, analytics and exact worker revisions. Shared features consume capabilities while SQLite retains authorization, encryption, transaction and claim fences. Synthetic browser/worker/store extension proofs pass without network calls or weakened migrations. A comparable literal-equality audit drops from 34 common source files to one development-sandbox label. All 134 main browser cases, four SMTP cases, two automatic-delivery cases, static gates, 21 builds and production-container recovery pass. [Evidence](worklogs/2026-10-23-PROV-569.md).

## [ISSUE-188] Web client structure has outgrown its boundaries

- Type: problem
- Status: resolved
- Evidence: `apps/web/src` holds about 55,000 hand-written TypeScript lines, excluding generated Paraglide output. Several components exceed 1,000 lines (`media-attachment-picker.tsx` 2,047; `publication-editor.tsx` 1,953; `event-calendar.tsx` 1,830). `lib/api.ts` is a 2,345-line wrapper over the already typed Eden client from `@postdot/client`. `dashboard-context.tsx` (876 lines) loads project-wide data and exposes mutations, provider-specific actions and composer draft state through one context used by 14 modules. TanStack Query and TanStack DB (0.x) coexist. The `realtime-prototype` project route is reachable in production builds; `/editor-lab` is gated to development.
- Impact: Large shared modules increase review and regression cost, and re-render scope. Duplicated client typing can drift from the API contract. Prototype surfaces ship to users.
- Desired outcome: Data loading and mutations are scoped to the routes and features that need them, the typed client is used without a parallel hand-maintained contract, the client data layer is a deliberate single choice, and prototype surfaces are either removed or excluded from production.
- Related: ISSUE-185, ADR-047, ADR-057
- Tasks: WEB-557 (development-only prototype slice); WEB-558 (Eden response typing and project tags); WEB-559 (workspace reads and derived workspace types); WEB-560 (workspace writes); WEB-561 (project user/group grants); WEB-562 (project members and invitations); WEB-563 (instance access); WEB-564 (user API keys); WEB-565 (provider applications); WEB-566 (complete application JSON contract migration and architectural balance); WEB-567 (feature data/actions and lifecycle boundaries). Recorded desired outcome completed; component-size observations remain separate follow-up evidence.

- Partial resolution (2026-10-23): WEB-557 gates the realtime prototype to development, redirects production access to the same project overview and conditionally imports the experimental component so production assets omit it. Both browser modes, an audit of 173 production JavaScript assets, 283 web tests and static gates pass. The wider data-loading, typed-client and dependency-boundary questions remain open. [Evidence](worklogs/2026-10-23-WEB-557.md).

- Typed-client progress (2026-10-23): WEB-558 replaces the incompatible Eden v1 SDK with the v2 client matching the installed server, makes unwrap check its data type and infers the five project-tag responses. The compiler exposed two opaque composer-content boundaries, now validated before UI use. Five type contracts fail with the previous helper; 1,552 unit/script tests, 133 browser plus 4 SMTP scenarios, static gates and production-container recovery pass. Raw-fetch workspace contracts and broader client architecture remain open. [Evidence](worklogs/2026-10-23-WEB-558.md).

- Workspace-read progress (2026-10-23): WEB-559 migrates list, detail, team-member and invitation reads to Eden and replaces eight handwritten workspace declarations with types derived from its server responses. Invitation status now reflects the API string schema. Eight compile-time checks, 288 client/web tests, production build, static gates and three invitation/role/navigation browser scenarios pass. Workspace mutations still use raw fetch; broader data-layer and client boundaries remain open. [Evidence](worklogs/2026-10-23-WEB-559.md).

- Workspace-write progress (2026-10-23): WEB-560 migrates all nine workspace mutation wrappers to Eden/unwrap, retaining their inputs and error semantics. Ten compile-time contracts, 301 web/client/access tests, production build, static gates and four browser scenarios pass. A temporary browser acceptance exercises every migrated method, a single forbidden write and protected-owner rejection. Better Auth invitation acceptance and project grant wrappers remain separate; broader client boundaries stay open. [Evidence](worklogs/2026-10-23-WEB-560.md).

- Project-grant progress (2026-10-23): WEB-561 derives the two grant entity types from Eden and migrates eight read/write wrappers with inferred responses. Twelve type checks preserve the result shapes and editor/viewer write inputs. The production build, static gates, 298 selected tests and five browser scenarios pass. Browser acceptance verifies all eight methods, direct/group access fallback, final revocation, foreign-workspace rejection, forbidden elevation and workspace-admin management. Project members/invitations and broader client architecture remain open. [Evidence](worklogs/2026-10-23-WEB-561.md).

- Project-membership progress (2026-10-23): WEB-562 derives four member/invitation types from Eden and migrates eight wrappers with inferred responses. Thirteen type contracts preserve roles, states and response shapes. The production build, static gates, 298 selected tests and five browser scenarios pass, including invitation resend/cancellation, self-membership rejection and live revocation. Better Auth invitation acceptance remains on its existing transport. Instance-access contracts and broader client architecture remain open. [Evidence](worklogs/2026-10-23-WEB-562.md).

- Instance-access progress (2026-10-23): WEB-563 derives twelve types and migrates nine wrappers to Eden. Public invitation-token GET and invitation-id DELETE use explicit typed Eden paths to avoid Treaty dynamic-parameter collisions without changing server routes. Sixteen type contracts, 302 selected tests, five browser scenarios, production build and static gates pass. Invitation lifecycle, administrator protection, forbidden administration and live revocation remain covered. User API keys and broader client architecture remain open. [Evidence](worklogs/2026-10-23-WEB-563.md).

- User API-key progress (2026-10-23): WEB-564 derives the key entity/capability types and migrates four wrappers to inferred Eden responses. Eleven type contracts preserve inputs, access scopes and creation-only token visibility. 302 selected tests, four browser scenarios, production build and static gates pass. Browser acceptance verifies project restrictions, forbidden key administration, optional/null inputs, expiration parity with the previous transport and effective revocation. Provider settings, media and broader client architecture remain open. [Evidence](worklogs/2026-10-23-WEB-564.md).

- Provider-application progress (2026-10-23): WEB-565 derives six configuration/input types and migrates three wrappers to Eden. Twelve type contracts, 305 selected tests, five browser scenarios, production build and static gates pass. Browser acceptance verifies callbacks, omitted-secret retention, secret-free responses, disabled configuration, Bluesky loopback mode, normalized validation/not-found errors and session-only administration. Media, remaining raw-fetch wrappers and broader client architecture remain open. [Evidence](worklogs/2026-10-23-WEB-565.md).

- JSON-client completion (2026-10-23): WEB-566 removes all 96 explicit Eden response overrides, migrates the eight remaining application JSON fetches and derives the remaining shared types and 23 body/query contracts. Fifteen additional type assertions reject untyped application results and extracted requests. The web API drops from 2,034 to 1,666 lines. 1,553 unit/script tests, 133 main browser plus four SMTP scenarios, static gates and all 21 production build tasks pass. Better Auth passthrough, raw byte uploads and validated opaque composer content are explicit boundaries, not further ordinary JSON migration slices. [Evidence](worklogs/2026-10-23-WEB-566.md).

- Remaining architecture (2026-10-23): ADR-047 already selects Query for production; DB imports are confined to the development prototype and its tests. The substantive open work is route-owned data/mutations and component boundaries. The project parent still loads six resource groups on every project route; DashboardContext remains 876 lines. Treat this as a coherent lifecycle/data-ownership batch with shared acceptance scenarios, rather than more wrapper-by-wrapper tasks. Keep this issue open for that work.

- Resolution (2026-10-23): WEB-567 reduces DashboardContext from 876 to 134 lines and limits the parent to three navigation resource groups. Publications/due work, tags and domain mutations now belong to their feature hooks; composition has a dedicated session preserving channel-setup navigation. One QueryClient owns project server data, targeted refreshes leave dormant/foreign data alone, and feature-entry freshness plus an accessible Suspense boundary preserve loading and recovery semantics. All 1,555 unit/script tests, 134 distinct main browser cases (with focused correction reruns), four SMTP cases, static gates and all 21 production builds are validated. With the prior JSON migration and development-only prototype, all four recorded desired-outcome criteria are satisfied. Large component sizes are not a further acceptance requirement for this completed issue. [Evidence](worklogs/2026-10-23-WEB-567.md).

## [ISSUE-190] Tier providers by self-hosting setup friction

- Type: proposal
- Status: open
- Evidence: LinkedIn, X, Facebook and Instagram require each self-hosted operator to register a developer application, sometimes pass a platform review, and for X use a paid API tier (see `docs/deployment/provider-requirements.md` and ADR-056). Bluesky, Mastodon, Telegram, Discord, DEV.to and custom HTTP can be connected without an operator-owned developer application review. The README positions Postdot as self-hosted publishing for people and their agents. ISSUE-036 records a deferred MCP surface.
- Impact: First-run success for a self-hoster depends heavily on which providers they try first; presenting all providers equally hides the setup cost and invites support load. Positioning on provider count competes on the weakest axis for a self-hosted product.
- Desired outcome: An owner decision on how providers are presented and supported by tier, and on the product's differentiating axis (manual and custom channels, reliable publication ledger, agent-facing surfaces) relative to provider breadth. Revisit ISSUE-036 timing in light of that decision.
- Related: ISSUE-036, ISSUE-184, ISSUE-185
- Tasks: none

- Remaining scope (ALPHA-578, 2026-10-24): Decide provider presentation/support tiers using actual self-hosting setup friction; no provider removal or new connection is implied.

## [ISSUE-191] Reduce anonymous entry JavaScript against the existing footprint target

- Type: problem
- Status: resolved
- Evidence: FOUND-571 repaired the footprint script's stale index-component lookup: the index route now redirects and has no component chunk. Measuring the application entry plus the anonymous login route and their static imports produces 279,720 bytes gzip (about 273 KiB), above SPEC-002's 180 KiB initial-web-JavaScript target. Both the previous host canary/artifact and Bun 1.4.4/current artifact produce the same value. This is an aggregate of each unique manifest file's gzip size, not an observed browser transfer or a claim about all authenticated routes. TanStack DB was already excluded from the production bundle before its source cleanup.
- Impact: The current anonymous entry exceeds the intended transfer budget, and the broken measurement had hidden the result. Dependency removal alone should not be presented as fixing production loading cost.
- Desired outcome: Attribute the measured entry graph to required code and avoidable eager imports, reduce the anonymous entry toward the existing target without changing authentication or application behavior, and retain a reproducible measurement with an explicitly named entry screen. If the target must change, record an evidence-based trade-off rather than silently lowering it.
- Related: SPEC-002, ISSUE-185
- Tasks: WEB-587

- Resolution (WEB-587, 2026-10-25): Production login static JavaScript falls from 279,730 to 154,814 aggregate gzip bytes (44.66% reduction), below the unchanged 184,320-byte target. Separated Performance search parsing and project-shell loading from authenticated UI dependencies; scoped notification UI to dashboard/editor-lab. Production browser loading and affected navigation/Performance/toast checks pass. The budget now runs in build CI. This is source-build evidence, not a published-image or server-memory claim. [Evidence](worklogs/2026-10-25-WEB-587.md).
