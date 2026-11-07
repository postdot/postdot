# Postdot database package

This package owns Postdot's persistence: the engine-neutral SQL port (`src/sql`),
its SQLite (`bun:sqlite`) and PostgreSQL (`Bun.SQL`) adapters, and the schema as
portable SQL migrations (ADR-097).

## Migrations

```sh
bun run db:migrate
```

`migrations/NNNN_name.sql` files run in order. Sections open with
`-- postdot:common`, `-- postdot:sqlite` or `-- postdot:postgres`; only `common`
and the current engine's sections apply. To change the schema, add the next
numbered file: an applied migration is recorded with a checksum and must never be
edited. `src/sql/schema-parity.test.ts` proves both engines produce the same
schema, and the store suites run on both (`POSTDOT_TEST_ENGINE=postgres` with
`POSTDOT_TEST_POSTGRES_URL`).

A SQLite database created by an earlier release (the frozen Drizzle chain in
`legacy-migrations/`) is adopted in place on first start when its chain is
complete and its schema is exactly the baseline. Anything else is refused before
any change; an incomplete legacy database must first be started once with the
previous release. The runner never resets a database or hides a history conflict.

The production API bundle also exposes SQLite recovery commands. A database-only
backup remains available for low-level recovery:

```sh
bun apps/api/src/index.ts backup --database ./postdot.sqlite --output ./backups/postdot.sqlite
```

Stop the application before restoring a database-only backup. The API owns a
sidecar runtime lock next to the database while it is running. Restore and local
account recovery acquire the same lock before changing database state. Restore
fails closed while Postdot is active, then validates the backup, writes a temporary
replacement, and renames it into place:

```sh
bun apps/api/src/index.ts restore --database ./postdot.sqlite --input ./backups/postdot.sqlite
```

When SMTP password recovery is unavailable, the API bundle can reset an existing
account password offline. The command requires an explicit database path and an
interactive confirmation of its resolved path. It creates a validated database
backup before updating the Better Auth password hash, revokes the account's sessions
and outstanding reset links, and preserves projects, API keys, publisher credentials,
and historical actors:

```sh
bun apps/api/src/index.ts account recover-password --database ./postdot.sqlite
```

Run the command with Postdot stopped. It does not create users or change instance
roles. The generated backup is stored in an owner-only directory beside the
database, with owner-only file permissions; retain or remove it according to the
deployment's backup policy.

For a complete application backup, add `--media`. Postdot creates an inspectable
directory bundle containing the SQLite snapshot, an integrity manifest, and the
stored bytes for every retained media representation. The configured media store
identity must be the same during restore:

```sh
bun apps/api/src/index.ts backup --media --database ./postdot.sqlite --output ./backups/postdot.bundle
```

Stop the application before restoring the complete bundle:

```sh
bun apps/api/src/index.ts restore --media --database ./postdot.sqlite --input ./backups/postdot.bundle
```

The lock is intentionally not reclaimed automatically after a forced process
termination. If a restart, restore, or account-recovery command reports an existing
lock, verify that no Postdot process is using the database, then remove only the exact
`<database>.runtime.lock` sidecar before retrying. Never remove the marker to
override a live process.

The complete bundle does not contain `POSTDOT_PUBLISHER_ENCRYPTION_KEY`. A complete
application recovery therefore also requires the exact deployment key and its
matching `POSTDOT_PUBLISHER_ENCRYPTION_KEY_ID`, preserved separately in a secret
manager or offline escrow. Never put the key in the bundle, source control, logs,
or command arguments. Restore the database and media with Postdot stopped, inject
the original key before starting the application, and verify publisher credentials
with an intentionally approved provider operation when such verification is
required. A replacement key cannot decrypt existing credentials.

See the [publisher encryption key recovery runbook](../../README.md#publisher-encryption-key-recovery)
for the complete operator procedure.
