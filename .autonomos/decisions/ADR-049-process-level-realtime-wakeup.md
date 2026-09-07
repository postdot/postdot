# ADR-049 — Use a Process-Level Realtime Wakeup With Durable Replay

- Status: superseded
- Date: 2026-09-07
- Scope: Herald API event streaming and in-app notification projection
- Provenance: ISSUE-050, REALTIME-104
- Related decisions: ADR-047, ADR-048
- Superseded by: ADR-050

## Context

The first SSE transport read the durable SQLite event journal every 250 ms for
each open browser connection. That is restart-safe and works when any part of
the process writes the journal, but it duplicates idle reads as connections
grow. The web client also invalidated its notification query before the
notification projection had necessarily consumed the source event; the
projection's periodic five-second loop could therefore leave the inbox stale
after the client had already finished its bounded refetches.

Herald remains a single Bun process with SQLite as its durable source of truth.
The event stream must remain reconnectable and must not trust an in-memory
signal as the only record of a change.

## Decision

Use one lazy process-level durable-journal watcher and a project-scoped
in-memory wakeup hub. The watcher is active only while at least one SSE stream
is waiting, advances one global journal cursor, and wakes only the projects
that have new committed events. SSE connections wait on the hub and read their
own project events from SQLite after wakeup; they retain heartbeat and
cancellation behavior. The bounded journal scan is the recovery path for
writes that do not publish an in-process signal and for process-local missed
wakeups; it is never duplicated per connection.

The notification projection is explicitly woken after the watcher observes a
new journal event. It still retains its periodic recovery loop and durable
projection cursor. The browser continues to receive payload-free SSE events
and refetch authoritative read models through TanStack Query.

This phase removes the per-connection SQLite polling loop and closes the
projection timing gap. A later phase may add direct post-commit notifications
at every write boundary to reduce normal event discovery latency below the
watcher interval; that optimization must be added only after all audit-event
write paths have a common post-commit boundary.

## Alternatives considered

- Keep one SQLite polling loop per SSE connection: simple and durable, but its
  idle database work scales with the number of connections.
- Use only an in-memory event emitter: fast, but it loses changes across
  crashes and cannot recover a signal that was emitted before a subscriber was
  attached.
- Add Redis, another broker, or a database-specific notification service:
  useful for a genuinely multi-process deployment, but outside Herald's
  current monolith and introduces a second delivery system before a need is
  demonstrated.
- Replace SSE with WebSocket: changes the transport without solving durable
  event discovery or notification projection timing.

## Consequences

- Idle journal reads are bounded per API process instead of per SSE connection.
- Reconnect and restart recovery continue to use the durable journal cursor.
- The notification inbox is projected before its corresponding client
  invalidation is delivered by the process bridge.
- The watcher interval remains a measurable latency bound in this phase; it is
  a deliberate fallback boundary, not the final post-commit wakeup mechanism.
- A future multi-process deployment will need either one watcher per process
  reading the shared journal or a dedicated durable cross-process signal.
