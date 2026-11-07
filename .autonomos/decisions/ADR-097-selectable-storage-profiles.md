# ADR-097 — Offer selectable storage profiles: embedded SQLite or PostgreSQL in one image

- Status: accepted — owner approval on 2026-11-07
- Date: 2026-11-06
- Scope: persistence port, database engines, media storage topology, instance count, migrations,
  data transfer between profiles
- Provenance: owner direction on 2026-11-06 (ISSUE-194)
- Partially supersedes: [ADR-003](ADR-003-use-a-single-process-singleton.md) (the
  singleton becomes a property of the embedded profile, not of the product),
  [ADR-005](ADR-005-use-sqlite-first-persistence.md) (SQLite stays the default, no longer the only
  engine)
- Related: [ADR-049](ADR-049-process-level-realtime-wakeup.md),
  [ADR-053](ADR-053-sqlite-first-optional-analytics-engine.md),
  [ADR-068](ADR-068-runtime-quiescence-sidecar-lock.md),
  [ADR-089](ADR-089-explicit-sqlite-wal-policy.md)

## Context

SQLite meets the first goal: a self-contained, monolithic application that is easy to host.
Its single-writer lock and file-based operations also mean one instance per database: no
rolling release, no second replica and no managed database. Some operators prefer a standard
PostgreSQL deployment and would see the embedded profile as a limit, and a later hosted offer
would need the same capabilities.

Postdot is an alpha without production users. Compatibility with existing databases, migration
chains and upgrade paths is **not** a constraint for this change (owner direction). Data transfer
between profiles is a constraint: it must be planned, documented and verifiable, but explicit
rather than automatic.

Measured starting point (2026-11-06, `main` at `aa33df034`):

- `packages/db` has about 37,000 non-test lines. Its stores run about 470 **raw SQL prepared
  statements** through `bun:sqlite` (`client.query<Row, Params>(sql)`) with `?N` parameters.
  The Drizzle query builder appears only 4 times. Drizzle mainly provides the schema (about 70
  tables) and migrations (27 files, 79 triggers and 11 views written by hand).
- Every store is **synchronous**. There are 31 transaction sites (`.immediate` and others). The
  commit observer relies on a synchronous frame stack. The API calls the stores synchronously
  from 96 files and reaches `$client` directly in 3 places.
- The SQLite-specific SQL is limited: `json_*` (27), `unixepoch` (16), `glob` (7),
  `sqlite_master` (3), `rowid` (2) and `PRAGMA`. Some operations work at file level: `VACUUM
  INTO` backup, pathname-replacement restore, sidecar runtime lock, WAL recovery.
- Some coordination exists only inside the process: credential-refresh queues, the realtime
  wakeup hub and the poster/bootstrap maps.
- Bun 1.4 ships `Bun.SQL`, one async client for SQLite, PostgreSQL and MySQL selected by URL.
  Tested here: under SQLite it does **not** isolate an open transaction from other queries on
  the same connection. Outside reads see uncommitted rows, and an outside write lands inside the
  transaction. It is therefore not used as-is for the SQLite profile.

## Decision

1. **One image, profile chosen at runtime.** `POSTDOT_DATABASE_URL` picks the engine:
   `sqlite:` (default, a file under the data volume) or `postgres:`/`postgresql:`. The engine
   adapter is loaded with a dynamic import, so the unused one is never initialized. PostgreSQL
   uses the built-in `Bun.SQL` client, so the image needs no extra native dependency.
   `POSTDOT_MEDIA_STORE` keeps choosing `local` or `s3`.
2. **An async persistence port with ambient transactions.** Stores define typed statements once
   and run them with `await`. `database.transaction(mode, async () => …)` binds the current
   transaction through `AsyncLocalStorage`, so a statement uses the open transaction without
   threading a handle. Nested transactions become savepoints. Commit observers fire only after
   the outermost commit. External I/O inside a transaction stays forbidden.
3. **SQLite adapter: `bun:sqlite` behind an async writer gate.** One connection keeps the
   ADR-089 policy (WAL, FULL, busy timeout). An async mutex admits one transaction or
   autocommit statement at a time, so an awaiting transaction can never be observed or joined by
   another flow. Transactions keep their `BEGIN IMMEDIATE` semantics.
4. **PostgreSQL adapter: `Bun.SQL` pool.** Each transaction reserves its own connection. Today's
   `IMMEDIATE` serialization points become explicit row locks, `SELECT … FOR UPDATE SKIP LOCKED`
   for job claims, or transaction advisory locks. They are not emulated globally.
5. **Portable SQL first, isolated dialect fragments.** Store SQL is written in the common subset
   with `?N` parameters, which are translated to `$N` once per statement. The few engine-specific
   expressions (JSON, epoch time, pattern match, introspection, constraint-error classification)
   live in one dialect module. There is still no universal repository layer or second copy of the
   store logic.
