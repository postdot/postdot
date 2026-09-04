# Project Issues

## [ISSUE-001] Validate the complete production distribution path

- Type: proposal
- Status: resolved
- Evidence: Herald is intended to run as one self-hosted process, but the current
  repository has not yet proven the complete path from production build to a
  runnable application image with the dashboard, API, database migrations, health
  checks, backup, restore, and resource measurements.
- Impact: Missing a broken packaging or serving boundary late would make the
  single-process deployment promise expensive to repair.
- Desired outcome: A reproducible production distribution artifact and an end-to-end
  validation procedure that exercise the supported runtime chain within the accepted
  footprint budgets.
- Tasks: OPS-10 (completed)
- Resolution: The repository now builds a single-process Bun runtime image with the
  API bundle, dashboard, migrations, healthcheck, and persistent SQLite volume. The
  documented backup and restore commands and the Linux amd64 footprint measurements
  were exercised against the real image.
- Decision: [ADR-010](decisions/ADR-010-use-bun-runtime-image-for-v1-packaging.md)

## [ISSUE-003] Define the media attachment boundary and storage lifecycle

- Type: proposal
- Status: resolved
- Evidence: The owner direction requires a durable media foundation rather than a
  release-limited media cut. Local self-hosting and a Bun-native S3-compatible
  backend affect metadata, cleanup, backup, security, and publisher contracts. The
  [DOMAIN-07 worklog](worklogs/2026-08-29-DOMAIN-07.md) records the comparative study
  and the accepted model for media families, original assets, derived variants,
  publication-revision references, provider delivery, and storage lifecycle.
- Impact: Deferring the ownership and lifecycle model too long could force a costly
  rewrite. Designing every conceivable storage backend would violate the
  SQLite-first, evidence-driven scope posture, but local and S3-compatible storage
  are already part of the intended boundary.
- Desired outcome: An explicit decision about the media model, file metadata,
  retention, backup, access control, and one interchangeable storage contract with
  local and S3-compatible implementations.
- Tasks: DOMAIN-07 (completed), MEDIA-22, MEDIA-23, MEDIA-24, MEDIA-31
- Resolution: The project now has an accepted media model, project-owned asset and
  representation persistence, local and Bun S3-compatible storage adapters, upload
  inspection and cleanup lifecycles, revision references, provider delivery state,
  and media-aware backup and restore. MEDIA-31 completes the first product surface
  integration by making this existing boundary usable from the web editor.
- Decision: [ADR-019](decisions/ADR-019-separate-media-assets-representations-and-deliveries.md)

## [ISSUE-004] Establish a reusable Herald design-system package

- Type: proposal
- Status: resolved
- Evidence: The dashboard already uses Tailwind CSS, shadcn/ui with Base UI, and
  Solar Icons React, while a future website and documentation surface should reuse
  the same visual language.
- Impact: Allowing application-local components and tokens to grow independently
  would make later extraction expensive and could produce inconsistent product
  surfaces.
- Desired outcome: A focused shared package for approved design tokens, Base UI-based
  components, project-specific variants, icon conventions, and Tailwind integration,
  with a clear ownership boundary and no Radix UI dependency.
- Tasks: DESIGN-29 (completed)
- Resolution: The private `@herald/ui` workspace package now owns shared Tailwind
  tokens, base styles, the Base UI Button primitive, and the class-composition
  utility. The web app consumes the package through public subpaths and keeps a
  thin local Tailwind entrypoint with explicit application and package source
  roots. [ADR-023](decisions/ADR-023-establish-shared-ui-package.md) records the
  ownership boundary.
- Decision: [ADR-023](decisions/ADR-023-establish-shared-ui-package.md)

## [ISSUE-005] Define a motion policy before adding an animation runtime

- Type: proposal
- Status: resolved
- Evidence: No motion policy exists yet, and GSAP is a possible solution for future
  interactions but would add runtime weight and another abstraction to the web
  surface.
- Impact: Adding animation infrastructure before a concrete interaction need could
  increase bundle size and visual inconsistency without improving the core workflow.
- Desired outcome: A small motion policy covering accessibility, interaction classes,
  performance budget, and the evidence required before introducing GSAP or another
  animation dependency.
