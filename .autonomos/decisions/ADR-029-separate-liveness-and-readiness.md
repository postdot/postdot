# ADR-029 — Separate Liveness and Readiness

- Status: accepted
- Date: 2026-09-03
- Scope: public runtime health endpoints for the single-process API
- Related issue: ISSUE-012
- Related task: OPS-13

## Context

Postbot runs its HTTP API, durable publication worker, and media reconciliation
maintenance in one process. The existing `/health` endpoint always returns
`status: ok`, so it cannot distinguish an answering HTTP process from a process
whose scheduler has entered its terminal `failed` state. Media reconciliation
also has no observable runtime state.

The deployment needs a process signal for liveness and a separate signal for
whether the instance is currently able to execute its durable responsibilities.
The distinction must remain useful when there is no scheduled publication: an
idle scheduler with no next event is operational, not unhealthy.

## Decision

Expose two public, unauthenticated endpoints:

- `GET /health` is the liveness endpoint. A successful response means that the
  HTTP process can accept and answer requests. It does not claim that the
  database, scheduler, or maintenance runtime is ready.
- `GET /ready` is the readiness endpoint. It probes the SQLite database and
  reports the scheduler and media-maintenance runtime states. It returns `200`
  with `status: ready` only when the database probe succeeds and both runtimes
  are active (`started` or `running`). Otherwise it returns `503` with
  `status: not_ready` and the individual non-secret check states.

The readiness response keeps the operational state visible without exposing
exception messages, credentials, database paths, or provider details. A
missing runtime in an application composition is reported as
`not_configured`, which is not ready and cannot be mistaken for a healthy
production process.

The worker scheduler remains the source of truth for publication execution
readiness. Its existing `idle`, `started`, `running`, `stopped`, and `failed`
states are preserved. Media reconciliation exposes its lifecycle and reports
`failed` after a reconciliation error. A later attempt reports `recovering` and
remains not ready until that attempt succeeds and returns the runtime to
`started`. The liveness endpoint remains successful while a runtime has failed
so an operator or orchestrator can distinguish a live process from a ready one.

The container healthcheck continues to use `/health` as a liveness check. The
`/ready` endpoint is available for deployment routing and operational checks;
using it as a restart-triggering healthcheck is a deployment policy choice and
is not implicit in the application image.

## Alternatives considered

### Keep one health endpoint

Rejected because a scheduler failure would either be hidden behind a false
positive or make the process liveness signal unusable for diagnosing a degraded
runtime.

### Make `/health` depend on every runtime

Rejected because it conflates process availability with work readiness and
would prevent an operator from observing a live process that needs recovery.

### Report only the scheduler

Rejected because the single-process runtime also owns media reconciliation and
the API must expose whether that maintenance responsibility is running.

### Add a separate monitoring subsystem

Rejected because the existing scheduler state and a small maintenance state
machine are sufficient. A second metrics or heartbeat subsystem would add
weight before an operational need exists.

## Consequences

- Deployment systems can route or alert on `/ready` without treating a live,
  degraded process as identical to a dead process.
- Scheduler and media-maintenance failures become observable through a stable,
  non-secret JSON contract.
- Readiness is intentionally strict: a failed or recovering media maintenance
  loop makes the instance not ready until it successfully recovers. This is
  visible and reversible without forcing the process to restart.
- The public health contract is now part of the API and must be updated with
  the OpenAPI inventory and production serving prefixes.

## Verification

- API integration tests cover healthy readiness, missing and failed runtime
  states, database failure, HTTP status codes, and OpenAPI registration.
- Media runtime tests cover lifecycle state, failure, and recovery.
- The production asset fallback and container documentation keep both server
  endpoints reachable and preserve `/health` as the image liveness check.
