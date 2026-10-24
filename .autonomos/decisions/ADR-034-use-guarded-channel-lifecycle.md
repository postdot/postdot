# ADR-034 — Use a guarded, reversible channel lifecycle

- Status: accepted
- Date: 2026-09-05
- Scope: project-owned channel lifecycle, publication authoring, publisher connections, and channel management API
- Related issue: [ISSUE-033](../archive/foundations-first-deliveries/ISSUES.md#issue-033-complete-web-onboarding-and-lifecycle-for-runtime-defined-channels)
- Related tasks: CHANNEL-71, CHANNEL-67
- Superseded by: none

## Context

Postbot already treats a channel as a project-owned publication destination,
separate from its optional publisher connection and from the versioned profile
that describes its content contract. The web channel-management surface needs
explicit rename, archive, restore, and delete behavior, but the current schema
has no channel lifecycle state and no server boundary for these actions.

Changing or removing a channel can affect publication history, scheduled work,
publisher credentials, pending OAuth callbacks, profile versions, and audit
records. A client-side convention or a cascade chosen only for convenience
would make these consequences invisible and could create an external execution
race.

## Decision

Channels have two durable states: `active` and `archived`. The channel row also
stores `archivedAt` and an optimistic-concurrency `revision`. New channels are
active with a null archive timestamp and revision one. The channel ID remains
stable for its entire lifetime; renaming never changes the ID or profile
identity.

The project-scoped lifecycle operations are:

- **Rename:** trims and updates the display name in either state, requires the
  observed channel revision, increments the revision, and records an
  attributable audit event. A stale revision fails closed.
- **Archive:** changes an active channel to archived, records the archive time,
  increments the revision, and records an audit event. It is blocked while the
  channel has scheduled, ready, publishing, or ambiguous publication work, or
  while a publisher OAuth authorization attempt is pending. Existing drafts,
  completed publications, profile history, publisher connections, credentials,
  and audit history are retained. An archived channel is read-only for new
  publication authoring, profile mutation, publisher connection, and OAuth
  authorization until restored.
- **Restore:** changes an archived channel back to active, clears the archive
  timestamp, increments the revision, and records an audit event. No historical
  publication is silently rescheduled; the operator explicitly schedules new
  work after restoration.
- **Delete:** is a physical deletion only after the channel is archived and the
  server verifies that it has no publications, publisher, or pending OAuth
  authorization attempt. The operation requires the observed revision. It
  preserves the attributable `channel.deleted` audit event while cascading only
  profile and other channel-owned rows that have no retained domain reference.
  If any guard fails, the server returns the machine-readable blockers and
  changes nothing.

All lifecycle mutations are project-scoped, actor-attributed, transactional,
and compare-and-swap guarded. `Channel` remains distinct from `Publisher`:
archiving does not revoke or delete project-owned credentials, and deleting a
channel requires the publisher connection to be removed first.

## Alternatives considered

- **Hard-delete every channel on request:** rejected because publications use a
  restrictive foreign key and because it would erase or orphan durable product
  history and publisher state.
- **Soft-delete only with no restore operation:** rejected because a temporary
  operational pause should not require rebuilding a channel or its profile.
- **Allow archive to cancel or rewrite scheduled publications automatically:**
  rejected because it silently changes user scheduling intent. Blocking archive
  while active work exists keeps the transition explicit and avoids a worker
  race without adding a reactivation queue.
- **Delete publishers and credentials automatically with the channel:**
  rejected because credentials are project-owned and their lifecycle is separate
  from channel identity; the operator must disconnect them explicitly.
- **Use an unguarded last-write-wins update:** rejected because concurrent web
  sessions could rename or change lifecycle state based on stale data.

## Consequences

- The channel API exposes lifecycle state and revision so clients can render
  archived destinations and handle conflicts without a second domain model.
- Publication creation, profile mutation, publisher connection, and OAuth
  authorization must reject archived channels at their existing server
  boundaries.
- The UI must explain active-work and reference blockers before offering archive
  or delete, while the database remains the final authority.
- Physical deletion is intentionally rare and safe-by-default; channels with
  any publication history are archived instead of deleted.
- No generic workflow, soft-delete framework, or cross-database abstraction is
  introduced for this boundary.

