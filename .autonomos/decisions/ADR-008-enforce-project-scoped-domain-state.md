# ADR-008 — Enforce Project-Scoped Domain State

- Status: accepted
- Scope: M1 domain invariants, lifecycle separation, and SQLite referential integrity
- Provenance: `DOMAIN-06` and V1 foundation review
- Related specs: [SPEC-001](../specs/SPEC-001-v1-scope.md), [SPEC-002](../specs/SPEC-002-engineering-operating-model.md), [SPEC-003](../specs/SPEC-003-product-foundation.md)
- Related decisions: [ADR-001](ADR-001-separate-channel-from-publisher.md), [ADR-002](ADR-002-separate-post-from-publication.md), [ADR-005](ADR-005-use-sqlite-first-persistence.md), [ADR-006](ADR-006-use-a-next-event-durable-scheduler.md)
- Superseded by: none

## Context

Postbot must support several projects without tenant isolation and must never connect a
post, channel, publication, actor, publisher, or job across project boundaries. The
domain also needs publication and execution state without combining independent
concepts or prematurely implementing the crash-recovery semantics owned by
`WORK-07`.

Application-only validation would leave direct SQL and future code paths able to
persist impossible cross-project relations. SQLite triggers could enforce the same
rules, but would hide central invariants in procedural database behavior.

## Decision

- `packages/core` owns framework-independent entities, creation invariants, and
  explicit `Publication` and `Job` transition rules.
- `Project`, `Channel`, `Publisher`, `Post`, `Publication`, `Job`, and `Actor` remain
  distinct concepts. A publisher belongs to exactly one channel, and a channel has
  at most one publisher. No `ManualPublisher` exists.
- Actors are project-scoped attribution identities. Their kind identifies a human,
  agent, API token, or Postbot system action without coupling the core model to Better
  Auth tables.
- Publications use `draft`, `scheduled`, `ready`, `publishing`, `published`,
  `failed`, `ambiguous`, and `cancelled`. Jobs independently use `pending`,
  `running`, `succeeded`, `failed`, and `cancelled`.
- Approval is not implemented in M1. A future approval state remains a separate
  dimension and must not be encoded in publication status.
- Domain tables repeat `project_id` where needed and use composite foreign keys to
  enforce same-project relations in SQLite. Matching unique parent keys and child
  indexes make those constraints valid and efficient.
- The database uses checks for bounded state values and local row invariants. It does
  not use triggers, a generic repository layer, or a universal publisher
  configuration format.

## Transition Graphs

Publication transitions are intentionally explicit:

- `draft` → `scheduled`, `ready`, or `cancelled`
- `scheduled` → `ready` or `cancelled`
- `ready` → `publishing`, `published`, `failed`, or `cancelled`
- `publishing` → `published`, `failed`, or `ambiguous`
- `failed` → `ready` or `cancelled`
- `ambiguous` → `published`, `failed`, or `cancelled`
- `published` and `cancelled` are terminal

The direct `ready` → `published` path records a manual publication without creating
a fake execution job. A scheduled publication may be rescheduled while it remains
`scheduled`.

Job transitions are independent:

- `pending` → `running` or `cancelled`
- `running` → `succeeded` or `failed`
- `failed` → `pending` or `cancelled`
- `succeeded` and `cancelled` are terminal

A pending job may be rescheduled. Claim ownership, lease expiry, retry policy, and
restart recovery remain part of `WORK-07` rather than this graph.

## Alternatives Considered

- Validate project ownership only in application services: simpler schema, but the
  database could contain structurally invalid relations after a missed code path or
  direct migration.
- Use SQLite triggers: expressive, but harder to discover through Drizzle schema,
  harder to typecheck, and unnecessary for equality constraints supported by foreign
  keys.
- Use one lifecycle for publications and jobs: fewer columns, but mixes product truth
  with execution attempts and makes manual publication awkward.
- Add approval and provider configuration now: anticipates possible needs but adds
  unvalidated behavior and credential decisions outside M1.

## Consequences

- Cross-project relations fail at the database boundary as well as in pure domain
  construction.
- Project identifiers are intentionally duplicated in child rows and indexes.
- Publication state remains understandable without inspecting worker attempts, and
  jobs can be retried without rewriting publication identity.
- `WORK-07` may extend job fields and transition preconditions for claims, retries,
  crash recovery, and ambiguous external outcomes, but must preserve the lifecycle
  separation.
- The state names and transition graph were accepted with this record and form the
  starting point for the durable workflow proof.
