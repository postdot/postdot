# SPEC-009 — Shared channel workflows

- Status: accepted (owner approval, 2026-10-26)
- Scope: SHARE-592; [GitHub #12](https://github.com/postdot/postdot/issues/12)
- Related decision: [ADR-095](../decisions/ADR-095-workspace-channels-and-project-attachments.md)
- Delivery: not yet implemented; alpha.2 does not support channel sharing

## Ordinary use and sharing

1. Project → Channels → Add channel keeps the existing ordinary journey. Create
   the channel, managing-project relation and first attachment atomically.
2. Use in other projects… selects authorized target projects. Explain that they
   gain publication use, not connection management, and that anonymous occupied
   times become visible across attached projects.
3. A shared channel appears in each project's channel list, with Shared and no
   project count. The manager's project name is visible only when readable;
   otherwise describe management without revealing the name.
4. Workspace → Channels lists authorized channels, with project usage filtered
   by scope. It supports direct creation with an initial project selection,
   attachments, management transfer, cadence and archived-resource inspection.
5. A channel may be manual or automatic. Sharing neither creates automation nor
   changes publication delivery modes.

## Ownership and access

The workspace owns the common destination/profile/connection and secret lifecycle.
An active project attachment grants publication use according to project roles.
Detached attachments preserve historical references and grant no future use.

A managing project is initialized from contextual creation and changes only
explicitly. Workspace administrators can recover management. Project membership
alone neither reads other projects nor reveals reusable credentials.

Project owners can withdraw their project. Channel managers can withdraw another
project without editing or cancelling its content: its future work becomes
unavailable for review. A project owner can explicitly cancel or move their own
work during withdrawal. Started effects finish and record their outcome.

Session, API and CLI use one authorization path. channel:share grants only sharing
operations, requires live underlying authority and key scope for each affected
project, and does not imply dispatch, secret access or workspace administration.
Key creation supplies initial human authorization; ordinary authorized machine
calls do not require repeated human confirmation. OAuth callbacks recheck live
management rights and bind attempts to workspace/channel.

## Shared calendar and cadence

Full publication details are filtered by current project-read rights. Other
attached-project scheduled/published activity is represented by anonymous occupied
times and states, never names/content. Drafts from unreadable projects are not
shown or counted. The disclosure of occupancy is intentional and explained.

Cadence is opt-in. Channel timezone defaults from the managing project when first
configured; use civil days and Monday-start ISO weeks. Project timezone still
controls date entry. Scheduled, ready, publishing, published and ambiguous work
participates in planning counts; drafts, cancelled and definitely failed work do
not. Manual outcomes use their recorded publishedAt. Activity outside Postdot is
unknown. Delays/retries may change the actual day relative to planning maxima.

Planning checks and writes share one immediate SQLite transaction. Conflict
confirmation binds channel, rules revision, affected publications and times;
stale confirmation returns a fresh conflict. Replanning invalidates the old
exemption. Daily/weekly maxima warn, with explicit attributed confirmation.

Configured minimum spacing also applies before automatic publication effects,
including retries and overdue work after restart. Persist the timing state and
any exemption. A delayed item must not occupy a worker slot needed by eligible
work on another channel. Preserve scheduledAt, expose actual dispatch timing and
a readable delay reason, and wake when the earliest deferral becomes eligible.
An attributed explicit override bypasses only the confirmed editorial rule.
Provider/network/security restrictions are independent and cannot be bypassed.

Mechanical refresh coordination is keyed by credential ID; channel planning and
pacing are keyed by channel ID. Neither mechanism promises coordination across
independent duplicate records or workspaces. Do not infer manual or HTTP destination
identity from names or URLs, and do not reveal invisible duplicate channels.

## Destination identity and history

Reconfirmation is required when the selected account/destination changes, including
a custom HTTP endpoint change. Same-account reconnection and token refresh do not
constitute a destination change. Preserve a monotonic generation even when the
connection row is replaced, and recheck before the external-effect boundary.

The immutable execution record carries non-secret provider/destination identity,
name and generation. Never copy tokens. Historical rows without captured identity
remain explicitly unrecorded. Effects already started finalize against their
captured identity even if the channel is later disconnected or detached.

## Moving work and retiring resources

Move only future work without an execution attempt. Create a new publication under
the destination profile in the same post, preserve the requested schedule, and
revalidate content/media. Cancel/link the old item only as part of the explicit
operation; invalid destination content remains available for review. Never copy
approvals, execution outcomes or provider receipts as if they belonged to the new
publication. Preserve access, profile and source concurrency checks.

Retiring the last active attachment presents explicit channel archive/delete
choices. Deleting a project removes its data but cannot remove a shared channel,
credential, attribution record or profile required elsewhere. Unused channels
retained solely by detached-project history remain archived and administrator-
manageable. Resource cleanup and backup safety retain ADR-094 boundaries.

## Migration and acceptance

Preflight the actual current schema, ownership and foreign keys without changing
unknown data. A project with no workspace requires explicit resolution; never
assign it silently to the default workspace. No automatic duplicate merging.

Use the existing backup/quiescence path. Create one migrated attachment for each
existing channel, retain original IDs and mark migration provenance with migration
time; do not invent a historical sharing event. Preserve content/profile hashes,
media references, pending times/states and execution history. Workspace actors must
not be deleted with an originating project while shared records reference them.

Required grouped proofs:

- alpha.2 upgrade/restoration on AMD64/ARM64 using an operator-approved copied
  backup or a representative synthetic fixture; distinguish which was tested;
- migration rollback/preflight failure and foreign_key_check; unchanged historical
  content/profile/media and pending schedule;
- ordinary single-project creation; sharing without visiting workspace settings;
- session/key scope masking, no cross-project content or secret leakage;
- concurrent planning, stale confirmation, cancellation/replanning and overrides;
- overdue restart pacing, retries, ambiguity, manual timestamps and timezone edges;
- reconnect same/different destination, claimed work and in-flight completion;
- concurrent refresh of one shared credential without rotating it twice;
- detach and project deletion while other projects retain channel/history;
- explicit move with validation failure and no historical retargeting;
- EN/FR, keyboard, populated/error states and desktop/tablet/mobile journeys.

Do not claim real-provider acceptance from synthetic tests, native ARM acceptance
from emulation, or production-data coverage without an approved copied backup.
No image release is implied by implementation or local validation.