- Tasks: DESIGN-30 (completed)
- Resolution: Herald now follows a native-first motion policy recorded in
  [ADR-024](decisions/ADR-024-adopt-a-native-first-motion-policy.md). The shared
  stylesheet honors reduced-motion preferences, existing transitions target
  bounded properties, and no animation runtime was added without a concrete
  interaction requirement.
- Decision: [ADR-024](decisions/ADR-024-adopt-a-native-first-motion-policy.md)

## [ISSUE-006] Separate publisher credentials from application authentication

- Type: problem
- Status: resolved
- Evidence at opening: The LinkedIn connection flow stored publisher OAuth credentials
  in Better Auth accounts, references those user-owned accounts directly from
  project-owned publisher connections, resolves worker tokens through Better Auth,
  and changes global account-linking policy to support the publisher use case.
- Impact: Application identity and publisher credential lifecycles have different
  ownership, deletion, transfer, revocation, and background-execution semantics.
  Keeping them coupled could make user or organization changes affect publication
  infrastructure and could force non-OAuth credentials into an identity model.
- Desired outcome: Better Auth provides email/password authentication into Herald,
  while Herald owns project-scoped publisher credentials and delegates only
  well-defined OAuth protocol mechanics to an evidence-backed dependency.
- Tasks: CRED-15, CRED-16, CRED-17, CRED-18, PUB-09
- Resolution: Better Auth now provides only Herald email/password sessions. Herald
  owns project-scoped encrypted publisher credentials and single-use authorization
  attempts, while provider modules supply explicit OAuth mechanics and the worker
  resolves credentials without a Better Auth account or session. The live LinkedIn
  smoke test completed successfully, and no publisher token material is exposed in
  API responses, logs, audit events, or committed artifacts.
- Decision: [ADR-012](decisions/ADR-012-own-publisher-credentials-and-use-oauth4webapi.md)

## [ISSUE-007] Define the publication content and provider capability boundary

- Type: problem
- Status: resolved
- Evidence at opening: The `Post` and `Publication` records persisted plain text
  only, while the first publisher contract accepted a LinkedIn-specific text input.
  There was no domain representation for attachments, rich content, mentions,
  links, provider constraints, or a provider-specific publication rendition. The
  existing media question in ISSUE-003 covered storage lifecycle but not the
  publication content contract that would consume stored media. ADR-013 and
  ADR-014 accepted runtime-defined custom channel contracts and the
  draft-versus-execution revision boundary; SPEC-004 then defined source content,
  runtime schemas, HTTP mapping, profile evolution, and media behavior.
- Resolution evidence: SPEC-004 is now the accepted publication-content boundary.
  The implementation has established reusable media assets, immutable
  representations, exact publication-revision references, provider media
  deliveries, provider-owned capability contracts, and a web editor that reuses
  the same media lifecycle for source and target editing. PUB-10 adds the first
  durable LinkedIn image-delivery slice without moving provider identifiers into
  reusable assets.
- Impact: Continuing with a provider integration before defining this boundary could
  make the first provider's payload shape leak into the core domain, force later
  rewrites for channels with different capabilities, and leave manual channels
  unable to represent content that cannot be automated. It is also unclear which
  content must be shared from a source post and which content may be adapted per
  publication.
- Desired outcome: An accepted durable boundary that defines the source post content,
  channel-specific publication content, provider capability validation, attachment
  references, publication snapshots and revisions, and the separation between
  common domain data and provider-specific payloads. The boundary must identify
  what is intentionally deferred and provide executable invariants for the chosen
  model without requiring every future social network to be designed in advance.
- Tasks: DOMAIN-07 (completed), DOMAIN-20, DOMAIN-21, MEDIA-24, MEDIA-31, CHANNEL-25, CHANNEL-26, EDITOR-27, PUB-10
- Specification: [SPEC-004](specs/SPEC-004-publication-content-boundary.md)
- Decisions: [ADR-013](decisions/ADR-013-runtime-defined-custom-channel-contracts.md), [ADR-014](decisions/ADR-014-separate-autosaved-drafts-from-execution-revisions.md), [ADR-015](decisions/ADR-015-use-a-small-semantic-source-content-vocabulary.md), [ADR-016](decisions/ADR-016-use-a-bounded-json-schema-runtime-profile.md), [ADR-017](decisions/ADR-017-use-versioned-webhooks-and-mapped-http-for-custom-channels.md), [ADR-018](decisions/ADR-018-restrict-custom-channel-network-egress.md), [ADR-019](decisions/ADR-019-separate-media-assets-representations-and-deliveries.md), [ADR-020](decisions/ADR-020-version-and-assess-channel-profile-changes.md), [ADR-021](decisions/ADR-021-channel-owns-profile-contract.md), [ADR-026](decisions/ADR-026-linkedin-single-image-delivery.md)

