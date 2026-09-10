# ADR-058 — User-global notification inbox with optional project context

- Status: accepted
- Date: 2026-09-10
- Scope: in-app notification ownership, project context, preferences, and dashboard access
- Related task: NOTIFY-127
- Related decisions: ADR-038, ADR-050, ADR-057
- Supersedes: ADR-038's in-app recipient and preference scope only

## Context

Herald's first notification implementation made the in-app inbox look like a
project resource. That made the bell disappear from the useful global state and
made entering instance settings discard the user's selected project. A signed-in
person owns one notification inbox even when publication outcomes are attributed
to several projects. Project selection is an organizational context, not an
authentication boundary.

The product still needs contextual reading: when a project is selected, showing
only that project's publication outcomes avoids mixing similarly named work. When
no project is selected, the person must be able to see the complete inbox, with a
project label on project-scoped items. Some future notifications may have no
project at all, such as an instance or account event.

## Decision

The durable in-app notification record is recipient-user owned. It stores a
required `recipientUserId`, an optional `projectId`, and an optional project
recipient actor used only for project attribution and referential integrity.
Project publication outcomes are still projected from the durable event journal
for human recipients only; the projection cursor remains project-scoped because
the source facts are project-scoped. The inbox may later accept explicit
instance/user events with a null project without introducing a broker or a
second application.

The authenticated notification API exposes one user inbox with an optional
project filter. The dashboard uses the selected project as the default view and
uses the all-project view when no project is selected. Read and archive mutations
authorize by notification id plus recipient user id, never by a client-supplied
project alone. User-level preferences are the primary preference boundary;
existing project/actor preferences remain as a compatibility fallback while old
project routes are retired deliberately.

The notification bell remains present without a selected project. Its unread
count follows the visible scope: the selected project's count in project
context, and the complete user count in the instance-wide context. The existing
project realtime stream invalidates the relevant user query; a dedicated
user-wide stream is a later optimization, not a correctness dependency.

Provider-application settings remain instance-scoped, but navigation preserves
the selected project as context when entering them. This keeps the project
selection stable without incorrectly making provider applications project-owned.

## Alternatives considered

- Keep notifications project-owned: rejected because a person would need to
  visit every project to see their complete inbox and global events would have
  nowhere natural to live.
- Always show every project in every context: rejected because operational
  work benefits from a quiet project-local view and similarly named publication
  outcomes can be confused.
- Hide or disable the bell without a project: rejected because it makes the
  global inbox inaccessible precisely when no project context is active.
- Move source facts to a global journal: rejected because project attribution,
  cursor ownership, and existing event boundaries do not require that change.

## Consequences

- One user can receive outcomes from multiple projects without duplicate
  application-level inboxes.
- Projectless settings and future instance events are representable without a
  fake project.
- Project context remains a view concern and can be changed without changing
  notification ownership.
- The migration must fail closed if an old notification cannot be mapped back
  to a human actor subject; it must not silently discard an existing row.
- A future user-wide realtime channel may reduce refresh latency for events from
  projects other than the currently selected one.

## Verification

Tests cover migration replay, preservation of existing notification rows,
multi-project user inbox reads, projectless rows, user-preference precedence,
recipient authorization, pagination, and the authenticated API surface.
