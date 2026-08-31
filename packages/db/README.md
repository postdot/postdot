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
