# ADR-051 — Establish a Query-Time Operational Analytics Foundation and Provider Data Boundary

- Status: proposed
- Date: 2026-09-07
- Scope: operational analytics read models, metric semantics, and provider-owned engagement data
- Provenance: ISSUE-054, ANALYTICS-107, ANALYTICS-89
- Related specs: [SPEC-003](../specs/SPEC-003-product-foundation.md), [SPEC-005](../specs/SPEC-005-continuous-product-scope.md)
- Related decisions: [ADR-005](ADR-005-use-sqlite-first-persistence.md), [ADR-008](ADR-008-enforce-project-scoped-domain-state.md), [ADR-009](ADR-009-fence-external-effects-with-durable-claims.md), [ADR-028](ADR-028-use-audit-events-as-execution-journal.md), [ADR-037](ADR-037-use-one-versioned-fact-journal.md), [ADR-038](ADR-038-project-durable-facts-into-recipient-owned-notifications.md), [ADR-042](ADR-042-derive-analytics-from-the-fact-journal.md), [ADR-050](ADR-050-post-commit-project-realtime-signal.md)
- Supersedes: none; this record refines the accepted source decision in ADR-042

## Context

Herald has two durable kinds of information that are useful for analytics:

- Current-state tables describe what is true now. `publications` owns the current
  publication lifecycle, delivery mode, schedule, and outcome. `jobs` owns the
  current automatic execution state, claim, lease, attempt count, and due time.
  `channels` and `publishers` provide the current channel and provider
  configuration.
- `audit_events` is the single append-only, versioned fact journal. It is written
  transactionally with the state transition it describes, has a non-reusable
  append sequence, and is readable through a project-scoped cursor. Automatic
  execution records claims, effect-boundary crossings, outcomes, retries, and
  recovery. Manual publication and reconciliation paths record their own
  publication facts.

Notifications are already a separate projection of the journal. Their recipient,
preference, presentation, acknowledgement, and delivery semantics make them an
incorrect source for operational measurements. The journal is also not an event
queue: analytics must not acknowledge, delete, or mutate journal facts.

ANALYTICS-89 added a narrow query-time store, an authenticated project analytics
route, and regression coverage on `main`. That baseline is useful evidence, but it
does not yet define the distinction between current snapshots and ranged history,
queue and workload measures, latency semantics, historical dimension snapshots,
data-quality handling, or provider engagement. This record defines the target
contract; this change intentionally does not modify the existing tables, routes,
aggregations, or UI.

The word “analytics” currently hides two different ownership problems:

1. Herald operational analytics must explain publication work that Herald created,
   scheduled, claimed, attempted, retried, completed, failed, or left ambiguous.
2. Provider engagement analytics must report data such as likes, impressions,
   clicks, and reactions only when an individual provider exposes that data with
   the required permission and scope.

Conflating these categories would make a successful HTTP delivery look like user
engagement, turn a provider's missing metric into a misleading zero, and force
provider-specific authorization and retention rules into Herald's provider-neutral
workflow model.

## Decision

Adopt a query-time hybrid operational read model with a strict provider engagement
boundary:

- Use current Herald tables for current inventories and workload snapshots.
- Use the durable fact journal for historical lifecycle, execution, retry,
  recovery, and latency facts.
- Keep the first operational implementation query-time and read-only. Do not add
  analytics tables, a second event stream, a collector, a broker, a telemetry
  service, or a dashboard as part of this decision.
- Preserve one typed operational contract while allowing a future materialized
  projection behind that contract if measured query cost justifies it.
- Keep provider engagement in provider-owned observations and a separate
  provider-facing read model. It is optional, provider-specific, and never part
  of the operational source of truth.

The hybrid in this decision describes the sources of truth, not two competing
histories. `publications` and `jobs` remain authoritative for current state;
`audit_events` remains authoritative for historical Herald facts. A future
analytics projection, if needed, is a cache derived from those sources and is not a
new authority.

### Source and ownership map

