# Postdot database package

This package owns Postdot's Drizzle ORM schema, Bun SQLite connection, and
migrations. The runtime uses Bun's native `bun:sqlite` driver.

## Commands

```sh
bun run db:generate
bun run db:migrate
```

Run `db:generate` after changing the schema, review the generated SQL, and use
`db:migrate` to apply migrations through the Bun runtime.

The development migration directory intentionally starts with one generated
baseline for the current schema. The runner never resets a database or hides a
history conflict. If a disposable local database still belongs to an earlier
development model, stop Postdot and move that file aside so a fresh database can be
created; a database with data that must be preserved needs a separately approved
production migration plan.

The production API bundle also exposes SQLite recovery commands. A database-only
backup remains available for low-level recovery:

```sh
bun apps/api/src/index.ts backup --database ./postbot.sqlite --output ./backups/postbot.sqlite
```

Stop the application before restoring a database-only backup. The API owns a
sidecar runtime lock next to the database while it is running. Restore and local
account recovery acquire the same lock before changing database state. Restore
fails closed while Postdot is active, then validates the backup, writes a temporary
replacement, and renames it into place:

```sh
bun apps/api/src/index.ts restore --database ./postbot.sqlite --input ./backups/postbot.sqlite
```

When SMTP password recovery is unavailable, the API bundle can reset an existing
account password offline. The command requires an explicit database path and an
interactive confirmation of its resolved path. It creates a validated database
backup before updating the Better Auth password hash, revokes the account's sessions
and outstanding reset links, and preserves projects, API keys, publisher credentials,
and historical actors:

```sh
bun apps/api/src/index.ts account recover-password --database ./postbot.sqlite
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
bun apps/api/src/index.ts backup --media --database ./postbot.sqlite --output ./backups/postbot.bundle
```

Stop the application before restoring the complete bundle:

```sh
bun apps/api/src/index.ts restore --media --database ./postbot.sqlite --input ./backups/postbot.bundle
```

The lock is intentionally not reclaimed automatically after a forced process
termination. If a restart, restore, or account-recovery command reports an existing
lock, verify that no Postdot process is using the database, then remove only the exact
`<database>.runtime.lock` sidecar before retrying. Never remove the marker to
override a live process.

The complete bundle does not contain `POSTBOT_PUBLISHER_ENCRYPTION_KEY`. A complete
application recovery therefore also requires the exact deployment key and its
matching `POSTBOT_PUBLISHER_ENCRYPTION_KEY_ID`, preserved separately in a secret
manager or offline escrow. Never put the key in the bundle, source control, logs,
or command arguments. Restore the database and media with Postdot stopped, inject
the original key before starting the application, and verify publisher credentials
with an intentionally approved provider operation when such verification is
required. A replacement key cannot decrypt existing credentials.

See the [publisher encryption key recovery runbook](../../README.md#publisher-encryption-key-recovery)
for the complete operator procedure.
