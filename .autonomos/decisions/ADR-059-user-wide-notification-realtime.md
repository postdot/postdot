# ADR-059 — User-wide notification realtime

- Status: accepted
- Date: 2026-09-10
- Scope: authenticated in-app notification refresh

## Context

The notification inbox belongs to the signed-in user and can contain items
from several projects. The existing project event stream is intentionally
project-scoped, so it cannot reliably refresh an open global inbox when an
event arrives in another project.

## Decision

Postbot exposes one authenticated SSE endpoint at
`/api/notifications/events` for each signed-in user. The stream uses the
durable global audit-event cursor and emits only safe invalidation envelopes
for notification-producing publication outcomes in projects currently
visible to that user. Project identity remains in the envelope so the client
can preserve context without receiving journal payloads or actor identifiers.

The process-local realtime runtime has a user hub in addition to its project
hub. A committed project change resolves only the user waiters belonging to
that project; the stream then rereads SQLite from its cursor. The existing
project stream remains responsible for project page data. Direct user events
can use `publishUsers` when projectless notification producers are introduced.

## Consequences

- An open global notification popover refreshes after activity in any of the
  user's projects without opening one SSE connection per project.
- Reconnects remain safe because the browser's `Last-Event-ID` is a durable
  global journal cursor and the server filters access again on every read.
- Events from projects the user cannot currently access are advanced past but
  never serialized into the response.
- The current hub is process-local. A future multi-process deployment will
  need a cross-process wakeup mechanism; SQLite remains the source of truth.
- Projectless notifications are structurally supported by the user-owned
  inbox and `publishUsers`, but their producer/event contract is a separate
  product decision.