| Read-model concern | Authoritative source | Semantics |
| --- | --- | --- |
| Current publication inventory | `publications`, joined to `channels` and current publisher configuration | One row per publication as observed at request evaluation time |
| Current execution and queue state | `jobs` joined to `publications` | One active job per project/publication; `pending` and `running` are current work, not historical event counts |
| Historical publication lifecycle | Versioned `audit_events` facts for publication subjects | Count supported transition facts by their occurrence time; do not infer missing transitions from `updated_at` |
| Historical execution attempts and outcomes | Versioned automatic execution facts in `audit_events` | One claim/effect/outcome/recovery fact per durable transition, correlated by job and attempt metadata |
| Notifications | `notifications` and its projection cursor | Recipient-owned presentation state; never an analytics source |
| Provider engagement | Future provider-owned observations/snapshots | External provider data with its own scope, freshness, authorization, retention, and aggregation semantics |

### Herald operational analytics

Operational analytics use only facts that Herald can prove. They must work for a
manual channel with no publisher just as they work for an automatic channel.

#### Publication metrics

- `publication.current_state_count` counts current `publications` rows by the
  exact domain state: `draft`, `scheduled`, `ready`, `publishing`, `published`,
  `failed`, `ambiguous`, or `cancelled`. This is a snapshot and is not filtered
  by a historical time range.
- `publication.current_count` is the number of current publication rows after
  any channel, provider, or delivery-mode filter.
- `publication.created_count` counts distinct publication ids with one supported
  `publication.created` fact in the requested event interval. A replay of the
  same source fact cannot increase the count.
- `publication.lifecycle_transition_count` counts supported facts that enter a
  publication state. It is a transition count, not a distinct-publication count:
  a publication that is failed, promoted again, and failed again has two failure
  transitions. The mapping is explicit:
  `publication.created` uses its recorded initial state;
  `publication.target_promoted` uses the recorded schedule state;
  `publication.ready` enters `ready`;
  `publication.execution.effect_started` enters `publishing`;
  `publication.published`, `publication.execution.succeeded`, and
  `publication.reconciled` enter the recorded target state; and
  `publication.execution.failed`, `publication.execution.ambiguous`, and
  recovery facts use their recorded target state. Unsupported or incomplete
  facts are not guessed from error text or current rows.
- `publication.published_count` is the distinct-publication KPI for definitive
  publication success. Its canonical success facts are manual
  `publication.published`, automatic `publication.execution.succeeded`, and
  `publication.reconciled` with `toState = 'published'`. Attempt counts remain
  separate, so a retry cannot inflate published publications.
- Failure and ambiguity transition counts remain separate. A retryable outcome
  does not count as a terminal failure or as a successful publication. A
  publication that is still `ambiguous` is not treated as published merely
  because an external call may have succeeded.

#### Execution and workload metrics

An execution *attempt* is identified by `(project_id, job_id, attempt)` in the
execution fact metadata. A claim can exist without an external attempt: a lease
may expire before the effect boundary and be recovered safely.

