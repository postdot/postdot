# ADR-047 — Evaluate the Reactive Client Data Layer

- Status: accepted
- Date: 2026-09-07
- Scope: initial web client data boundary for project publications, queue,
  notifications, unread state, and derived views
- Related issue: ISSUE-050
- Related tasks: REALTIME-96, REALTIME-103

## Context

Herald already has a durable server event journal and a notification projection,
but the web client does not yet have a central contract for receiving relevant
project changes. Queue and inbox data can therefore remain stale after a worker
outcome or an action in another browser session.

The immediate question is not which library can render a reactive demo. It is
which client boundary fits Herald's current API shape, project authorization
model, projection delay, reconnect needs, and future SSE transport without
forcing a DashboardContext rewrite or a second source of truth.

The prototype deliberately uses a local event source and a deterministic
fixture. It does not add SSE, a new database model, credentials, provider calls,
or production dashboard wiring.

## Options evaluated

### Option A — TanStack Query with targeted invalidation

The prototype uses explicit project-scoped query keys for publications and
notifications. A coordinator receives a typed event, deduplicates by event id,
refreshes only the affected resource, and retries when the event arrives before
the server projection is visible. Reconnect performs a bounded full refresh of
both resources.

The queue, unread counter, and attention groups are pure selectors over the two
query results. A notification read is a normal server mutation followed by a
targeted notification refresh; publication outcomes never use optimistic
success.

### Option B — TanStack DB backed by QueryCollection

The prototype uses typed publication and notification collections backed by
`@tanstack/query-db-collection`. The same coordinator refreshes the affected
collection, while live queries derive the queue inputs and join publications to
unread notifications by publication id. Marking a notification read is an
optimistic collection update; the `QueryCollection` handler calls the server and
the transaction rolls back when the fixture write fails.

TanStack DB is therefore evaluated as a local reactive/read-model layer, not as
the transport or source of truth. Its QueryCollection still reads the existing
Herald-shaped endpoints.

### Option C — Combine Query and DB in production

This remains technically viable: Query can own server freshness while DB owns
normalized collections and live derivations. The prototype demonstrates this
bridge, but adopting both globally would add a second lifecycle and mutation
model before Herald has a production push contract or enough cross-screen
normalized views to justify it.

## Prototype contract and fixture

The fixture exposes safe, project-scoped DTOs rather than raw API or database
objects. It models separate authoritative and visible maps so an event can beat
the notification/publication projection by a controlled delay. It simulates:

- `publication.updated`;
- `publication.status_changed`;
- `notification.created`;
- `notification.read`;
- disconnect/reconnect;
- duplicate event delivery;
- a failed optimistic notification write.

Each event carries an id, project id, sequence, entity id, and the minimal
payload needed to decide whether a refreshed snapshot has caught up. The
coordinator rejects events for another project, coalesces an event already in
flight, and only records an event as handled after its refresh succeeds. A
failed refresh can therefore be retried by a later delivery.

## Results

| Criterion               | TanStack Query                                                           | TanStack DB / QueryCollection                                                                                               |
| ----------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Readability             | Smaller boundary: query keys, fetchers, coordinator, selectors           | More moving parts: `DbClient`, collections, collection utilities, live query lifecycle, and a Query bridge                  |
| Current API integration | Direct fetches match the existing list/read endpoints                    | Works, but requires `QueryCollection` adapters and `collection.utils.refetch()` for collection-level synchronization        |
| Targeted remote update  | One exact query refetch for the affected resource                        | One exact collection refetch for the affected collection                                                                    |
| Derived views           | Straightforward pure selectors; joins remain application code            | Live query joins update reactively from normalized collections                                                              |
| Optimistic reads        | Explicit mutation plus refresh; rollback is application-owned            | Transaction rollback is convenient for the safe notification-read case                                                      |
| Publication truth       | Clear server-authoritative model; no optimistic provider outcome         | Also server-authoritative in the prototype; DB is not allowed to invent `published`/`failed` outcomes                       |
| Projection delay        | Explicit bounded retry `[0, 20, 80, 160]` ms in the fixture              | Same retry policy; the collection layer does not remove the need for projection awareness                                   |
| Reconnect               | Bounded full refresh of publications and notifications                   | Same; reconnect still needs the coordinator and transport cursor semantics later                                            |
| Duplicate delivery      | Event-id deduplication and in-flight coalescing are explicit             | Same shared coordinator; DB does not provide transport deduplication                                                        |
| Project isolation       | Guarded source plus project-scoped keys                                  | Guarded source plus project-scoped collection ids and keys                                                                  |
| Error surface           | Query `isPending`/`isFetching`/`error` and mutation failure are familiar | Collection `isLoading`/`isError` plus transaction promises; lifecycle failures are less obvious to future callers           |
| Future SSE              | Event handler can invalidate/refetch without changing view selectors     | Event handler can refetch collections, but transport events still need explicit collection synchronization                  |
| Bundle/build impact     | Main application remains unaffected when the prototype route is lazy     | The isolated route carries the DB bridge and live-query code; the combined prototype chunk is 351.58 kB raw / 97.47 kB gzip |

