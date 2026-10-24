# Project Issues

## [ISSUE-001] Validate the complete production distribution path

- Type: proposal
- Status: resolved
- Evidence: Postbot is intended to run as one self-hosted process, but the current
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

## [ISSUE-004] Establish a reusable Postbot design-system package

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
- Resolution: The private `@postbot/ui` workspace package now owns shared Tailwind
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
- Resolution: Postbot now follows a native-first motion policy recorded in
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
- Desired outcome: Better Auth provides email/password authentication into Postbot,
  while Postbot owns project-scoped publisher credentials and delegates only
  well-defined OAuth protocol mechanics to an evidence-backed dependency.
- Tasks: CRED-15, CRED-16, CRED-17, CRED-18, PUB-09
- Resolution: Better Auth now provides only Postbot email/password sessions. Postbot
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
  `3000`, which is already used by another local project, so the Postbot dashboard
  sends API requests to the wrong server when Postbot's API is unavailable.
- Impact: A new contributor or operator cannot tell whether startup failed because
  of stale development data, a port collision, or a dashboard request failure.
  The resulting generic browser error obscures the actual integration boundary.
- Desired outcome: Document and exercise a clean local startup path, make the web
  development API target configurable without changing production same-origin
  behavior, and provide actionable migration failure context without weakening
  migration safety.
- Tasks: OPS-11 (completed)
- Resolution: The Vite development API target is now validated and configurable
  through `POSTBOT_API_ORIGIN`, while browser requests remain same-origin. The API
  keeps the default `3000` port, and alternate local ports are documented for both
  processes. Migration conflicts involving an existing schema object now fail
  closed with actionable context; no idempotent SQL or automatic reset was added.

## [ISSUE-009] Complete multi-destination post authoring

- Type: problem
- Status: resolved
- Evidence: The API and persistence boundary accept an array of publication inputs
  for one source post, and the primary web composer now exposes repeatable target
  cards instead of a single publication form.
- Impact: Before this slice, Postbot's central promise of one source post feeding
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
- Desired outcome: Postbot defines and exposes clear liveness and readiness
  semantics that reflect the operational state relevant to serving requests and
  executing durable work.
- Tasks: OPS-13 (completed)
- Resolution: Postbot now separates the public `/health` liveness endpoint from
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
- Evidence: The initial implementation exposed access through the creating user's
  actor and a Postbot-owned project-token model. `SPEC-002` lists project-scoped API
  tokens in the operable milestone. The access reassessment showed that Better Auth's
  Admin, Organization, and API Key plugins cover the standard identity, membership,
  invitation, expiry, and machine-key primitives needed by Postbot.
- Impact: Postbot cannot yet provide a deliberate access model for trusted humans,
  scripts, and agents before the instance is exposed beyond local development.
- Desired outcome: The instance has an explicit bootstrap policy and project access
  model, including attributable machine access where required, without coupling
  project ownership or publisher credentials to Better Auth account rows.
- Tasks: ACCESS-14 (completed)
- Resolution: Better Auth now owns global user administration, project
  membership/invitations, and user-owned API keys with bounded expiry. Postbot keeps
  the instance membership boundary, actor attribution, publisher credentials, and
  the project-grant projection. New keys use `postbot_pat_`, authenticate as their
  creating user, and optionally narrow that user's current project access. API-key
  management is session-only; bearer keys cannot create, list, update, or revoke
  keys. Project-token routes, storage, and compatibility facades are removed from
  the private development baseline.
- Decision: [ADR-030](decisions/ADR-030-project-scoped-machine-access.md),
  [ADR-063](decisions/ADR-063-adopt-better-auth-access-plugins.md)
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
  separately managed encryption key an explicit part of a complete Postbot recovery
  without placing the secret in the archive.
- Tasks: OPS-16 (completed)
- Resolution: The root recovery runbook now treats the publisher encryption key
  and its key ID as separately managed recovery material, explains the restore
  sequence and verification boundary, and distinguishes the key from encrypted
  credential data in the application bundle. The database package README links
  to the same procedure. No secret value is stored in repository artifacts.

## [ISSUE-020] Establish maintainability and refactor guardrails

- Type: proposal
- Status: resolved
- Evidence: The independent audit identified one large persistence unit, while the
  current project does not yet record a cross-cutting review method for module
  responsibility, cohesion, test seams, or safe extraction across backend and
  frontend code.
- Impact: Future autonomous sessions may keep appending to convenient files and
  components until the product becomes difficult to reason about or safely evolve.
- Desired outcome: Postbot has lightweight, evidence-based structural review rules
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

## [ISSUE-022] Separate LinkedIn authorization principals from publication destinations

- Type: problem
- Status: resolved
- Evidence: The current LinkedIn publisher stores the authenticated member ID as
  the only external account identity and uses it as the Posts API author. This
  makes a controlled validation publish to a company page impossible: the OAuth
  principal and the page that should publish are different LinkedIn entities.
- Impact: Postbot could publish to the wrong LinkedIn destination while the
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
  automatic image publication reached the provider successfully. Postbot
  persisted the publication as published, the job as succeeded, and the media
  delivery as uploaded. The first failed attempt remains an explicit local
  ambiguous record and was not retried blindly.

## [ISSUE-024] Establish serialized orchestration for parallel agent work

- Type: proposal
- Status: resolved
- Evidence: Postbot now has several independent implementation and review
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
  cleanup. The owner later retired the separate app-managed control investigation
  as no longer relevant to current Postbot work (ISSUE-029 / META-228); that scope
  decision does not claim the control-plane limitation was fixed.
- Resolution: The root AGENT.md now assigns shared resources and integration to
  one orchestrator, requires explicit mission contracts and disjoint semantic
  ownership, restricts worker checks and effects, and records the full worker
  lifecycle. The fallback records the sub-agent identity, status, base commit,
  worktree, branch, scope, checks, result, and cleanup evidence.
- Related issues: ISSUE-025, ISSUE-026, ISSUE-027, ISSUE-028, ISSUE-029

## [ISSUE-025] Isolate concurrent local and test runtime resources

- Type: problem
- Status: resolved
- Evidence: The browser test configuration uses a shared temporary data root
  that startup and teardown remove, while development and E2E commands rely on
  conventional ports and local database/media paths.
- Impact: Overlapping workers or test runs can collide on ports, erase another
  run's SQLite/media state, or execute against the wrong local runtime.
- Desired outcome: Each concurrent test or explicitly isolated runtime receives
  its own temporary data and media roots and reserved ports, with teardown
  limited to resources owned by that run. Shared/default paths remain a
  serialized orchestrator concern until then.
- Tasks: OPS-139 (completed)
- Resolution: Playwright now creates a unique disposable runtime root and
  invocation-specific loopback ports and output directory. Worker processes
  reuse the parent runtime through explicit environment propagation, while the
  API launcher and global teardown validate and remove only the generated run
  root. The legacy `/tmp/postbot-e2e-data` root is not accepted as a cleanup
  target. Default development ports and data paths remain operator-owned and
  serialized; explicit E2E debug ports remain caller-reserved.
- Verification: The isolated runtime unit tests pass, two concurrent realtime
  Playwright runs pass on distinct ports, the CI-mode browser suite passes all
  15 tests, and no generated E2E data root remains after teardown.

## [ISSUE-026] Enforce runtime quiescence before backup restore

- Type: problem
- Status: resolved
- Evidence: The restore path can replace the database and media state while the
  API, scheduler, or maintenance runtime may still hold open resources. The
  operator documentation asks for a stop but the restore operation does not
  enforce quiescence.
- Impact: A live process can retain stale SQLite or media handles and diverge
  from the restored state, leaving an inconsistent runtime that is difficult to
  diagnose.
- Desired outcome: Restore has an explicit fail-closed quiescence boundary and
  a verified operator lifecycle for stopping, restoring, and restarting Postbot.
- Tasks: OPS-140 (completed)
- Related decision: [ADR-068](decisions/ADR-068-runtime-quiescence-sidecar-lock.md) (proposed)
- Resolution: The API process acquires a database-specific `.runtime.lock`
  sidecar before opening the database, and the database and media restore
  primitives acquire the same lock before validating a backup or touching the
  destination. Atomic exclusive creation prevents an active server and a
  restore from proceeding together. Graceful shutdown releases the marker;
  forced termination leaves it in place so a later startup or restore fails
  closed until an operator verifies that no Postbot process is using the database
  and removes only that exact stale marker.
- Verification: Runtime-lock unit tests cover exclusive ownership, stale-marker
  refusal, release, and in-memory rejection. Backup tests cover restore refusal
  while the server boundary is held and successful retry after release. The
  full repository quality gate and local server readiness checks remain required
  before integration.

## [ISSUE-027] Isolate built-in provider execution behind an explicit contract

- Type: proposal
- Status: resolved
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
- Tasks: PROVIDER-69 (completed)
- Resolution: The worker now dispatches built-in execution through an explicit
  provider registry and contract. Provider-specific credential resolution,
  destination handling, execution, and outcome mapping live behind the provider
  boundary, while channel-owned profiles remain separate. The implementation was
  integrated through PR #70.

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

## [ISSUE-030] Restrict current web entry points to the authenticated application

- Type: problem
- Status: resolved
- Evidence: The SPA still exposes a marketing-style `/` page and an `/about`
  page with public navigation, even though Postbot is currently being developed
  as an authenticated operational application. The accepted design direction
  keeps any landing or documentation surface future-facing and separate from
  the current app shell.
- Impact: Public composition and navigation add an obsolete product boundary,
  dilute the authenticated workspace entry point, and can cause future reviews
  to spend time on a surface that is intentionally out of the current scope.
- Desired outcome: The current web application exposes only authentication and
  operational application surfaces. The root entry point resolves the current
  session to login or the dashboard, while future public and documentation
  surfaces remain a separate, explicitly authorized product task.
- Tasks: WEB-63
- Resolution: The root route now redirects unauthenticated sessions to
  `/login` and authenticated sessions to `/dashboard`. The temporary marketing
  root and `/about` route were removed, the root layout now only hosts shared
  application providers, and the generated route tree contains only
  authentication and operational application routes. The browser contract now
  covers both root redirects and waits for the authenticated dashboard to
  finish loading before starting a second navigation.

## [ISSUE-031] Support path-authenticated custom HTTP receivers safely

- Type: question
- Status: resolved
- Evidence: Custom HTTP connections currently store and validate one origin-only
  endpoint. The declarative mapped HTTP contract can construct bounded path and
  query values beneath that origin, but the connection secret can only be applied
  through the supported authentication header modes. Some webhook-style receivers
  identify the destination through a secret-bearing path rather than a header.
- Impact: A receiver that requires a path credential cannot be onboarded through
  the current custom HTTP contract without either rejecting a valid integration or
  placing sensitive URL material in the endpoint metadata. Broadly allowing
  path-bearing endpoints would also contradict the accepted secret and egress
  boundaries.
- Desired outcome: Postbot has a deliberate, bounded contract for receivers whose
  authentication or routing requires URL components, while preserving origin-only
  network authority, encrypted-secret handling, SSRF protections, redaction, and
  immutable execution semantics.
- Tasks: SECURITY-141
- Related decisions: [ADR-017](decisions/ADR-017-use-versioned-webhooks-and-mapped-http-for-custom-channels.md), [ADR-018](decisions/ADR-018-restrict-custom-channel-network-egress.md), [ADR-069](decisions/ADR-069-custom-http-path-authentication.md)
- Resolution: `SECURITY-141` adds an explicit `path` authentication binding for
  mapped HTTP profiles. A profile may declare exactly one dedicated
  `{ "kind": "secret" }` path segment; Postbot resolves it only from the
  encrypted connection credential, encodes it as one URL component, and keeps
  the connection endpoint origin-only. Path authentication is rejected for
  Postbot webhooks, query/header/body mappings, and profiles without the exact
  secret segment. The API, database connection boundary, transport, response
  schema, UI, and redaction tests now fail closed around this contract.

## [ISSUE-032] Expose user-owned API-key access through supported operator clients

- Type: problem
- Status: resolved
- Evidence: User-owned API-key storage, authentication, OpenAPI routes, revocation,
  owner attribution, and operator-client integration are implemented. The typed
  client accepts a user API key, the CLI supports ordinary bearer-authenticated
  operations and human-session key management, and the authenticated dashboard
  exposes the same user-key lifecycle.
- Impact: Operators need one external credential representing their Postbot account,
  with optional project narrowing, rather than a separate credential per project.
- Desired outcome: Supported operator clients can create, display once, list, and
  revoke user-owned keys through the existing human-only management boundary,
  while ordinary project operations accept the bearer key and keep plaintext
  secrets out of logs and persistent state.
- Tasks: ACCESS-68
- Resolution: `@postbot/client`, the supported CLI, and the authenticated web
  application now cover user-key creation, one-time display, metadata listing,
  and revocation. Ordinary client and CLI project operations can send the user
  bearer key; key management deliberately uses a human session. A key can cover
  all projects the owner can access or an explicit selected subset.
  The plaintext value remains in process/UI memory only after creation and is
  never returned by metadata operations or written to persistent state.
- Related decision: [ADR-075](decisions/ADR-075-user-owned-api-keys.md)
- Verification: Client, CLI, database, and API integration tests cover bearer
  propagation, human-only management, one-time secret handling, metadata
  redaction, and project isolation. The browser E2E flow creates a disposable
  token, verifies that the secret disappears after dismissal, and revokes it.
  The full format, lint, typecheck, unit/integration, browser E2E, and build gate
  passed.

## [ISSUE-033] Complete web onboarding and lifecycle for runtime-defined channels

- Type: problem
- Status: resolved
- Evidence: The API and domain support versioned runtime-defined channel profiles,
  while the web channel creation surface currently offers only manual-message and
  LinkedIn choices. The channel list does not provide channel rename, archival, or
  deletion actions, and custom profile authoring is not exposed as a complete web
  workflow.
- Impact: The primary client does not represent the channel model that Postbot
  already persists. Users cannot manage runtime-defined destinations or their
  lifecycle coherently from the application, and provider-specific workarounds
  would undermine the channel/profile boundary.
- Desired outcome: The web application can onboard and manage built-in and
  runtime-defined channels through the same versioned profile and impact-
  assessment contract, with explicit lifecycle semantics and no loss of existing
  publication or credential invariants.
