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

Herald is a publication application. An API key is an external way for a
person to use Herald from a CLI, MCP server, script, or another client; it is
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
boundary. Projects remain owned by their workspace and Herald's existing
project roles continue to decide whether the authenticated user may read or
modify a resource.

### Product surfaces

API keys are managed from the user Preferences area and from the CLI's
`api-keys` resource. Creation returns the plaintext secret once; subsequent
list responses contain only metadata and the token prefix.

Workspace/instance administration, provider OAuth setup, and other
interactive account-security mutations remain human-session surfaces. A user
API key may operate project content according to the same project role as its
owner, but it is not a way to bypass those session-only security boundaries.

### Compatibility

Herald is still private and has no deployed data contract to preserve. The
project-bound API routes, typed-client methods, CLI commands, actor store, and
project API-key dashboard are removed rather than kept as compatibility
facades. The development database baseline contains no project-token table.
This is an intentional breaking change: the supported migration is to create a
new user-owned key with the required project scope.