## [ISSUE-008] Make local API and web startup reproducible

- Type: problem
- Status: resolved
- Evidence: A local database created from an earlier migration history contains
  tables and migration records that do not match the five migrations currently
  committed. Starting the API then fails with a low-level `table account already
exists` error. At the same time, the Vite development proxy always targets port
  `3000`, which is already used by another local project, so the Herald dashboard
  sends API requests to the wrong server when Herald's API is unavailable.
- Impact: A new contributor or operator cannot tell whether startup failed because
  of stale development data, a port collision, or a dashboard request failure.
  The resulting generic browser error obscures the actual integration boundary.
- Desired outcome: Document and exercise a clean local startup path, make the web
  development API target configurable without changing production same-origin
  behavior, and provide actionable migration failure context without weakening
  migration safety.
- Tasks: OPS-11 (completed)
- Resolution: The Vite development API target is now validated and configurable
  through `HERALD_API_ORIGIN`, while browser requests remain same-origin. The API
  keeps the default `3000` port, and alternate local ports are documented for both
  processes. Migration conflicts involving an existing schema object now fail
  closed with actionable context; no idempotent SQL or automatic reset was added.

## [ISSUE-009] Complete multi-destination post authoring

- Type: problem
- Status: resolved
- Evidence: The API and persistence boundary accept an array of publication inputs
  for one source post, and the primary web composer now exposes repeatable target
  cards instead of a single publication form.
- Impact: Before this slice, Herald's central promise of one source post feeding
  independently managed destinations could not be exercised through its primary
  authoring surface.
- Desired outcome: A user can create and manage one source post with multiple
  channel publications, each retaining its own target content, schedule, delivery
  mode, validation state, and outcome.
- Tasks: DOMAIN-39
- Resolution: The dashboard composer now keeps one source draft and a repeatable
  list of destination drafts. Each destination independently selects a channel,
  optional target copy, delivery mode, and schedule; creation submits all targets
  through the existing atomic `publications[]` API contract. The existing
  publication editor and queue continue to manage each resulting target and its
  persisted validation/outcome independently.
- Verification: `e2e/publication-media.spec.ts` creates one source with two
  destinations, distinct target content and schedules, manual and automatic
  delivery modes, shared media, and repeat/remove interactions, then verifies
  both persisted target payloads. Format, lint, typecheck, unit, browser, and
  build gates pass.

## [ISSUE-010] Define recovery for shared source revision conflicts

- Type: problem
- Status: resolved
- Evidence: `packages/db/src/manual-store.ts` rejects a stale publication draft
  when the shared post source revision has advanced. The integration test in
  `packages/db/src/manual-store.test.ts` confirms that a sibling draft remains on
  the old revision and has no recovery operation.
- Impact: The fail-closed concurrency invariant prevents silent data loss, but a
  legitimate editor can be left unable to continue without an explicit recovery
  path.
- Desired outcome: Source edits across sibling publications have a deterministic,
  user-visible reconciliation flow that preserves source and target work, explains
  conflicts, and never changes an already promoted or executing snapshot.
- Tasks: DOMAIN-39
- Resolution: ADR-027 is implemented. Working drafts now retain their source
  snapshot, the API exposes an explicit project-scoped rebase operation guarded by
  the draft revision, and the web editor preserves local recovery data while
  presenting the source conflict for review. Rebase preserves target content,
  schedule, delivery state, and execution state; it never promotes or rewrites a
  target payload.
- Verification: Database migration, store, API, and browser-editor integration
  tests cover source snapshots, stale-draft rejection, explicit rebase,
  idempotent retry, audit attribution, and fail-closed legacy migration.

## [ISSUE-011] Make execution history append-only and attributable