- Tasks: CHANNEL-71 (lifecycle foundation), CHANNEL-67 (web onboarding and lifecycle)
- Related decisions: ADR-013, ADR-020, ADR-021
- Resolution: The web client now creates built-in and runtime-defined channels through
  the shared profile boundary and exposes guarded rename, archive, restore, deletion,
  profile drafting, impact preview, and activation operations.

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

## [ISSUE-037] Add reusable built-in channel profile presets

- Type: proposal
- Status: resolved
- Evidence: Runtime-defined profiles intentionally allow complete custom schemas,
  while common provider shapes are currently represented by individually defined
  built-in profiles. The audit identified reusable presets for recurring channel
  families as a potential acceleration path.
- Impact: Creating a familiar custom destination can require repeating a profile
  definition, and future built-in coverage may duplicate capability knowledge
  without a deliberate preset boundary.
- Desired outcome: Postbot can offer editable, versioned starting profiles for
  common channel families without making presets live authorities or restricting
  fully runtime-defined custom channels.
- Tasks: CHANNEL-142 (completed)
- Related decisions: ADR-013, ADR-020, ADR-021
- Resolution: Provider-owned built-in profiles are now exposed through an
  authenticated, typed preset catalog. The web channel-creation flow can use
  those profiles as editable custom snapshots for common provider families,
  while preserving manual/webhook starters and fully runtime-defined profiles.
  Presets do not remain live authorities after a channel is created.

## [ISSUE-038] Prevent execution of disabled channel profiles

- Type: problem
- Status: resolved
- Evidence: The workflow claim and pre-effect execution paths resolved a persisted
  target profile without requiring its state to remain executable. The accepted
  publication-content contract allows a security correction to disable a profile
  immediately and states that a disabled contract cannot be re-approved.
- Impact: A scheduled target could remain claimable after its referenced profile was
  disabled, which weakened the fail-closed execution boundary for security or
  provider-compatibility corrections.
- Desired outcome: Pending work and pre-effect execution reject disabled profile
  versions while preserving already-started execution records for reconciliation.
- Tasks: QUAL-65 (completed)
- Related specification: [SPEC-004](specs/SPEC-004-publication-content-boundary.md)
- Resolution: Workflow wake-up, job claiming, target loading, and pre-effect
  execution now require a non-disabled channel profile version. Started execution
  records remain loadable for reconciliation, and regression coverage verifies both
  the claim boundary and the disable-after-claim race.

## [ISSUE-039] Apply SQLite schema-rebuild migrations to populated databases

- Type: problem
- Status: resolved
- Evidence: Migration `0011_deep_captain_britain` rebuilds the `channels` table while
  existing publications, publishers, and profile records reference it. The SQL
  correctly requests `PRAGMA foreign_keys=OFF`, but Drizzle starts its SQLite
  migration transaction before executing that statement. SQLite ignores the pragma
  change inside the transaction, so a populated local database fails at `DROP TABLE
channels` with a foreign-key constraint error even though a fresh empty database
  succeeds.
- Impact: A normal development restart can fail after a schema evolution as soon as
  the local database contains real project data. Resetting the database would hide
  the migration defect and discard useful local validation state.
- Desired outcome: Trusted SQLite migrations can perform their committed table
  rebuilds against populated development databases, while foreign-key enforcement
  remains active during normal application work and the final schema is checked
  before migration startup completes.
- Tasks: OPS-73 (completed)
- Related issue: ISSUE-008
- Resolution: The migration runner now disables foreign-key enforcement before
  Drizzle opens its migration transaction, runs `PRAGMA foreign_key_check` after the
  migration, and restores the previous pragma state. Regression coverage applies the
  channel lifecycle migration to a populated database with foreign keys enabled. The
  existing local database migrated from 11 to 12 entries without losing its 3
  projects, 5 channels, or 8 publications.

## [ISSUE-040] Generalize built-in provider connection boundaries before adding Bluesky

- Type: problem
- Status: resolved
- Evidence: Built-in execution already resolves versioned adapters through a registry,
  but publisher runtime construction, OAuth routes and callbacks, channel profile
  resolution, and database connection normalization still contain LinkedIn-specific
  branches. The current boundary is therefore suitable for one provider but does not
  yet prove that a second built-in provider can be added without expanding central
  hotspots.
- Impact: Adding Bluesky directly would spread provider-specific authentication,
  destination, credential, and profile assumptions through generic application code.
  That would make provider behavior harder to test and would risk treating a provider's
  account model as a universal Postbot model.
- Desired outcome: Each built-in provider owns its identity, connection flow,
  destination rules, profile definition, credential requirements, and execution adapter
  behind explicit application ports. Shared code owns orchestration, project scope,
  encrypted credential persistence, OAuth-attempt lifecycle, and generic outcomes.
  Custom HTTP remains a separate declarative execution kind.
- Alternatives: Keep adding provider branches to LinkedIn-shaped routes and stores;
  introduce a universal provider DSL; or split providers into processes. The first
  preserves the current hotspot, the second hides provider truth, and the third adds
  deployment and coordination cost without evidence. None is selected.
- Tasks: PROVIDER-74
- Related decision: ADR-033
- Resolution: PROVIDER-74 moved provider identity, connection, destination,
  profile, credential, and execution concerns behind explicit provider-owned
  ports while keeping orchestration, project scope, encrypted persistence, and
  generic outcomes shared. The follow-up Bluesky slice exercised that boundary
  without adding another provider-shaped central branch. Real-provider
  authorization remains a separate controlled operator validation boundary.

## [ISSUE-041] Add Bluesky as the next built-in provider after the boundary extraction

- Type: proposal
- Status: resolved
- Evidence: Postbot currently has one production-relevant built-in provider. Bluesky
  exercises a materially different account and API model from LinkedIn, including
  repository/PDS identity and provider-specific authorization and media handling.
- Impact: A second provider can reveal whether the shared channel profile, target
  revision, credential, media delivery, outcome, and retry contracts are genuinely
  reusable or only LinkedIn-shaped.
- Desired outcome: A deterministic Bluesky vertical slice covers provider-owned
  profile and capability rules, project-owned connection credentials, authenticated
  text and supported image publication, provider-specific error mapping, and isolated
  tests without weakening the existing LinkedIn path. The authentication mechanism
  must be selected from current provider evidence before implementation; no OAuth or
  app-password behavior is assumed silently.
- Tasks: CHANNEL-75 (after PROVIDER-74)
- Related issue: ISSUE-040
- Related decision: ADR-036 (accepted)
- Resolution: CHANNEL-75 delivered the provider-owned Bluesky profile,
  portable AT Protocol OAuth bridge, encrypted restart-safe session state,
  project-owned account destination, text and image publication path, provider
  outcome mapping, and deterministic tests. The provider stays disabled until
  its required deployment profile is configured; no real provider action is
  implied by this resolution.

## [ISSUE-042] Treat the web application as a dedicated client architecture project

- Type: proposal
- Status: resolved
- Evidence: The web application is the most visible Postbot client, but its current
  navigation, composition, calendar, queue, channel, and media surfaces were built
  incrementally while backend foundations were being established. The owner explicitly
  rejects a short visual or UX pass and wants the client judged by information
  architecture, discoverability, workflow clarity, accessibility, and calm operation.
- Impact: Incremental UI additions can preserve local screens while making the product
  harder to navigate, more scroll-heavy, and less coherent. This would obscure the
  strength of the backend and make later redesigns more expensive.
- Desired outcome: A dedicated web-client workstream defines the application shell,
  project context, navigation hierarchy, primary workflows, responsive behavior,
  information density, accessibility rules, component ownership, and validation method
  before broad feature expansion. The result must remain a client of stable API/domain
  contracts rather than becoming a second source of business rules.
- Scope boundary: This is not a landing-page or branding exercise. Authenticated app
  IA and interaction design come first; visual tokens and component calibration support
  that structure. Public marketing pages remain out of scope unless separately accepted.
- Tasks: WEB-76 (after the provider and Bluesky slices provide the next backend evidence)
- Resolution: WEB-76 established the authenticated web-client ownership
  boundaries, project context, route composition, responsive navigation
  structure, and decomposition of the largest surfaces without moving domain
  rules into the client. The remaining visual calibration and route-density
  work is tracked separately by ISSUE-063 and ISSUE-065.

## [ISSUE-043] Expose the Bluesky connection flow through the supported web client

- Type: problem
- Status: resolved
- Evidence: The Bluesky backend vertical slice is integrated and tested, but the web
  client still exposes only manual, LinkedIn, and custom HTTP channel creation and
  connection controls. An operator cannot use the new provider through the supported
  dashboard without constructing raw API requests.
- Impact: A provider that exists only behind unadvertised routes is not an actionable
  built-in channel. Asking an operator to reproduce session cookies and OAuth redirects
  manually would create avoidable setup errors and would not exercise the intended
  product surface.
- Desired outcome: The authenticated web client can create a Bluesky channel, start the
  provider-owned OAuth flow with a handle, show the project-owned account destination,
  disconnect it, and report provider-specific readiness clearly. Local development uses
  the official AT Protocol loopback profile without a tunnel; deployed web OAuth uses
  HTTPS client metadata and an exact public callback. Development routing must expose the
  public metadata path only for the web profile.
- Scope boundary: This task wires the existing API contract into the web client. It does
  not redesign the web information architecture, add app-password authentication, or
  perform an uncontrolled real-provider publication in automated tests.
- Tasks: CHANNEL-77
- Related issue: ISSUE-040
- Related decision: ADR-036 (accepted)
- Resolution: The authenticated web client now creates Bluesky channels, starts
  the handle-based OAuth flow, renders the project-owned connected destination,
  and exposes disconnect handling through the supported dashboard. The runtime now
  supports both the official AT Protocol loopback profile for local development and
  the public HTTPS web profile for deployed instances. No publication was performed
  during the initial real-provider validation.

## [ISSUE-061] Make Bluesky OAuth deployment profiles explicit

- Type: enhancement
- Status: resolved
- Evidence: AT Protocol OAuth defines a local loopback client profile that does not
  need a publicly fetchable client metadata document, while Postbot's first Bluesky
  implementation required HTTPS metadata for every connection. That requirement was
  appropriate for the first public-web validation, but it forced local development
  through a tunnel and obscured the difference between Bluesky OAuth and providers
  with simpler token-based setup.
- Impact: A global DNS/HTTPS requirement would add unnecessary self-hosting friction,
  while silently accepting a loopback callback on mixed `localhost`/`127.0.0.1`
  origins would lose the host-bound Postbot session cookie during the callback.
- Desired outcome: Provider application settings expose an explicit Bluesky loopback
  mode and public HTTPS mode. Loopback mode creates the official AT Protocol native
  client metadata and uses a consistent loopback IP for the API, dashboard, and
  callback. Public mode keeps the stable HTTPS metadata and exact callback contract.
  Deployment documentation states provider-specific requirements without imposing
  DNS/HTTPS on all Postbot installations.
- Scope boundary: This does not add a proxy, a Bluesky client secret, or a second
  provider application system. It does not change public analytics, which remain
  independent of OAuth. Other providers retain their own callback and credential
  requirements.
- Tasks: PROVIDER-115
- Related issues: ISSUE-041, ISSUE-043, ISSUE-059
- Related decisions: ADR-036, ADR-056
- Resolution: Runtime-managed Bluesky applications now allow `clientMetadataUrl: null`
  as an explicit loopback mode, expose a derived `oauthMode` in the settings API,
  construct the official `http://localhost` AT Protocol client identifier with a
  `127.0.0.1` or `[::1]` callback, and keep the public metadata route unavailable in
  loopback mode. The web settings form offers localized loopback/public choices.
  SQLite migration `0024_sour_wolfsbane` updates the provider-application shape
  constraint without rewriting existing public configurations. Deployment guidance
  is recorded in `docs/deployment/provider-requirements.md`.
- Verification: Bluesky OAuth metadata, provider-application store, migration,
  runtime-origin, API, localization coverage, and package typecheck tests pass.

## [ISSUE-044] Preserve the AT Protocol OAuth state when PAR hides it from the authorization URL

- Type: problem
- Status: resolved
- Evidence: A live Bluesky authorization request uses a pushed authorization request
  (PAR). The official `@atproto/oauth-client` stores the generated OAuth state in its
  state store, while the returned authorization URL contains only `client_id` and
  `request_uri`. The web connection route previously attempted to read `state` from
  that URL and returned `provider_unavailable` before redirecting to Bluesky.
- Impact: The real Bluesky connection flow could not start against an OAuth server
  using PAR, despite the provider metadata, handle resolution, and Bun runtime being
  valid. This boundary is provider-critical because the callback must recover the
  exact state required for PKCE and DPoP validation.
- Desired outcome: The connection flow persists the exact internal OAuth state key
  produced by the provider client, independently of whether authorization parameters
  are returned directly or through PAR, and the callback continues to restore the
  encrypted provider state without exposing secrets.
- Tasks: CHANNEL-78
- Related issue: ISSUE-041

## [ISSUE-045] Define a durable domain-event contract without duplicating Postbot's history

- Type: proposal
- Status: resolved
- Evidence: Postbot already commits project-scoped `audit_events` atomically with
  publication, channel, credential, and execution transitions. The notification and
  analytics inventory identified a need for versioned facts that durable projections
  can consume, but the current records have no explicit schema version, correlation
  context, or typed read boundary.
- Impact: Treating process callbacks as an event bus would lose work after restart,
  while adding an independent event table would duplicate the same facts and force
  every state transition to maintain two append-only histories. Treating the audit API
  itself as a notification queue would instead conflate provenance, recipient state,
  and delivery reliability.
- Desired outcome: Keep one append-only SQLite journal and strengthen its records with
  an explicit event version and optional correlation and causation identifiers. Expose
  a framework-independent domain-event envelope and a private ordered journal reader
  for durable projections. Audit remains the operator-facing view; notifications and
  external deliveries own separate projections, cursors, deduplication, and retries.
- Scope boundary: Postbot does not become event sourced. Existing current-state tables
  remain authoritative, the public audit API keeps its current semantics, and EVENT-79
  does not introduce notification preferences or an external transport.
- Tasks: EVENT-79
- Related decisions: ADR-028, ADR-037
- Resolution: `audit_events` now persists an explicit event schema version, correlation
  context, and a non-reusable monotonic append sequence. A framework-independent event
  envelope rejects non-JSON and custom-serialization payloads, while the database
  package exposes an opaque-cursor reader isolated by project. Populated migration,
  append ordering, cursor reuse, transaction rollback, and public audit compatibility
  are covered by the repository gate.

