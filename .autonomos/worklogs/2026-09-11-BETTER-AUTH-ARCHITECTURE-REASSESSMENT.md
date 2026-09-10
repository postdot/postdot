# Better Auth access architecture reassessment

- Status: proposed architecture study; no implementation started
- Date: 2026-09-11
- Scope: human administration, project memberships, invitations, and machine API keys
- Trigger: the previous ACCESS-131/132 implementation used Herald-owned membership,
  invitation, and token models without first comparing the Better Auth Admin,
  Organization, and API Key plugins.

## Executive finding

The previous implementation decision was incomplete. Better Auth was correctly kept
as the identity/session boundary, and Herald-owned publisher credentials must remain
outside Better Auth. That separation does not justify reimplementing all user access
features independently.

The current repository contains no `admin`, `organization`, or API Key plugin
configuration. Better Auth `1.7.2` already exports the Admin and Organization
plugins. The compatible `@better-auth/api-key@1.7.2` package exists separately and
was not evaluated before the custom project-token implementation.

The current custom token model does support an optional `expiresAt`, but the normal
web creation flow does not expose an expiry field, so UI-created tokens are lifetime
tokens unless revoked. The API Key plugin offers a richer built-in lifecycle:
expiration, cleanup of expired keys, rate limiting, remaining/refill counters,
permissions, metadata, and organization ownership.

## Product requirements used for the comparison

- Better Auth remains responsible for human identity, password hashing, sessions,
  cookies, and account lifecycle primitives.
- A Herald installation must support several projects and several users.
- A project needs independent membership and roles (`owner`, `editor`, `viewer`).
- Instance-level administration must remain distinct from project content access.
- Invitations must support existing and new users, email delivery when configured,
  and a documented mail-less self-hosted fallback.
- CLI/MCP/API automation needs machine credentials with explicit project scope,
  expiration, revocation, and preferably permissions/rate limits.
- Herald still owns projects, publications, channels, publisher credentials, audits,
  notification projections, and background execution.
- Provider OAuth credentials and publisher access tokens must not become Better Auth
  user/account data.

## Capabilities verified

### Better Auth Admin

The Admin plugin provides global user management, roles, banning, session operations,
impersonation, and custom access-control statements. It is a credible candidate for
instance-level administration, but its role is attached to the user globally. It is
not a replacement for per-project membership by itself.

Reference: https://better-auth.com/docs/plugins/admin

### Better Auth Organization

The Organization plugin provides organizations, members, invitations, invitation
expiry/status, active organization context, custom roles, and organization-scoped
permissions. It also supports invitation email delivery through a supplied callback.

Its roles and access-control definitions can represent Herald project roles. Its
organization model is a better fit for a project than its team model when project
scoped API keys are required, because the API Key plugin can own keys by organization
but not by team.

Reference: https://better-auth.com/docs/plugins/organization

### Better Auth API Key

`@better-auth/api-key@1.7.2` is a separate package compatible with the repository's
`better-auth@1.7.2`. It supports user- or organization-owned keys, custom headers,
custom prefixes, expiration, cleanup, metadata, permissions, rate limiting, and
remaining/refill counters.

Reference: https://better-auth.com/docs/plugins/api-key
Reference: https://better-auth.com/docs/plugins/api-key/reference

The key plugin does not natively know Herald project IDs. That problem disappears or
becomes small if each project is represented by a Better Auth organization. If keys
are user-owned with a `projectId` in metadata, shared project ownership and safe key
listing/management become application responsibilities again; that is a weaker fit.

## Candidate architectures

### A — Admin + one Organization per Herald project + organization-owned API keys

This is the leading hypothesis.

- Better Auth Admin owns global instance administration and global user lifecycle.
- Each Herald project has one corresponding Better Auth organization.
- Organization membership owns `owner/editor/viewer` project roles and invitations.
- API Key uses `references: "organization"`, so every machine key is naturally
  project-scoped and receives the plugin's expiry/rate-limit/permission features.
- Herald retains project business data, publisher credentials, audit events, and
  notification projections.
- A global Admin role does not automatically grant project content access; Herald
  route policy can still require organization membership unless we explicitly choose
  an administrator override.

Main design checkpoint: decide whether a Herald instance member is simply an existing
Better Auth user, or whether a separate instance membership is still needed for users
who have no project membership. The latter would remain a small Herald extension.

### B — One Organization for the Herald instance + projects as custom sub-resources

This models a future multi-tenant workspace well, but it is a weaker fit for the
current project-scoped machine API. Organization members would still need custom
project grants, and organization-owned API keys would be workspace-wide unless an
additional project binding and validator were maintained.

Teams could represent projects, but they do not provide the same organization-owned
API-key boundary and would add another semantic layer.

### C — Admin + custom project access + API Key metadata/validator

This uses Better Auth for global users and API key mechanics while retaining custom
project memberships. It gains key expiry, rate limiting, and permissions, but the
project scope would remain custom. User-owned keys also make shared project
credentials less natural. This is preferable to the current token implementation
only if the project binding can be made authoritative rather than an unchecked
metadata convention.

### D — Keep the current Herald-owned access and token system

This is not a preferred architecture merely because it already exists. It provides
project scope, actors, and audit attribution, but leaves invitations, global user
administration, token expiry UX, rate limiting, and token permissions as Herald
maintenance responsibilities.

## Recommendation

Do not consider the current access models settled. Prototype candidate A first:

1. Add Admin and Organization to a disposable Better Auth configuration.
2. Configure custom organization roles matching Herald's project operations.
3. Create a project organization and validate membership and invitation flows.
4. Add `@better-auth/api-key@1.7.2` with organization ownership, expiration,
   permissions, and rate limiting.
5. Resolve an authenticated key to the corresponding Herald project and verify
   cross-project isolation through Elysia routes.
6. Test first-account bootstrap, global admin operations, disabled users, last-admin
   safety, new-account invitation acceptance, and the mail-less self-hosted path.
7. Keep Herald-owned audit and publisher credential boundaries independent.

Only after this spike should we decide whether to migrate, and the decision should be
based on behavior and domain fit rather than the cost of undoing the current code.

Permix should not be added during this comparison. Better Auth Organization already
provides typed custom roles and access-control primitives. A second permission library
would only be justified if the prototype exposes a concrete policy-expression gap.

## Decision gate

The architecture is ready for implementation when the prototype answers these points:

- Can one project map cleanly to one Better Auth organization without weakening the
  Herald project domain model?
- Can a new invited email complete sign-up and invitation acceptance safely?
- Can organization-owned API keys carry project permissions and expiry while using
  Herald's `Authorization: Bearer` contract?
- Can global instance administration remain separate from project content access?
- Can audit attribution and project-owned publisher credentials survive user removal?
- Can local self-hosted operation work without SMTP while accurately communicating
  what email functionality is unavailable?

No production schema or authentication code was changed by this study.