- Type: problem
- Status: resolved
- Evidence: `packages/db/src/workflow-store.ts` updates the current publication and
  job rows for success, retry, failure, and ambiguous recovery, but does not append
  corresponding `audit_events` records. `packages/db/src/domain-schema.ts` stores a
  current job attempt counter and error rather than a durable attempt history.
- Impact: Operators cannot reconstruct the complete execution sequence or inspect
  each attempt after a retry and state fields have been overwritten.
- Desired outcome: Every automatic execution attempt, outcome, retry, ambiguity,
  and recovery is durably attributable and reconstructable while current lifecycle
  state remains efficient to query.
- Tasks: WORK-11 (completed)
- Resolution: The workflow store now records claims, effect-boundary transitions,
  successes, retries, terminal failures, direct ambiguities, cancellations, and
  expired-claim recovery through the existing project-scoped `audit_events`
  journal. Events use a stable `publication.execution.*` action vocabulary and
  structured non-secret metadata while current job and publication rows remain
  the efficient lifecycle projections. Each event is persisted in the same
  transaction as its state transition.
- Decision: [ADR-028](decisions/ADR-028-use-audit-events-as-execution-journal.md)
- Verification: Workflow integration tests cover every execution outcome,
  pre- and post-effect lease recovery, retry attempt history, cancellation,
  stale fences, duplicate completion, and rollback when audit persistence fails.
  The full repository format, lint, typecheck, unit/integration, browser E2E,
  and build gate passes.

## [ISSUE-012] Expose truthful runtime readiness

- Type: problem
- Status: resolved
- Evidence: `/health` in `apps/api/src/modules/health/routes.ts` always returns
  `status: ok`, while `packages/core/src/scheduler.ts` has a terminal `failed`
  state and the worker and media maintenance runtimes are started independently
  in `apps/api/src/index.ts`.
- Impact: A running HTTP process can appear healthy while scheduled publications no
  longer execute, delaying detection of a broken deployment.
- Desired outcome: Herald defines and exposes clear liveness and readiness
  semantics that reflect the operational state relevant to serving requests and
  executing durable work.
- Tasks: OPS-13 (completed)
- Resolution: Herald now separates the public `/health` liveness endpoint from
  the `/ready` readiness endpoint. Readiness probes SQLite and reports the
  publication scheduler and media reconciliation runtime states, returning 503
  while a required check is absent, stopped, or failed. Media maintenance now
  exposes lifecycle state and recovers to started after a successful later run.
  The production asset fallback protects `/ready` as a server path, and the
  container liveness check remains intentionally attached to `/health`.
- Decision: [ADR-029](decisions/ADR-029-separate-liveness-and-readiness.md)
- Verification: API integration tests cover missing and active runtimes,
  scheduler failure, database failure, liveness independence, and OpenAPI
  registration. Media runtime tests cover lifecycle, failure, and restart
  recovery. The full format, lint, typecheck, unit/integration, browser E2E,
  and build gate passed. A real production-bundle smoke test returned 200 from
  `/health` and `/ready`, and 404 for an unknown `/ready` path instead of the
  SPA fallback.

## [ISSUE-013] Complete project access and machine identity

- Type: problem
- Status: resolved
- Evidence: Projects currently expose access through the creating user's actor;
  there are no project membership, invitation, or project-token models or routes.
  The CLI authenticates with `HERALD_SESSION_COOKIE`, while `SPEC-002` lists
  project-scoped API tokens in the operable milestone. Better Auth remains limited
  to application email/password authentication.
- Impact: Herald cannot yet provide a deliberate access model for trusted humans,
  scripts, and agents before the instance is exposed beyond local development.
- Desired outcome: The instance has an explicit bootstrap policy and project access
  model, including attributable machine access where required, without coupling
  project ownership or publisher credentials to Better Auth account rows.
- Tasks: ACCESS-14 (completed)
- Resolution: Herald now supports project-scoped opaque bearer tokens with
  hash-only persistence, optional expiry, durable revocation, one-time secret
  disclosure, and project-scoped `api_token` actors. Human sessions manage the
  tokens; machine tokens use ordinary project operations but cannot create
  projects, manage tokens, or start interactive LinkedIn OAuth flows. Better Auth
  remains limited to human email/password authentication.
