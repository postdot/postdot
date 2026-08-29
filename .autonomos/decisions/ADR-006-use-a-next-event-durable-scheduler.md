# ADR-006 — Use a Next-Event Durable Scheduler

- Status: accepted
- Scope: Publication scheduling, job durability, and restart recovery
- Provenance: V1 workflow review
- Related specs: [SPEC-001](../specs/SPEC-001-v1-scope.md), [SPEC-002](../specs/SPEC-002-engineering-operating-model.md)
- Superseded by: none

## Context

Scheduled publications must survive process restarts without requiring an external
queue. Frequent polling wastes work, while operating-system cron cannot represent
individual mutable publication schedules or immediate replanning.

## Decision

Persist jobs and publication state in SQLite as the source of truth. In memory, arm
one timer for the next due event. Recompute and replace that timer when planning
changes and reconstruct it from durable state at startup.

External writes must distinguish retryable failure from an ambiguous outcome where
the provider may have succeeded before Herald persisted the result.

## Alternatives considered

- Fixed-interval polling: simple but introduces avoidable wake-ups and scheduling
  latency.
- Operating-system cron per publication: externalizes mutable application state and
  complicates cancellation, recovery, and portability.
- Bun cron: useful for periodic maintenance but not the primary durable schedule.
- Redis, Temporal, or another external queue: provides distributed capabilities the
  singleton does not currently need.

## Consequences

- In-memory state remains small and reconstructible.
- Recovery, claims, retries, cancellation, and crash points need integration tests.
- Provider idempotency is used when available, but ambiguous outcomes remain an
  explicit domain state rather than triggering blind retries.
- Multi-instance execution remains unsupported by this scheduler.
