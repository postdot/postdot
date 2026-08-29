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

The production API bundle also exposes SQLite recovery commands. Create a
consistent backup while the application is running:

```sh
bun apps/api/src/index.ts backup --database ./herald.sqlite --output ./backups/herald.sqlite
```

Stop the application before restoring a backup. The restore validates the backup,
writes a temporary replacement, and renames it into place:

```sh
bun apps/api/src/index.ts restore --database ./herald.sqlite --input ./backups/herald.sqlite
```
