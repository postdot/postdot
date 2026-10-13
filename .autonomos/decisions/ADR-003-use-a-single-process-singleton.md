# ADR-003 — Use a Single-Process Singleton

- Status: accepted
- Scope: V1 deployment and execution topology
- Provenance: V1 deployment review
- Related specs: [SPEC-001](../specs/SPEC-001-v1-scope.md), [SPEC-003](../specs/SPEC-003-product-foundation.md)
- Superseded by: none

## Context

Postbot targets individuals and small teams with low write concurrency and a modest
number of asynchronous publication requests. Distributed coordination would add
memory, services, deployment complexity, and failure modes before the product has a
demonstrated scaling need.

## Decision

V1 supports one instance with one Bun process and one worker. The process hosts the
Elysia API, built dashboard assets, scheduler, worker, and SQLite access.

## Alternatives considered

- Separate API and worker services: improves independent scaling but adds process
  orchestration and deployment cost without a measured bottleneck.
- Multiple workers or instances: requires atomic claims, wake-up signaling,
  coordination, and potentially leader election.
- Distributed infrastructure such as Redis and Temporal: solves a scale and
  availability problem outside the current target.

## Consequences

- Self-hosting requires one application process and one data volume.
- In-memory scheduling state is allowed, but essential state must be reconstructible.
- Two simultaneous Postbot instances are unsupported until a separate decision adds
  coordination semantics.
- A measured singleton limitation may justify revisiting the topology later.