| Metric | Exact semantics |
| --- | --- |
| `execution.scheduled_depth` | Current automatic jobs with `jobs.state = 'pending'`; includes both future and overdue work. Manual scheduled publications are not executions. |
| `execution.due_depth` | The scheduled depth subset whose current `jobs.run_at` is less than or equal to the single `observedAt` used for the response. |
| `execution.claimed_count` | Number of supported `publication.execution.claimed` facts in the event interval. A claim recovered before the effect boundary still counts as a claim. |
| `execution.running_depth` | Current automatic jobs with `jobs.state = 'running'` at `observedAt`. A current running job is the current representation of claimed, unfinished work; there is no separate current claimed state. |
| `execution.attempt_count` | Distinct attempts with a supported `publication.execution.effect_started` fact. A pre-boundary claim recovery is not an attempt. |
| `execution.succeeded_count` | Distinct attempts with `publication.execution.succeeded`; counts definitive automatic publication success, not provider engagement. |
| `execution.failed_count` | Distinct attempts with `publication.execution.failed`; this is terminal automatic failure only. It excludes `retry_scheduled` and ambiguity. |
| `execution.retryable_count` | Distinct attempts with `publication.execution.retry_scheduled` where Herald durably requeued the job. It is the count of accepted retry scheduling, not an inference from a provider error string. |
| `execution.ambiguous_count` | Distinct attempts with either `publication.execution.ambiguous` or `publication.execution.ambiguity_recovered`. These paths are reported separately as direct ambiguity and post-boundary recovery, then may be shown as a total. |
| `execution.claim_recovered_count` | Count of pre-effect lease recoveries. These are useful workload/reliability facts but are not external attempts. |
| `execution.ambiguity_recovered_count` | Count of post-effect-boundary lease recoveries that moved the publication to `ambiguous`. They are not retryable. |
| `execution.retryable_pending_depth` | Current pending automatic jobs whose latest supported execution outcome is `retry_scheduled`. A job that has already been claimed again is running, not retryable-pending. |
| `execution.succeeded_depth` | Current jobs with `jobs.state = 'succeeded'`, joined to a published publication. This is a current job inventory and is distinct from ranged historical success count. |
| `execution.failed_depth` | Current failed jobs whose publication is currently `failed`. Jobs failed while resolving an ambiguous external outcome are excluded from this terminal-failure bucket. |
| `execution.ambiguous_depth` | Current publications with `publications.state = 'ambiguous'` and an external execution history. This is reconciliation workload, not a proof of provider success or failure. |

The current workload read model additionally exposes the facts needed to operate
the queue: `manual_due_depth`, `ambiguous_reconciliation_depth`,
`oldest_due_at`, `next_run_at`, and the split between future scheduled and overdue
automatic work. These are snapshots at `observedAt`; they do not pretend to be a
queue monitor across multiple Herald processes.

#### Delivery latency and retry metrics

Latency values are derived only when both endpoints are durable and comparable.
They are stored and returned as non-negative integer milliseconds; missing
timestamps produce `null`/no sample, never a zero.

- `execution.queue_delay_ms` measures `effect_started` occurrence minus the
  logical run time for that attempt. The claim fact must carry the run time that
  led to the claim; for a retry this is the retry's scheduled run time. This
  distinguishes scheduler/queue delay from provider time.
- `execution.effect_duration_ms` measures the outcome occurrence minus
  `effect_started` for each attempt. It is reported for success, terminal
  failure, retry scheduling, and ambiguity. For ambiguity it means time until
  Herald detected uncertainty, not time until the provider resolved it.
- `publication.scheduled_to_outcome_ms` measures a publication's definitive
  outcome occurrence minus the schedule timestamp that led to that outcome. The
  schedule timestamp must come from a durable creation or promotion fact, not a
  mutable current row when a publication was rescheduled.
- `publication.manual_completion_latency_ms` measures manual scheduled time to
  the manual `publication.published` fact. It is an operator-completion measure,
  not provider delivery latency.
- `execution.retry_scheduled_count`, `execution.claim_recovered_count`, and
  `execution.ambiguity_recovered_count` are the primary retry/recovery measures.
  `execution.retry_rate` is explicitly the event-window ratio
  `retry_scheduled_count / attempt_count` for the same interval; it is not a
  cohort success probability. `execution.attempts_per_publication` is
  `attempt_count / distinct automatic publications with an effect started in
  the interval`.

The first response may return latency summaries as `{ count, totalMs, minMs,
maxMs, averageMs }`. Percentiles and histograms are deferred until a concrete
consumer and measured query strategy justify them. A range that cuts off one end
of a latency pair reports only complete samples in that range and exposes the
effective range; it does not silently reach outside the requested interval.

### Provider and channel dimensions

Every operational metric is project-scoped. Its dimension key is a stable
`channelId`, a provider key, and (where relevant) `deliveryMode`:

