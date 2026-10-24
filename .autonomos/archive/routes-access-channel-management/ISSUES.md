# Historical routes, access and channel-management issues

Source: .autonomos/ISSUES.md. Historical evidence and superseded mechanisms
remain preserved; applicable current contracts stay in accepted records.

<a id="issue-031"></a>

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
- Related decisions: [ADR-017](../../decisions/ADR-017-use-versioned-webhooks-and-mapped-http-for-custom-channels.md), [ADR-018](../../decisions/ADR-018-restrict-custom-channel-network-egress.md), [ADR-069](../../decisions/ADR-069-custom-http-path-authentication.md)
- Resolution: `SECURITY-141` adds an explicit `path` authentication binding for
  mapped HTTP profiles. A profile may declare exactly one dedicated
  `{ "kind": "secret" }` path segment; Postbot resolves it only from the
  encrypted connection credential, encodes it as one URL component, and keeps
  the connection endpoint origin-only. Path authentication is rejected for
  Postbot webhooks, query/header/body mappings, and profiles without the exact
  secret segment. The API, database connection boundary, transport, response
  schema, UI, and redaction tests now fail closed around this contract.

<a id="issue-037"></a>

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

<a id="issue-053"></a>

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

<a id="issue-067"></a>

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
- Related decisions: [ADR-064](../../decisions/ADR-064-clean-development-access-baseline.md)
- Resolution: The old project access tables, legacy project bearer-token store,
  retirement marker, and runtime compatibility branches were removed. Instance
  invitations now use a dedicated table, the migration directory contains one
  generated baseline, and the test suite verifies that obsolete tables cannot appear
  in a fresh database. A database file is intentionally not reset by application
  code; a stale disposable local file must be moved aside explicitly.

<a id="issue-068"></a>

## [ISSUE-068] Enforce the accepted project role boundary on every mutation

- Type: problem
- Status: resolved
- Evidence: The 2026-09-11 foundation audit reproduced a project member with the
  Better Auth `viewer` role receiving `201 Created` from both channel creation and
  post creation. The same fixture received `403` for the existing project timezone
  mutation, proving that the role is known but not enforced consistently. See the
  [security audit](../../worklogs/2026-09-11-postbot-audit/01-security-and-access.md).
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

<a id="issue-069"></a>

## [ISSUE-069] End or reauthorize project event streams after access revocation

- Type: problem
- Status: resolved
- Evidence: The audit opened a project SSE stream as a viewer, removed the
  membership, confirmed a new project read was rejected, and then observed a later
  `channel.created` event on the already-open stream. The stream currently checks
  access at connection time but does not revalidate the principal during its
  lifetime. See the [security audit](../../worklogs/2026-09-11-postbot-audit/01-security-and-access.md).
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

<a id="issue-071"></a>

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

<a id="issue-072"></a>

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

<a id="issue-112"></a>

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

<a id="issue-130"></a>

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

<a id="issue-140"></a>

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

