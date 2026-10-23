# ADR-009 — Fence External Effects with Durable Claims

- Status: accepted
- Scope: M2 job claims, external-effect boundary, lease recovery, and retry safety
- Provenance: `WORK-07` and crash-path investigation
- Related specs: [SPEC-002](../specs/SPEC-002-engineering-operating-model.md), [SPEC-003](../specs/SPEC-003-product-foundation.md)
- Related decisions: [ADR-003](ADR-003-use-a-single-process-singleton.md), [ADR-006](ADR-006-use-a-next-event-durable-scheduler.md), [ADR-008](ADR-008-enforce-project-scoped-domain-state.md)
- Superseded by: [ADR-090](ADR-090-bounded-project-effects-and-renewal.md), lease renewal deferral only

## Context

SQLite can atomically claim due work, but it cannot participate in a transaction
with an external publisher. A process can crash after a provider accepted a
publication and before Postbot persisted success. Retrying that operation blindly can
create a duplicate.

The supported deployment remains one Postbot process and one worker. Claims and
leases are therefore recovery and fencing mechanisms, not a promise of horizontal
worker scaling.

## Decision

- A due `pending` job is claimed with one conditional SQLite update. The update
  records a random claim token, the claiming actor, claim time, lease expiry, and
  increments the attempt count.
- A publication execution job requires a publisher for its channel. Manual channels
  remain schedulable product work but never enter the external-effect worker.
- Every completion or mutation of a running attempt is conditional on its claim
  token. A stale worker cannot commit after its claim was recovered or replaced.
- Immediately before calling an external system, one transaction marks the job's
  durable `effect_started_at` boundary and moves the publication to `publishing`.
- Recovery examines only expired running claims:
  - without `effect_started_at`, no external call could have started and the job is
    safely returned to `pending`;
  - with `effect_started_at`, the job becomes `failed` and the publication becomes
    `ambiguous` atomically. It is never retried automatically.
- A known retryable outcome may be requeued only when the executor can assert that
  no external effect occurred. Retry timing and attempt limits are explicit policy,
  not hard-coded into persistence.
- Cancellation completes a pending job and its scheduled publication atomically.
  Once the external-effect boundary is crossed, cancellation cannot claim that the
  remote operation was prevented.
- The next-event scheduler considers both pending `run_at` values and running lease
  expirations, and keeps only the nearest timer in memory.

## Alternatives Considered

- Treat every abandoned running job as retryable: simpler, but can duplicate remote
  publications after the critical crash window.
- Treat every running claim as ambiguous: safe but creates avoidable manual recovery
  when the process died before beginning the external call.
- Depend only on a process lock: prevents cooperative overlap but does not explain
  or recover a crash around an external side effect.
- Use an outbox transaction: useful for internal message delivery, but cannot make a
  third-party HTTP side effect atomic with SQLite.
- Add Redis, Temporal, or a distributed lease service: solves a deployment model
  Postbot does not support and violates the accepted footprint boundary.

## Consequences

- The schema gains bounded claim metadata and an index for lease expiry.
- A crash after persisting `effect_started_at` but before the provider receives the
  request can conservatively produce a false ambiguous result. This is preferable to
  an automatic duplicate; a provider idempotency key or reconciliation API may
  reduce that uncertainty later.
- Long-running effects need deliberate renewable ownership. [ADR-090](ADR-090-bounded-project-effects-and-renewal.md) replaces the original renewal deferral with bounded internal admission, fenced renewal and cooperative deadlines.
- `WORK-07A`, `WORK-07B`, and `WORK-07C` prove the decision in reviewable slices.
- This record was accepted before the first durable workflow slice merged. The
  umbrella `WORK-07` task remains open until scheduling and execution proofs pass.
