# ADR-060 — Define a Replayable SQLite Analytics Projection Beyond the Interactive Envelope

- Status: proposed
- Date: 2026-09-10
- Scope: historical operational analytics projection and serving boundary
- Provenance: ANALYTICS-113, ISSUE-057, ADR-053, ADR-054
- Related decisions: ADR-028, ADR-037, ADR-042, ADR-051, ADR-053, ADR-054, ADR-055
- Superseded by: none

## Context

Herald's operational analytics reader currently reconstructs historical metrics
from `audit_events` at request time and reads current inventory from
`publications` and `jobs`. ANALYTICS-111 established a useful but provisional
interactive envelope: approximately 5,000 publications and 20,000 historical
facts per request. The 20,000-publication synthetic fixture took about 565 ms
warm median and retained approximately 281 MiB after repeated refreshes. That
is evidence for a future projection boundary, not evidence for a new source of
truth or a second database.

The database already provides the properties a projection needs:

- `audit_events.sequence` is a project-readable, monotonic append sequence;
- `audit_events.id` is the durable fact identity;
- the journal is written in the same transaction as the domain transition;
- notification projections demonstrate atomic cursor advancement and
  source-event idempotency;
- SQLite backup and restore already include the database file atomically.

The projection must not use notifications, provider credentials, provider
analytics observations, source content, or media as inputs. It must also not
derive historical dimensions from current publisher configuration: a channel
or publisher can be renamed, replaced, or removed after a fact was written.
Some older facts do not contain a complete immutable dimension snapshot, so a
projector that silently joins current rows would not be replay-deterministic.

## Decision

Define, but do not yet ship, a versioned SQLite historical projection behind
the existing storage-neutral analytics contract. The first implementation is
deferred until a representative workload demonstrates a need beyond the
ADR-054 envelope and the event-dimension compatibility rules below are accepted.
SQLite remains the authoritative store; projection rows are disposable,
rebuildable cache state.

### Inputs and normalization

The projector reads only the following sources:

1. `audit_events`, scoped by `project_id` and ordered by `sequence`, for
   historical publication and execution facts;
2. `projects.time_zone`, captured when a projection version is built, for
   deterministic local-day bucket boundaries;
3. `publications` and `jobs` only for the live current snapshot served beside
   the projection. They are not historical enrichment inputs;
4. provider-owned observation tables only through their separate provider
   analytics contract. They are never joined into operational facts.

Projection version 1 accepts `entity_type = 'publication'`, event version 1,
and the action vocabulary already implemented by `analytics-store.ts`:
publication creation, target promotion, ready, published, reconciliation,
claim, effect start, success, retry scheduling, failure, ambiguity, claim
recovery, ambiguity recovery, and cancellation. Unsupported actions and
unknown event versions are still checkpointed as scanned coverage rows; they
are not interpreted as metrics.

The normalizer parses only the allow-listed metadata needed by the current
contract: channel id, provider, delivery mode, job id, attempt, run time,
schedule time, target state, and effect-start/completion timestamps. It stores
no raw metadata JSON. A missing or malformed value becomes an explicit null or
`unknown` dimension plus a quality flag. It is never recovered from a current
publisher or publication join. A future event-version change requires a new
projection version and a side-by-side rebuild.

### Derived tables and indexes

The implementation should add a migration with project-scoped composite keys
and foreign keys to `projects`. The names below are the target shape; the
implementation may use equivalent Drizzle definitions.

`analytics_projection_cursors` stores one row per
`(project_id, projection_version)`:

```text
project_id, projection_version, state,
cursor_sequence, source_latest_sequence, source_latest_occurred_at,
project_time_zone, started_at, last_success_at, last_error,
created_at, updated_at
```

`state` is `backfilling`, `catching_up`, `live`, `stale`, `failed`, or
`retired`. `cursor_sequence` is an opaque checkpoint represented internally as
the source sequence integer; it is not an analytics value. A unique index on
`(project_id, projection_version)` is required.

`analytics_projection_facts` is the normalized, source-addressable history:

```text
project_id, projection_version, source_event_id, source_sequence,
event_version, support_state, quality_flags,
action, occurred_at, publication_id, job_id, attempt,
channel_id, provider, delivery_mode, target_state,
scheduled_at, run_at, effect_started_at
```

`(project_id, projection_version, source_event_id)` is the idempotency key;
`(project_id, projection_version, source_sequence)` is also unique. Required
indexes are `(project_id, projection_version, occurred_at, source_sequence)`,
`(project_id, projection_version, action, occurred_at)`, and
`(project_id, projection_version, publication_id, source_sequence)`. An
additional `(project_id, projection_version, job_id, attempt, source_sequence)`
index supports attempt reconstruction. Facts are retained without raw payloads
so coverage and deterministic replay remain inspectable.