- `projectId` comes from the request path and is never an unrestricted group-by
  field in the first contract.
- `channelId` is the publication's channel and is the historical grouping key.
  A current channel name is display metadata, not an identity key; renaming a
  channel must not split or rewrite historical totals.
- For a manual publication, `provider = 'manual'` even if the channel currently
  has an automatic publisher configured. Delivery mode describes the actual
  publication path.
- For an automatic publication, `provider` is the non-secret, stable publisher
  kind used for that attempt. The fact or immutable execution snapshot must
  capture it at the time of execution. A current publisher join must not rewrite
  history after a connection is replaced or removed. If an old fact lacks the
  required snapshot, its provider dimension is `unknown` and its coverage gap is
  explicit; it is never relabeled as manual.
- Provider account ids, credential ids, destination identifiers, source content,
  media bytes, and actor ids are not first-implementation dimensions. They add
  cardinality or sensitivity without answering the initial operational questions.

The first filters are `channelId`, provider key, delivery mode, and the fixed
metric families in the contract. Current-state filters apply to the snapshot;
event filters apply to the fact interval. Filters do not change the definitions
of metrics, and there is no arbitrary SQL or source-content search surface.

For current snapshots, the provider value describes the channel configuration
observed at `observedAt`; historical facts use the provider snapshot attached to
the publication or execution fact. The response must label these as current or
historical dimensions rather than implying that a current connection rewrites
past delivery.

### Event versions and deduplication

The journal's `id` is the identity of a durable fact and its `sequence` is the
ordering key. A query-time reader counts a supported fact once by its journal id;
a future projection uses `(project_id, source_event_id)` as its idempotency key.
The append sequence is never used as a metric value and is never reused after
project deletion.

Execution metadata is a correlation key, not a replacement for fact identity:

- Do not deduplicate all `publication.execution.effect_started` or retry facts by
  publication id. Distinct attempts for one publication are real and must remain
  visible.
- For an attempt-level metric, group by `(project_id, job_id, attempt)` only to
  prevent the same attempt from being counted twice in a derived measure. A
  future projector must not collapse distinct attempt numbers.
- A supported attempt has at most one terminal outcome fact. If contradictory
  terminal facts or multiple incompatible versions are found for one attempt,
  the read model reports a data-quality gap and does not select a winner by
  accident.
- Publication-level success is deduplicated by publication id using the canonical
  success action set above. This prevents a future generic success fact from
  being added on top of an existing automatic success fact.
- Only explicitly supported `(action, event_version)` pairs are actionable.
  Unknown event versions are not coerced to the newest schema. The response's
  coverage metadata or server diagnostics must make skipped facts visible to
  operators, so “zero” never means “the reader understood every fact.”
- Equal occurrence timestamps are ordered by journal sequence. Bucket assignment
  uses occurrence time; sequence resolves ties and gives deterministic rebuilds.

### UTC storage, project time zone, and user display time zone

- Persist all event, job, publication, observation, and latency endpoints as UTC
  epoch milliseconds. The journal's occurrence timestamp is the canonical time
  for historical facts; insertion order is only its tie-breaker.
- Evaluate one `observedAt` per response in UTC. Current inventories and workload
  measures are consistent snapshots relative to that value.
- Historical intervals are half-open `[from, to)`: `from` is inclusive and `to`
  is exclusive. This makes adjacent windows composable without double-counting
  a boundary event.
- Daily buckets use the project's stored IANA time zone. The response includes
  the local bucket date and its UTC start/end so a daylight-saving transition
  never becomes a guessed 24-hour period.
- The project time zone is the bucket authority for shared analytics. A user's
  display time zone may format UTC timestamps or labels in a client, but it must
  not re-bucket or change the count. A future explicit display-time-zone option
  is presentation-only and must be returned separately from `projectTimeZone`.