- Decision: [ADR-030](decisions/ADR-030-project-scoped-machine-access.md)
- Verification: Database and API integration tests cover secret handling,
  project isolation, expiry, revocation, actor attribution, human-only management,
  bearer precedence, OAuth session-only behavior, and OpenAPI security metadata.
  The full format, lint, typecheck, unit/integration, browser E2E, and build gate
  passed.

## [ISSUE-014] Make web project context URL-authoritative

- Type: problem
- Status: resolved
- Evidence: The `/dashboard` loader initializes project data from `projects[0]`,
  while the nested publication editor receives its own `$projectId`. The shell
  keeps the selected project and related data in local state.
- Impact: Direct links or reloads for a publication belonging to another project
  can show a mismatched project context and make navigation state unreliable.
- Desired outcome: The selected project is stable across direct navigation, reloads,
  nested editors, and shell actions, with one authoritative route/data model.
- Tasks: WEB-51 (completed)
- Resolution: The project route now passes its URL-resolved `Project` directly to
  the authenticated shell instead of making the shell infer the selected project
  from the global project list. The project dashboard provider is keyed by the
  resolved project identity, so changing project parameters cannot retain the
  previous project's operational data or compose state.
- Verification: The browser integration scenario switches between two projects,
  validates isolated channel data, visits both project URLs directly, and checks
  the selected project context after navigation. The full format, lint, strict
  typecheck, unit/integration, browser, and build gate passed.

## [ISSUE-015] Provide schema-aware target editing

- Type: problem
- Status: resolved
- Evidence: The publication editor previously exposed the target payload through
  only a raw JSON textarea even though channel profiles already provided bounded
  schemas, field bindings, capabilities, and normalized validation issues.
- Impact: Human users must understand internal target JSON instead of receiving an
  editor that reflects the selected channel and its constraints.
- Desired outcome: The web editor presents usable, reactive controls for supported
  channel fields and constraints, preserves manual and runtime-defined channels,
  and keeps the same server-side validation and immutable promotion boundary.
- Tasks: WEB-52 (completed)
- Resolution: The editor now projects declared schema properties and field
  bindings into bounded controls for text, numbers, booleans, primitive
  enumerations, string lists, and ordered media. Nested scalar properties are
  supported through JSON Pointer updates; ambiguous compositions, unsupported
  shapes, and provider-specific payloads remain available through the preserved
  Advanced JSON escape hatch. The server remains authoritative for validation,
  and the interface blocks explicit promotion while a draft is marked
  `review_required`.
- Verification: Added metadata and JSON Pointer unit coverage for schema
  projection, local references, capability intersections, nested fields,
  invalid compositions, optional values, and provider-field preservation. The
  focused media publication browser scenario and the full `bun run check` gate
  passed, including formatting, lint, strict typecheck, unit/integration tests,
  browser integration, and package builds.

## [ISSUE-016] Split persistence by coherent use-case boundaries

- Type: problem
- Status: resolved
- Evidence at opening: `packages/db/src/manual-store.ts` was 3,742 lines and
  contained project, channel/profile, post/draft, publication, media resolution,
  reconciliation, and audit persistence for both manual and automatic flows.
- Impact: The current unit is difficult to navigate, review, test, and safely modify
  for both humans and agents; its name also no longer describes its responsibility.
- Desired outcome: Persistence code is organized into cohesive, discoverable units
  that preserve transaction boundaries and project invariants without introducing
  a generic repository abstraction or splitting code only by arbitrary line count.
- Tasks: MAINT-41 (completed), MAINT-42 (completed), MAINT-43 (completed), MAINT-44 (completed), MAINT-45 (completed), MAINT-46 (completed), MAINT-47 (completed), MAINT-48 (completed), MAINT-49 (completed), MAINT-50 (completed)
- Resolution: MAINT-41 through MAINT-50 extracted project, channel, profile,
  publication, media, reconciliation, and read-model responsibilities into
  cohesive persistence units while preserving the stable manual-store facade,
  SQLite transaction boundaries, and domain invariants. The extraction was
  evidence-driven and did not introduce a generic repository abstraction or an
  arbitrary file-size rule.

## [ISSUE-017] Repair the documented coverage command

