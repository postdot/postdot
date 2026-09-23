# ADR-048 — Establish an Authenticated Project Event Stream over SSE

- Status: proposed
- Date: 2026-09-07
- Scope: authenticated server-to-client project update transport
- Provenance: REALTIME-102, ISSUE-050, PR #109 follow-up
- Related decisions: ADR-037, ADR-038, ADR-047
- Related specs: none

## Context

Herald already has one durable, project-scoped fact journal in `audit_events`.
The notification projection consumes that journal independently and advances its
own cursor. The web client currently has no server transport for worker-generated
changes, so `NotificationInbox` and project work views only discover changes when
they perform another read.

The first reactive client experiment selected TanStack Query and deliberately kept
its fixture and route isolated. A production transport must therefore expose a
small signal boundary without making the dashboard, notification projection, or
publication adapters depend on a process-local event bus. It must also remain safe
when an event occurs before its notification projection is visible.

## Decision

Expose `GET /api/projects/:projectId/events` as an authenticated Server-Sent Events
stream.

### Authentication and project isolation

- The endpoint requires a Better Auth session. User API keys receive a
  forbidden response; this first browser transport is not a machine-token API.
- The session user must have a current human actor in the requested project. The
  existing notification access lookup is reused for this check, so a missing
  project membership is indistinguishable from a missing project to the route.
- Journal reads are always filtered by the path `projectId`; the client cannot
  select another project through a cursor or payload.

### Durable cursor and reconnect

- The SSE `id` field is the opaque journal cursor
  `event-sequence:<AUTOINCREMENT sequence>`. The JSON envelope repeats it as
  `cursor` and includes the durable event `id` separately.
- Reconnection uses the standard `Last-Event-ID` header. The server passes that
  cursor to the journal's ordered `readAfter` operation, so reconnect replays
  durable events instead of relying on process memory.
- The current journal has no retention floor: valid historical cursors remain
  replayable for the lifetime of the project. A structurally valid cursor above
  the journal high-water mark is rejected with a `cursor_ahead` response and the
  client must perform a full refetch before reconnecting. A malformed cursor is
  rejected with `invalid_cursor`.
- The sequence is global, not project-local. Numeric jumps are expected when
  events for another project (or deleted project history) occur between two
  events for this project; they are not interpreted as data loss. The transport
  detects a non-monotonic cursor returned by the journal as a `cursor_gap`
  resynchronization condition, emits a terminal control event, and closes.

### Event envelope and safe payload policy

Only an explicit allowlist of project-view event names and version `1` is exposed.
Publisher connection changes and publication draft rebases are included as safe
invalidation signals; access-token lifecycle events and provider delivery bodies
are intentionally excluded.
Unsupported journal facts are consumed by the stream scanner but are not sent to
the browser. Every emitted event has this shape:

```json
{
    "id": "durable-event-id",
    "cursor": "event-sequence:42",
    "projectId": "project-id",
    "version": 1,
    "type": "publication.execution.failed",
    "entity": { "type": "publication", "id": "publication-id" },
    "occurredAt": 1800000000000,
    "payload": {}
}
```

`actorId`, correlation/causation identifiers, raw audit metadata, credentials,
tokens, provider response bodies, error text, and provider-specific target
payloads are never serialized into the stream. The initial payload is deliberately
empty: the event is an invalidation signal, and the client refetches the
authoritative project or notification read model. Adding a payload field later
requires an explicit allowlist and compatibility test.

### Liveness, projection lag, and shutdown

- The single-process server polls the durable journal at a bounded interval while
  an SSE request is open. This polling is a latency mechanism only; SQLite remains
  the source of truth and no Redis, WebSocket, or process-local callback is added.
- The stream emits an SSE comment heartbeat at a bounded interval so proxies and
  clients can detect a live connection without creating a domain event.
- Request abort, reader cancellation, stream errors, and normal terminal conditions
  clear pending timers/listeners and close the stream without an unhandled error.
- A durable journal event may arrive before `NotificationStore` projects its inbox
  row (the current projection runtime normally runs every five seconds). The
  transport does not claim that a notification is already readable. The client
  keeps the PR #109 strategy: invalidate/refetch the relevant Query data and retry
  or perform a full refetch after reconnect when the projection is still behind.

## Alternatives considered

- **Process-local publish/subscribe callbacks:** rejected as the correctness path;
  callbacks would be lost during restart and would not serve a request that opens
  after the mutation. They may be considered later as a latency optimization.
- **Client polling:** deferred because this mission establishes the server push
  contract; the durable cursor and full-refetch fallback remain useful if a future
  client cannot hold SSE.
- **WebSocket/WebRTC or an external broker:** rejected by the current single-process,
  SQLite-first constraints and the lack of a demonstrated bidirectional need.
- **Expose raw audit metadata:** rejected because audit payloads are not a public
  transport contract and may contain provider or operational details that should
  remain server-side.

## Consequences

- Browser clients get a reconnectable project signal without a second source of
  truth or a schema migration.
- One open request performs bounded SQLite reads per project. The interval and
  heartbeat are explicit policy knobs and must be measured before broad rollout.
- Event filtering means the stream is an invalidation channel, not a complete
  replica of the journal. Consumers must refetch authoritative read models and
  must not infer contiguous numeric sequences.
- The first implementation is intentionally transport-only. DashboardContext,
  NotificationInbox, the isolated PR #109 prototype, and publication adapters are
  not migrated by this decision.

## Verification

Tests must prove session authentication, strict project isolation, replay after a
cursor, reconnect behavior, malformed and ahead cursors, non-monotonic journal
responses, heartbeat emission, abort/cancel cleanup, safe envelopes, and the
absence of credentials or provider calls. All tests use in-memory SQLite and fake
events; no real credentials or provider network is permitted.