## Measurements

The reproducible fixture scenario uses a 1 ms network delay for ordinary event
tests, a 35 ms projection delay for a publication event, a 25 ms delay for a
missed notification during reconnect, and a 20 ms delay for the DB optimistic
write scenario.

- Both approaches load one publications list and one notifications list for an
  initial snapshot.
- A publication event refreshes publications only; the Query test verifies that
  notification reads do not increase.
- A notification event refreshes notifications only.
- Reconnect refreshes both resources and records the reconnect plus projection
  wait metrics.
- The DB read mutation adds the expected write and collection refresh path, and
  a failed write restores the unread row.
- The web build transformed 8,400 modules in 1.20 s in this worktree. The main
  client chunk was 252.29 kB raw / 81.84 kB gzip. The prototype route chunk,
  which intentionally contains both alternatives for comparison, was 351.58
  kB raw / 97.47 kB gzip. This is an upper bound for the combined spike, not a
  per-library differential benchmark.

## Recommendation

Adopt **TanStack Query as Herald's initial reactive client boundary** and keep a
small event coordinator responsible for project scoping, event-id
deduplication, projection-aware retries, and reconnect refreshes.

Do **not** retain TanStack DB in the production web client for now. The DB
prototype proves that live joins and optimistic local transactions work, but the
current Herald surface has two server lists, simple selectors, and no real
client push transport yet. The additional collection lifecycle and bundle
surface do not currently buy enough value over explicit Query data plus pure
selectors. The Query path is also easier for future agents to trace against the
existing API and to debug when projection or authorization failures occur.

This is a recommendation for the current client boundary, not a rejection of
TanStack DB in perpetuity. Re-evaluate it if Herald gains several normalized
entities shared by queue, calendar, inbox, and other screens, or if the product
requires many local joins and optimistic workflows that would otherwise be
duplicated across selectors.

## Limits and deliberate non-decisions

- The fixture is not a production latency, throughput, or browser-memory
  benchmark.
- No SSE endpoint, cursor persistence, gap recovery, heartbeat, or server event
  ordering contract was implemented.
- The prototype does not replace `DashboardContext`, alter the schema, or wire
  real publications into the dashboard.
- The event contract still needs a production decision about whether events are
  emitted after projection, or whether clients should always perform the
  bounded catch-up retry used here.
- The reconnect path currently uses a full refresh. A production transport
  should persist the last accepted sequence/cursor and define gap behavior.
- The route is intentionally isolated at
  `/dashboard/projects/:projectId/realtime-prototype` and is not linked from
  the product navigation.

## Proposed follow-up subtasks

1. Define the authenticated project event transport and cursor contract, with
   server-side authorization and post-projection ordering semantics.
2. Integrate the Query coordinator behind a narrow web data boundary without
   rewriting `DashboardContext`; cover queue, calendar, and inbox consumers.
3. Add a real reconnect/gap test against the durable event and notification
   projection path, including stale or duplicate sequences.
4. Add browser-level validation for the chosen production boundary and record
   a bundle budget before enabling push updates broadly.
5. Revisit TanStack DB only if normalized cross-screen views or optimistic
   workflows demonstrate material duplication with the Query/selectors design.

## References

- TanStack DB overview: https://tanstack.com/db/latest/docs/overview
- TanStack DB installation: https://tanstack.com/db/latest/docs/installation
- TanStack Query invalidation: https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation
- TanStack Query invalidations from mutations: https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations
- `ISSUE-050`: Keep notifications and project work views synchronized

## Adoption

The project owner accepted the TanStack Query recommendation before the
production integration. REALTIME-103 adopts Query for the authenticated project
cache and keeps the SSE transport as an invalidation signal; TanStack DB remains
deferred pending a concrete normalized-join or optimistic-workflow need.