- Type: problem
- Status: resolved
- Evidence: `bun run test:coverage` invokes `bun test --coverage`, which loads
  `e2e/publication-media.spec.ts` and fails because Playwright tests are not being
  executed by the Playwright runner. The regular `bun run check` gate remains green.
- Impact: The documented coverage workflow is not reproducible and can mislead
  contributors about the quality signal it produces.
- Desired outcome: The coverage command runs the intended unit and integration
  suites, produces its documented reports, and remains distinct from the browser
  integration runner.
- Tasks: QUAL-38 (completed)
- Resolution: The root `test:coverage` script now excludes Playwright specifications
  from Bun's coverage discovery while keeping browser integration in its dedicated
  runner. The command and its documentation were verified in PR #28.

## [ISSUE-018] Document separate publisher-key recovery

- Type: problem
- Status: resolved
- Evidence: `ADR-012` correctly keeps the publisher encryption key outside SQLite
  and its backups, but the backup and restore procedure in `README.md` does not
  explain how the operator preserves and restores that key alongside an application
  bundle.
- Impact: Restoring database and media bytes without the deployment key makes stored
  publisher credentials unusable, even though the data archive itself is valid.
- Desired outcome: The recovery runbook and its verification procedure make the
  separately managed encryption key an explicit part of a complete Herald recovery
  without placing the secret in the archive.
- Tasks: OPS-16 (completed)
- Resolution: The root recovery runbook now treats the publisher encryption key
  and its key ID as separately managed recovery material, explains the restore
  sequence and verification boundary, and distinguishes the key from encrypted
  credential data in the application bundle. The database package README links
  to the same procedure. No secret value is stored in repository artifacts.

## [ISSUE-019] Define the operational planning experience

- Type: proposal
- Status: resolved
- Evidence: Herald currently presents operational work through dashboard sections
  and publication lists. A calendar or timeline has not been designed, and the
  owner identified the need to rethink information hierarchy and scroll behavior
  before adding more incremental web surfaces.
- Impact: Adding more controls and sections without a coherent planning model can
  make scheduling and review fragmented, dense, or unnecessarily tiring to use.
- Desired outcome: A deliberate information architecture explains how overview,
  composition, queue, channels, media, and time-based planning fit together across
  desktop and small screens before the corresponding UI is expanded.
- Tasks: DESIGN-36 (completed), DESIGN-40 (completed)
- Resolution: DESIGN-36 established the route-oriented workspace and dedicated
  task surfaces, while DESIGN-40 added the project-scoped calendar planning
  surface with desktop, tablet, and mobile compositions. Both preserve the
  existing publication and scheduling boundaries; further planning affordances
  remain separate product work.

## [ISSUE-020] Establish maintainability and refactor guardrails

- Type: proposal
- Status: resolved
- Evidence: The independent audit identified one large persistence unit, while the
  current project does not yet record a cross-cutting review method for module
  responsibility, cohesion, test seams, or safe extraction across backend and
  frontend code.
- Impact: Future autonomous sessions may keep appending to convenient files and
  components until the product becomes difficult to reason about or safely evolve.
- Desired outcome: Herald has lightweight, evidence-based structural review rules
  and a periodic codebase audit that favors cohesive responsibilities, explicit
  dependencies, reusable behavior, and testable boundaries without enforcing an
  arbitrary file-size quota.
- Tasks: MAINT-41 (completed), MAINT-42 (completed), MAINT-43 (completed), MAINT-44 (completed), MAINT-45 (completed), MAINT-46 (completed), MAINT-47 (completed), MAINT-48 (completed), MAINT-49 (completed), MAINT-50 (completed)
- Resolution: The maintenance sequence recorded responsibility maps, preserved
  transaction ownership, and extracted the verified persistence seams behind
  explicit dependencies. The resulting guardrail is evidence-based cohesion
  and testability, not a blanket line-count target or generic repository layer.

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
- Desired outcome: Herald periodically exercises and records the complete intended
  publication workflow in realistic use, including automatic and manual channels,
  failures, edits, and recovery, without reintroducing a release-oriented MVP
  boundary.