The target API policy uses a bounded historical window: `from` and `to` are finite
non-negative UTC milliseconds, `from <= to`, explicit `to` cannot be later than
`observedAt`, and one query covers at most 366 days. An omitted historical range
defaults to the preceding 30 days ending at `observedAt`. Longer history is
retrieved through adjacent windows; this read guard is not a retention policy.
Current snapshot fields are available independently of the historical range.

### Operational API and read-model shape

Keep the authenticated project analytics surface as a typed, read-only
operational contract. The existing `/api/projects/:projectId/analytics` path can
carry this contract when the implementation task revises its provisional shape;
no provider engagement fields are added to it.

The response is versioned and separates snapshot from history so a caller cannot
mistake a current state count for a count within the requested interval:

```text
{
  contractVersion: 1,
  projectId,
  projectTimeZone,
  observedAt,
  range: { from, to },
  current: {
    publications: { total, byState, byDeliveryMode, byDimension },
    executions: {
      scheduled, due, running, retryablePending,
      succeeded, failed, ambiguous
    },
    workload: {
      manualDue, ambiguousReconciliation, oldestDueAt, nextRunAt
    }
  },
  historical: {
    publications: { created, published, lifecycleTransitions },
    executions: {
      claimed, attempts, succeeded, failed, retryable, ambiguous,
      claimRecoveries, ambiguityRecoveries
    },
    retries: { scheduled, rate, attemptsPerPublication },
    latency: {
      queueDelay, effectDuration, scheduledToOutcome, manualCompletion
    },
    buckets: [
      {
        bucketDate, bucketStartUtc, bucketEndUtc,
        dimensions, metrics
      }
    ]
  },
  coverage: { supportedFactVersions, skippedFactCount, dataQuality }
}
```

Counts are integers. Latency summaries are nullable when there are no complete
samples. Dimension arrays use stable ids and explicit provider/delivery-mode
values. The contract does not return raw journal rows, payloads, error messages,
credentials, source content, media bytes, or provider engagement values.

Provider engagement uses a separate provider-owned read model, for example an
observation envelope with:

```text
{
  contractVersion,
  projectId,
  provider,
  scope: { type: 'publication' | 'channel' | 'account', id },
  observedAt,
  fetchedAt,
  freshness,
  availability,
  metrics: [{ name, value, unit, observedAt, source }]
}
```

The exact metric names, units, scope, polling/webhook behavior, pagination,
authorization, and retention belong to the provider module. The neutral envelope
only carries provenance and freshness; it does not turn `likes`, `impressions`,
`clicks`, or `reactions` into a universal Herald metric vocabulary.

An absent provider metric is represented as `not_supported`, `not_authorized`,
`not_configured`, or another explicit availability state. It is never represented
as zero. A provider's cumulative snapshot must not be summed as a time series
without provider-owned rules for deltas and resets. Engagement observations do
not mutate publications, jobs, or the operational journal.

### Authorization and data isolation

The analytics read model follows the existing project access boundary:

- A request is authorized through the project-scoped Herald actor/access-token
  relationship. Human, agent, and API-token subjects may read according to the
  existing route policy; a provider credential is not an analytics permission.
- The project id is bound before any publication, job, channel, publisher, or
  engagement join. Every query and future projection key includes `project_id`.
- An inaccessible project returns the same not-found behavior used by the
  project routes, avoiding project-existence disclosure. No first implementation
  supports an unrestricted cross-project or organization-wide aggregate.
- A future engagement reader uses the same project authorization and resolves
  provider credentials only inside the provider integration boundary. It never
  returns credential material or allows one project's observation to be joined to
  another project's publication.
- Project deletion removes its current state, journal, and any future projections
  or observations through the same project-owned lifecycle. It must not cause
  cursor reuse or make another project inherit a metric row.

### Retention and rebuild

The first operational implementation has no analytics-specific purge. It follows
the existing audit fact lifecycle: facts remain available for the lifetime of the
project and are removed with project deletion. Current publication and job rows
remain authoritative for current snapshots. The 366-day query guard limits work,
not historical retention.

