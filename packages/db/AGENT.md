# AGENT: packages/db

- **Stack:** Drizzle ORM, Bun SQLite, Drizzle Kit
- **Conventions:** Keep database connection and schema definitions in this package. Expose explicit database factories instead of reading process state during module import.
- **Constraints:** Use Bun's native `bun:sqlite` driver for the local SQLite runtime. Keep application schema changes migration-driven once the first domain tables are introduced.
- **Publisher secrets:** Keep publisher credential encryption behind an explicit internal boundary. Metadata APIs must never expose token material, and persisted publisher credentials must never reference Better Auth users or accounts.
- **Media lifecycle:** Keep project-owned asset, representation, upload-intent, inspection, retention, and reconciliation state in this package. Use `@herald/media` only through its storage contract, and keep opaque object keys out of public API responses.
- **Media recovery:** Treat SQLite-only backup as a low-level primitive. Complete media recovery must use the manifest-and-bytes bundle, verify every checksum, and fence physical media deletion while the bundle is being copied.
