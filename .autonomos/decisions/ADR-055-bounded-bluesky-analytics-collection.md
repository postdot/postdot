# ADR-055 — Bound the First Real Bluesky Provider-Analytics Collection

- Status: proposed
- Date: 2026-09-08
- Scope: explicit public Bluesky collection, source timestamps, and coverage
- Provenance: ISSUE-056, ANALYTICS-109, ANALYTICS-112, ANALYTICS-114
- Related decisions: ADR-051, ADR-052
- Supersedes: none; this record refines the collection details in ADR-052

## Context

ADR-052 established a persisted observation slice and an explicit Bluesky
collection route. Its first implementation already mapped public profile and
known-post views, but it did not make request timeouts, source timestamps, or
partial collection coverage explicit. A synchronous collection action must not
hang on a provider response or report a complete snapshot when a provider
returned only part of the requested data.

The official Bluesky lexicons define `app.bsky.actor.getProfile` as a public
detailed profile read and `app.bsky.feed.getPosts` as public post hydration by
AT-URI. The latter has a maximum of 25 URIs and has no cursor. Its post view
also defines `indexedAt` and the five engagement counters used by this slice.

## Decision

### Public, bounded reads

The Bluesky analytics package uses only the public AppView origin and sends no
Authorization header. One collection reads one profile and at most 25 known
post URIs in one `getPosts` request. The collector rejects a larger set after
deduplicating repeated URIs. It does not call an author feed, search, firehose,
or any outside-content discovery endpoint. Because the official known-post
endpoint has no cursor, this is a bounded hydration page rather than a
paginated discovery loop.

The fetcher remains injectable. Each request has an AbortController timeout of
10 seconds by default, with an explicit maximum of 60 seconds. The timeout
covers fetch and JSON-body parsing. The action does not retry implicitly;
callers can explicitly repeat a bounded collection. A 429 is persisted as
rate_limited so a later policy can add Retry-After handling without changing
the observation contract.

### Provider response and identity mapping

The reader validates the required provider identity fields before returning an
available result. Profiles preserve the returned DID and handle. Posts
preserve the requested AT-URI, returned CID, author handle, and valid
`indexedAt` source timestamp. A profile `indexedAt` is optional in the
provider view; a post `indexedAt` is required by the post-view lexicon. An
invalid required field makes the subject invalid_response rather than guessing
or storing the raw response.

The provider timestamp is an index/source timestamp, not a guarantee that all
counters were measured at that instant. It is stored as `observedAt` when
valid, while `freshness` remains `unknown` because Bluesky supplies no
freshness SLO for these counters. `fetchedAt` is Herald's UTC timestamp at the
start of the collection and is the idempotency snapshot boundary.

Missing optional counter fields remain `not_reported` with a null value. A
provider-declared unsupported metric is `not_supported`; a real zero is
`measured` with value 0. An omitted requested post is `partial_response`,
whereas an explicit blocked or not-found post keeps its corresponding state.
Timeouts, network failures, rate limits, disabled accounts, authorization
failures, and malformed responses remain distinct.

### Coverage and persistence

The collection response carries a coverage envelope with `complete`, a
`complete`/`partial`/`unavailable` state, requested and measured counts, and
sanitized subject/metric gaps. Any non-measured observation makes
`complete` false. A profile failure with no successfully returned known post
is unavailable; mixed success and failure is partial. The envelope does not
contain provider error text or raw payloads.

The existing project-scoped observation table remains the source for persisted
data. The migration adds only the `partial_response` availability state; it
rebuilds the SQLite table while copying existing rows. The existing unique
snapshot key preserves idempotence for the same project, provider, subject,
metric, and `fetchedAt`, while later fetches retain history. The coverage
envelope is per explicit invocation, not a materialized projection or a
background collection record. Persisted rows retain the per-metric gaps, and
the GET route reads those rows without calling Bluesky.

### Herald publication identity

`publications.external_id` already stores the provider post identifier returned
by a successful publisher outcome. For a Bluesky publication this is the
stable AT-URI needed by `getPosts`, so no fragile second relation is invented.
The publication does not currently retain a CID; the collector records the
provider-returned CID on each observation as the content revision identifier.
If future workflows need revision-level publication history, that is a separate
model decision and is not hidden inside analytics collection.

## Alternatives considered

- Add an account-feed or search cursor to collect more than 25 posts. Rejected:
  it would turn known-content analytics into discovery and exceed this slice's
  privacy, cost, and boundedness boundary.
- Treat an omitted post as not_found. Rejected: the provider response does not
  prove deletion or absence when it omits a requested URI; partial_response is
  the honest state.
- Store collection runs or a materialized coverage projection. Deferred:
  per-observation availability plus the explicit response is sufficient for
  this slice and avoids a second lifecycle, cursor, or rebuild contract.
- Add automatic retries or scheduler policy now. Rejected: explicit repeated
  collection keeps provider cost and rate-limit behavior visible and leaves
  cadence to a separately authorized task.

## Consequences

The collection is a real public-provider read path with deterministic bounds,
abortable failure behavior, explicit coverage, and replay-safe normalized
history. It remains safe for fixture-only tests and does not require a user
credential, publish content, mutate workflow state, or change operational
analytics.

The public counters remain current snapshots subject to AppView indexing,
deletion, deactivation, and rate limits. A separate orchestrated validation
step may invoke the explicit route with public test identities; that step is
not part of CI and must not use real credentials or mutate provider content.
