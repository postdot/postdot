# Herald database package

This package owns Herald's Drizzle ORM schema, Bun SQLite connection, and
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
development model, stop Herald and move that file aside so a fresh database can be
created; a database with data that must be preserved needs a separately approved
production migration plan.

The production API bundle also exposes SQLite recovery commands. A database-only
backup remains available for low-level recovery:

```sh
bun apps/api/src/index.ts backup --database ./herald.sqlite --output ./backups/herald.sqlite
```

Stop the application before restoring a database-only backup. The restore
validates the backup, writes a temporary replacement, and renames it into place:

```sh
bun apps/api/src/index.ts restore --database ./herald.sqlite --input ./backups/herald.sqlite
```

For a complete application backup, add `--media`. Herald creates an inspectable
directory bundle containing the SQLite snapshot, an integrity manifest, and the
stored bytes for every retained media representation. The configured media store
identity must be the same during restore:

```sh
bun apps/api/src/index.ts backup --media --database ./herald.sqlite --output ./backups/herald.bundle
```

Stop the application before restoring the complete bundle:

```sh
bun apps/api/src/index.ts restore --media --database ./herald.sqlite --input ./backups/herald.bundle
```

The complete bundle does not contain `HERALD_PUBLISHER_ENCRYPTION_KEY`. A complete
application recovery therefore also requires the exact deployment key and its
matching `HERALD_PUBLISHER_ENCRYPTION_KEY_ID`, preserved separately in a secret
manager or offline escrow. Never put the key in the bundle, source control, logs,
or command arguments. Restore the database and media with Herald stopped, inject
the original key before starting the application, and verify publisher credentials
with an intentionally approved provider operation when such verification is
required. A replacement key cannot decrypt existing credentials.

See the [publisher encryption key recovery runbook](../../README.md#publisher-encryption-key-recovery)
for the complete operator procedure.
