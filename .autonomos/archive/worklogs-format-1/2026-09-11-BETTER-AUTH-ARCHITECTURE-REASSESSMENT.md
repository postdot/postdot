# Better Auth access architecture reassessment

- Status: implementation completed and validated on `codex/access-131-foundation`
- Date: 2026-09-11
- Scope: human administration, project memberships, invitations, and machine API keys
- Trigger: the previous ACCESS-131/132 implementation used Postbot-owned membership,
  invitation, and token models without first comparing the Better Auth Admin,
  Organization, and API Key plugins.

## Executive finding

The previous implementation decision was incomplete. Better Auth was correctly kept
as the identity/session boundary, and Postbot-owned publisher credentials must remain
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
- A Postbot installation must support several projects and several users.
- A project needs independent membership and roles (`owner`, `editor`, `viewer`).
- Instance-level administration must remain distinct from project content access.
- Invitations must support existing and new users, email delivery when configured,
  and a documented mail-less self-hosted fallback.
- CLI/MCP/API automation needs machine credentials with explicit project scope,
  expiration, revocation, and preferably permissions/rate limits.
- Postbot still owns projects, publications, channels, publisher credentials, audits,
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

Its roles and access-control definitions can represent Postbot project roles. Its
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

The key plugin does not natively know Postbot project IDs. That problem disappears or
becomes small if each project is represented by a Better Auth organization. If keys
are user-owned with a `projectId` in metadata, shared project ownership and safe key
listing/management become application responsibilities again; that is a weaker fit.

## Candidate architectures

### A — Admin + one Organization per Postbot project + organization-owned API keys

This is the leading hypothesis.

- Better Auth Admin owns global instance administration and global user lifecycle.
- Each Postbot project has one corresponding Better Auth organization.
- Organization membership owns `owner/editor/viewer` project roles and invitations.
- API Key uses `references: "organization"`, so every machine key is naturally
  project-scoped and receives the plugin's expiry/rate-limit/permission features.
- Postbot retains project business data, publisher credentials, audit events, and
  notification projections.
- A global Admin role does not automatically grant project content access; Postbot
  route policy can still require organization membership unless we explicitly choose
  an administrator override.

Main design checkpoint: decide whether a Postbot instance member is simply an existing
Better Auth user, or whether a separate instance membership is still needed for users
who have no project membership. The latter would remain a small Postbot extension.

### B — One Organization for the Postbot instance + projects as custom sub-resources

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

### D — Keep the current Postbot-owned access and token system

This is not a preferred architecture merely because it already exists. It provides
project scope, actors, and audit attribution, but leaves invitations, global user
administration, token expiry UX, rate limiting, and token permissions as Postbot
maintenance responsibilities.

## Recommendation

Do not consider the current access models settled. Prototype candidate A first:

1. Add Admin and Organization to a disposable Better Auth configuration.
2. Configure custom organization roles matching Postbot's project operations.
3. Create a project organization and validate membership and invitation flows.
4. Add `@better-auth/api-key@1.7.2` with organization ownership, expiration,
   permissions, and rate limiting.
5. Resolve an authenticated key to the corresponding Postbot project and verify
   cross-project isolation through Elysia routes.
6. Test first-account bootstrap, global admin operations, disabled users, last-admin
   safety, new-account invitation acceptance, and the mail-less self-hosted path.
7. Keep Postbot-owned audit and publisher credential boundaries independent.

Only after this spike should we decide whether to migrate, and the decision should be
based on behavior and domain fit rather than the cost of undoing the current code.

Permix should not be added during this comparison. Better Auth Organization already
provides typed custom roles and access-control primitives. A second permission library
would only be justified if the prototype exposes a concrete policy-expression gap.

## Decision gate

The architecture is ready for implementation when the prototype answers these points:

- Can one project map cleanly to one Better Auth organization without weakening the
  Postbot project domain model?
- Can a new invited email complete sign-up and invitation acceptance safely?
- Can organization-owned API keys carry project permissions and expiry while using
  Postbot's `Authorization: Bearer` contract?
