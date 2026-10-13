# ADR-028 — Use Audit Events as the Execution Journal

- Status: accepted
- Date: 2026-09-03
- Scope: automatic publication execution history
- Related issue: ISSUE-011

## Context

The workflow store persists the current job and publication state, including an
attempt counter and the latest error. A retry or recovery then overwrites
attempt-specific fields, so an operator cannot reconstruct what happened before
the current state. The database already has project-scoped, attributable
`audit_events` records and the existing manual publication workflows use them.

Postbot must preserve its lightweight SQLite-first design. Adding a second
history subsystem would duplicate a durable event surface before the product has
evidence that the generic audit record is insufficient.

## Decision

Use `audit_events` as the append-only journal for automatic publication
execution. The current `jobs` and `publications` rows remain the efficient
current-state projection; execution events are never used as a substitute for
their lifecycle state.

Automatic execution events use `entity_type = 'publication'` and the publication
ID as `entity_id`. Their action vocabulary is:

- `publication.execution.claimed`
- `publication.execution.effect_started`
- `publication.execution.succeeded`
- `publication.execution.retry_scheduled`
- `publication.execution.failed`
- `publication.execution.ambiguous`
- `publication.execution.claim_recovered`
- `publication.execution.ambiguity_recovered`
- `publication.execution.cancelled`

Each event carries structured JSON metadata with the job ID, attempt number,
transition-specific timestamps, and the non-secret outcome details needed to
understand the transition. Claim tokens, credentials, and other authentication
material are never written to event metadata. Provider error messages may be
recorded only as the same operational error text already accepted by the job
state contract; provider adapters remain responsible for not putting secrets in
that text.

Every event is inserted in the same SQLite transaction as the state transition
it describes. If event persistence fails, the associated claim, effect-boundary
transition, completion, cancellation, or recovery is rolled back. A claim
increments the current attempt counter once; a later effect-boundary event and
one terminal, retry, or recovery event describe the rest of that attempt.

The SQLite audit reader resolves equal-timestamp events by the journal's explicit
append sequence, so a worker timeline remains stable even when several transitions
share one application timestamp or a later migration rebuilds the table.

Lease expiry before the external-effect boundary records a claim recovery.
Lease expiry after the boundary records ambiguity recovery and never silently
requeues the work. The existing audit retention and project deletion lifecycle
remain unchanged; a separate archival policy is deferred until usage evidence
requires one.

## Alternatives considered

- Add a dedicated `execution_attempts` table: rejected for now because it would
  duplicate the existing attributable audit surface and add a migration and
  read model before a concrete query requirement justifies it.
- Keep only the current job columns: rejected because overwritten attempt data
  cannot reconstruct retries, outcomes, or recovery.
- Use process logs: rejected because logs are not durable, project-scoped, or
  attributable after restart.

## Consequences

- Existing audit APIs can expose the execution timeline without a new public
  endpoint or a new persistence subsystem.
- The event metadata contract must be kept stable and tested because SQLite does
  not type-check its JSON payload.
- A future dedicated projection remains possible if reporting or retention needs
  outgrow the audit record, without changing the current worker state machine.

## Verification

The implementation must test successful execution, retry scheduling, terminal
failure, direct ambiguity, pre-boundary claim recovery, post-boundary ambiguity
recovery, cancellation, stale-fence no-ops, and rollback when an audit insert
fails. The full repository quality gate remains required.