- Tasks: EVAL-53 (completed; repeat periodically), EVAL-54 (completed), PUB-55 (completed), EVAL-57 (completed; repeat periodically)
- EVAL-54 completed the automatic-provider stage with an operator-approved,
  organization-scoped LinkedIn smoke test. The provider acknowledged the text
  publication, Herald persisted the successful job and publication outcome, and
  the dashboard displayed the target as published. This issue remains open as
  a recurring validation practice rather than a one-time implementation task.
- EVAL-57 completed the automatic image-provider stage with an operator-approved
  disposable publication. The provider acknowledged the image delivery, Herald
  persisted the successful media checkpoint and publication outcome, and the
  dashboard displayed the target as published. This remains a recurring
  validation practice rather than a release gate.

## [ISSUE-022] Separate LinkedIn authorization principals from publication destinations

- Type: problem
- Status: resolved
- Evidence: The current LinkedIn publisher stores the authenticated member ID as
  the only external account identity and uses it as the Posts API author. This
  makes a controlled validation publish to a company page impossible: the OAuth
  principal and the page that should publish are different LinkedIn entities.
- Impact: Herald could publish to the wrong LinkedIn destination while the
  connection appears healthy. Storing the page identity on the OAuth credential
  would also prevent one authorized member credential from safely serving several
  project channels or pages.
- Desired outcome: A LinkedIn connection explicitly records whether its
  publication destination is a member or an organization page. The provider
  adapter builds the corresponding author and media-owner URN, while the
  encrypted credential remains the project-owned authorization of the member who
  granted access.
- Tasks: PUB-55 (completed), EVAL-54 (completed)
- Decision: [ADR-031](decisions/ADR-031-separate-linkedin-principal-and-destination.md)
- Resolution: LinkedIn credentials now retain the OAuth member principal while
  each project publisher connection records an explicit member or organization
  destination. Organization IDs are permission-checked after OAuth, and both
  text and image delivery use the persisted destination URN.

## [ISSUE-023] Keep provider media delivery timestamps on one workflow clock

- Type: problem
- Status: resolved
- Evidence: A real automatic image-publication attempt created the provider
  media delivery with the store's wall clock, then started it with the logical
  workflow processing timestamp. A millisecond skew caused the SQLite timestamp
  invariant to reject the transition before the provider upload call.
- Impact: A valid automatic image publication can be classified as ambiguous and
  stop the worker even though the provider request was never reached. The same
  clock split can affect delayed or batched processing whenever a delivery store
  clock advances between operations.
- Desired outcome: Every provider media delivery mutation in one workflow run
  uses the same validated processing timestamp, while direct store callers keep
  a safe wall-clock default. A regression test must cover a skewed store clock.
- Tasks: FIX-58 (completed), EVAL-57 (completed)
- Resolution: FIX-58 now passes the workflow processing timestamp into provider
  media reservation, while direct store callers retain a validated wall-clock
  default. The skewed-clock regression test passed, and a subsequent approved
  automatic image publication reached the provider successfully. Herald
  persisted the publication as published, the job as succeeded, and the media
  delivery as uploaded. The first failed attempt remains an explicit local
  ambiguous record and was not retried blindly.

## [ISSUE-024] Establish serialized orchestration for parallel agent work

- Type: proposal
- Status: resolved
- Evidence: Herald now has several independent implementation and review
  surfaces, while local development servers, SQLite and media paths, browser
  state, external provider credentials, the canonical checkout, and merge
  operations remain shared resources.
- Impact: Uncoordinated agents can race on ports or local state, create
  conflicting changes, duplicate external effects, or integrate work before it
  has been independently reviewed.
- Desired outcome: A tested operating model assigns shared-resource ownership to
  one orchestrator, isolates implementation missions in dedicated worktrees,
  serializes integration through one queue, provides a read-only independent
  review path, and keeps secrets and external side effects out of worker tasks.
- Tasks: META-60 (completed), META-61 (completed)
- Pilot result: The ownership, isolation, and independent-review principles
  worked for two read-only missions. The worktree-task control path returned
  preparation identifiers without a durable task identity, so the pilot did not
  prove status monitoring, cancellation, attribution, or cleanup through that
  path. META-61 then validated an explicit-worktree fallback with a bounded
  implementation worker, a stale-base integration, an independent Sol-High
  review, a complete repository gate, and deterministic worktree and branch
  cleanup. The fallback is now the operational policy; the app-managed
  task-control path remains gated by META-62 and is not used as the default.
