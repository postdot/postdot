# ADR-002 — Separate Post from Publication

- Status: accepted
- Scope: Source content and channel delivery domain model
- Provenance: V1 product review and domain modeling task
- Related specs: [SPEC-001](../specs/SPEC-001-v1-scope.md), [SPEC-003](../specs/SPEC-003-product-foundation.md)
- Superseded by: none

## Context

One source idea may be adapted, scheduled, delivered, retried, or completed
differently for each destination. Combining source content and delivery state makes
channel-specific behavior and partial outcomes difficult to represent.

## Decision

A `Post` owns the shared source intent. A `Publication` is one channel-specific
delivery of that post and owns its content adaptation, schedule, state, external
result, and errors.

## Alternatives considered

- One post record per channel: duplicates source intent and loses the relationship
  between renditions.
- One post with global delivery state: cannot represent independent schedules,
  failures, retries, or manual completion.

## Consequences

- One post can create several independently valid publications.
- Publication state transitions can be tested without mutating shared source state.
- The UI and API must distinguish authoring concepts from delivery concepts.
- Cross-channel editing requires explicit propagation rules rather than implicit
  shared mutation.
