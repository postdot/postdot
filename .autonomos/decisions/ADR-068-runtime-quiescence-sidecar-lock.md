# ADR-068 — Coordinate Herald runtime and restore with a fail-closed sidecar lock

- Status: proposed
- Date: 2026-09-11
- Scope: API lifecycle, SQLite database restore, media restore, and local/container operations
- Provenance: ISSUE-026, OPS-140, OPS-139, and the existing backup/restore runbook

## Context

Herald replaces the database pathname atomically during restore. An API process,
its scheduler, or its media runtime can still hold handles to the previous
database inode if restoration is started against a live deployment. SQLite and
the media-store fence protect individual operations, but they do not establish
that the whole application runtime has stopped before the replacement.

## Decision

Herald coordinates the server and restore commands through one exclusive,
database-specific sidecar marker at `<database>.runtime.lock`:

- the API acquires it before opening or migrating the database and releases it
  after the runtime has stopped and the database connection is closed;
- both database-only and complete media restore acquire it before backup
  validation and hold it until all destination writes and the atomic database
  replacement finish;
- the marker is created with an atomic exclusive filesystem operation and
  records only ownership metadata (version, owner kind, PID, host, timestamp,
  and a random release token);
- a present marker is never reclaimed automatically. A forced termination
  therefore fails closed and requires an operator to verify that no Herald
  process is using the database before removing the exact sidecar.

Online backup remains available. Its existing SQLite snapshot and media fence
semantics are not changed; restore is the operation that requires full runtime
quiescence.

## Alternatives considered

- Rely only on the documented stop-before-restore procedure: rejected because
  documentation cannot prevent a concurrent local process or an accidental
  restore against a live runtime.
- Reclaim a marker when its recorded PID is absent: rejected because PID reuse
  and partial process state can turn a stale check into a false negative. The
  boundary is intentionally conservative.
- Hold an application-wide SQLite transaction as a lock: rejected because it
  would interfere with Herald's own writes and would not coordinate media
  resources or pathname replacement cleanly.
- Require an external lock service: rejected for the current single-process,
  local/self-hosted deployment model; it would add an infrastructure dependency
  for a filesystem boundary already shared by the runtime and maintenance CLI.

## Consequences

- A restore cannot silently race the running API on the same database path.
- Graceful local and container shutdowns remain straightforward and release the
  marker automatically.
- A hard kill can require one explicit stale-marker cleanup step. This is
  deliberate: an operator must choose recovery after verifying process state.
- Separate development database/media paths and E2E runtime allocation remain
  important; this lock coordinates one database path and does not make shared
  development resources concurrent-safe by itself.

## Verification

OPS-140 adds lock and restore regression coverage, documents the operator
lifecycle in the root and database recovery guides, and keeps the full quality
gate as the integration requirement.