## [ISSUE-046] Build a persistent notification inbox from durable project facts

- Type: proposal
- Status: resolved
- Evidence: Postbot now exposes a durable, versioned project fact journal, but users
  cannot yet receive or acknowledge actionable publication outcomes. Audit records do
  not contain recipients, preferences, presentation state, or delivery state and must
  not be repurposed as an inbox.
- Impact: Failures and ambiguous publication outcomes remain discoverable only by
  actively inspecting the queue or audit history. Adding Ntfy, Telegram, email, or
  another notification surface directly to workflow code would duplicate policy and
  weaken delivery recovery.
- Desired outcome: Project-scoped human actors receive idempotent persistent inbox
  items projected from an explicit allowlist of high-value event names and versions.
  Notification preferences and read/archive state are stored separately from the fact
  journal. Authenticated API operations expose the inbox without coupling delivery
  transports to publication workflows.
- Scope boundary: NOTIFY-80 does not add a web interface or external transport. It does
  not notify machine or system actors, make notifications event-sourced, or infer the
  source event actor as the recipient.
- Tasks: NOTIFY-80
- Related decisions: ADR-037, ADR-038
- Resolution: Postbot now projects a versioned allowlist of durable publication outcomes
  into project- and human-recipient-owned inbox items. Projection writes and cursor
  advancement are atomic, preferences suppress only future items, and read/archive
  operations remain idempotent and project-isolated. The authenticated API exposes
  stable keyset pagination, unread count, archived history, and preference management;
  machine credentials cannot impersonate a human notification recipient.

## [ISSUE-047] Deliver recipient notifications through optional external transports

- Type: proposal
- Status: resolved
- Evidence: Postbot now has a durable fact journal and recipient-owned in-app inbox, but
  no recoverable path can deliver selected outcomes to an external notification
  destination. Ntfy, Telegram, email, and webhook integrations would otherwise be
  tempted to call providers directly from publication or inbox code.
- Impact: External notification latency and failures could enter publication
  transactions, retries could duplicate visible messages, and transport-specific
  configuration could leak into the domain without a shared delivery boundary.
- Desired outcome: Project human actors can own optional transport destinations and
  per-kind subscriptions. A separate projector creates immutable delivery work from
  durable facts, and a reusable fenced executor handles leases, known-safe retries,
  permanent failures, and ambiguous outcomes without weakening publication workflows.
- Scope boundary: NOTIFY-81 proves the transport-neutral destination, subscription,
  outbox, and executor semantics with deterministic tests. It does not add web UI,
  send a real notification, or make Ntfy a core dependency; the Ntfy adapter and its
  authenticated management API follow in a separate task.
- Tasks: NOTIFY-81
- Related decisions: ADR-009, ADR-037, ADR-038, ADR-039

- Resolution: Postbot now persists project-human external destinations, explicit
  per-kind subscriptions, durable projection cursors, immutable delivery
  snapshots, atomic claims, lease recovery, and explicit retry/ambiguity
  semantics behind a reusable external-effect executor. No real transport,
  provider credential, or web UI was introduced. `NOTIFY-82` gates the secret
  boundary required before a provider adapter can be configured.

## [ISSUE-048] Add an encrypted secret boundary for external notification destinations

- Type: proposal
- Status: resolved
- Evidence: NOTIFY-81 deliberately stores only bounded public destination configuration;
  external delivery transports will eventually need bearer tokens, topic credentials,
  or other provider secrets. Persisting those values in the public configuration JSON
  would duplicate plaintext secrets into destination metadata and immutable delivery
  snapshots.
- Impact: A transport adapter introduced before a dedicated secret boundary could leak
  credentials through metadata reads, backups, logs, or delivery history.
- Desired outcome: External notification destinations expose safe metadata and retain
  provider credentials behind Postbot's deployment-owned encrypted-secret boundary.
  Delivery snapshots must reference the secret envelope without copying plaintext into
  public configuration or transport-neutral history.
- Scope boundary: This issue does not select a provider, credential format, or
  management API. It must be resolved before a real Ntfy, Telegram, email, or similar
  transport can be configured.
- Tasks: NOTIFY-82
- Related decisions: ADR-016, ADR-039, ADR-040
- Resolution: Postbot now stores versioned notification destination secret envelopes
  separately from public destination configuration. AES-256-GCM encryption is
  deployment-keyed and domain-separated from publisher credentials; projection stores
  only the secret row reference, and claimed delivery resolution checks project,
  destination, transport, lease, and claim token before decryption. Rotation retires
  the previous active version without changing already-projected deliveries. No real
  provider transport, management API, or UI was introduced.

## [ISSUE-049] Establish a user-facing localization foundation

- Type: proposal
- Status: resolved
- Evidence: The web client currently renders English UI copy directly in
  application components. It has no locale preference, translation catalog,
  fallback policy, or shared message-formatting boundary; locale-sensitive
  formatting is limited to scattered `Intl` calls and must not be confused with
  publication-content language metadata.
- Impact: Postbot cannot serve users who need another interface language, and
  continuing to add copy without a localization boundary will make later
  extraction expensive, increase bundle risk, and make product text harder to
  maintain safely across clients.
- Desired outcome: The authenticated web client has an explicit user-locale
  contract with a deterministic default and fallback, lazy-loadable catalogs,
  plural/select and date/number formatting, accessible language switching, and
  stable message identifiers that remain understandable in application code.
  API errors expose stable machine-readable codes and parameters rather than
  requiring clients to translate server-rendered prose. Publication-content
  language remains a separate domain concern.
- Tasks: I18N-95, I18N-99, I18N-100
- Resolution: I18N-95, I18N-99, and I18N-100 established the Paraglide
  localization boundary, migrated authenticated web copy and locale-aware
  formatting, enforced catalog coverage, and validated English/French switching
  in the browser. Translation quality, public-route localization, and a future
  persisted account preference remain separate follow-ups.

## [ISSUE-051] Give the notification inbox a non-blocking interaction surface

- Type: proposal
- Status: resolved
- Evidence: The current dashboard notification inbox is presented as a centered
  modal dialog with an overlay. The product direction is an operational workspace
  where notifications should be inspectable alongside the current task rather
  than temporarily replacing it.
- Impact: A modal notification surface interrupts queue, calendar, and compose
  work, hides context behind an overlay, and makes the inbox feel like a separate
  interruption instead of a persistent operational aid.
- Desired outcome: The notification inbox has an accessible contextual surface
  that preserves the current task, supports unread/read/archive actions, behaves
  coherently on desktop and narrow screens, and remains compatible with the
  existing persistent inbox API and future live-update contract. The exact
  component and visual treatment remain subject to the dedicated UX task.
- Tasks: DESIGN-97
- Related issues: ISSUE-046, ISSUE-050
- Resolution: DESIGN-97 and its follow-up implementation now expose the inbox
  as a contextual, non-blocking popover that keeps the current work surface
  visible while preserving loading, error, read/archive, preference, and
  accessibility behavior. Notification grouping and transient toast feedback
  remain outside this bounded correction.

## [ISSUE-052] Reduce explanatory repetition and operational information density

- Type: problem
- Status: resolved
- Evidence: Several authenticated surfaces repeat combinations of overline,
  icon, title, description, helper text, and container treatment. The owner
  reports that the resulting pages are difficult to scan and require more
  scrolling than the operational task warrants. The accepted design direction
  already treats descriptive heading elements as optional rather than a default
  formula.
- Impact: Users must read through presentation copy before reaching the next
  action, and important state can compete with repeated explanations. Local
  component simplifications risk producing inconsistent hierarchy if the rule is
  not made explicit and checked across the application.
- Desired outcome: Each operational surface has a clear primary task and a
  deliberate information hierarchy. Repeated explanatory copy is removed or
  moved to contextual help without hiding required state, recovery guidance,
  accessibility information, or the next action. The result is validated on
  realistic desktop and narrow-screen data rather than by isolated component
  screenshots.
- Tasks: DESIGN-98

## [ISSUE-053] Define project categories and publication tags

- Type: proposal
- Status: resolved
- Evidence: Postbot needs a way to organize publications beyond their channel,
  schedule, and lifecycle state. Categories and tags have been identified as
  useful product concepts, but their ownership, semantics, and query behavior
  have not been defined.
- Impact: Adding ad hoc labels in one screen could create incompatible
  filtering, calendar, queue, API, CLI, and future analytics behavior. A rushed
  model could also confuse a controlled category taxonomy with free-form tags.
- Desired outcome: Decide whether categories, tags, or both are needed; define
  their scope and ownership, naming and normalization rules, cardinality,
  permissions, lifecycle, filtering/search behavior, and client/API exposure.
  The design must remain useful for projects with many publications without
  turning organization into a second content model.
- Tasks: TAXONOMY-101, TAXONOMY-129, TAXONOMY-130
- Related decision: ADR-062
- Resolution: ADR-062 accepts one optional instance-scoped primary category per
  project and zero or more project-scoped tags per publication. Stable opaque
  identifiers, normalized uniqueness, archive/restore, and all-selected-tags
  filtering are the V1 boundaries. TAXONOMY-129 delivered the additive
  domain/SQLite/API foundation with project isolation, publication assignments,
  deterministic ordering, and archived-state handling. TAXONOMY-130 now exposes
  categories in project context, tags in Compose and publication detail, and
  stable-ID all-selected-tags filtering in Queue with URL state. The API also
  supports bounded repeated/comma-separated tag filters without N+1 reads. No
  provider hashtag behavior is inferred from these labels. Shared
  category-definition mutations retain the documented temporary human-session
  boundary until ACCESS-116 supplies the instance-admin authority.

## [ISSUE-054] Define an analytics foundation without coupling Postbot to provider dashboards

- Type: proposal
- Status: resolved
- Evidence: The provider-neutral analytics foundation has been identified in
  durable publication and execution events, but Postbot does not yet have an
  accepted read model, measurement vocabulary, retention policy, or explicit
  boundary for provider-supplied engagement data.
- Impact: Implementing charts or provider-specific counters ad hoc could create
  incompatible APIs, double-count lifecycle events, confuse operational
  delivery metrics with external engagement, and make future analytics harder
  to test or reconcile.
- Desired outcome: Define the first analytics contract from durable Postbot
  facts, including metric names, dimensions, time semantics, aggregation and
  retention rules, project authorization, API/read-model shape, and the
  boundary for optional provider analytics. The design must remain useful
  without external provider analytics and must not require a dashboard UI yet.
- Tasks: ANALYTICS-107, ANALYTICS-108
- Related issues: ISSUE-045, ISSUE-050, ISSUE-053, ISSUE-055
- Related decision: ADR-051
- Resolution: ANALYTICS-107 and ANALYTICS-108 established the provider-neutral
  operational analytics contract, measurement vocabulary, coverage semantics,
  project authorization, and typed read model. Provider-owned engagement remains
  outside this contract and is tracked separately; no dashboard or universal
  engagement score is inferred here.

## [ISSUE-055] Close historical analytics coverage gaps and measure read-model cost

- Type: problem
- Status: resolved
- Evidence: The first operational analytics read model now exposes explicit
  coverage gaps instead of inventing provider, schedule, or latency values.
  Facts written before the immutable metadata boundary can still lack provider
  and logical runtime snapshots, and some historical latency pairs remain
  incomplete. The query-time reader is bounded and row-streamed, but no
  representative history benchmark has established its latency or memory
  envelope.
- Impact: Legacy projects may have less useful historical dimensions than new
  projects, and a future projection could be introduced prematurely or too late
  without evidence from realistic journal sizes and workload shapes. Either
  mistake would make analytics harder to trust or add storage and rebuild
  complexity without a demonstrated need.
- Desired outcome: Postbot has a documented, repeatable way to distinguish
  recoverable historical metadata gaps from facts that must remain unknown;
  representative project histories have measured query-time latency and memory
  behavior; and the project can decide, using those results, whether a
  versioned replayable projection is justified behind the existing contract.
- Tasks: ANALYTICS-110
- Related issues: ISSUE-054
- Related decisions: ADR-051
- Resolution: ANALYTICS-110 added a repeatable isolated SQLite benchmark and
  exercised 1,000, 5,000, and 20,000-publication histories. Legacy provider,
  runtime, schedule, and latency gaps remain explicit in coverage counters;
  unknown event versions and unsupported facts are skipped without being
  fabricated. The query-time reader was tightened to stream current rows and
  retain compact outcome state. The V1 contract remains query-time for now;
  the 20,000-publication / 80,000-fact fixture measured roughly five seconds
  and +177 MiB RSS, so larger interactive histories require a dedicated scale
  decision rather than an implicit assumption.
- Verification: `scripts/benchmark-analytics.ts`, the focused analytics test
  suite, and the full repository gate. Follow-up scale work is tracked by
  ISSUE-057 / ANALYTICS-111.

## [ISSUE-056] Define provider-owned engagement analytics without conflating operational metrics

- Type: proposal
- Status: resolved
- Evidence: The current Postbot analytics contract measures operational facts
  created by Postbot: publication lifecycle, queue depth, attempts, retries,
  failures, ambiguity, recovery, and latency. The competitor review shows a
  separate product meaning for analytics. Postiz exposes per-channel and
  per-post time series with platform-dependent metrics such as followers,
  impressions, likes, comments, and shares. Mixpost presents reach,
  engagement, impressions, clicks, audience growth, and best-time analysis,
  with provider imports and backfills isolated from publication work. OpenPost
  explicitly makes analytics optional per connected account, separates its
  analytics interface from publishing and engagement interfaces, persists
  normalized account/content snapshots plus sync state, and treats missing
  values as unavailable rather than zero.
- Impact: Adding views, impressions, reach, clicks, reactions, or comments to
  the current provider-neutral operational response would mix two different
  sources of truth. Provider permissions, metric definitions, freshness,
  rate limits, billing, retention, and the identity of content published
  outside Postbot would become implicit and difficult to test. A generic
  `metric: number` model could also present incomparable values as if they
  were directly comparable.
- Desired outcome: Define a provider-owned engagement analytics boundary that
  specifies account and publication subjects, provider metric semantics and
  units, observation windows and timestamps, freshness and availability
  states, permissions and scopes, collection cadence and retry/backoff,
  retention/privacy, provider-content discovery, and the API/read-model
  boundary. The operational analytics contract remains unchanged and useful
  when engagement analytics are unavailable.
