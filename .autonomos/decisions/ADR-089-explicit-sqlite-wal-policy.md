# ADR-089 — Configure explicit SQLite WAL durability and contention

- Status: accepted
- Date: 2026-10-23
- Accepted by: owner approval of the ISSUE-187 implementation plan
- Scope: main SQLite connections, shutdown and database replacement
- Provenance: ISSUE-187, DB-555
- Related decisions: ADR-005, ADR-068

## Decision

File-backed main connections request WAL, require the returned WAL mode, set
`synchronous=FULL`, enable foreign keys and set `busy_timeout=5000` milliseconds.
SQLite in-memory connections retain memory journal mode. Initialization failures
close the connection and propagate rather than silently keeping rollback mode.

Keep the existing single-process deployment and a local filesystem with SQLite
locking and shared-memory support. WAL does not support network filesystems.
FULL retains durable commits in WAL mode; NORMAL would permit loss of recent
commits after power failure and is not selected for the publication ledger.

The busy wait is synchronous and can pause the Bun thread for up to five seconds
per contended SQLite operation. It bounds transient contention; it does not add
parallel writers or promise an end-to-end request deadline. The timeout matches
existing maintenance connections. A transaction may still fail with SQLITE_BUSY.

Close main connections with Bun's strict close so outstanding prepared statements
are finalized and the underlying connection is released before the runtime lock.

Restore holds the existing fail-closed runtime lock. Before replacing an existing
destination, ask SQLite to switch it to DELETE journal mode, checkpointing the
old WAL and retiring its sidecars. A lock failure aborts replacement. Never remove
WAL or shared-memory files manually to force restoration. Complete restore does
this before opening its destination media fence, so that fence cannot retain an
old WAL across pathname replacement. The next main connection re-enables WAL.
Database-only restore stages a SQLite snapshot, including committed source WAL
frames, instead of copying only the main source file.

## Alternatives and consequences

- Keeping rollback mode retains the observed reader/writer conflict.
- NORMAL reduces synchronization work but changes the durability requirement.
- A zero timeout retains immediate failures under transient writer contention.
- Deleting sidecars before replacement can discard committed data and cannot
  establish that the destination is quiescent.

The journal setting persists in the database; synchronous and timeout are applied
per main connection. Reverting WAL requires a stopped runtime and a successful
SQLite journal-mode transition. Online backups continue through VACUUM INTO.
Recovery holds and runtime markers retain their existing authority.

## Evidence

DB-555 covers reader snapshots, independent-process writer release, timeout,
prepared-statement closure, online snapshots with commits still in the WAL,
migrations and both restore modes after SIGKILL. Removing WAL retirement makes
the restore regression tests fail with corruption or an unsafe replacement.
