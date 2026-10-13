# ADR-054 — Keep Query-Time Operational Analytics Within a Provisional Envelope

- Status: accepted
- Date: 2026-09-08
- Scope: operational analytics reads over the SQLite current state and fact journal
- Provenance: ISSUE-057, ANALYTICS-111, ADR-053
- Related decisions: ADR-028, ADR-042, ADR-051, ADR-053

## Context

ANALYTICS-110 showed that the first operational analytics reader became too
expensive at a synthetic 20,000-publication history. The reader already
streamed SQLite rows and retained compact outcome references, but the benchmark
still reported roughly five seconds for a warm read. A projection would make
repeated reads cheaper, but would also add a cursor, replay, rebuild, freshness,
retention, and crash-recovery lifecycle.

Before choosing another storage engine or a projection, ANALYTICS-111 measured
and removed costs that were independent of SQLite's ability to scan the fact
journal:

- current publication, job, and retryable-pending snapshots are aggregate-only
  and no longer request unused SQL ordering;
- the historical bucket path reuses timezone formatters instead of constructing
  one `Intl.DateTimeFormat` for every fact metric;
- duplicate-attempt detection uses a bit mask rather than allocating one
  action `Set` for every retained attempt;
- the benchmark separates first-read memory from repeated-refresh memory and
  forces garbage collection before those measurements.

The resulting synthetic reference measurements were:

| Publications | Facts | Warm median | Warm p95 | First-read RSS delta | After repeated refreshes |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 4,008 | 24 ms | 25 ms | +21 MiB | +41 MiB |
| 5,000 | 20,040 | 130 ms | 132 ms | +37 MiB | +63 MiB |
| 20,000 | 80,160 | 565 ms | 580 ms | +115 MiB | +281 MiB |

The last column is the process RSS after two warmups and nine measured reads;
it is a stress signal, not proof of a memory leak. The fixture is one process,
one project, one channel, no concurrent requests, no provider calls, and Bun
1.4.0 on Linux x64. It is not a universal capacity promise.

## Decision

Keep query-time operational analytics as the V1 implementation and keep SQLite
as the authoritative source of truth. The public analytics contract, project
authorization, half-open time ranges, and truthful coverage fields remain
unchanged.

Treat at most 5,000 publications and 20,000 historical facts per interactive
request as the provisional benchmark envelope for the current query-time path.
This is an engineering boundary for planning and capacity discussions, not a
new runtime rejection or API limit. A 20,000-publication history remains a
stress boundary: it is materially faster after hardening, but repeated reads
still consume significant process RSS.

Do not add a projection or DuckDB solely because the synthetic stress fixture
exists. Start ANALYTICS-113 only when retention, refresh frequency, concurrent
readers, write interference, or real project history demonstrates that the
provisional envelope is insufficient. The first projection candidate remains a
rebuildable SQLite projection; an optional DuckDB projection requires the
separate gate in ADR-053.

## Consequences

Postbot avoids a second durable analytics lifecycle while the product is still
early, and the current read model is substantially cheaper without changing its
meaning. Operators still have a clear warning boundary rather than an implicit
promise that arbitrary history is inexpensive.

The current path is not a substitute for a projection at larger or concurrent
scales. ANALYTICS-113 must define the cursor, rebuild and backfill procedure,
freshness state, retention, crash recovery, and resource budget before such a
projection is made part of the product contract.

## Revisit criteria

Revisit this decision when a representative workload demonstrates one or more
of the following:

- interactive reads within the provisional envelope miss the agreed latency or
  memory budget;
- projects routinely exceed the provisional envelope and need repeated
  dashboard refreshes;
- analytics reads interfere with publication writes, scheduling, or realtime
  delivery;
- retention and refresh requirements make replaying the journal per request
  materially more expensive than maintaining a rebuildable projection.
