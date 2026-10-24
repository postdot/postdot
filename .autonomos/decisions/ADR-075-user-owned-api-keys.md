# ADR-075 — Make API Keys User-Owned and Project-Scoped by Permission

- Status: accepted — implemented
- Scope: external API, CLI, MCP usage, and API-key management
- Provenance: product direction discussion on 2026-09-21
- Related decisions: [ADR-074](ADR-074-workspace-and-access-boundaries.md)
- Supersedes: [ADR-030](ADR-030-project-scoped-machine-access.md) for machine-key
  ownership and scope, [ADR-061](ADR-061-human-account-and-instance-access-policy.md)
  for API-key policy, and [ADR-064](ADR-064-clean-development-access-baseline.md)
  for the API-key implementation bullet

## Context

Postbot is a publication application. An API key is an external way for a
person to use Postbot from a CLI, MCP server, script, or another client; it is
not a deployment, CI/CD integration, or project-owned machine identity.

The previous model attached a Better Auth API key to one project workspace
organization. That made the key look like a project credential and made the
project access page responsible for a concern that belongs to the user.

## Decision

### Ownership

Every new API key is created in the user-owned Better Auth API-key
configuration. Its owner is the user who creates it. The key authenticates as
that user for project operations; it never grants more access than that user
currently has.

API-key management itself is a human-session operation. A bearer key cannot
create, edit, list, or revoke other keys.

### Project scope

Each key has one of two scopes:

- `all`: all projects the owner can currently access;
- `selected`: an explicit non-empty subset of projects the owner can currently
  access.

The scope is checked twice: when it is configured and on every project
request. This means a project removed from the user's access automatically
stops being available through the key. A selected scope can only narrow access;
it cannot elevate the owner or preserve access after the owner loses it.

The key's project scope is an authorization boundary, not an ownership
boundary. Projects remain owned by their workspace and Postbot's existing
project roles continue to decide whether the authenticated user may read or
modify a resource.

### Action scope

A key may also carry an optional action ceiling. With no ceiling, the key
continues to inherit all actions its owner can currently perform in each
project. A limited key is authorized only when all three conditions hold:

1. The owner currently has the required project role.
2. The project is within the key's current project scope.
3. The key has the required action capability.

The nullable Better Auth `apikey.permissions` field stores a limited key's
capabilities. Postbot maps each route to an explicit capability and checks it
after authenticating the key; unknown routes fail closed. A null permission
record deliberately means “no key-level action ceiling” in Postbot, not that
Better Auth itself treats null as a wildcard. This preserves dynamic role
inheritance for existing unrestricted keys without freezing a maximum action
list at key-creation time.

The initial action capabilities are:

- `project:read` — read project content and cached analytics.
- `publication:manage` — prepare, edit, duplicate, and remove drafts; manage
  publication tags and project taxonomy.
- `publication:dispatch` — schedule, cancel, publish, retry, and reconcile
  publication work.
- `channel:manage` — manage channels, profiles, and custom HTTP publishers.
- `media:manage` — upload, import, trash, and restore media.
- `analytics:refresh` — explicitly call supported providers to refresh stored
  publication analytics.
- `media:permanently_delete` — permanently purge trashed media; this is separate
  from ordinary media management.

Workspace and project access administration, account and API-key management,
built-in publisher OAuth, notifications/realtime, audit/security surfaces, and
installation administration remain human-session operations. The capability
list is a ceiling only; it never grants a role the user does not currently
have. See [the API-key operations guide](../../apps/docs/content/docs/reference/authentication.mdx)
for the current route and client contract.

### Product surfaces

API keys are managed from the user Preferences area and from the CLI's
`api-keys` resource. Creation returns the plaintext secret once; subsequent
list responses contain only metadata and the token prefix.

Workspace/instance administration, provider OAuth setup, and other
interactive account-security mutations remain human-session surfaces. A user
API key may operate project content according to the same project role as its
owner, but it is not a way to bypass those session-only security boundaries.

### Compatibility

Postbot is still private and has no deployed data contract to preserve. The
project-bound API routes, typed-client methods, CLI commands, actor store, and
project API-key dashboard are removed rather than kept as compatibility
facades. The development database baseline contains no project-token table.
This is an intentional breaking change: the supported migration is to create a
new user-owned key with the required project scope.