- Scope boundary: This issue does not select a provider, add a provider
  adapter, request real credentials, add a dashboard, or require a universal
  cross-provider engagement score. Provider metrics remain optional and
  provider-owned until their semantics and access requirements are documented.
- Tasks: ANALYTICS-109
- Related issues: ISSUE-054, ISSUE-055
- Related decisions: ADR-051
- Resolution: ANALYTICS-109 accepts a separate provider-owned observation
  boundary with provider-specific subjects, metrics, freshness, availability,
  permissions, cadence, retention, and discovery semantics. The bounded Bluesky
  slice proves the first provider-specific path without creating a universal
  engagement score; cadence and broader provider coverage remain follow-ups.
- Research sources:
    - https://docs.postiz.com/public-api/analytics/platform
    - https://docs.postiz.com/public-api/analytics/post
    - https://mixpost.app/features
    - https://docs.mixpost.app/guides/horizon/
    - https://docs.openpost.social/development/analytics
    - https://docs.openpo.st/usage/analytics

## [ISSUE-057] Harden operational analytics reads for large project histories

- Type: problem
- Status: resolved
- Evidence: ANALYTICS-110 measured the current operational analytics read model
  on isolated SQLite fixtures. ANALYTICS-111 then removed order-only temporary
  sorts from current snapshots, cached the expensive timezone formatter used by
  historical buckets, and replaced one per-attempt action `Set` with a compact
  bit mask. On the same synthetic fixture, 20,000 publications and 80,160 facts
  now measure 565 ms warm median and 580 ms p95; the first read adds about 115
  MiB RSS after an explicit garbage collection. Repeated reads remain a stress
  case at about 281 MiB RSS after two warmups and nine samples, so this is not a
  claim of an unlimited analytics history or of a leak-free native allocator.
- Impact: A large project can make the interactive analytics endpoint slow and
  memory-heavy even though the response contract is correct. Adding a
  projection blindly would introduce rebuild, cursor, retention, and
  consistency complexity; leaving the boundary implicit risks a poor product
  experience at realistic history sizes.
- Desired outcome: Reduce the query-time aggregate cost with measured changes,
  define the supported interactive history envelope, and then decide whether a
  versioned replayable projection is justified by retention, refresh, and
  concurrency requirements. The operational contract and truthful coverage
  semantics must remain stable throughout.
- Scope boundary: This issue does not add provider-owned engagement metrics,
  change the analytics API contract, add a dashboard, or introduce a broker or
  external service without a separately accepted decision.
- Tasks: ANALYTICS-111
- Related issues: ISSUE-054, ISSUE-055, ISSUE-056, ISSUE-058
- Related decisions: ADR-051, ADR-053, ADR-054
- Resolution: The query-time V1 read model remains the default and its public
  contract and truthful coverage semantics are unchanged. The provisional
  interactive benchmark envelope is at most 5,000 publications and 20,000
  historical facts per request on the current reference fixture; 20,000
  publications is retained as a stress boundary. No runtime rejection or API
  limit was introduced. A replayable SQLite projection is deferred to
  ANALYTICS-113 until retention, refresh frequency, concurrency, and a
  representative workload justify its lifecycle cost.
- Verification: `bun run benchmark:analytics` with explicit first-read and
  post-refresh memory measurements, the focused analytics tests, the package
  typecheck, and the full repository gate.

## [ISSUE-058] Add a replayable analytics projection beyond the interactive envelope

- Type: proposal
- Status: resolved
- Evidence: ANALYTICS-111 establishes a provisional query-time envelope of 5,000
  publications / 20,000 historical facts per interactive request. Larger
  histories can still be read, but repeated reads retain material process RSS
  in the benchmark and should not silently become an unlimited dashboard
  contract.
- Impact: A future projection can reduce repeated replay cost, but it also
  introduces a durable cursor, rebuild/backfill semantics, freshness and
  retention policy, crash recovery, and a consistency boundary with SQLite.
  Starting it before those requirements are measured would create a second
  read lifecycle without a demonstrated product need.
- Desired outcome: Design and, if justified by a representative workload,
  implement a versioned replayable projection behind the existing analytics
  contract. It must remain rebuildable from SQLite's journal, expose freshness
  and coverage truthfully, and define resource limits before any optional
  DuckDB engine is considered.
- Scope boundary: This issue does not add DuckDB, change the public analytics
  contract, add provider engagement metrics, or introduce an external service.
- Tasks: ANALYTICS-113
- Related issues: ISSUE-054, ISSUE-055, ISSUE-057
- Related decisions: ADR-053, ADR-054, ADR-060
- Resolution: ADR-060 defines the accepted replay boundary: SQLite remains the
  source of truth, the projection is versioned and rebuildable from the durable
  journal, cursor advancement and facts are idempotent, and freshness,
  retention, crash recovery, and coverage are explicit. This merge records the
  design only; no projection runtime or DuckDB dependency is introduced before
  a representative workload justifies it.

## [ISSUE-059] Remove runtime friction from provider application configuration

- Type: problem
- Status: resolved
- Evidence: Postbot currently reads LinkedIn, X, and Bluesky OAuth application
  configuration from environment variables during API startup. A missing
  configuration causes the provider connection action to return unavailable,
  even though the user is trying to connect a normal business account or
  destination. The current project-owned credential and connection model already
  separates provider accounts from channels, but it does not yet separate the
  provider application used to authorize them.
- Impact: Requiring an operator to edit `.env` and restart Postbot for a new
  provider application creates the same self-hosting friction we explicitly do
  not want to reproduce from Postiz. It also obscures the distinction between
  installation bootstrap secrets, OAuth application configuration, connected
  account credentials, and channel destinations. A one-provider or one-channel
  limit would prevent legitimate projects from managing several LinkedIn pages
  or accounts together.
- Desired outcome: A running Postbot instance can register and update one or more
  provider application configurations through an authorized setup surface, then
  use them immediately for OAuth connections without an application restart.
  Provider accounts remain encrypted project-owned credentials, channels remain
  independently addressable destinations, and no arbitrary provider/account/
  channel cardinality limit is introduced. Provider-specific permission and
  destination constraints remain explicit and truthful.
- Scope boundary: Deployment bootstrap values such as the database location,
  session secret, publisher encryption root key, listener address, and public
  origin remain valid environment configuration. This issue does not remove the
  need to register an application and callback with an external provider, and it
  does not make provider policies or approval requirements disappear.
- Tasks: CRED-19, CRED-20
- Related issues: ISSUE-006, ISSUE-040, ISSUE-041, ISSUE-060
- Related decisions: ADR-012, ADR-031, ADR-033, ADR-041, ADR-044, ADR-045,
  ADR-056
- Resolution: Runtime-managed provider applications are now available through
  authenticated settings API routes and the web surface at
  `/dashboard/settings/provider-applications`. Postbot supports multiple
  LinkedIn, Bluesky, and X application configurations per instance, encrypted
  client secrets, active/default state, and immediate OAuth resolution without
  an API restart. Existing environment-backed configuration remains a
  compatibility/bootstrap path. Provider account credentials and channel
  destinations remain separate, and no one-channel or one-account limit was
  introduced. Explicit non-default application selection is covered by
  CRED-20 and ISSUE-060.
- Verification: PR #131 merged the runtime/API and migration work; PR #132
  merged the authenticated web settings surface; PRs #133 and #134 completed
  the API and channel UI selection flow. The full repository gate and CI Verify
  passed for the integrated changes.

## [ISSUE-060] Select a provider application explicitly for a channel connection

- Type: enhancement
- Status: resolved
- Evidence: Runtime provider applications now support multiple active
  configurations and a default per provider, but the channel OAuth start
  routes currently use only that default. The persisted OAuth attempt and
  publisher credential already retain the selected application identity.
- Impact: An operator with several LinkedIn, Bluesky, or X applications must
  temporarily change the provider default to start a connection with a
  non-default application. That is workable, but it is unnecessary friction
  and makes API/CLI automation less explicit.
- Desired outcome: Channel OAuth start routes accept an optional
  `providerApplicationId`, validate that it belongs to the requested provider
  and is active, and pin it to the authorization attempt and resulting
  project-owned credential. Omitting it continues to resolve the active
  provider default. The web channel connection UI exposes the same choice
  whenever more than one active application exists for LinkedIn or Bluesky.
- Scope boundary: This does not make provider applications project-owned, does
  not bypass provider permissions, and does not change the one-publisher-per-
  channel invariant. Invalid, disabled, or cross-provider application ids must
  fail closed without falling back to another application.
- Tasks: CRED-20
- Related issues: ISSUE-059
- Related decisions: ADR-056
- Resolution: LinkedIn, Bluesky, and X OAuth start routes now accept an
  explicit active application id and fail closed for invalid, disabled, or
  cross-provider ids. The channel management UI loads active runtime-managed
  applications and offers a localized selector for LinkedIn and Bluesky only
  when multiple choices exist; with one application, the existing default
  flow remains unchanged. The selected application remains pinned by the
  existing authorization-attempt and project-owned credential boundary.
- Verification: PR #133 merged the API and typed-client support. The follow-up
  web implementation passes the complete repository format, lint, typecheck,
  unit, E2E, and build gate; English and French catalogs both remain at 100%
  coverage.

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

## [ISSUE-067] Establish a clean development access baseline

- Type: problem
- Status: resolved
- Evidence: Postbot is a private, unused development application with no database
  file or deployed user data in the repository. The Better Auth cutover had
  temporarily kept project-membership, mixed invitation, and Postbot bearer-token
  compatibility paths solely to support a hypothetical deployed upgrade.
- Impact: Retaining those paths would make the development model harder to reason
  about, keep untested authorization branches alive, and force every future schema
  change to carry an unnecessary historical migration chain.
- Desired outcome: The current codebase starts from one generated Drizzle baseline,
  uses Better Auth Organization members/invitations for project access and user-owned
  API keys for external callers, and keeps only the Postbot-owned instance boundary
  and actor projection that have independent domain meaning.
- Tasks: ACCESS-133, ACCESS-135
- Related decisions: [ADR-064](decisions/ADR-064-clean-development-access-baseline.md)
- Resolution: The old project access tables, legacy project bearer-token store,
  retirement marker, and runtime compatibility branches were removed. Instance
  invitations now use a dedicated table, the migration directory contains one
  generated baseline, and the test suite verifies that obsolete tables cannot appear
  in a fresh database. A database file is intentionally not reset by application
  code; a stale disposable local file must be moved aside explicitly.

## [ISSUE-068] Enforce the accepted project role boundary on every mutation

- Type: problem
- Status: resolved
- Evidence: The 2026-09-11 foundation audit reproduced a project member with the
  Better Auth `viewer` role receiving `201 Created` from both channel creation and
  post creation. The same fixture received `403` for the existing project timezone
  mutation, proving that the role is known but not enforced consistently. See the
  [security audit](worklogs/2026-09-11-postbot-audit/01-security-and-access.md).
- Impact: A principal explicitly granted read-only access can modify project
  content and potentially influence downstream publication work. The current
  route-level test coverage can therefore pass while the product-wide role contract
  remains false.
- Desired outcome: Every project operation accepts only a principal with the
  current capability required by that operation; read-only members cannot mutate
  project state, valid editors and owners retain their intended operations, and
  denied requests leave no durable or external side effect.
- Tasks: ACCESS-143
- Related issues: ISSUE-013, ISSUE-062, ISSUE-067
- Related decisions: ADR-061, ADR-064
- Resolution: A shared project-role guard now protects every project content,
  channel, profile, media, taxonomy, delivery, and provider-analytics mutation.
  It runs before the domain store or external provider flow, so viewers receive
  403 without side effects while editors and owners retain their capabilities.
  Owner-only membership, project-setting, and API-key operations remain explicit
  human-session boundaries. The lifecycle integration test covers viewer denial,
  editor success, removed access, and user-API-key restrictions.

## [ISSUE-069] End or reauthorize project event streams after access revocation

- Type: problem
- Status: resolved
- Evidence: The audit opened a project SSE stream as a viewer, removed the
  membership, confirmed a new project read was rejected, and then observed a later
  `channel.created` event on the already-open stream. The stream currently checks
  access at connection time but does not revalidate the principal during its
  lifetime. See the [security audit](worklogs/2026-09-11-postbot-audit/01-security-and-access.md).
- Impact: Revoked members can continue observing project identifiers, event types,
  subjects, and timestamps. The reproduction did not expose post text, tokens, or
  provider responses, but it violates the expected lifetime of a revoked project
  access grant.
- Desired outcome: A project event stream stops exposing project facts after a
  revoked, expired, disabled, or logged-out principal is no longer authorized, and
  every reconnect performs the complete current access check within an explicit
  bounded delay.
- Tasks: REALTIME-144
- Related issues: ISSUE-050, ISSUE-064, ISSUE-068
- Related decisions: ADR-048, ADR-050
- Resolution: Project SSE streams revalidate the Better Auth session and current
  project membership before each journal read and again before serving the
  resulting batch. A failed check emits a terminal `project.access-revoked`
  signal and closes the stream; the browser consumes that signal and disables
  automatic reconnection. The default recheck bound is the existing 15-second
  heartbeat interval, and the stream tests cover fail-closed revocation.

## [ISSUE-071] Make notification projection catch up completely after a delay

- Type: problem
- Status: resolved
- Evidence: The notification projection runtime stops after ten batches even when
  the store reports more work and returns to `started`. Production constructs the
  runtime without a recovery interval, so a backlog larger than the bounded pass can
  remain unprojected until another signal or restart. The audit reproduced twelve
  required batches as ten processed with state `started`. See the [reliability
  audit](worklogs/2026-09-11-postbot-audit/02-reliability-data-and-operations.md).
- Impact: The durable fact journal remains intact, but the user-global notification
  inbox can be stale or incomplete while readiness still reports the runtime as
  active. Recovery after interruption is therefore not guaranteed by the current
  projection lifecycle.
- Desired outcome: A bounded notification projection eventually processes all
  eligible durable facts after interruption or transient failure, exposes meaningful
  lag or failure state, and does not block the API with an unbounded synchronous loop.
- Tasks: NOTIFY-146
- Related issues: ISSUE-046, ISSUE-050, ISSUE-066
- Related decisions: ADR-038, ADR-058, ADR-059
- Resolution: The projection runtime keeps the per-run ten-batch bound but
  schedules an asynchronous continuation whenever a project still reports work.
  It also schedules delayed retry after a transient failure, merges project
  wakeups without overlapping runs, cancels pending work on stop, and exposes a
  `recovering` or `failed` state instead of silently returning to `started`.
  Runtime tests cover backlog continuation and lifecycle behavior.

