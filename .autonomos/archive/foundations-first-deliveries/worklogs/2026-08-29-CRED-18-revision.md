# CRED-18 Revision — Use the current schema as the migration baseline

- Date: 2026-08-29
- Status: completed
- Related task: [CRED-18](../../../TASKS.md)
- Related issue: [ISSUE-006](../../../ISSUES.md)
- Decision: [ADR-012](../../../decisions/ADR-012-own-publisher-credentials-and-use-oauth4webapi.md)

## Reason

The initial CRED-18 implementation treated the local development database as if
it were a deployed database that required an upgrade path. Postbot has no released
deployment or data to preserve, so that compatibility boundary was not part of
the product scope and introduced an unnecessary startup failure.

## Correction

- Removed the fail-closed legacy publisher-connection guard and its migration test.
- Replaced the development migration history with one Drizzle baseline generated
  directly from the current schema.
- Removed the corresponding legacy-upgrade instructions from the README.
- Kept the Better Auth `account` table because email/password authentication uses
  it; publisher connections no longer reference that table.
- Kept only the current project-owned `publisher_credentials` and
  `publisher_connections.credential_id` relationship in the baseline.

The previous CRED-18 worklog records the intermediate implementation. This record
supersedes its migration-compatibility statements for the current project scope.

## Verification

- `bun run db:generate` generated `0000_eager_patriot.sql` from `src/schema.ts`.
- Fresh in-memory migrations pass with one committed migration.
- `bun run check` passes format, lint, typecheck, 116 tests, and production build.
- The existing Docker and footprint checks remain valid for the current schema.