- Can global instance administration remain separate from project content access?
- Can audit attribution and project-owned publisher credentials survive user removal?
- Can local self-hosted operation work without SMTP while accurately communicating
  what email functionality is unavailable?

## Implemented foundation

The leading candidate was implemented without replacing Postbot's domain model:

- Better Auth now loads the Admin, Organization, and API Key plugins.
- Each Postbot project has one deterministic Better Auth organization, linked by
  `projects.organization_id`.
- Organization roles are `owner`, `editor`, and `viewer`, with Postbot-specific
  resource statements available for the future policy migration.
- New project API keys are organization-owned, use the `postbot_pat_` prefix,
  carry the Postbot project id in metadata, and expire by default after 180 days.
  The existing project-token API remains the compatibility surface and falls back
  to the legacy store only for projects without an organization bridge.
- Better Auth organization invitations are projected into Postbot's durable project
  membership and human-actor records after acceptance. An invitation addressed to
  a new email is the only post-bootstrap path that can create an account; public
  signup remains closed otherwise. The existing instance invitation route also
  writes the Better Auth project member when applicable.
- Better Auth Admin's global user role and ban state are now the effective source
  for instance authorization. Postbot's instance membership table remains as the
  compatibility/invariant projection, including last-admin and self-protection
  checks. Existing legacy admins and disabled users are promoted during the
  idempotent migration backfill.
- API-key identities get a dedicated Postbot actor (`api-key:<better-auth-key-id>`)
  so publication and audit code does not confuse machine credentials with humans.
- Provider OAuth credentials, publications, channels, audits, notifications, and
  scheduler state remain Postbot-owned; they are not forced into Better Auth.

## Validation completed

- Better Auth unit coverage validates bootstrap admin behavior, organization
  invitations for a new account, API-key ownership, expiry, and closed public
  signup.
- Database migration coverage validates deterministic organization/member backfill,
  legacy admin/ban projection, idempotence, and foreign-key safety.
- Access HTTP coverage validates route writes plus direct Better Auth role changes
  reflected by Postbot, project bearer-token isolation, invitation acceptance, and
  admin safety invariants.
- API coverage validates organization-backed project creation, key creation/listing/
  revocation/expiry, cross-project isolation, and organization invitation projection.
- Changed auth, db, API, and web packages pass typecheck, lint, and formatting checks.

## Deliberate remaining boundary

Instance membership is intentionally still a small Postbot extension: it represents
who may administer the self-hosted installation even when a user belongs to no
project. Better Auth Admin supplies the user lifecycle and global role/ban
primitive; Better Auth Organization supplies project membership and invitations; and
Better Auth API Key supplies organization-owned, expiring machine keys. Project route
authorization now reads the Better Auth member table for bridged projects, while
Postbot's membership/actor rows remain a compatibility projection.

The remaining work is deliberately operational rather than an unresolved plugin
choice: reconcile deployed legacy data, publish a rollback plan, and retire the old
membership/invitation/token path through ACCESS-133. ACCESS-134 can add the project
member UI when collaboration is exposed in the dashboard. Recovery, mail delivery,
and user deletion/anonymization remain separate decisions.

## Final decision

The repository adopts candidate A from this reassessment: Better Auth Admin plus one
Organization per Postbot project plus organization-owned API keys. The native plugin
write endpoints that could bypass Postbot invariants are server-only; guarded Postbot
routes are the public product contract. Permix is not added because Better Auth's
typed organization access control covers the current role model without a second
policy engine.

## Final validation

- `bun run test:unit`: all 16 workspace tasks passed.
- `bun run test:e2e`: 14/14 disposable browser scenarios passed.
- Focused auth, database access, migration, and API route suites passed, including
  native Better Auth organization member add/role-change/remove/leave behavior.
- `bun run format`, `bun run lint`, `bun run typecheck`, `bun run build`, and
  `git diff --check` passed.