6. **Postdot owns its schema as portable SQL migrations; Drizzle is retired** (amended
   2026-11-06, owner). Drizzle schemas are bound to one engine and Postdot already runs only
   raw SQL, so Drizzle offered no shared schema. Each migration is one file: SQL common to
   both engines (SQLite accepts PostgreSQL type names such as `bigint`, `text`, `boolean`),
   plus an explicit per-engine section only where they differ (identity keys, `blob`/`bytea`,
   triggers, deferred constraints). A Postdot-owned runner applies them with the existing
   fail-closed checks, and an automated parity test migrates both engines and compares the
   introspected schemas (tables, columns, nullability, defaults, keys, indexes, foreign keys).
   No conversion tool generates one engine's schema from the other. The current schema becomes
   one portable baseline; an up-to-date SQLite database from the historical Drizzle chain is
   adopted in place (baseline recorded as applied) rather than recreated. Integer millisecond
   timestamps are `bigint`. Drizzle's remaining uses (API response schemas, test queries,
   the Better Auth adapter) are replaced; Better Auth uses an adapter on the persistence port.
7. **Topology is enforced by construction.** The profile defines the instance capability:
   - SQLite **or** local media → **single instance**. With SQLite, the existing sidecar lock
     already refuses a second process. PostgreSQL with local media takes a database-held
     singleton lease and refuses to start while another live instance holds it.
   - PostgreSQL **and** S3 → **multiple instances allowed**: serialized migrations (advisory
     lock), cross-instance wakeup (`LISTEN/NOTIFY` with the durable journal remaining the source
     of truth), database-backed credential-refresh coordination. Missed signals are covered by
     a non-overlapping safety rescan every 30 seconds after the previous pass completes, plus
     rescan on listener reconnect (owner-approved hardening, 2026-11-07, DB-614). Slow database
     reads add to recovery latency; this interval is not a hard execution deadline.
   - Background runtimes (publication worker, media maintenance, video previews, notification
     projection, email) run on **one elected leader** (amended 2026-11-07, owner): a session
     advisory lock, released when its connection ends, so another instance takes over after a
     crash or during a rolling release. Every instance serves HTTP. This replaces distributing
     job claims with `SKIP LOCKED`: the goal is availability and rolling releases, not
     throughput, and claims stay lease-guarded and serializable should distribution be needed.
   Health and startup logs report the active profile and its instance capability.
8. **Transfer between profiles is an explicit offline operation.** A logical, engine-neutral
   export (rows in dependency order, schema version, checksums) can be imported into an empty
   target at the same schema version: SQLite ↔ PostgreSQL. A media copy through the storage
   contract with checksum verification covers local ↔ S3. Both run with the runtime quiesced and
   are documented in the runbook. No automatic conversion happens.
   Implemented by DB-613 (2026-11-07): `export` / `import` (directory with `manifest.json` and
   one NDJSON file per table, values encoded from the declared column type, rows in byte order
   of the primary key, so both engines export identical bytes; the import suspends user
   triggers, restores the journal sequence high-water mark and re-exports the target inside its
   transaction, committing only on identical checksums) and `media transfer` (copy through the
   storage contract with size/SHA-256 checks against the database and a read-back, then one
   transaction rewriting `store_id`; the destination needs its own store ID; the source is
   never changed). Commands refuse while a server runs (SQLite runtime lock; PostgreSQL
   instance and leader locks plus no other connected session). `POSTDOT_DATABASE_URL` takes
   precedence over `DB_FILE_NAME`, which the image always sets.
9. **Same tests on both engines.** The `packages/db` and API integration suites run against
   SQLite and PostgreSQL in CI. A PostgreSQL feature counts only once its parity passes.

## Phasing

| Task | Content |
|------|---------|
| DB-609 | Phase 0: async port, SQLite writer gate, ambient transactions, every store and caller converted, SQLite only, no behaviour change |
| DB-610 | Phase 1: dialect module and portable SQL audit of runtime statements |
| DB-611 | Phase 2: PostgreSQL adapter, portable SQL migrations and runner with schema parity, Better Auth on the port, Drizzle retired, CI parity on both engines |
| DB-612 | Phase 3: topology guard, multi-instance coordination, PostgreSQL operations runbook |
| DB-613 | Phase 4: profile transfer (database export/import, media copy) and documentation |

Rolling releases additionally require an expand/contract migration policy (old and new versions
must share a schema). That policy is defined in DB-612.

## Alternatives considered

- **`Bun.SQL` for both engines:** smallest code, but its SQLite mode breaks transaction isolation
  on the shared connection (tested). This could be revisited if Bun adds isolation.
- **Full repository interface with two implementations:** doubles about 37,000 lines and lets
  behaviour drift between engines.
- **Rewriting on Kysely or the Drizzle query builder for dialect independence:** rewrites 470
  reviewed statements for little gain over portable SQL plus a small dialect module.
- **A second image for PostgreSQL:** simpler packaging but two artifacts to release and qualify.
  Rejected because the single-image path adds no dependency.
- **Keeping the SQLite migration chain:** unnecessary while the project has no production users.

## Consequences

- Phase 0 is the largest and riskiest step. It also improves the SQLite profile: no transaction
  can depend on synchronous atomicity without saying so.
- Each schema change will need one migration per engine, plus parity tests.
- SQLite remains the default, documented profile. The single-instance limitation becomes an
  explicit property of the profile rather than a product limitation.
- `AGENT.md` constraints on horizontal scaling and universal database abstractions must be
  updated when this ADR is accepted.
