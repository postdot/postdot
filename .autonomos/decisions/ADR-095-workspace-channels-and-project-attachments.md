# ADR-095 — Workspace channels with explicit project attachments

- Status: accepted (owner approval, 2026-10-26)
- Implementation: SHARE-592; acceptance does not mean delivery
- Scope: GitHub [issue #12](https://github.com/postdot/postdot/issues/12)
- Related specification: [SPEC-009](../specs/SPEC-009-shared-channel-workflows.md)
- Provenance: owner-approved second design review and consolidated action plan

## Context

One real destination can serve several editorial projects. Duplicating its channel
and connection loses a common calendar and cadence; assigning it to one project
loses the other projects' editorial context. Moving creation into workspace
administration would make ordinary single-project use needlessly complicated.

## Decision

Use one technical ownership model: channels, immutable channel profiles and their
optional publisher connections/credentials belong to a workspace. Explicit active
or detached project attachments authorize use and preserve historical relations.
Posts, publications, content, media, tags, project grants and editorial attribution
remain project-owned. An attachment grants use of a concrete destination, not the
underlying credential or an ability to create other destination connections.

Creation remains contextual: adding a channel from a project creates its first
attachment and makes that project its manager. No workspace page or sharing
concept is required for normal use. **Use in other projects…** adds attachments.
A Shared badge reflects multiple active attachments without exposing their count.
A workspace Channels page lists only channels the actor can read or manage,
including channels with one attachment. No separate shareable/private type is needed.

The managing project is explicit and stable. Its existing channel-management roles
and workspace administrators manage the common profile, connection and cadence.
Adding/removing other projects does not transfer management. Transfer requires an
explicit authorized action. If the managing project is removed or deleted,
management falls back to workspace administrators; no other project is promoted.
Attaching requires authority over the channel and the target project. User-owned
API keys additionally need a channel:share capability and scope for every affected
project, with the owner's live role checked. Existing channel:manage and dispatch
capabilities remain distinct. OAuth ceremony remains session-based.

Project content visibility remains unchanged. The shared calendar exposes full
items only for readable projects, and anonymous occupied times/states for other
projects, without names, titles, content or project counts. Sharing explicitly
explains this disclosure. Management authority alone is not content-reading access.

Cadence rules are optional and disabled unless configured. Daily/weekly maxima
warn during planning; a configured minimum interval also defers automatic effect
admission on the same channel. Deferral preserves the requested schedule and
explains the delay. Explicit, attributed, rule-specific overrides support urgency;
provider-enforced restrictions cannot be overridden. Retries and restart recovery
participate in channel pacing. These rules coordinate one channel, not inferred
external-account duplicates or activity outside Postdot.

Detach/retirement closes new admission, preserves in-flight completion and retains
history. Upcoming work is explicitly moved, cancelled or left unavailable for
review. Moving creates a revalidated publication on the new channel and links the
cancelled original; it never rewrites existing execution history. Only work with
no execution attempt is eligible. Deleting one project must preserve shared
resources referenced by other projects or their history.

A confirmed automatic publication records the concrete destination generation.
Admission checks that generation; actual execution preserves a non-secret identity
snapshot. Reconnecting the same destination or rotating credentials does not
invalidate confirmation; changing destination requires explicit reconfirmation.
Legacy historical identity remains unrecorded rather than being guessed.

## Amendments and precedence

This accepted target amends the following records only in the stated scope:

- ADR-074: channel ownership moves to workspace; project use is explicit, with a
  stable managing project and unchanged project-content access.
- ADR-008: same-project publication/content/actor relations remain enforced;
  channel/profile relations instead require the same workspace and a valid
  project attachment. Do not merely remove composite foreign keys.
- ADR-012 and ADR-031: publisher secret/connection ownership becomes workspace
  scope. Connection attribution is not personal secret ownership. Permission to
  use one destination does not authorize other destinations of the same account.
- ADR-020/021: channel-owned immutable profiles remain; impact assessment spans
  all affected project attachments while filtering results by readable scope.
- ADR-034/094: channel and project retirement must account for attachments,
  explicit pending-work handling, in-flight completion and surviving history.
- ADR-075: extend route capability/scope mapping for sharing; preserve live access
  resolution, hidden-not-found masking and existing action ceilings.
- ADR-090: retain global/project effect bounds; add channel pacing where enabled
  and shared-credential refresh coordination. Do not serialize unrelated accounts.
- ADR-032: project timezone still governs editorial scheduling; the optional
  channel cadence uses its own timezone for civil days and ISO weeks.

Existing code, docs and prior records may still describe project-owned channels.
Until implementation is complete, they document current behavior, not proof that
this accepted target is delivered. Update operating guidance and public docs with
implementation; never represent partial schema work as a usable sharing feature.

## Alternatives

- Private project channels promoted into a different shared ownership type: two
  ownership paths, difficult reversal and ambiguous deletion; rejected.
- Project channels backed only by a shared connection: keeps duplicated profile
  and calendar semantics and still needs workspace credential ownership; rejected.
- Management computed from owning every attached project: attachment changes
  silently grant/revoke management; replaced by a stable managing project.
- Workspace-only creation/administration: burdens single-project use; rejected.
- General per-channel ACLs or approval inbox: unnecessary new access system;
  reuse existing roles with explicit sharing authority.

## Consequences and evolution

A preserved migration and cross-project authorization proof are mandatory. Unknown
workspace ownership blocks migration instead of being assigned by convenience.
Existing duplicates are neither merged nor coordinated automatically.
Workspace attribution uses the existing actor system with a workspace scope;
project deletion must not leave shared resources tied to deletable project actors.

Future strict cadence, editorial attachment preferences, alternative calendar
visibility and additional agent flows can evolve independently. This decision
adds no runtime service, worker, global lock manager or expression language.
Release publication still requires the existing grouped-release boundary.

## Persistence and architecture operating rules

- **Publisher ownership:** Released alpha.1/alpha.2 connections and credentials are project-owned. From alpha.3, migration 0023 moves channels, profiles, publishers, connections and credentials to workspace ownership with explicit project attachments, per [ADR-095](ADR-095-workspace-channels-and-project-attachments.md) and [SPEC-009](../specs/SPEC-009-shared-channel-workflows.md); every new project must belong to a workspace. This schema conversion is not a delivered sharing feature: the live authorization adapters, HTTP/CLI/Studio workflows and release acceptance remain under SHARE-592. The connecting actor is audit attribution, not personal secret ownership; actor departure does not revoke the connection.
- **Workspace attribution:** Workspace actors grant no access. Authenticated workspace requests may use a subject snapshot with no originating project actor; do not fabricate an editorial grant or project identity for workspace administration. Their originating project-actor ID is provenance, not a foreign key or a source of authorization; snapshots survive source-project deletion. Scope cleanup triggers retire actors after the owning scope's dependent rows have cascaded, avoiding sibling-cascade ordering failures. Actor-table rebuilds must drop and recreate those triggers around the rebuild.
- **Project ownership boundary:** Every new project belongs to a workspace (`createProject` requires it); a null `projects.workspace_id` exists only for historical rows that the ownership preflight refuses. Tests needing such data null the column explicitly after creation, and fixtures use `seedTestWorkspace` from `@postdot/db/testing`.
- **Common-resource ownership:** Channels, profile versions, publishers, connections and credentials belong to a workspace (migration 0023, ADR-095). A project uses them through `project_channel_attachments`; `project_channel_profiles` / `project_channel_publishers` are derived bindings that let project-scoped rows keep their composite foreign keys, and `channel_managers` names one stable managing project. Write common resources only through a live attachment (`state = 'active'`); `project_*_contexts` views identify an editorial context for reads, not ownership or authorization, and historical context stays readable after detach without granting new admission. Writers verify visibility through those views rather than a `project_id` column. Attribution on common rows is a workspace actor snapshot (`ensureFromProjectActor`), not a project actor. Credential refresh may use the historical context so an admitted effect can finish after detach; revocation and management use the active context. A credential not yet connected to any destination is addressable only by the project whose flow staged it.
- **Shared-channel blockers:** Channel archive, delete and publisher disconnect consider work and attachments of every attached project, not only the caller's. Deleting a channel that other projects still use is refused (`shared`). Connecting a publisher queues scheduled automatic work for all attached projects.
- **Authorization boundary:** `createWorkspaceChannelStore` (exposed as `manualStore.sharedChannels`) takes a request-bound policy port and is the only creation/attach/detach/transfer path; `contextFor` resolves the workspace attribution actor from a live project actor and grants nothing. The project-scoped `createChannel` delegates to it with a policy admitting only that project, after the caller has authenticated. The API builds the real policy (`createChannelAccessPolicy`: live role, key capability and project scope) for channel sharing and cadence configuration. Cadence management uses `channel:manage`, independently of `channel:share`; publication spacing overrides use `publication:dispatch`.
- **Channel cadence:** Planning guards run inside the publication writer's immediate transaction, including creation, promotion/approval, bulk rescheduling and explicit failed-work retry. Confirmations bind current rules, publication revisions, occupancy and requested times; never accept a bare bypass flag. Preserve requested schedules. Runtime discovery and claim use the same channel eligibility expression, with a transactional recheck at the effect boundary; persist admission timing and consume an attributed spacing override once. Credential refresh remains keyed by credential, pacing by channel. Manual outcomes contribute their recorded publication time. Keep the SQL expression index in migration 0024 as SQL: Drizzle Kit incorrectly quotes its comma-separated expression when generating SQLite DDL.
