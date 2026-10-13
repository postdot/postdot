# ADR-050 — Use Post-Commit Project Signals for Normal Realtime Wakeups

- Status: accepted
- Date: 2026-09-07
- Scope: Postbot API database write boundary, SSE wakeups, and in-app notification projection
- Provenance: ISSUE-050, REALTIME-105, product discussion
- Related decisions: ADR-047, ADR-048, ADR-049
- Supersedes: ADR-049 for the normal event-discovery path

## Context

Postbot is a single Bun process backed by SQLite. Its project changes and
notifications are durable facts, not ephemeral chat messages. A browser stream
therefore needs a fast in-process signal for normal operation and a durable
journal for replay after a reconnect or process restart.

The previous implementation used one process-level watcher that read the
global SQLite journal every 250 ms while an SSE stream was open. That removed
the per-connection duplication, but it still performed idle database work and
made the database the normal event trigger even though the write runtime
already knows when it appends a fact.

## Decision

Every Postbot transaction that appends an `audit_events` fact uses the shared
`createDatabaseTransaction` boundary. The event-writing code records the
affected project id in the active transaction frame. When Bun returns from the
transaction callback successfully, SQLite has committed the state and fact;
only then does the database boundary invoke the process-local observer:

```text
begin transaction
  mutate current state
  append audit fact
  record project id in the transaction frame
commit succeeds
observer(project ids)
```

The observer publishes the project ids to the in-memory realtime hub. The
notification projection runs immediately for those projects, and matching SSE
waiters wake immediately. The SSE stream then rereads the authoritative,
project-scoped journal and sends a payload-free invalidation event to the
browser. No SQLite read loop is used to discover normal in-process changes.

The durable journal remains the recovery boundary:

- a transaction that rolls back never emits a signal;
- a callback failure cannot make an already committed transaction fail;
- if the process crashes after commit and before the callback, the SSE
  connection is lost and reconnects with `Last-Event-ID`, allowing the server
  to replay the durable journal;
- notification projection performs an initial durable recovery on startup;
- no notification or event fact is deleted because a process was offline.

The current deployment remains single-process. Writes made by an external
process or an uninstrumented raw SQLite connection are outside this boundary
and require a future cross-process signal if Postbot ever supports them.

## Alternatives considered

- **Process-level SQLite polling every 250 ms:** durable but wasteful while
  idle and slower than a direct signal; superseded.
- **Polling once per SSE connection:** simpler but scales idle reads with
  connections; rejected.
- **In-memory event emitter without a durable journal:** fast but unsafe across
  crashes and missed subscribers; rejected.
- **SQLite triggers, WAL hooks, Redis, or WebSockets:** either do not provide a
  post-commit application boundary or add infrastructure and failure modes
  that Postbot does not currently need.

## Consequences

- Normal event-to-browser and event-to-inbox latency is bounded by local
  synchronous post-commit dispatch rather than a polling interval.
- There is no periodic SQLite watcher for realtime updates.
- The write boundary must remain complete: new audit-event transactions must
  use the shared wrapper and record their project id.
- Durable replay, cursor validation, heartbeat, authorization, and
  project-scoped read models remain unchanged.
- A future multi-process mode will need a durable cross-process notification
  mechanism, while SQLite remains the source of truth.
