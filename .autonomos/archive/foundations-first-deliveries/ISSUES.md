# Historical foundations and first delivery issues

Source: .autonomos/ISSUES.md. Historical evidence and superseded mechanisms
remain preserved; applicable current contracts stay in accepted records.

<a id="issue-001"></a>

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
- Decision: [ADR-010](../../decisions/ADR-010-use-bun-runtime-image-for-v1-packaging.md)

<a id="issue-003"></a>

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
- Decision: [ADR-019](../../decisions/ADR-019-separate-media-assets-representations-and-deliveries.md)

<a id="issue-004"></a>

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
  roots. [ADR-023](../../decisions/ADR-023-establish-shared-ui-package.md) records the
  ownership boundary.
- Decision: [ADR-023](../../decisions/ADR-023-establish-shared-ui-package.md)

<a id="issue-005"></a>

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
  [ADR-024](../../decisions/ADR-024-adopt-a-native-first-motion-policy.md). The shared
  stylesheet honors reduced-motion preferences, existing transitions target
  bounded properties, and no animation runtime was added without a concrete
  interaction requirement.
- Decision: [ADR-024](../../decisions/ADR-024-adopt-a-native-first-motion-policy.md)

<a id="issue-006"></a>

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
- Decision: [ADR-012](../../decisions/ADR-012-own-publisher-credentials-and-use-oauth4webapi.md)

<a id="issue-007"></a>

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
- Specification: [SPEC-004](../../specs/SPEC-004-publication-content-boundary.md)
- Decisions: [ADR-013](../../decisions/ADR-013-runtime-defined-custom-channel-contracts.md), [ADR-014](../../decisions/ADR-014-separate-autosaved-drafts-from-execution-revisions.md), [ADR-015](../../decisions/ADR-015-use-a-small-semantic-source-content-vocabulary.md), [ADR-016](../../decisions/ADR-016-use-a-bounded-json-schema-runtime-profile.md), [ADR-017](../../decisions/ADR-017-use-versioned-webhooks-and-mapped-http-for-custom-channels.md), [ADR-018](../../decisions/ADR-018-restrict-custom-channel-network-egress.md), [ADR-019](../../decisions/ADR-019-separate-media-assets-representations-and-deliveries.md), [ADR-020](../../decisions/ADR-020-version-and-assess-channel-profile-changes.md), [ADR-021](../../decisions/ADR-021-channel-owns-profile-contract.md), [ADR-026](../../decisions/ADR-026-linkedin-single-image-delivery.md)

<a id="issue-008"></a>

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

<a id="issue-009"></a>

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

<a id="issue-010"></a>

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

<a id="issue-011"></a>

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
- Decision: [ADR-028](../../decisions/ADR-028-use-audit-events-as-execution-journal.md)
- Verification: Workflow integration tests cover every execution outcome,
  pre- and post-effect lease recovery, retry attempt history, cancellation,
  stale fences, duplicate completion, and rollback when audit persistence fails.
  The full repository format, lint, typecheck, unit/integration, browser E2E,
  and build gate passes.

<a id="issue-012"></a>

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
- Decision: [ADR-029](../../decisions/ADR-029-separate-liveness-and-readiness.md)
- Verification: API integration tests cover missing and active runtimes,
  scheduler failure, database failure, liveness independence, and OpenAPI
  registration. Media runtime tests cover lifecycle, failure, and restart
  recovery. The full format, lint, typecheck, unit/integration, browser E2E,
  and build gate passed. A real production-bundle smoke test returned 200 from
  `/health` and `/ready`, and 404 for an unknown `/ready` path instead of the
  SPA fallback.

<a id="issue-013"></a>

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
- Decision: [ADR-030](../../decisions/ADR-030-project-scoped-machine-access.md),
  [ADR-063](../../decisions/ADR-063-adopt-better-auth-access-plugins.md)
- Verification: Database and API integration tests cover secret handling,
  project isolation, expiry, revocation, actor attribution, human-only management,
  bearer precedence, OAuth session-only behavior, and OpenAPI security metadata.
  The full format, lint, typecheck, unit/integration, browser E2E, and build gate
  passed.

<a id="issue-014"></a>

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

<a id="issue-015"></a>

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

<a id="issue-016"></a>

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

<a id="issue-017"></a>

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

<a id="issue-018"></a>

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

<a id="issue-020"></a>

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

<a id="issue-022"></a>

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
- Decision: [ADR-031](../../decisions/ADR-031-separate-linkedin-principal-and-destination.md)
- Resolution: LinkedIn credentials now retain the OAuth member principal while
  each project publisher connection records an explicit member or organization
  destination. Organization IDs are permission-checked after OAuth, and both
  text and image delivery use the persisted destination URN.

<a id="issue-023"></a>

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

<a id="issue-024"></a>

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

<a id="issue-027"></a>

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

<a id="issue-028"></a>

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

<a id="issue-030"></a>

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

<a id="issue-032"></a>

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
- Related decision: [ADR-075](../../decisions/ADR-075-user-owned-api-keys.md)
- Verification: Client, CLI, database, and API integration tests cover bearer
  propagation, human-only management, one-time secret handling, metadata
  redaction, and project isolation. The browser E2E flow creates a disposable
  token, verifies that the secret disappears after dismissal, and revokes it.
  The full format, lint, typecheck, unit/integration, browser E2E, and build gate
  passed.

<a id="issue-033"></a>

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

<a id="issue-038"></a>

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
- Related specification: [SPEC-004](../../specs/SPEC-004-publication-content-boundary.md)
- Resolution: Workflow wake-up, job claiming, target loading, and pre-effect
  execution now require a non-disabled channel profile version. Started execution
  records remain loadable for reconciliation, and regression coverage verifies both
  the claim boundary and the disable-after-claim race.

<a id="issue-039"></a>

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

<a id="issue-040"></a>

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

<a id="issue-041"></a>

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

<a id="issue-042"></a>

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

<a id="issue-043"></a>

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

<a id="issue-061"></a>

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
  is recorded in `.autonomos/archive/root-documentation-2026-10-25/source/docs/deployment/provider-requirements.md`.
- Verification: Bluesky OAuth metadata, provider-application store, migration,
  runtime-origin, API, localization coverage, and package typecheck tests pass.

<a id="issue-044"></a>

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

<a id="issue-045"></a>

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

<a id="issue-046"></a>

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

<a id="issue-047"></a>

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

<a id="issue-048"></a>

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

<a id="issue-049"></a>

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

<a id="issue-051"></a>

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

<a id="issue-052"></a>

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

<a id="issue-054"></a>

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

<a id="issue-055"></a>

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

<a id="issue-056"></a>

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

<a id="issue-057"></a>

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

<a id="issue-058"></a>

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

<a id="issue-059"></a>

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

<a id="issue-060"></a>

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

