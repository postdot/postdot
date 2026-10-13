# ADR-052 — Add a Bounded Bluesky Provider-Analytics Observation Slice

- Status: proposed
- Date: 2026-09-08
- Scope: the first provider-owned analytics collector and persisted read model
- Provenance: ISSUE-056, ANALYTICS-109, ANALYTICS-112
- Related decisions: ADR-051 (analytics foundation and provider data boundary), ADR-008 (project-scoped domain state), ADR-042 (fact-journal analytics)
- Supersedes: none

## Context

Postbot's operational analytics describe publication and execution facts owned by
Postbot. Bluesky counters describe a different source of truth and can be
missing, delayed, unavailable, or provider-specific. ANALYTICS-109 identified a
small public Bluesky read surface that can prove the provider-owned boundary
without adding a dashboard, a recurring synchronizer, general content
discovery, or a new credential system.

## Decision

Implement the first provider-owned slice as a separate, extensible observation
contract and store:

- Account observations are followersCount, followsCount, and postsCount.
- Known-content observations are likeCount, replyCount, repostCount,
  quoteCount, and bookmarkCount.
- Every observation carries project and provider identity, subject type,
  provider subject identity, optional Postbot entity identity, metric, value,
  unit, aggregation, reporting period, observed time, fetched time,
  availability, freshness, and provenance.
- Bluesky observations use unit=count and aggregation=cumulative_snapshot.
  They are never added as interval measurements. The public AppView does not
  provide a dedicated counter observation time. Its profile and post views do
  expose source index timestamps; valid indexedAt values may be preserved as
  observedAt, but freshness remains unknown because no provider freshness
  guarantee exists.

The Bluesky package owns provider protocol behavior. It reads
app.bsky.actor.getProfile and app.bsky.feed.getPosts from the public AppView
with an injectable fetcher and no Authorization header. Account identity
preserves the returned DID and handle. Known post identity preserves the AT URI
and returned CID when available. The collector accepts only provider IDs
already retained by Postbot publications; it does not enumerate an account feed
or search the network. A collection contains at most 25 known posts.

The database owns no provider payloads or credentials. It stores an immutable
snapshot row. A unique key on
(project, provider, subject type, provider subject ID, metric, fetchedAt)
turns a repeated collection at the same fetch instant into a duplicate while
different fetch instants remain historical snapshots. The collector
deduplicates repeated post URIs within one request and keeps the first Postbot
publication association. It does not update an existing snapshot with a new
value.

Provider states are explicit: a measured zero is measured with value 0; an
absent counter is not_reported with a null value; blocked, not found, disabled,
temporary failure, rate limit, invalid response, unauthorized, and other
unsupported/configuration states remain distinct. No unavailable state is
converted to zero.

The API exposes two project-authenticated routes:

- GET /api/projects/:projectId/analytics/provider/bluesky reads only persisted
  observations and never calls Bluesky.
- POST /api/projects/:projectId/analytics/provider/bluesky/collect explicitly
  collects one connected Bluesky channel and at most 25 known publications.

No scheduler, UI, cross-provider score, operational analytics field, or
provider credential flow is added.

## Consequences

The slice is safe to test with fixture responses and can be removed or
extended without changing publication execution. Public counters are subject
to AppView indexing, deletion, deactivation, provider limits, and lack of
provider-guaranteed history. A future collector may add freshness policy,
provider-specific reporting periods, or other providers, but must preserve the
same separation and availability semantics.