## [ISSUE-072] Deliver taxonomy changes through the realtime contract

- Type: problem
- Status: resolved
- Evidence: Taxonomy mutations append `project_tag.*` and
  `publication.tags_replaced` facts, but those event names are absent from both the
  server and browser realtime allowlists. The real `publication.tags_replaced`
  event is therefore converted to no client event. See the [client architecture
  audit](worklogs/2026-09-11-postbot-audit/03-architecture-client-and-quality.md).
- Impact: Another tab or session can retain stale tags, filters, and publication
  data indefinitely because the project query uses an infinite stale time and relies
  on realtime invalidation or an explicit local action.
- Desired outcome: Every committed taxonomy mutation that affects a visible project
  resource either produces a supported realtime invalidation event or causes a
  deterministic resynchronization, with server and client event contracts kept in
  agreement.
- Tasks: REALTIME-147
- Related issues: ISSUE-050, ISSUE-053, ISSUE-063, ISSUE-066
- Related decisions: ADR-050, ADR-062
- Resolution: Project-tag creation, rename, archive, restore, and publication
  tag replacement are now present in both the server and browser realtime
  allowlists. The existing empty-payload contract is preserved; the web bridge
  invalidates project data, publication data, and notifications deterministically
  for the affected resource. Server and browser tests exercise the taxonomy
  event contract.

## [ISSUE-073] Keep migration sources outside ordinary build cleanup

- Type: problem
- Status: resolved
- Evidence: `packages/db/package.json` defines `clean` as `rimraf dist .turbo drizzle`,
  while `drizzle` contains the committed migration SQL and metadata. The audit did
  not execute the destructive command against the repository, but the script and
  tracked files establish the behavior statically. See the [reliability audit](worklogs/2026-09-11-postbot-audit/02-reliability-data-and-operations.md).
- Impact: A normal cleanup can remove the source history required for a fresh
  startup or package build. Git can restore committed files, but a local migration
  that has not been committed is not recoverable through that path.
- Desired outcome: Routine cleanup removes only disposable build outputs; any
  deliberate migration reset is a separately named, explicit, documented operation
  and cleanup is proven safe in a disposable clone.
- Tasks: OPS-148
- Related issues: ISSUE-001, ISSUE-008, ISSUE-026, ISSUE-067
- Related decisions: ADR-005, ADR-064
- Resolution: The database package cleanup now removes only `dist` and `.turbo`;
  the committed Drizzle migration directory is outside ordinary cleanup. A
  disposable clean verification preserved the baseline SQL and migration journal
  byte-for-byte.

## [ISSUE-074] Include repository-level test families in the standard quality gate

- Type: problem
- Status: resolved
- Evidence: `bun run check` reaches workspace tests through Turbo but does not run
  the eight tests under `scripts/`; those tests are only green when invoked
  separately with `bun test scripts`. The audit confirmed the omission in the Turbo
  task graph and the root package scripts. See the [client and quality audit](worklogs/2026-09-11-postbot-audit/03-architecture-client-and-quality.md).
- Impact: Regressions in the CLI and runtime-isolation helpers can merge while the
  repository's advertised check remains green. This weakens confidence in the same
  orchestration paths used by local development and browser validation.
- Desired outcome: The normal repository quality gate executes every required test
  family, including root-level scripts, and a deliberate regression in that family
  fails the gate.
- Tasks: QUAL-149
- Related issues: ISSUE-017, ISSUE-025, ISSUE-066
- Related decisions: ADR-029
- Resolution: The root `test:unit` command now runs the Turbo workspace suites
  and the dedicated `test:scripts` command. The eight CLI and runtime-isolation
  tests pass through that explicit gate, so root script regressions are no longer
  outside the normal repository check.

## [ISSUE-075] Prove graceful runtime shutdown and durable restart recovery

- Type: problem
- Status: resolved
- Evidence: The foundation audit's medium-term follow-up identified shutdown during
  a provider effect, notification projection, or media reconciliation as unverified.
  `NextEventScheduler.stop()`, the publication worker, and media maintenance stop
  scheduling synchronously, while the production entrypoint closes the database
  immediately afterward. Existing tests cover idle cleanup and restart-readable
  state, but do not prove that in-flight work drains before the database and runtime
  lock are released.
- Impact: A SIGTERM during an external effect can close SQLite while the worker is
  still completing its durable outcome, or can leave a provider/media operation
  without a clear final checkpoint. A process that exits without a durable final
  state must be recoverable on restart without claiming that an unknown external
  effect was successful.
- Desired outcome: Graceful shutdown prevents new work, waits for in-flight worker,
  projection, and media maintenance operations to settle before closing resources,
  and releases the runtime boundary only after that drain. Restart tests must prove
  durable job recovery, notification projection recovery, media maintenance
  lifecycle, and an explicit behavior for forced-stop leftovers.
- Scope boundary: This issue proves the existing single-process lifecycle and
  recovery contracts; it does not introduce a supervisor, a distributed lock,
  provider-specific cancellation APIs, or a new deployment architecture.
- Tasks: OPS-150
- Related issues: ISSUE-012, ISSUE-026, ISSUE-067
- Related decisions: ADR-005, ADR-038, ADR-058, ADR-064
- Resolution: The scheduler now stops planning new work and exposes an async
  drain barrier; the worker and media maintenance propagate it, and production
  awaits those drains before closing SQLite or releasing the runtime lock.
  Restart, notification projection, workflow lease, backup/restore, and stale
  lock tests preserve durable recovery and explicit forced-stop handling.

## [ISSUE-076] Prove fair multi-project execution and provider media boundaries

- Type: risk
- Status: resolved
- Evidence: The publication worker currently iterates projects sequentially and
  drains one project's due jobs in an unbounded inner loop before it visits the
  next project. The provider conformance suite and MediaStore contract suite use
  deterministic doubles, but no representative fixture proves that a busy
  project cannot delay another project indefinitely, or that provider/media
  fault paths preserve their durable checkpoints together.
- Impact: A project with a large ready backlog can monopolize the single worker and
  make another project's scheduled publication late even when both are due. A
  green provider or S3-shaped test can also hide a missing error/checkpoint
  contract if the failure path is not exercised explicitly.
- Desired outcome: The single worker services projects with a bounded round-robin
  quantum, preserves serial external effects and lease fencing, and has
  representative provider/media fault tests that distinguish durable outcomes
  from unknown external outcomes. Deployment-specific cloud behavior remains an
  explicit verification boundary rather than an unearned claim.
- Scope boundary: This issue does not add concurrent workers, a broker, a
  distributed scheduler, live provider credentials, or a required cloud service.
- Tasks: OPS-151
- Related issues: ISSUE-028, ISSUE-067, ISSUE-075
- Related decisions: ADR-005, ADR-019, ADR-038, ADR-064
- Resolution: The publication worker now services each project with a bounded
  round-robin quantum instead of draining one project's due backlog before
  visiting the next. Serial provider effects, project-scoped actor leases, and
  claim fencing remain unchanged. Existing provider fault coverage exercises
  success, retryable, failed, and ambiguous outcomes; local and S3-shaped
  MediaStore contract coverage exercises atomic replacement and failed writes
  without leaving partial objects. These checks remain deterministic and do not
  claim live cloud-provider behavior.

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
- Status: accepted
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

## [ISSUE-108] Align quality gates with the repository test topology

- Type: problem
- Status: resolved
- Evidence: The supplied audit questions whether root-level script tests are included consistently in local hooks, CI, and the standard check, and whether the complete gate is unnecessarily duplicated.
- Impact: A green local check may fail to represent the checks required before integration, while an over-broad hook can discourage ordinary commits.
- Desired outcome: Each quality gate has an explicit purpose, stable coverage, and a documented relationship between local, CI, and release validation.
- Tasks: OPS-193
- Resolution: `check:quick` is the bounded local pre-commit path. `check` runs
  format, lint, typecheck, unit tests, browser tests, and build; CI invokes that
  complete path. Root script tests are included through `test:unit`, so the
  reported topology gap is not reproduced in the current checkout.

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
- Status: accepted
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

## [ISSUE-112] Prove authorization coverage across route families

- Type: problem
- Status: resolved
- Evidence: The supplied audit questions whether project mutation, analytics, and publisher routes consistently enforce the same role and subject boundary.
- Impact: A route that relies on a caller-selected subject or an incomplete guard could permit unauthorized writes or cross-project reads.
- Desired outcome: Every route family has an explicit authorization contract, consistent enforcement, and tests for the relevant actor and project boundaries.
- Tasks: SECURITY-198
- Resolution: The shared authentication macro separates sessions and user-owned
  API keys. Project scope is checked before route handlers; project role checks
  protect mutations and access-management routes;
  provider and analytics routes have explicit subject/project checks; existing
  boundary tests cover unauthorized and cross-project cases. The reported
  inconsistency is not reproduced in the current source.

## [ISSUE-113] Reauthorize global user event streams after session or membership changes

- Type: problem
- Status: resolved
- Evidence: The supplied audit reports that a long-lived user notification stream may remain open after session expiry or loss of all relevant project memberships.
- Impact: A connected client could continue receiving events after its authentication or visibility authority is no longer valid.
- Desired outcome: Long-lived user event streams stop or reauthorize within a defined contract after authentication or access changes.
- Tasks: REALTIME-194
- Resolution: User streams now revalidate the session and visible project set on
  pulls, emit a terminal `user.access-revoked` frame, close the server stream,
  and close the browser source. Focused API and web tests cover the contract.

## [ISSUE-114] Define and connect external notification delivery

- Type: problem
- Status: accepted
- Evidence: The supplied audit reports a durable notification-delivery store that is exported and tested but not connected to an external transport.
- Impact: The repository can persist delivery intent without providing an operator-visible path to deliver or reconcile it.
- Desired outcome: Supported external notification destinations, ownership, transport, retry, ambiguity, and observability semantics are explicit and exercised end to end.
- Tasks: NOTIFY-199
- Current classification: The durable delivery store is real and tested, but no
  external destination is part of the current Postbot product contract. The owner
  explicitly deferred Ntfy, Telegram, and other real adapters for now, without
  ruling them out permanently. A recording in-memory transport verifies the
  delivery seam without network access; revisit real adapters when a concrete
  destination is requested.

## [ISSUE-115] Define durable email failure handling

- Type: problem
- Status: accepted
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

## [ISSUE-116] Prove worker fairness and multi-process execution policy

- Type: problem
- Status: resolved
- Evidence: The supplied audit questions project scheduling fairness, timer behavior, claim races, and the absence of runtime execution metrics.
- Impact: A busy project or multiple process instances could delay or duplicate external effects, while operators lack evidence about backlog and claim health.
- Desired outcome: The supported worker topology, fairness guarantees, lease behavior, shutdown semantics, and operational measurements are explicit and tested.
- Tasks: WORKFLOW-201
- Current classification: The worker uses bounded round-robin service, atomic
  lease-fenced claims, and awaited scheduler drain behavior. The supported
  deployment remains one process and one worker; multi-process execution is not
  claimed. Runtime metrics are tracked separately under ISSUE-122.
- Resolution: ADR-003 defines the current single-process boundary. OPS-150
  verifies graceful shutdown and durable restart recovery; OPS-151 verifies
  round-robin fairness, lease-fenced claims, retries, cancellation, and
  ambiguous outcomes in a local provider sandbox. No evidence justifies adding
  multi-process coordination. Observability remains separately tracked under
  ISSUE-122.

## [ISSUE-117] Enforce the repository language boundary and vocabulary

- Type: problem
- Status: resolved
- Evidence: The supplied audit reports French text outside translation catalogs, inconsistent Post/Publication vocabulary, and identical untranslated catalog values.
- Impact: Repository artifacts become harder to review and localization drift can enter unnoticed.
- Desired outcome: Non-translation repository artifacts remain English, application translations remain catalog-owned, and intentional identical localized values are explicit and reviewable.
- Tasks: TOOLING-190
- Resolution: CSpell now owns the repository spelling gate; the translation
  catalogs and generated localization output are excluded, and intentional
  identical localized values are allowlisted by the i18n coverage check. The
  cache-reset spelling run, full lint, typecheck, unit tests, browser suite, and
  production build all pass.

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

## [ISSUE-122] Define an operational observability contract

- Type: problem
- Status: resolved
- Evidence: The supplied audit reports health/readiness checks and domain analytics but no accepted metrics, tracing, dashboards, or alert thresholds.
- Impact: Operators may detect failures only after users report them and cannot distinguish backlog, provider, notification, or storage degradation quickly.
- Desired outcome: Supported deployments have a bounded observability contract tied to concrete service-level and recovery goals.
- Tasks: OPS-207
- Resolution: OPS-207 adds an unauthenticated Prometheus scrape endpoint backed
  by the approved Prometheus JavaScript client, with process CPU, memory, and
  uptime measurements plus fixed-cardinality scheduler and worker metrics. No
  user, workspace, project, channel, or provider identifiers are emitted. The
  deployment guide requires network-level restriction of the scrape endpoint.
  Scrape cadence, retention, dashboards, and alert thresholds remain
  deployment-owned; no hosted monitoring service was added.

## [ISSUE-123] Define production deployment and recovery boundaries

- Type: problem
- Status: resolved
- Evidence: The supplied audit reports a production image and development Mailpit compose file but no complete production orchestration, TLS, backup retention, or restore policy.
- Impact: Operators may deploy a technically runnable image without a supported secure lifecycle for networking, persistence, and recovery.
- Recent revalidation (2026-09-25): The documented Docker `backup --media` and
  `restore --media` commands start the production entrypoint without an env file.
  The entrypoint constructs the complete server configuration before dispatching
  maintenance, and that configuration rejects the image defaults because the
  authentication, signed-media-URL, and publisher-encryption secrets are absent.
  This was reproduced with the production environment values declared by the
  Dockerfile and `createPostbotConfig`; the commands therefore cannot run as
  documented. This finding reopens the operational recovery contract; it does
  not invalidate the historical implementation work below.