`analytics_projection_attempts` is one derived row per
`(project_id, projection_version, job_id, attempt)`. It stores the normalized
dimension, claim/effect/outcome timestamps, terminal outcome action, recovery
classification, queue delay, effect duration, source first/last sequence, and
quality flags. Its unique attempt key prevents a replay from collapsing or
duplicating distinct attempts. Index it by outcome time, effect-start time,
publication, and dimension:

```text
(project_id, projection_version, outcome_at),
(project_id, projection_version, effect_started_at),
(project_id, projection_version, publication_id, outcome_at),
(project_id, projection_version, channel_id, provider, delivery_mode, outcome_at)
```

`analytics_projection_daily` stores additive closed-day rollups keyed by
`(project_id, projection_version, bucket_start_utc, channel_id, provider,
delivery_mode)`. It contains publication lifecycle counts, execution counts,
retry/recovery counts, latency sample count/sum/min/max, and data-quality
counters. The bucket row stores `bucket_end_utc` and the projection's time
zone version. Index it by `(project_id, projection_version,
bucket_start_utc)` and `(project_id, projection_version, channel_id, provider,
delivery_mode, bucket_start_utc)`.

Current publication and job snapshots remain query-time reads against their
authoritative tables. The projection is for historical work: full closed days
can use daily rollups, while partial first/last days use normalized facts and
attempts. This avoids stale queue depth and makes arbitrary half-open ranges
exact without requiring an unbounded interactive scan.

### Replay, idempotency, and ordering

Each projector batch runs in one SQLite transaction:

1. read at most a fixed page of journal rows after the stored project cursor,
   ordered by `sequence`;
2. insert each normalized fact with `ON CONFLICT DO NOTHING` on its source
   identity;
3. only for newly inserted facts, update the affected attempt and daily
   rollup; retain explicit quality counters for skipped or malformed facts;
4. advance `cursor_sequence` to the last scanned source sequence, including
   unsupported events;
5. commit the fact, derived rows, quality state, and cursor together.

A crash before commit rolls back all work and replays the batch. A crash after
commit observes the advanced cursor and the source-key conflict. Reprocessing
the same source fact therefore has no metric effect. Journal `sequence` is the
ordering key; `occurred_at` orders bucket placement, with sequence breaking
equal timestamps. `(job_id, attempt)` groups attempt facts but never replaces
`source_event_id` identity. More than one terminal action for an attempt is a
data-quality contradiction, not a reason to choose a winner.

The optional post-commit project signal may wake the projector, but startup
must always compare the cursor with the journal's latest sequence and catch up
without relying on the signal. A projector never acknowledges, deletes, or
rewrites journal facts.

### Backfill, rebuild, and cutover

Projection versions are built side by side; a migration creates empty tables
but does not switch reads. A rebuild follows this procedure:

1. create a new projection-version cursor in `backfilling` state and capture
   the project's current time zone;
2. replay from sequence zero in bounded transactions until the initial
   high-water sequence is reached;
3. move to `catching_up`, replaying new facts until the cursor reaches the
   latest sequence and remains caught up for a configured observation window;
4. compare projection results with the query-time reference over representative
   full, partial, DST, retry, ambiguity, duplicate-replay, and unknown-version
   ranges; compare current snapshots directly against current tables;
5. atomically mark the version `live` only after equivalence and health checks
   pass. Keep the previous live version available for rollback until the new
   version's retention horizon is proven;
6. on lag, read failure, or failed comparison, mark the version `stale` or
   `failed` and continue serving the prior version or the query-time reference.

Cutover changes only the analytics read implementation. It never changes
publication, job, journal, notification, provider-observation, or backup
semantics. A cutover must expose the projection version and freshness state in
internal diagnostics, and a fallback must not present stale projected history
as current truth.

### Checkpoints and retention

The cursor is per project and projection version, not process-global. The
projection keeps the source sequence and the last source occurrence time for
operator diagnostics. Project deletion cascades projection rows with the rest
of project state. A source sequence is never reused.

The initial retention policy is the existing project lifetime: retain
`audit_events` and projection history together, with no analytics-only purge.
Daily rollups do not permit earlier journal deletion until an accepted policy
defines a rebuild horizon and proves that the retained normalized facts cover
every promised query range. Provider observation retention remains provider
specific and separate. SQLite backups include the projection tables because
they are in the same database; a restore starts with the stored cursor and
replays any facts committed after the backup if the source database contains
them, or rebuilds the projection from the restored journal when required.

