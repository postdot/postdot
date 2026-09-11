# ACCESS-135 — Clean development access baseline

- Status: implemented
- Date: 2026-09-11
- Scope: Drizzle migration history and project access model
- Related decision: [ADR-064](../decisions/ADR-064-clean-development-access-baseline.md)
- Related issue: [ISSUE-067](../ISSUES.md#issue-067-establish-a-clean-development-access-baseline)

## Outcome

The project has no committed SQLite database and no deployed users or provider
credentials to reconcile. The access model was therefore rebuilt directly from the
current intended state instead of carrying a compatibility migration path.

The generated Drizzle history now contains one baseline, `0000_jittery_maelstrom.sql`,
with one matching snapshot and journal entry. The baseline includes Better Auth's
user, organization, member, invitation, and API-key tables, Herald's instance
access and domain tables, a dedicated `instance_access_invitations` table, and the
claimable instance seed row.

Removed from the schema and runtime:

- project-owned Herald membership rows;
- the mixed project/instance invitation table;
- the Herald project bearer-token table and store;
- the retirement marker and maintenance commands;
- project-access fallbacks that bypass Better Auth Organization membership or API
  keys.

Better Auth Organization membership is now the project authorization authority.
Better Auth Organization invitations handle project invitations, while the Herald
access store owns only instance invitations. Better Auth API keys remain wrapped by
Herald's project binding and actor-attribution boundary.

## Verification

- `bun run typecheck` passed across all workspace packages.
- Focused authentication, access, migration, API, and client tests passed: 49 tests
  passed before the final API fixture correction, then the complete API suite passed
  with 28 tests.
- Fresh-database migration tests prove the old access tables and marker are absent,
  the instance starts claimable, the baseline is idempotent, foreign keys remain
  enabled, and exactly one migration is recorded.
- No local database file was deleted or overwritten; any stale disposable database
  must be moved aside explicitly before restarting Herald.

## Follow-up

When Herald has a real deployed database, define and approve a separate production
upgrade and rollback strategy based on its actual data. That future concern is not
part of this private development baseline.