- Desired outcome: Supported deployment modes state their network, secret, persistence, retention, upgrade, and restore responsibilities, and the documented backup/restore commands execute successfully against the production image with only the configuration each operation actually needs.
- Tasks: OPS-208, OPS-213
- Previous resolution (OPS-208): The repository documents the supported single-process container,
  health/readiness checks, development-only Mailpit, database/media backup and
  restore commands, runtime locking, and separate publisher-key recovery. Full
  orchestration, TLS termination, and retention remain deployment-owned concerns
  rather than undocumented application behavior.
- Resolution (OPS-213, 2026-09-25): Maintenance commands now parse only the
  database and media-store configuration they need. The local media bundle
  commands run without server secrets; S3 credentials remain validated when S3
  storage is configured. README instructions match this contract, and CI builds
  and starts the production image, backs up, restores, and starts the restored
  database using disposable data.

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

## [ISSUE-125] Protect the optional Prometheus scrape endpoint

- Type: problem
- Status: resolved
- Evidence: `GET /metrics` is mounted on the same HTTP server as the public API
  and has no authentication. The deployment guide asks operators to restrict it,
  but the application does not enforce that boundary.
- Impact: A public Postbot deployment can expose process and publication-worker
  activity to unauthenticated callers, and the scrape handler can be repeatedly
  invoked from the public network.
- Desired outcome: Operators can intentionally enable metrics and allow only
  authenticated monitoring scrapes, with clear setup and verification guidance.
- Tasks: OPS-212
- Resolution: `/metrics` is absent by default and requires a dedicated bearer
  token of at least 32 characters when enabled. HTTP tests cover disabled,
  unauthorized, and authenticated scrapes, including changing worker metrics;
  deployment guidance documents configuration and network restrictions.

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
  substitute. See the [OPS-217 worklog](worklogs/2026-09-26-OPS-217.md).

## [ISSUE-128] Log unexpected HTTP failures in production by default

- Type: problem
- Status: resolved
- Evidence: Production defaults `LOG_LEVEL` to `silent`, which disables the
  request-logger error hook. The global HTTP error handler returns a generic
  500 response but does not independently log unexpected exceptions.
- Impact: An operator can receive a server error without a corresponding
  diagnostic record, making a self-hosted failure difficult to investigate.
- Desired outcome: Unexpected server failures produce structured, correlated
  and secret-redacted error records in production while successful request
  logging can remain disabled and clients continue to receive generic errors.
- Tasks: OPS-216
- Resolution: Production now defaults to `LOG_LEVEL=error`: successful request
  records remain below the threshold, while unexpected 5xx responses emit one
  structured Pino record with a generated request ID, route template, safe error
  type, and bounded stack frames that omit the exception message. Dynamic route
  values such as signed media tokens are not logged, the generic client error
  response is unchanged, and `LOG_LEVEL=silent` remains an explicit full opt-out.

## [ISSUE-129] Verify dashboard delivery from the production image

- Type: problem
- Status: resolved
- Evidence: The CI recovery acceptance test now builds and starts the production
  image, checks `/ready`, and exercises backup and restore. It does not request
  the dashboard entry point or verify that its referenced assets are served by
  that image.
- Impact: A healthy API and successful recovery test could still miss a broken
  production static-asset path that prevents users from loading Postbot.
- Desired outcome: CI verifies the production image serves the dashboard shell
  and its built assets, in addition to the existing readiness and recovery
  checks.
- Tasks: OPS-218
- Related issue: ISSUE-123
- Related task: OPS-213
- Resolution (OPS-218, 2026-09-26): The existing production-image acceptance
  command now fetches the root dashboard document, checks its Postbot title and
  application root, discovers its same-origin built asset references, and
  requests each one. It verifies successful responses, non-empty bodies, and
  JavaScript/CSS content types. The check runs against both the initial and
  restored production containers; CI already invokes this command, so no new
  workflow step was needed.
- Verification: The production image served the dashboard shell and all 17
  referenced assets before backup and after restore. Missing-asset and wrong-shell
  behavior are unit tested. See the [OPS-218 worklog](worklogs/2026-09-26-OPS-218.md).

## [ISSUE-130] Complete the X connection journey in the web client

- Type: problem
- Status: resolved
- Evidence: The API exposes the X authorization start/callback flow and the web
  API client exposes `startXPublisherConnection`, but the authenticated channel
  connection surface has no corresponding X connection action.
- Impact: A supported built-in provider is not fully operable through Postbot's
  primary client, even though the provider and API path exist.
- Desired outcome: A user can initiate, complete, cancel, and recover the X
  connection flow from the web client, with explicit provider-application
  requirements and browser coverage.
- Tasks: CHANNEL-222
- Related issue: ISSUE-041
- Related decision: ADR-044
- Resolution (CHANNEL-222, 2026-09-26): Added X to channel creation and connected
  its connect/reconnect action to the existing OAuth API. The administrator
  configuration form now displays the server's exact X redirect URI and PKCE
  setup guidance; project editors use the instance's default application
  without calling the admin-only configuration endpoint. The callback continues
  through the shared connection feedback and recovery surface.
- Verification: `e2e/channel-x-connection.spec.ts` covers X channel creation,
  callback setup guidance, missing-configuration error, cancellation, denial,
  success, and reconnect using mocked browser/provider responses.
  `apps/api/src/app.test.ts` covers the actual API OAuth state, PKCE, callback,
  denial, provider errors, and revoked-connection reconnect with mocked provider
  transport. No live X credentials or requests were used. See the
  [CHANNEL-222 worklog](worklogs/2026-09-26-CHANNEL-222.md).

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
  verification matrix](../docs/capability-evidence.md), covering current web,
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
  [user API key policy](../docs/security/user-api-keys.md).

## [ISSUE-140] Let user-owned API keys narrow project actions

- Type: accepted proposal
- Status: resolved
- Evidence: Postbot API keys are owned by a user and inherit that user's current
  project roles, while the existing optional project subset further narrows
  access. The Better Auth API-key record already has a nullable native
  `permissions` field, but Postbot neither exposes nor enforces action-level
  limits. The owner approved an optional capability ceiling on 2026-09-27.
- Impact: A copied key currently carries every project action available to its
  owner within its project scope. This is unnecessarily broad for external
  scripts and especially for less predictable agent clients. Per-key limits
  must not become a second source of project authority or persist after the
  owner's role is revoked.
- Desired outcome: Let a user create and later edit a key that either inherits
  all of their current project actions or is explicitly limited to a small,
  understandable set of Postbot capabilities.
- Related issues: ISSUE-112
- Related decisions: ADR-074, ADR-075
- Accepted boundaries: A key remains user-owned and generic; Postbot does not
  classify the external client as an AI agent. Effective access is the
  intersection of the user's current project role, the key's selected project
  scope, and its optional action ceiling. An unrestricted key continues to
  inherit all actions dynamically. Restricted capabilities cover project
  reads; publication preparation/management; publication scheduling and
  lifecycle control; channel management; media management; explicit provider
  analytics refresh; and permanent media deletion as a separate sensitive
  action. Workspace/project access administration, account and API-key
  management, built-in publisher OAuth, notifications/realtime, and
  installation administration remain session-only. Existing project-role
  guards remain authoritative, and no database migration is expected because
  Better Auth already persists API-key permissions.
- Acceptance: The same capability policy is checked by the API for every
  bearer-key request and unknown/session-only routes fail closed. Existing
  unrestricted keys retain their current behavior; scoped keys cannot exceed
  current user/project rights; selected project and action scopes compose by
  intersection. Create/list/update responses expose only safe permission
  metadata, and the localized key-management UI supports both inherited and
  limited access. API, UI, and authorization-boundary tests plus English
  documentation cover the contract.
- Tasks: ACCESS-236
- Decision: Owner approved the capability matrix and boundaries in the
  conversation on 2026-09-27. This authorizes implementation; it does not
  authorize agent identity, approval workflows, or new clients.
- Resolution: Added optional key-level capability ceilings using Better Auth's
  existing permissions field. Each bearer-key request now intersects the
  owner's current project role, the key's project scope, and its selected
  actions. Unrestricted keys continue to inherit the owner's current actions;
  unknown and session-only routes fail closed. The localized Settings UI can
  create, review, edit, and remove the action ceiling. No schema migration or
  agent-specific identity was introduced.
- Evidence: [ACCESS-236 worklog](worklogs/2026-09-27-ACCESS-236.md).

## External diagnostic follow-up classification

- The X weighted-count finding is resolved by ISSUE-126 and X-214.
- Production backup/restore execution is resolved by ISSUE-123 and OPS-213;
  ISSUE-129 tracks the remaining production dashboard-serving assertion only.
- Password recovery is already tracked under accepted ISSUE-062; ACCESS-219
  and ACCESS-220 split its remaining web and mail-less operator paths.
- Real publication validation remains the recurring practice in ISSUE-021; its
  existing LinkedIn and Bluesky runs are evidence, not work to restart.
- MCP remains ISSUE-036, intentionally deferred by the owner until the web
  product is sufficiently stable. This is not a permanent rejection and has no
  implementation task in the current backlog.
- Media component debt remains ISSUE-119; WEB-204 is the completed first seam,
  and WEB-224 will identify the next evidence-backed seam rather than mandate a
  broad refactor.
- The Prometheus endpoint was separately secured under ISSUE-125 and OPS-212;
  the diagnostic does not authorize expanding telemetry.

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
- Status: accepted for staged UX work
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

## [ISSUE-145] Reduce Queue scan noise while preserving lifecycle lookup

- Type: design problem
- Status: accepted for staged UX work
- Evidence: In the populated project, Queue begins with a project name and UTC subtitle although the project is already in the header. It shows a zero-count Scheduled tab, repeats publication state next to the destination, and gives drafts a long “pending draft changes” phrase. The published item appears alongside actionable drafts under All, with identical row weight. The date and action compete with the publication title rather than forming a clear triage order.
- Impact: Queue remains functional but takes more reading than necessary to identify which publication needs action now. Finished work and inactive filters can dominate the same visual plane as due or failed work.
- Desired outcome: Preserve all lifecycle states and explicit filters while making action priority, publication identity, destination, and timing scannable. Remove context already carried by the shell and copy that merely restates a visible state.
- Tasks: UX-251, UX-255
- Related issues: ISSUE-063, ISSUE-141
- Acceptance: Test due-manual, failed, scheduled, draft, and published rows together; verify useful filtering and bulk actions at desktop and mobile widths; demonstrate that an operator can distinguish actionable from historical items without reading an explanatory sentence per row.

- UX-246 follow-up: Mixed long destination names and variable lifecycle actions expose desktop header/row column drift. UX-255 tracks a shared grid correction; compact stacking remains readable. Narrow detail lifecycle actions were corrected during UX-246.

- Completed partial delivery (META-573 reconciliation): UX-251 established action-priority Queue ordering, removed repeated project/timezone and draft-state copy, and retained lifecycle filters, tags, bulk actions and historical lookup. The staged issue status is unchanged; its broader acceptance is not inferred from the completed task. [Delivery evidence](archive/calendar-queue-delivery/worklogs/2026-09-29-UX-251.md).

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

## [ISSUE-151] Shutdown can report success while its runtime marker remains

- Type: problem
- Status: resolved by OPS-306
- Evidence: On 9e0de695f, an isolated permission-failure probe leaves the marker while release() returns normally. removeLockIfOwned catches unlink errors; the shutdown exception guard therefore does not detect incomplete release. See worklogs/2026-10-04-OPS-305.md.
- Impact: Exit 0 can contradict the documented cleanup contract and a subsequent launch is refused. No automatic deletion is justified.
- Desired outcome: Cleanup success and incomplete cleanup are accurately observable without weakening ownership or stale-marker exclusion.
- Tasks: OPS-306
- Resolution: `release()` now returns whether the marker is gone (removal errors, unreadable content, and foreign tokens report retained without deleting); the shutdown handler maps a retained marker to exit 2 while token ownership, drain-before-cleanup, and the no-automatic-reclaim rule are preserved. Behavioral tests cover release failure, close failure, drain ordering with a pending operation, and the ignored second signal. See worklogs/2026-10-04-OPS-306.md.

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

## [ISSUE-156] Dashboard state after live loss of project access is undefined

- Type: problem
- Status: open
- Evidence: WEB-310 and WEB-311 established the static viewer experience, and ACCESS-309 established that the server stops answering reads for a removed project (hidden 404). Nothing establishes what the already-open dashboard does when access disappears mid-session: whether an open Overview, Queue or editor notices, what previously fetched data remains on screen, whether stale mutating controls stay armed, how the SSE stream reacts, and whether an unsaved local draft survives.
- Impact: A user can keep consulting, and possibly acting on, a project they no longer have. The server still refuses, so this is not an authorization failure, but the interface can misrepresent both what data is visible and what is still possible.
- Desired outcome: The post-revocation behavior of an open session is diagnosed with reproducible evidence, and the correction is bounded to removal of interface data plus preservation of local work, without polling or a general cache purge.
- Tasks: WEB-312 (completed), WEB-313 (completed), WEB-314 (proposal), WEB-315 (implementation), WEB-316 (hardening)
- Resolution: diagnosis delivered with two-session browser evidence and deterministic stream tests. Server protection is immediate and complete; the stream announces access loss within one heartbeat and is silent on a role narrowing; refused refetches empty the list surfaces and a navigation drops the project entirely, but the project identity, the cached editor role and the open editable publication survive because a refused refetch cannot replace the last successful data. Unsaved local work is preserved by the existing recovery buffer. No behavior was changed. The proposed correction removes project-scoped caches on the existing signal without purging the client, and leaves copy, disposition of local work, stay-or-navigate, and role-change announcement as owner decisions.
- Follow-up: WEB-313 qualifies that cache removal as unproved. Router-loader snapshots, context fallbacks, scheduled refreshes, raw in-flight writes, autosave timers, and local buffers can survive it, while `access-revoked` conflates genuine revocation with authorization-control failure. WEB-313 instead models an unverified-access interaction state, without deciding transport, copy, navigation, retention, or announcement policy.

## [ISSUE-157] Structure the public site around usage, core capabilities and self-hosting