Because the first read model is query-time, it has no projection cursor and no
analytics rebuild job. Rebuilding means rerunning the same versioned query over
the retained current rows and journal facts.

If measured volume later requires materialization, the projection must:

1. Keep a project-scoped cursor over the journal's opaque append sequence.
2. Store the source event id and projection version for replay-safe idempotency.
3. Preserve raw `audit_events` for the declared rebuild horizon; never purge the
   only source before proving that a rollup covers its promised range.
4. Be backfillable into a new projection version from current rows and facts,
   with deterministic sequence ordering and explicit handling of unknown event
   versions.
5. Be compared with the query-time reference before a read cutover. A projection
   outage or lag must be visible as stale coverage, not silently reported as
   current truth.

Provider engagement observations may have a shorter, provider-specific retention
or freshness policy, but that policy is declared in the provider read model and
does not alter operational retention or counts.

### Performance and indexing constraints

The query-time target is appropriate for the current SQLite-first singleton while
the journal volume and read shapes are still unproven. The implementation must:

- Bound historical reads by project and `[from, to)`, select only supported
  publication actions/versions, and avoid scanning notification payloads or
  source/media content.
- Aggregate in the database where practical and keep application memory bounded
  by the number of returned dimensions/buckets, not by an unbounded all-project
  event dump. Metadata JSON is parsed only for fields in the supported contract.
- Keep current snapshot queries read-only and short. Queue queries must use the
  `jobs` state/run-time and lease indexes, and publication inventory must use the
  project/channel/state dimensions before joining current publisher configuration.
- Preserve and use the existing journal indexes for project/sequence, project/time,
  and project/entity. If `EXPLAIN QUERY PLAN` or a representative fixture shows
  action filtering or ordered range reads are the bottleneck, the next migration
  may add covering shapes such as
  `(project_id, entity_type, created_at, sequence)`,
  `(project_id, action, created_at, sequence)`,
  `(project_id, state, run_at)`, or
  `(project_id, state, lease_expires_at)`. This ADR is an index plan, not a
  migration.
- Keep dimension cardinality bounded by project channels and provider keys. Do
  not expose arbitrary provider payload keys as group-by fields.
- Benchmark representative event volume, range length, retries, and channel
  count before selecting a materialized projection. A projection is justified by
  measured read latency, memory, lock contention, or retention needs, not by a
  hypothetical scale target.

### First implementation boundary

The implementation that follows this ADR may add a typed database read model and
its authenticated API contract, plus focused tests, but it must not add:

- analytics tables, migrations, projection cursors, background collectors, or a
  second event stream;
- provider polling, provider webhooks, provider engagement tables, or external
  telemetry;
- a dashboard, charts, exports, alerts, or UI-specific metric shaping;
- cross-project, organization, billing, quota, or benchmarking analytics;
- source-content, media, credential, external-account, or actor-behavior metrics;
- predictive delivery, SLA, follower-growth, sentiment, attribution, or
  recommendation features;
- percentile/histogram infrastructure without a concrete consumer and benchmark;
- inferred likes, impressions, clicks, reactions, or other provider-owned values;
- changes to the notification projection or use of notifications as a metric
  source.

The first implementation must instead prove current-vs-historical separation,
manual and automatic dimensions, all execution classes, retry/recovery semantics,
latency boundary behavior, half-open ranges, DST-aware project buckets,
unknown-version handling, duplicate/replay safety, authorization, and project
isolation.

## Alternatives considered

### Derive every metric directly from the durable journal

Using `audit_events` alone is attractive because it is canonical, transactional,
attributable, and rebuildable without another table. It is the correct source for
historical transitions and attempts. It is not sufficient as the sole read source:
current queue depth, current publication state, leases, due work, and current
workload are authoritative in `publications` and `jobs`. It also cannot safely
reconstruct mutable historical dimensions or latency endpoints that were never
captured in a fact. Journal-only is therefore rejected as the complete read-model
architecture, while journal facts remain part of the chosen hybrid.