### Bounded interactive reads

The public contract keeps project authorization, current-vs-historical
separation, half-open UTC ranges, project-time-zone buckets, and bounded
dimension filters. A projected read:

- serves current inventory from `publications`/`jobs` at one `observedAt`;
- sums daily rows only for complete buckets and reads normalized edge facts;
- retains the existing maximum range guard or uses adjacent windows rather than
  accepting an unbounded history request;
- bounds page size, bucket count, and returned dimensions;
- returns coverage, source version, and freshness/lag diagnostics through the
  existing typed envelope or an explicitly versioned extension;
- refuses silent projected reads when the cursor is outside the declared
  freshness budget.

The projection does not return raw journal rows, metadata, credentials, source
content, media, actor behavior, or provider engagement values.

### Operational observability

The cursor row and structured logs must provide, at minimum, projection version,
project id, state, cursor sequence, source latest sequence, sequence/event lag,
latest source occurrence time, last successful batch, batch size, scan/insert
counts, skipped unknown-version and unsupported-action counts, invalid metadata,
contradictory attempts, rebuild id, and the last sanitized error. Metrics must
include batch duration, SQLite busy/lock failures, rollup row counts, database
size/backup duration, and cutover comparisons. Logs must not include metadata
payloads, source content, provider identifiers beyond approved dimensions,
credentials, or error messages copied from provider responses.

Operators should alert on a failed projector, persistent lag beyond the
deployment's freshness budget, cursor movement stopping while source sequences
advance, repeated rollback/busy failures, and projection/reference mismatch.
The wakeup signal is an optimization; the cursor and these checks are the
recovery mechanism.

### DuckDB decision boundary

Do not introduce DuckDB in this task. Reconsider it only after a representative
SQLite projection with the indexes and rollups above demonstrates that one or
more of the following remain outside the accepted budget: projected p95 read
latency, projection CPU/RSS, SQLite write interference, database/backup growth,
or provider time-series scan cost. A DuckDB version would still be a derived
consumer of the SQLite journal/cursor, require a native Bun compatibility spike,
resource limits, rebuild and freshness state, and an explicit backup policy.
It would not replace SQLite or become an independent authority.

## Alternatives considered

- **Ship a materialized projection immediately:** rejected for this task. The
  design is now concrete, but no representative product retention/refresh
  requirement authorizes the added migration, cursor, cutover, and recovery
  lifecycle, and legacy historical dimensions are not uniformly immutable.
- **Project only current rows:** rejected because it cannot preserve retries,
  ambiguity, claim recovery, or historical transitions.
- **Use notifications as the projection input:** rejected because notifications
  are recipient-owned presentation state with different retention and
  deduplication semantics.
- **Read current publishers during replay:** rejected because replacing or
  deleting a publisher would rewrite history and make rebuild output depend on
  mutable state.
- **Add DuckDB now:** rejected under ADR-053; the SQLite projection must be
  measured first.
- **Add Redis, RocksDB, or a second event stream:** rejected because none is
  required for the single-process SQLite durability and replay boundary.

## Consequences

The project has a concrete path beyond the current interactive envelope without
creating a speculative second database or weakening SQLite source-of-truth
semantics. The design makes replay, idempotency, freshness, retention,
dimension coverage, and rollback observable before implementation.

The future implementation is intentionally non-trivial: it requires a schema
migration, a projector, a read adapter, comparison tooling, and failure-focused
tests. It also requires an accepted event-dimension policy for legacy facts.
Until those prerequisites and a representative workload exist, the query-time
reader remains the serving path and its ADR-054 envelope remains a planning
boundary rather than a hard API rejection.

## Implementation acceptance criteria

The follow-up implementation is ready for review only when it proves:

- migration and project deletion isolation for all projection tables;
- batch atomicity under an injected failure before cursor commit;
- duplicate/replayed source events are idempotent;
- unsupported actions, unknown versions, malformed metadata, and contradictory
  attempts remain visible as quality coverage;
- distinct attempts and canonical publication success are not collapsed;
- exact half-open ranges, partial buckets, equal timestamps, and DST boundaries;
- backfill and live catch-up produce the same result as the query-time reference;
- cutover, stale fallback, restart recovery, backup/restore, and projection
  version rollback are deterministic;
- bounded reads meet a representative latency/RSS/write-interference budget;
- provider observations and credentials cannot enter the operational projection.