- Type: proposal
- Status: open
- Priority: high — next public-site design work
- Evidence: The owner wants the site to establish humans and agents as equal audiences from day one. A separate scheduling illustration would repeat the shared-post distribution story. Current automation presentation is dominated by CLI details, while core capabilities and deployment options lack a coherent hierarchy.
- Impact: Visitors may mistake Postbot for a technical CLI utility or fail to understand its access surfaces and operational depth.
- Desired outcome: A visual usage section shows existing and planned access paths to the same workspace, with no false availability claims; a distinct core-capability section groups scheduling, image/video media, local/S3 storage, access administration, built-in/manual/custom channels, workspaces/projects and interface languages. A concise technical/open-source/self-hosting section leads to verified guides and supported image artifacts. Scheduling may enrich the existing publication story rather than receive a redundant standalone chapter. Layout, animation and final copy remain proposals, not approved card grid/carousel choices.
- Tasks: SITE-441 (design proposal), SITE-442 (isolated interactive prototype; homepage replacement not approved)
- Source: owner direction, 2026-10-15; public-site planning captured in
  [public positioning](../docs/project/public-positioning.md).

- Design proposal: [shared-workspace scene](../apps/docs/design/HUMANS-AND-AGENTS.md).

## [ISSUE-158] Provide agent skills for the first public launch

- Type: proposal
- Status: open
- Priority: high — explicit launch requirement, after workflow stabilization
- Evidence: The owner intends agent skills to be available for the first launch, but has deliberately delayed authoring until the first version is stable enough to avoid repeated rewrites. A CLI and API exist; launch-facing agent skills are not established in the current repository.
- Impact: Agents may use valid endpoints without understanding review, permissions, destination differences or the boundary between draft creation and publication.
- Desired outcome: Versioned, discoverable agent guidance covers the stable supported workflows and safe effect boundaries, validated with representative natural-language requests. The owner launch requirement is retained without beginning authoring before stability. Target harnesses, skill distribution and evaluation scope remain to be selected.
- Tasks: none — recorded for triage; no implementation authorized by intake
- Source: owner direction, 2026-10-15; public-site planning captured in
  [public positioning](../docs/project/public-positioning.md).

## [ISSUE-159] Establish a supported n8n integration path

- Type: proposal
- Status: open
- Priority: medium — after core access surfaces stabilize
- Evidence: The owner named n8n among intended ways to use Postbot. The API can be called programmatically, but that alone does not establish a tested n8n experience or an official node.
- Impact: Promoting an integration without a documented, reproducible workflow would shift authentication, error and publication semantics onto users.
- Desired outcome: Users can connect and run representative Postbot workflows from n8n with explicit permissions, outcomes and documentation. Determine whether documented HTTP workflows, a native node or another route is warranted; do not select a package or promise a native node at intake.
- Tasks: none — recorded for triage; no implementation authorized by intake
- Source: owner direction, 2026-10-15; public-site planning captured in
  [public positioning](../docs/project/public-positioning.md).

## [ISSUE-160] Explore a mobile Postbot client

- Type: proposal
- Status: open
- Priority: later — exploratory, not a first-launch commitment
- Evidence: The owner envisages a future mobile client alongside Studio and machine-facing tools. No dedicated mobile app workspace exists; the responsive website is not a shipped mobile application.
- Impact: Future marketing could overstate availability or a mobile implementation could duplicate domain behavior without a clear user need.
- Desired outcome: Define the mobile audience, high-value workflows, platforms and access boundaries before choosing delivery technology. Keep mobile visibly future-facing until implemented and validated; this issue does not authorize building an app.
- Tasks: none — recorded for triage; no implementation authorized by intake
- Source: owner direction, 2026-10-15; public-site planning captured in
  [public positioning](../docs/project/public-positioning.md).

## [ISSUE-161] Broaden documented self-hosting paths without implying unverified support

- Type: proposal
- Status: open
- Priority: medium — Docker/Compose first; orchestrators considered separately
- Evidence: The owner wants quick-start guides and resources for Docker, Compose, potentially Swarm, Kubernetes, Helm and other relevant hosts. Dockerfile and Compose files already exist; no Swarm/Kubernetes/Helm deliverables were found in the current repository. Release policy already targets GHCR and linux/amd64 plus linux/arm64 under RELEASE-303.
- Impact: A long list of deployment logos could misrepresent supported installation paths and dilute the lightweight single-service starting point.
- Desired outcome: Provide a concise Docker/Compose default, then independently scoped, exercised operator guides for justified additional environments. Helm is a possibility, not a selected architecture or launch requirement. Documentation points to public versioned AMD64/ARM64 artifacts only after acceptance and publication. Preserve the single-service/local-storage baseline; optional S3 and orchestrators must not become prerequisites. Public release remains separately authorized.
- Tasks: none — recorded for triage; no implementation authorized by intake
- Source: owner direction, 2026-10-15; public-site planning captured in
  [public positioning](../docs/project/public-positioning.md).

- Related work: RELEASE-303 remains the active image-release task. Do not duplicate it or treat this issue as authorization to publish.

## [ISSUE-162] Expand interface language coverage beyond English and French

- Type: proposal
- Status: open
- Priority: medium — staged after the existing language foundation
- Evidence: The owner wants broader international accessibility. Paraglide currently declares en and fr; the localization foundation tracked by ISSUE-049 is resolved, while additional languages and their quality/maintenance process remain future work.
- Impact: Advertising multi-language support broadly could imply catalogs that do not exist, while adding catalogs without translation and delivery checks could degrade quality or loading behavior.
- Desired outcome: Prioritize additional locales with translation ownership, fallback and formatting checks, and evidence of their delivered-page/bundle cost. Distinguish interface locale from publication content language and public-site localization. Do not reopen the already completed foundation or promise a language count.
- Tasks: none — recorded for triage; no implementation authorized by intake
- Source: owner direction, 2026-10-15; public-site planning captured in
  [public positioning](../docs/project/public-positioning.md).

- Additional owner direction, 2026-10-16: evaluate two further locales after product expansion, with delivered-bundle and interaction measurements. The pair is not selected. PRODUCT-477 found generated static EN/FR imports and an emoji-data locale list that must be included in the scope. See [expansion plan](../docs/project/product-expansion.md).

## [ISSUE-163] Define intentional workflow coverage across Postbot clients

- Type: proposal
- Status: open
- Priority: medium — before expanding client promises
- Evidence: Studio, API and CLI exist, while MCP, agent skills, n8n and mobile have different readiness and audience roles. The existing docs/capability-evidence.md records partial CLI coverage, including administration. The owner wants these surfaces to feel like ways to use one product, not disconnected products.
- Impact: An undifferentiated list of client logos could imply equal availability or full parity, while new clients might reimplement domain rules.
- Desired outcome: Maintain a workflow-oriented coverage map for human and programmatic clients; identify actual gaps, intentionally unsupported operations and planned surfaces. Separate a direct client (Studio/mobile), an access protocol/interface (API/CLI/MCP), orchestration (n8n) and agent guidance (skills). Preserve shared permissions, project ownership, revisions and effect boundaries; do not require every client to implement every screen.
- Tasks: none — recorded for triage; no implementation authorized by intake
- Source: owner direction, 2026-10-15; public-site planning captured in
  [public positioning](../docs/project/public-positioning.md).
- Related evidence: [client coverage](../docs/capability-evidence.md), ISSUE-036, ISSUE-158, ISSUE-159 and ISSUE-160.

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
- Plan: [product expansion](../docs/project/product-expansion.md).
- Tasks: PRODUCT-477; TELEGRAM-498 (official capability review and implementation proposal).
- Proposal: [SPEC-008](specs/SPEC-008-telegram-publishing.md); owner selected text plus one media on 2026-10-17, albums deferred.
- Implementation: TELEGRAM-499 adds the isolated provider protocol; TELEGRAM-500 adds the encrypted connection API and versioned profile; TELEGRAM-501 registers execution with pinned media and durable delivery handling. TELEGRAM-502 adds Studio creation, connection and conditional native editor limits. TELEGRAM-503 verifies photo/video storage-to-worker delivery and fixes MIME preservation under Bun. Live acceptance remains pending.
- Source: owner product direction, 2026-10-16.

## [ISSUE-166] Establish Facebook and Instagram integration scope

- Type: proposal
- Status: open
- Evidence: The owner requests mainstream networks beyond the existing six. No first-party Meta publishing adapters were found. Official documentation access in PRODUCT-477 was rate-limited.
- Desired outcome: Verify supported account types, permissions, app review/development access and initial publication formats before implementation. Record unknowns instead of promising personal-profile support or universal content formats.
- Plan: [product expansion](../docs/project/product-expansion.md).
- Tasks: PRODUCT-477 (initial discovery), META-505 (current official access and architecture review), FACEBOOK-506 (isolated Pages discovery and text/link/photo protocol), FACEBOOK-507 (isolated content profile and granted-permission Page selection), FACEBOOK-508 (confidential OAuth adapter), FACEBOOK-509 (authenticated callback and connection persistence), FACEBOOK-510 (encrypted application settings and gated Studio Page picker), FACEBOOK-511 (native capability and worker completion). FACEBOOK-511 registers the native profile, validation, Studio creation and production worker after owner acceptance of an explicitly unknown text maximum. Synthetic creation-to-connection and worker tests pass. FACEBOOK-512 verified live OAuth, explicit Page selection and text/single-PNG publishing on an owner-authorized test Page. INSTAGRAM-535 adds the isolated single-image protocol/profile after the owner selected direct Instagram Login in ADR-088; INSTAGRAM-536 adds distinct encrypted application settings, direct-login OAuth and project account connection with targeted synthetic security, storage and HTTP verification. INSTAGRAM-537 integrates durable single-JPEG delivery, bounded container processing, safe token refresh and Studio creation/connection. Canonical synthetic worker, HTTP and browser checks pass; Instagram live account access, signed-media fetching and App Review remain unverified (INSTAGRAM-538).
- Research: [Meta integration discovery](../docs/project/meta-integration-discovery.md); current account/login boundaries, review requirements, media lifecycle and first-lot recommendation.
- Source: owner product direction, 2026-10-16.

## [ISSUE-167] Replace normal Studio JSON authoring with a structured channel builder

- Type: proposal
- Status: open
- Evidence: Custom creation and profile editing expose JSON text fields. Impact/adoption views also show raw serialized values. Current schema, field bindings, media/text capabilities and profile revision lifecycle already exist.
- Desired outcome: A usable form for content capabilities, a separate execution setup and field-level impact/validation. Preserve richer existing profiles without silent data loss. Agree unsupported-rule behavior and reuse the existing runtime contract before replacing UI.
- Plan: [product expansion](../docs/project/product-expansion.md).
- Tasks: PRODUCT-477 (discovery), PRODUCT-478 (detailed builder proposal), CHANNEL-479 (isolated text-rule preservation spike), CHANNEL-480 (guarded content controls and local preview), CHANNEL-481 (before/after content comparison). Transport authoring, arbitrary field removal and full adoption cleanup remain pending.
- Source: owner product direction, 2026-10-16.

## [ISSUE-168] Expand provider information, performance and comment workflows

- Type: proposal
- Status: open
- Evidence: Bluesky and DEV.to collectors expose bounded observations. Reply/comment counts do not provide a conversation UI or reply execution path. The owner asks for richer information and comments.
- Desired outcome: An explicit provider capability/read-access matrix and scoped stored-data workflows for useful metadata, metrics and comments. Treat reading, replying and moderation as distinct permissions and external effects; preserve metric meanings and freshness.
- Plan: [product expansion](../docs/project/product-expansion.md). PRODUCT-540 records [current provider coverage](../docs/project/provider-capabilities.md), including code versus live evidence and the next account-free format recommendation.
- Tasks: PRODUCT-477 and ENGAGEMENT-525 (discovery); BLUESKY-526 (public thread reader); ENGAGEMENT-530 (stored latest Bluesky comment snapshot, editor refresh and read-only Studio panel). ENGAGEMENT-531 extends the same public stored-view workflow to Mastodon. ENGAGEMENT-532 adds public text replies on Bluesky with conversation-owned history and durable send outcomes. ENGAGEMENT-534 extends these replies to Mastodon with original-instance and account checks. ANALYTICS-539 adds anonymous public Mastodon counters, stored manual snapshots and Performance presentation. Further providers and moderation remain outside the delivered slice.
- Source: owner product direction, 2026-10-16.

## [ISSUE-169] Support provider-native publication formats and public text entities

- Type: proposal
- Status: open
- Evidence: Existing profiles expose provider-specific fields. MASTODON-533 adds native polls with typed destination controls, preview and instance-limit validation. The owner also requests questions and hashtag integration; broader provider formats remain open.
- Desired outcome: Discover feasible formats per provider and expose typed editor controls, validation, preview and execution. Distinguish plain questions from native polls and provider hashtags from internal tags; do not force identical support across networks.
- Plan: [product expansion](../docs/project/product-expansion.md).
- Tasks: PRODUCT-477 (discovery); MASTODON-533 (owner-authorized native Mastodon polls); TELEGRAM-541 (ordinary anonymous Telegram polls, typed authoring and durable delivery, synthetic acceptance). [Current provider coverage](../docs/project/provider-capabilities.md). Other formats remain proposed.
- Source: owner product direction, 2026-10-16.

## [ISSUE-170] Preserve user-defined organization through free publication tags

- Type: proposal
- Status: open
- Evidence: ADR-062 and ISSUE-053 already deliver publication tags and filtering. The owner suggests campaign-related internal tags; no separate campaign lifecycle is established.
- Desired outcome: Validate concrete campaign organization/reporting needs against existing tags first. The owner clarified that a campaign is an example of tag meaning, not a requested entity. Preserve free tags; any future campaign proposal needs separate evidence and approval.
- Plan: [product expansion](../docs/project/product-expansion.md).
- Tasks: PRODUCT-477 (discovery); implementation scope remains proposed.
- Source: owner product direction, 2026-10-16.

## [ISSUE-171] Evaluate scheduled comments beneath owned publications

- Type: proposal
- Status: open
- Evidence: The owner distinguishes a prepared first comment from replying to an incoming comment. Postiz documents delayed first-comment publishing.
- Desired outcome: Verify support and constraints per provider. Design a dependent delivery after confirmed parent publication, with remote parent identity, explicit timing, independent failure state, retry safety and duplicate prevention. A failed parent cannot trigger its comment. Do not imply an inbox or AI author is required.
- Plan: [product expansion](../docs/project/product-expansion.md).
- Tasks: PRODUCT-478 (discovery); ENGAGEMENT-542 scoped the first slice. The owner selected Bluesky, overdue catch-up after revalidation and suspension on enabling-editor access loss. ENGAGEMENT-543/544 implement that [first-comment workflow](../docs/project/first-comments.md) for Bluesky and Mastodon; other providers remain open. Local injected/browser acceptance does not claim live delivery.
- Source: owner clarification, 2026-10-16.

