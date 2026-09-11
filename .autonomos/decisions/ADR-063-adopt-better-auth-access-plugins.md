# ADR-063 — Adopt Better Auth access plugins for collaboration and machine keys

- Status: superseded
- Date: 2026-09-11
- Scope: instance administration, project membership, invitations, and project machine keys
- Provenance: ACCESS-131, ACCESS-132, ISSUE-013, ISSUE-062, and the Better Auth architecture reassessment
- Superseded by: [ADR-064](ADR-064-clean-development-access-baseline.md)

## Historical decision

Herald adopted Better Auth Admin for global user administration, Organization for
project membership and invitations, and API Key for organization-backed project
keys. Herald retained an instance membership boundary and actor projections because
those have domain meaning outside Better Auth.

The implementation originally described a compatibility period for the previous
Herald-owned project membership, invitation, and bearer-token records. That period
was never required by a deployed Herald installation: the application is private,
unused, and has no development database data to preserve.

## Current status

ADR-064 keeps the Better Auth plugin ownership decision and removes the hypothetical
compatibility boundary. The old project-access tables, store, marker, and runtime
fallbacks are absent from the clean development baseline. The dedicated Herald
instance invitation table and actor projection remain intentional extensions.