- Resolution: The root AGENT.md now assigns shared resources and integration to
  one orchestrator, requires explicit mission contracts and disjoint semantic
  ownership, restricts worker checks and effects, and records the full worker
  lifecycle. The fallback records the sub-agent identity, status, base commit,
  worktree, branch, scope, checks, result, and cleanup evidence.
- Related issues: ISSUE-025, ISSUE-026, ISSUE-027, ISSUE-028, ISSUE-029

## [ISSUE-025] Isolate concurrent local and test runtime resources

- Type: problem
- Status: open
- Evidence: The browser test configuration uses a shared temporary data root
  that startup and teardown remove, while development and E2E commands rely on
  conventional ports and local database/media paths.
- Impact: Overlapping workers or test runs can collide on ports, erase another
  run's SQLite/media state, or execute against the wrong local runtime.
- Desired outcome: Each concurrent test or explicitly isolated runtime receives
  its own temporary data and media roots and reserved ports, with teardown
  limited to resources owned by that run. Shared/default paths remain a
  serialized orchestrator concern until then.
- Tasks: to be triaged

## [ISSUE-026] Enforce runtime quiescence before backup restore

- Type: problem
- Status: open
- Evidence: The restore path can replace the database and media state while the
  API, scheduler, or maintenance runtime may still hold open resources. The
  operator documentation asks for a stop but the restore operation does not
  enforce quiescence.
- Impact: A live process can retain stale SQLite or media handles and diverge
  from the restored state, leaving an inconsistent runtime that is difficult to
  diagnose.
- Desired outcome: Restore has an explicit fail-closed quiescence boundary and
  a verified operator lifecycle for stopping, restoring, and restarting Herald.
- Tasks: to be triaged

## [ISSUE-027] Isolate built-in provider execution behind an explicit contract

- Type: proposal
- Status: open
- Evidence: The workflow worker currently dispatches the known built-in
  providers from central code, including provider-specific credential refresh
  and destination handling.
- Impact: Adding another built-in channel can enlarge a central hotspot and
  accidentally inherit assumptions that belong to a different provider, making
  provider missions harder to isolate safely.
- Desired outcome: Before the next built-in channel, evaluate a small explicit
  provider port or registry for credential resolution, capability validation,
  execution, and outcome mapping, while preserving channel-owned profiles and
  avoiding a universal provider DSL.
- Tasks: to be triaged

## [ISSUE-028] Verify pinned media bytes on every delivery path

- Type: problem
- Status: resolved
- Evidence: The custom HTTP media delivery path checks persisted identity, key,
  size, and content type but does not enforce the pinned SHA-256 comparison that
  the LinkedIn delivery path performs.
- Impact: A same-size object with a matching content type could be delivered
  after its bytes changed, weakening the immutable representation guarantee.
- Desired outcome: Every delivery adapter verifies the pinned representation
  checksum before entering its external-effect boundary, with a regression test
  covering changed bytes that preserve size and content type.
- Tasks: META-61 (completed)
- Resolution: The custom HTTP media contract now carries the pinned checksum;
  the worker hashes the actual bounded representation stream before LinkedIn
  upload and custom multipart dispatch, then reopens the stream for delivery.
  The multipart transport checks the returned checksum and cancels streams on
  rejected media or write failures. Same-size, changed-byte media is rejected
  before the custom HTTP requester is called, and preflight storage read errors
  remain retryable. Conditional storage reads or verified spooling remain a
  follow-up for closing the small time-of-check/time-of-use window.

## [ISSUE-029] Prove visible control for app-managed worktree missions

- Type: problem
- Status: open
- Evidence: The Codex app-managed worktree task path previously returned
  preparation identifiers without a durable task identity that the orchestrator
  could use for status, cancellation, attribution, visibility, and cleanup.
- Impact: The orchestrator cannot safely promise that a delegated worktree task
  is observable or controllable by the operator, even though the explicit
  worktree fallback is traceable and safe.
- Desired outcome: A controlled mission proves durable task identity, observable
  progress and final status, cancellation, attribution, operator visibility,
  and cleanup for an app-managed worktree task without granting it shared
  server, browser, credential, or merge ownership.
- Tasks: META-62
- Related issues: ISSUE-024
