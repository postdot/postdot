# ADR-053 — Keep SQLite First and Leave an Optional Analytics Engine Boundary

- Status: accepted
- Date: 2026-09-08
- Scope: embedded persistence, operational analytics, provider engagement analytics, and future deployment profiles
- Provenance: ISSUE-057, ANALYTICS-110, ANALYTICS-111, architecture review on 2026-09-08
- Related decisions: [ADR-003](ADR-003-use-a-single-process-singleton.md), [ADR-005](ADR-005-use-sqlite-first-persistence.md), [ADR-006](ADR-006-use-a-next-event-durable-scheduler.md), [ADR-028](ADR-028-use-audit-events-as-execution-journal.md), [ADR-042](ADR-042-derive-analytics-from-the-fact-journal.md), [ADR-051](ADR-051-analytics-foundation-and-provider-data-boundary.md), [ADR-052](ADR-052-bluesky-provider-analytics-observations.md)
- Supersedes: none; this decision records the storage-engine boundary left open by ADR-042 and ADR-051

## Context

Herald deliberately starts as a single-process, self-hostable application with
SQLite as its transactional source of truth. This gives the default deployment
zero required database or coordination services, a small idle footprint, simple
backup and restore, and one transaction boundary for domain state, durable facts,
jobs, and notifications.

The analytics discussion identified three different concerns:

1. operational analytics over Herald's current state and durable fact journal;
2. provider-owned engagement observations such as followers, likes, views, and
   clicks;
3. a future multi-instance deployment with shared coordination and database
   services.

These concerns have different workloads. A large SQLite file does not by itself
imply excessive RAM usage or require another engine. The current benchmark shows
that query-time reconstruction can become too slow at larger synthetic histories,
but it does not yet demonstrate that SQLite's transactional engine is the root
cause. The first performance question is therefore the read model and its
indexes, not an immediate database replacement.

DuckDB is a credible future embedded OLAP engine for scans, aggregations, and
provider time series. It is nevertheless a separate engine with its own native
runtime, memory and concurrency characteristics. RocksDB is an embedded local
key-value engine, not a drop-in local equivalent of Redis's shared streams,
pub/sub, locks, TTLs, and multi-process coordination.

## Decision

Keep SQLite as Herald's default and authoritative persistence engine.

- Domain state, jobs, durable events, notifications, and the first provider
  observation slices remain in SQLite.
- Operational analytics are first hardened with indexes and, if measured to be
  necessary, a rebuildable projection still backed by SQLite.
- The analytics API remains behind a storage-neutral contract. A future
  materialized projection may be implemented with SQLite or DuckDB without
  exposing the engine to API, web, provider, or domain callers.
- A DuckDB projection is not introduced until a representative benchmark shows
  that a correctly indexed or projected SQLite read model cannot meet the target
  latency and resource budget.
- If DuckDB is introduced, SQLite remains the source of truth. DuckDB receives
  derived data through a durable cursor and can be rebuilt after a crash or data
  loss. A post-commit signal may wake the projection, but the signal is never the
  only recovery mechanism.
- RocksDB is not added as a general Redis substitute or as a second authoritative
  job store. It may be reconsidered only for a narrowly defined local capability
  after a benchmark demonstrates a need that SQLite cannot meet.

Herald does not promise that the embedded and distributed deployments have
identical execution semantics. They share domain contracts and capability
boundaries, while infrastructure implementations may differ:

| Capability | Embedded profile | Future scaled profile |
| --- | --- | --- |
| Transactional domain state | SQLite | PostgreSQL or another server database |
| Durable event journal | SQLite | Shared server database |
| Local process wakeup | In-process signal | Shared broker or database facility |
| Distributed lease or lock | Not required by the singleton | PostgreSQL or Redis-backed implementation |
| Shared event transport | Not required | Redis or another shared transport |
| Heavy analytics projection | SQLite first, DuckDB if measured | Deployment-specific projection |

Ports must describe these capabilities and their guarantees rather than pretend
that SQLite, RocksDB, Redis, and PostgreSQL are interchangeable drivers.

## Consequences

The default deployment remains small, inexpensive while idle, and easy to
backup. A growing database will be monitored through query latency, write
interference, page-cache/RSS behavior, disk growth, checkpoint health, and
backup/restore time rather than file size alone.

The first analytics hardening step stays within the existing durability model.
It avoids a second file, a second migration stream, cross-database consistency,
and an additional native dependency before those costs are justified.

Adding DuckDB later remains feasible but is not a driver swap. It requires a
versioned projection schema, durable cursor, replay and rebuild behavior,
freshness semantics, backup policy, resource limits, and a verified Bun/native
integration. Provider observations may be a stronger future candidate than
operational lifecycle facts because they are naturally historical and
provider-specific, but the same measurement gate applies.

RocksDB does not provide horizontal scaling for Herald: a writable database is
owned by one process, so separate Herald instances would still need a shared
coordination service. PostgreSQL plus Redis is therefore treated as a future
deployment profile with different concurrency and failure semantics, not as a
second backend that must be implemented now.

## Revisit criteria

Reopen this decision only when one or more of the following is demonstrated on
representative hardware and data:

- the indexed or projected SQLite analytics path misses the agreed p95 latency;
- historical provider observations reach a scale where repeated analytical scans
  materially affect the API or worker;
- analytical reads interfere with publication writes or scheduler processing;
- backup, restore, retention, or disk usage becomes operationally unacceptable;
- multiple Herald processes or hosts become a real supported deployment target;
- a small Bun compatibility spike proves that an embedded DuckDB projection can
  be shipped without undermining the single-package deployment contract.

Until then, adding another embedded database would increase complexity without
proven product value.
