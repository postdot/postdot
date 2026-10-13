# ADR-042 — Derive Analytics from the Durable Fact Journal

- Status: accepted
- Date: 2026-09-06
- Scope: provider-neutral publication and execution analytics
- Related task: ANALYTICS-89

## Context

Postbot already persists an append-only `audit_events` journal. It contains the
publication lifecycle facts and the automatic execution facts needed to answer
the first operational analytics questions. Notifications are already a
separate projection of that journal and must not become the analytics source.

Postbot is still early enough that the volume and query shape do not justify a
second event stream or a materialized analytics table. Adding one now would
duplicate facts, introduce another projection cursor and rebuild policy, and
make event semantics harder to evolve before the product has established which
analytics are useful.

## Decision

- Treat `audit_events` as the durable source for the first analytics read model.
- Expose a provider-neutral project analytics contract from the database layer;
  provider names are dimensions, not provider-specific metric types.
- Combine durable publication rows with lifecycle and automatic-execution
  events. Current publication state remains the source for the current-state
  distribution; journal events remain the source for historical transitions and
  attempts.
- Support an optional half-open UTC interval `[from, to)` for all event-based
  counts. Group daily results using the project's IANA timezone while retaining
  UTC timestamps at rest.
- Return aggregate counts only: no source content, media bytes, credentials,
  external identifiers, or error messages are part of the analytics contract.
- Keep analytics read-only and rebuildable. No analytics-specific write path,
  external telemetry service, or dashboard is introduced by this task.
- If measured volume later requires it, add a versioned materialized projection
  behind the same read contract rather than changing callers or creating a
  second fact vocabulary.

## Initial contract

The first read model reports:

- current publication counts by state, delivery mode, and channel/provider;
- historical publication lifecycle counts;
- automatic execution outcomes and external-effect attempt counts;
- daily local-time buckets for created, published, failed, ambiguous, and
  external-effect attempt events.

Manual and automatic publication paths are represented by the same lifecycle
and outcome dimensions. A provider with no publisher connection is represented
as `manual`, not as a special analytics implementation.

## Alternatives considered

- **A new analytics event stream:** rejected because it would duplicate the
  already durable publication and execution facts.
- **A materialized analytics table immediately:** rejected until query volume or
  retention requirements demonstrate that on-demand projection is insufficient.
- **Third-party telemetry:** rejected because Postbot is self-hosted and the
  first analytics foundation must be local, privacy-preserving, and useful
  without another service.
- **Analytics derived only from current publication rows:** rejected because it
  loses retries, ambiguous outcomes, and historical transitions.

## Consequences

- The initial implementation stays small and fits the existing SQLite-first
  architecture.
- Analytics queries must preserve the event journal's versioned action names and
  tolerate events that are unrelated to publication execution.
- The read model can be rebuilt from the journal and current domain rows, which
  gives future materialization a clear correctness reference.
- Retention and high-volume query benchmarking remain explicit follow-up work,
  rather than hidden assumptions.