### Dedicated analytics projection tables immediately

A materialized table could make grouped reads fast and could snapshot dimensions,
but it would add another write path, cursor, deduplication key, migration surface,
freshness lag, and rebuild contract before the product has established its query
shape or volume. It risks becoming an accidental second source of truth. Immediate
materialization is rejected; a versioned projection remains a measured future
optimization behind the same contract.

### Current tables only

Reading only `publications`, `jobs`, and configuration tables is efficient for a
current dashboard but loses retries, pre-boundary claim recoveries, attempt
durations, ambiguity detection, and historical transitions overwritten by later
state. It is rejected as the complete source.

### Query-time versus pre-aggregation

Query-time aggregation is chosen first because it has no synchronization lag or
new durable state, matches the current SQLite singleton, and gives a correctness
reference for any later rollup. Pre-aggregation is appropriate only when measured
query cost, lock contention, or retention requirements justify the extra lifecycle.
It must retain raw facts, be replay-safe, and be verified against query-time
results before becoming the serving path.

### Notifications or an external telemetry service as the source

Notifications are recipient-owned and deliberately omit transient execution noise;
they cannot answer operational questions. A third-party telemetry service would
add privacy, availability, dependency, and self-hosting costs and still could not
prove Herald's durable state. Both are rejected.

### Put provider engagement in the operational contract

Adding a universal `likes`/`impressions` field would imply that every provider
supports the same metric, scope, freshness, and reset behavior. It would also
encourage callers to treat missing data as zero. Provider engagement is therefore
kept in a separate provider-owned contract with explicit availability and
freshness.

## Consequences

### Positive

- Herald can answer useful operational questions without any provider analytics
  API, including manual-channel work, queue pressure, retry behavior, and
  ambiguous outcomes.
- Current state and historical facts retain their existing ownership and
  transaction boundaries. No analytics write can weaken publication or workflow
  correctness.
- Query-time aggregation keeps the first implementation small, SQLite-first,
  rebuildable, and free of a new dependency or service.
- The response shape makes current snapshots, ranged history, latency, retries,
  and data coverage explicit rather than relying on ad hoc counters.
- A future provider integration can add engagement without changing the
  provider-neutral core or rewriting operational metrics.

### Costs and risks

- Historical analytics are limited by the completeness and versioning of facts
  already emitted. Missing provider snapshots or latency endpoints must remain
  visible as coverage gaps until the workflow fact contract is strengthened.
- Query-time reads consume SQLite resources and require bounded ranges and
  appropriate indexes. A high-volume project may eventually need a projection.
- Provider engagement needs separate implementation work for permissions,
  pagination, freshness, cumulative-snapshot semantics, rate limits, and
  provider-specific retention.
- Current provider configuration and historical provider dimensions can diverge;
  the implementation must label current configuration separately and never
  silently rewrite history.

## Verification and acceptance criteria

The future implementation is acceptable when focused deterministic tests prove:

- all publication current states are counted exactly once in the snapshot;
- manual and automatic publications use the correct `manual`/provider dimension;
- historical creation and canonical success counts do not double-count a
  publication, while retries and repeated lifecycle transitions remain visible;
- claims, effect attempts, success, terminal failure, retry scheduling, direct
  ambiguity, pre-boundary recovery, and post-boundary ambiguity are distinct;
- latency samples use durable endpoints, exclude incomplete pairs, and never
  represent ambiguity as success;
- `[from, to)` boundaries, default/effective ranges, equal timestamps, DST
  buckets, and UTC output are deterministic;
- duplicate/replayed facts, unknown event versions, and contradictory attempt
  outcomes produce the documented idempotent or data-quality behavior;
- project authorization and all joins remain project-isolated for session,
  agent, and project-token callers;
- no notification, provider credential, source content, media, or engagement
  value leaks into the operational response;
- representative SQLite fixtures meet the measured query and memory budget, or
  the evidence is recorded for a separate projection decision.
