# ADR-037 — Use One Versioned Fact Journal

- Status: accepted
- Date: 2026-09-05
- Scope: durable domain events, audit history, and future projections
- Related issue: ISSUE-045

## Context

Herald already writes project-scoped `audit_events` in the same SQLite transaction as
the state transition they describe. Automatic execution uses those records as its
append-only history under ADR-028. Notifications and operational analytics now create a
concrete need for durable, versioned facts that another subsystem can consume after a
restart.

Audit history and notification delivery have different responsibilities. Audit answers
what happened and who performed it. Notifications additionally own recipients,
presentation state, delivery policy, retries, and deduplication. That distinction does
not require two physical logs containing the same facts.

## Decision

Herald keeps `audit_events` as its single append-only fact journal. A record intended
for durable consumption has an explicit positive schema version. Its existing action,
project, actor, entity, metadata, and occurrence timestamp form the domain-event
envelope; optional correlation and causation identifiers connect related work without
encoding transport behavior.

The framework-independent domain contract names these fields as event name, subject,
payload, and occurrence context. The database package owns the mapping to the existing
audit schema and exposes a private reader ordered by a stable append sequence. Consumers
persist the opaque form of that cursor and their idempotent projection state. They must
explicitly select supported event names and versions rather than assuming every audit
action is actionable. The public audit API remains an operator-facing read model and
does not expose internal consumer cursors.

SQLite allocates the sequence with `AUTOINCREMENT`. Journal rows normally remain
append-only, but project deletion cascades its history; preventing sequence reuse keeps
a consumer cursor valid even when the deleted project owned the former maximum value.

Events belong to projects. The actor identifies attribution and is never inferred to be
the notification recipient. Recipient and preference rules will be an independent
user/project projection. Journal records currently follow the audit lifecycle: they are
retained for the lifetime of their project and cascade only when that project is deleted.

State mutation and its fact remain one transaction. Process-local callbacks may reduce
latency but are never the source of truth. Notification inbox records, delivery outbox
records, and provider analytics snapshots use their own tables and lifecycle contracts;
they do not mutate or acknowledge journal records.

Herald is not event sourced. Projects, publications, jobs, channels, credentials, and
other current-state tables remain authoritative. The journal supports provenance,
recovery inspection, and bounded asynchronous projections only.

## Alternatives considered

- Add a separate `domain_events` table and dual-write every transition: rejected
  because it duplicates facts, increases rollback surfaces, and leaves unclear which
  history is canonical.
- Use in-memory events only: rejected because restarts can lose notification and
  projection work.
- Use `audit_events` directly as a delivery queue: rejected because recipients,
  acknowledgement, retries, and external effects require independent state.
- Introduce Redis or an external broker: rejected because the single-process SQLite
  journal satisfies the current durability and throughput requirements.

## Consequences

- Existing audit writers acquire a stable versioned envelope without duplicating their
  records.
- Consumers can resume by append cursor and remain idempotent independently.
- Event payload compatibility becomes a maintained contract; incompatible payload
  changes require a new version.
- A future physical split remains possible if measured retention, throughput, or access
  patterns diverge enough to justify a migration.

## Verification

The implementation must reject invalid envelope fields and non-JSON payloads, preserve
schema version and correlation context through persistence, return equal-timestamp
records in append order, isolate projects, and roll back state transitions when the
journal insert fails. Existing audit and workflow tests must remain green.