## [ISSUE-172] Define shared-post and tag-based performance reports

- Type: proposal
- Status: open
- Evidence: Current collectors cover bounded Bluesky and DEV.to observations. The owner requests destination, shared-post and tag views.
- Desired outcome: Compare documented competitor metrics with stored Postbot observations. Define aggregation, compatible metrics, coverage and freshness; avoid double-counting fan-out or overlapping tags. Resolve current versus historical tag attribution before implementing reports. Keep account metrics separate from post metrics.
- Plan: [product expansion](../docs/project/product-expansion.md).
- Tasks: PRODUCT-478 and ANALYTICS-524 (scope); ANALYTICS-527/528 deliver bounded latest observations and source-post grouping. ANALYTICS-539 adds Mastodon favourites, boosts and replies to the same destination/source view without combined totals. Owner selected current-tag attribution; ANALYTICS-547 adds the corresponding Performance filter without summed metrics or historical claims. Historical attribution and aggregation remain separate decisions.
- Source: owner clarification, 2026-10-16.

## [ISSUE-173] Make the free-tag lifecycle discoverable in Studio

- Type: proposal
- Status: resolved
- Evidence: New publication, editing and Queue hide the picker when tags are absent. The shared picker only selects. Static searches found no Studio tag creation form or API wrapper for creation.
- Desired outcome: Provide a first-tag path and project-scoped creation, rename and archive/restore using existing domain permissions. Retain user-defined meaning without adding a campaign entity. Verify actual empty and populated UI states.
- Plan: [product expansion](../docs/project/product-expansion.md).
- Tasks: PRODUCT-478 (discovery and scope); TAGS-522 (owner-authorized Studio lifecycle implementation, 2026-10-20).
- Resolution: TAGS-522 adds project tag management and first-tag creation directly in publication authoring. Existing API permissions, stable identifiers and archived assignments are preserved; four focused browser scenarios verify the lifecycle, error recovery, read-only access and project isolation.
- Source: owner clarification, 2026-10-16.

## [ISSUE-174] Verify built-in provider constraint updates across retained work

- Type: proposal
- Status: open
- Evidence: The owner asks what happens if a platform reduces its text limits. ADR-020, ADR-078 and ADR-079 establish versioned profiles, impact review and explicit adoption. Packaged presets are snapshots; their existence is not automatic detection or rollout of upstream changes.
- Desired outcome: Audit the operational update path for built-in constraints and execution support. Prove behavior for new work, editable drafts, pending selected targets, retries and historical/in-flight revisions using a synthetic limit reduction. Preserve content and history; do not silently truncate, migrate, deliver known-incompatible work or claim automatic upstream detection. Identify any missing operator update/review entry.
- Tasks: CHANNEL-482 (intake); CHANNEL-523 (gap diagnosis); CHANNEL-529 (explicit shipped-template loading, verified local save/impact/activation). Automatic upstream discovery and a full retained-work lifecycle proof remain outside the delivered slice.
- Related: [profile evolution](decisions/ADR-020-version-and-assess-channel-profile-changes.md), [ordinary approval compatibility](decisions/ADR-078-explicit-superseded-profile-approval.md), [draft adoption](decisions/ADR-079-explicit-draft-profile-adoption.md).
- Source: owner direction, 2026-10-16.

## [ISSUE-175] Investigate a development API shutdown that retained SQLite

- Type: defect
- Status: open
- Evidence: CHANNEL-488 found the server process alive with the database and runtime-lock descriptors open after its earlier SIGTERM drain log, while port 3002 had no listener. A second explicit termination ended it. The exact retained marker was removed only after verifying its owner and that no process held the database, WAL, shared-memory or marker files.
- Desired outcome: Reproduce and identify which shutdown step can remain pending. Preserve fail-closed runtime exclusion; do not introduce automatic stale-lock reclamation or infer quiescence from a missing listener.
- Tasks: CHANNEL-488 (recovery and evidence); root-cause repair remains pending.

## [ISSUE-176] Exclude generated test and runtime data from production build contexts

- Type: defect
- Status: resolved
- Evidence: TELEGRAM-499 observed the default Docker context transferring over 4.9 GB before cancellation. Local test-results occupied 7.4 GB and data occupied 218 MB; neither directory is excluded by .dockerignore. These are local/generated inputs rather than production sources. The successful check used a tar context containing tracked files plus the new provider package.
- Desired outcome: Keep routine production contexts bounded and exclude generated test outputs and runtime data without hiding required workspace manifests or fixtures. Verify the normal Docker build with representative local outputs present. No runtime data was deleted during discovery.
- Tasks: TELEGRAM-499 (evidence); BUILD-556 (implementation and acceptance).

- Resolution (2026-10-23): BUILD-556 excludes root data, browser results and reports, and makes existing generated-output/dependency patterns recursive across workspaces. A real Docker context audit checks all workspace manifests and representative tracked fixtures while generated local data remains present. The audited copy falls from 1.6 GB after initial root exclusions to 47 MB after recursive exclusions. Normal production builds, complete container recovery and static gates pass. No existing runtime data or test results were deleted. [Evidence](worklogs/2026-10-23-BUILD-556.md).

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

## [ISSUE-180] Evaluate site and documentation hosting after the reference migration

- Type: proposal
- Status: open
- Evidence: The owner intends to validate TanStack Start with Cloudflare on solar-icons.dev first, then report whether that recipe should be reused here. Avoid additional OCI compute allocation for the site/docs. No migration is authorized to start now.
- Impact: Public site/docs hosting needs a sustainable path before launch.
- Desired outcome: After the owner's successful reference result, scope a suitable deployment and framework plan. apps/docs currently uses Next.js/Fumadocs; apps/web Studio already uses Vite/TanStack Router. Distinguish these surfaces and preserve the self-hosted API, SQLite, scheduler and worker boundary. Validate documentation capabilities and actual hosting constraints at that time; owner-provided quota expectations are not verified deployment guarantees.
- Tasks: none; wait for the reference migration result before selecting implementation.

## [ISSUE-181] Prepare a separately authorized public repository and site launch

- Type: proposal
- Status: open
- Evidence: The owner anticipates making the repository public and publishing the site/docs under postdot.app, but explicitly deferred both actions.
- Desired outcome: Coordinate final identity, hosting readiness and existing release/license requirements before an owner-authorized public launch. Do not change repository visibility, DNS, deployment or registry publication during routine product work.
- Tasks: PUBLIC-552 (owner-authorized README and disclosure readiness review); links BRAND-551, ISSUE-180 and existing RELEASE-303 readiness work. Owner selected preserving history, branches and PRs; PUBLIC-553 prepares the existing repository transition with targeted current-record corrections.

- ISSUE-181 source-publication update (2026-10-22): owner explicitly authorized PUBLIC-554. Pushed the reviewed local main and made the existing postdot/postdot repository public; repository identity and history are preserved, anonymous API/page access verified. Site/docs deployment remains deferred under ISSUE-180, so the broader launch issue remains open.

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

## [ISSUE-184] Validate the product with sustained real use before widening scope

- Type: problem
- Status: open
- Evidence: SPEC-001 defined a falsifiable hypothesis: one real project uses Postbot as its only publication source of truth for four consecutive weeks, including an automatic and a manual channel. SPEC-005 superseded the release framing with continuous development and did not carry over a validation milestone. No task, issue or worklog records that test being run. In about eight weeks the repository reached roughly 1,000 commits, nine built-in providers, analytics, replies, first comments, approvals, workspaces/groups, an image editor and webcam capture.
- Impact: Scope grows from internal design logic rather than observed demand, and every feature added before real use increases maintenance and later rework. Real friction (onboarding, provider setup, daily workflow) remains unknown.
- Desired outcome: A recorded, time-boxed period of real operation (for example the Postdot launch communication itself) produces evidence that drives prioritization, and an explicit owner decision states how new scope is admitted relative to that evidence.
- Related: ISSUE-181, ISSUE-190
- Tasks: none

## [ISSUE-185] Provider-specific knowledge leaks into shared API and web layers

- Type: problem
- Status: resolved
- Evidence: SPEC-005 requires each provider or channel module to own its destination-specific knowledge. On 2026-10-22, 52 non-test files in `apps/api/src`, `apps/web/src`, `packages/db/src` and `packages/core/src` branch on literal provider names. Commits for the Telegram provider touched 34 non-test source files outside `packages/telegram`, including API routes, publisher runtime, `models.ts`, and about 20 web files (composer, previews, target editor, connection panel, dashboard context). `ProjectDashboardContextValue` in `apps/web/src/lib/dashboard-context.tsx` exposes provider-specific callbacks (`onStartLinkedInConnection`, `onStartBlueskyConnection`, `onStartXConnection`, `onConnectDiscordPublisher`, ...) alongside composer draft state. A server-side `BuiltInProviderRegistry` already exists for execution.
- Impact: The cost and regression risk of each additional provider grows with the number of providers, and the shared layers become a de facto central catalog that SPEC-005 explicitly rejects.
- Desired outcome: Adding or changing a provider is confined to that provider's module plus a minimal registration point on the server and in the web client, and shared layers consume provider capabilities through a described contract rather than name checks. Measure progress by the files outside the provider module that a new provider must touch.
- Related: ISSUE-188, SPEC-005
- Tasks: PROV-569

- Resolution (2026-10-23): PROV-569 implements owner-approved ADR-091 across all nine integrations. Static browser/server modules own connection setup, application and engagement policies, authoring, preview, analytics and exact worker revisions. Shared features consume capabilities while SQLite retains authorization, encryption, transaction and claim fences. Synthetic browser/worker/store extension proofs pass without network calls or weakened migrations. A comparable literal-equality audit drops from 34 common source files to one development-sandbox label. All 134 main browser cases, four SMTP cases, two automatic-delivery cases, static gates, 21 builds and production-container recovery pass. [Evidence](worklogs/2026-10-23-PROV-569.md).

## [ISSUE-186] Serial publication execution and unrenewed claim leases

- Type: problem
- Status: resolved
- Evidence: `createPublicationWorker` in `apps/api/src/modules/workflow/worker.ts` awaits each external effect sequentially across all projects (one job per project per round, rounds repeated until idle), after first awaiting replies and first-comment processing. The default lease is 5 minutes and no code path renews a lease while an effect is running. Expired claims are classified as requeue or ambiguous by `classifyExpiredClaim` during subsequent claims.
- Impact: A slow effect, such as a large video upload or provider processing poll, delays every other due publication in every project, so scheduled times are not met under load. Effects that legitimately exceed the lease duration have undefined or unverified outcomes. They may end up ambiguous, or the completion may be fenced out even though the provider succeeded.
- Desired outcome: Investigate and document the actual behavior when an effect outlives its lease. Then make one slow destination unable to delay unrelated publications beyond a stated bound, keep long effects owned by their claim for their whole duration, and preserve the single-process constraint (ADR-003) and fencing semantics (ADR-009). Any change to execution semantics needs an explicit owner decision.
- Related: ADR-003, ADR-006, ADR-009, ADR-090
- Tasks: WORK-568

- Resolution (2026-10-23): WORK-568 implements owner-approved ADR-090: two shared internal publication/reply/first-comment slots, one effect per project, independent project/family rotation, fresh admission within one second when capacity is available, strict token-fenced renewal and cooperative deadlines. Shutdown drains actual effects; expired ownership cannot be revived or finalized. The original over-lease behavior is documented, and late uncertain outcomes remain ambiguous. 1,567 unit/script tests, all 134 main browser cases with four environmental reruns, two automatic-delivery cases, four SMTP cases and fresh production-container recovery validated. [Evidence](worklogs/2026-10-23-WORK-568.md).

## [ISSUE-187] Main SQLite connection lacks WAL and busy-timeout configuration

- Type: problem
- Status: resolved
- Evidence: `createDatabase` in `packages/db/src/client.ts`, used by the API runtime, maintenance and migrations, only sets `PRAGMA foreign_keys = ON`. No runtime path sets `journal_mode` or `synchronous`; `busy_timeout` is set only on dedicated backup and local-account-recovery connections. The default rollback journal therefore applies to the main process.
- Impact: Writers block readers (including heavier analytics queries) in the main process. A second connection (CLI, backup, maintenance) can make the main connection fail immediately with `SQLITE_BUSY` instead of waiting. Durability and throughput settings are implicit rather than chosen.
- Desired outcome: The main connection's journal mode, synchronous level and busy timeout are deliberate, documented and covered by tests, and remain compatible with the existing backup, restore, quiescence lock (ADR-068) and container recovery acceptance.
- Related: ADR-005, ADR-068, ADR-089, ISSUE-175
- Tasks: DB-555

- Resolution (2026-10-23): Owner approved WAL, FULL durability and a 5-second busy timeout. DB-555 configures main connections, strictly closes prepared statements and retires old destination WAL through SQLite before either restore mode replaces the database. Concurrent-reader/writer, online snapshot, migration and forced-stop restore tests pass; omitting WAL retirement makes the new tests detect corruption. Static gates, 1,550 unit/script tests, 137 browser/SMTP scenarios and fresh production-container recovery passed. [Evidence](worklogs/2026-10-23-DB-555.md).

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

## [ISSUE-191] Reduce anonymous entry JavaScript against the existing footprint target

- Type: problem
- Status: open
- Evidence: FOUND-571 repaired the footprint script's stale index-component lookup: the index route now redirects and has no component chunk. Measuring the application entry plus the anonymous login route and their static imports produces 279,720 bytes gzip (about 273 KiB), above SPEC-002's 180 KiB initial-web-JavaScript target. Both the previous host canary/artifact and Bun 1.4.4/current artifact produce the same value. This is an aggregate of each unique manifest file's gzip size, not an observed browser transfer or a claim about all authenticated routes. TanStack DB was already excluded from the production bundle before its source cleanup.
- Impact: The current anonymous entry exceeds the intended transfer budget, and the broken measurement had hidden the result. Dependency removal alone should not be presented as fixing production loading cost.
- Desired outcome: Attribute the measured entry graph to required code and avoidable eager imports, reduce the anonymous entry toward the existing target without changing authentication or application behavior, and retain a reproducible measurement with an explicitly named entry screen. If the target must change, record an evidence-based trade-off rather than silently lowering it.
- Related: SPEC-002, ISSUE-185
- Tasks: none
