# ADR-005 — Use SQLite-First Persistence

- Status: accepted
- Scope: V1 database, ORM boundary, and future PostgreSQL posture
- Provenance: V1 persistence review
- Related specs: [SPEC-001](../specs/SPEC-001-v1-scope.md), [SPEC-003](../specs/SPEC-003-product-foundation.md)
- Superseded by: none

## Context

The supported deployment is a singleton with low write concurrency and modest data
volume. PostgreSQL would add a service, data volume, memory cost, and operational
work. Future hosted or multi-instance needs remain possible but unproven.

## Decision

Use SQLite through Drizzle and Bun's native `bun:sqlite` driver as the only V1
database. Keep schema, migrations, SQL, transaction details, and SQLite tuning in
`packages/db`. Do not build a universal database adapter or duplicate schema for a
hypothetical PostgreSQL backend.

Domain and use-case APIs must not expose Drizzle rows, query builders, or SQLite
handles. Introduce a persistence interface only when a real implementation or test
seam requires it.

## Alternatives considered

- PostgreSQL from the start: operationally mature and scalable, but disproportionate
  for the supported singleton and lightweight self-hosting objective.
- Runtime-selectable SQLite/PostgreSQL support: reduces a possible future migration,
  but adds schema, migration, query, and test complexity before evidence exists.
- A universal repository layer: can hide useful database behavior and creates
  ceremony without a second implementation.

## Consequences

- Deployment and backup can center on the application data volume.
- SQLite-specific features may be used when they improve correctness or performance.
- PostgreSQL support may require a focused rewrite of `packages/db`.
- PostgreSQL is reconsidered only after measured contention, required multi-instance
  operation, managed-database requirements, or unacceptable availability limits.
