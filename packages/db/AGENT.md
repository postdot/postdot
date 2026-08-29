# AGENT: packages/db

- **Stack:** Drizzle ORM, Bun SQLite, Drizzle Kit
- **Conventions:** Keep database connection and schema definitions in this package. Expose explicit database factories instead of reading process state during module import.
- **Constraints:** Use Bun's native `bun:sqlite` driver for the local SQLite runtime. Keep application schema changes migration-driven once the first domain tables are introduced.
