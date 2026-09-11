# ADR-030 — Use Project-Scoped Bearer Tokens for Machine Access

- Status: accepted
- Scope: Initial project access, CLI/agent authentication, and actor attribution
- Provenance: ISSUE-013, ACCESS-14, SPEC-001, SPEC-002, SPEC-003, and SPEC-005
- Related decisions: [ADR-008](ADR-008-enforce-project-scoped-domain-state.md), [ADR-012](ADR-012-own-publisher-credentials-and-use-oauth4webapi.md), [ADR-063](ADR-063-adopt-better-auth-access-plugins.md), [ADR-064](ADR-064-clean-development-access-baseline.md)
- Superseded by: [ADR-063](ADR-063-adopt-better-auth-access-plugins.md) for the
  Better Auth key contract, and [ADR-064](ADR-064-clean-development-access-baseline.md)
  for removal of the discarded Herald-owned token contract

## Context

Herald's human application authentication is deliberately limited to Better Auth
email/password sessions. The REST API is also a first-class surface for scripts,
CI, and external agents, but the current implementation accepts only a human
session cookie and attributes every project operation through a human actor.

The domain already distinguishes project-scoped actors of kind `api_token` from
human, agent, and system actors. The initial product direction supported trusted
humans and machines on a self-hosted instance. The later collaboration decision maps
each Herald project to a Better Auth Organization so membership, invitations, and
organization-owned API keys can share one project boundary.

## Decision

### Initial access policy

- Better Auth remains the only application authentication mechanism for humans.
- Access is granted by the Better Auth Organization member role. A project without
  an organization bridge is not available through the authenticated project API.
- An authenticated human with access to a project may create, list, and revoke
  that project's machine tokens.
- Machine tokens are scoped to exactly one project. They may use the ordinary
  project API and are not allowed to create projects or manage access tokens.
- Interactive publisher OAuth flows remain session-only because their provider
  redirects must return to an authenticated human browser. A machine token may
  use an existing publisher connection through the ordinary project API, but it
  cannot start or complete the LinkedIn connection flow.
- Tokens have the same project-wide permissions initially. Fine-grained scopes are
  deferred until real usage demonstrates that this boundary is too broad.

### Token contract

- A new project key is a high-entropy opaque Better Auth API Key with the
  `herald_pat_` prefix, organization reference, project metadata, and a 180-day
  default expiry. The plugin owns hashing, expiry, cleanup, and durable deletion.
- Invalid, expired, deleted, or revoked tokens produce the same generic unauthorized
  response.
- Clients send the token in `Authorization: Bearer <token>`. If an Authorization
  header is present, it is authoritative; a malformed or invalid bearer token does
  not fall back to a session cookie.

### Attribution and ownership

- Each token has a project-scoped `api_token` actor. Operations authenticated by
  the token resolve through that actor, so audit and domain attribution identify
  the machine credential rather than impersonating the human who created it.
- Better Auth owns new key records; Herald keeps a project-scoped `api_token` actor
  bridge so operations still have durable machine attribution. Neither key system
  owns publisher credentials.
- Deleting a new key prevents future authentication and removes the key record; the
  Herald actor remains available for historical attribution. Deleting a project
  cascades its organization-owned API keys and actor-owned domain state, while the
  project-to-organization foreign key prevents an orphan organization.

## Alternatives considered

### Keep the CLI human-session-only

This avoids a token model but prevents unattended agents, CI, and long-lived
automation from using a stable project boundary. It contradicts the existing
product surface and acceptance direction.

### Use Better Auth accounts or sessions for machines

This would couple machine lifecycle and project authorization to human identity
records, make attribution ambiguous, and risk reusing the wrong authentication
boundary. Rejected in favor of the dedicated Better Auth API Key plugin, which is
organization-owned and independent from human sessions.

### Use instance-wide API keys

An instance-wide key would make a compromised credential reach unrelated projects
and would not express the project's domain ownership. Rejected in favor of a
project-scoped token and actor.

### Add memberships, invitations, and scopes in the same slice

Memberships and invitations are now addressed by ADR-063. Fine-grained machine
permissions remain a future policy decision; the current project-wide machine
operation boundary is kept explicit rather than inferred from a token string.

## Consequences

- Scripts, agents, and a future CLI can authenticate without receiving a human
  session cookie or any publisher credential.
- Token plaintext handling is limited to one creation response; storage, logs,
  errors, audit metadata, and ordinary API responses contain no secret material.
- Existing human routes need one concrete principal boundary so both human and
  token actors can reach the same project-owned use cases without duplicating
  domain logic.
- OpenAPI documents the Bearer token and Better Auth session-cookie schemes,
  while public endpoints explicitly opt out and human-only operations advertise
  the session scheme.
- The initial full-project permission is intentionally broad. A future scope
  model must be driven by observed workflows and added as a separate decision,
  not smuggled into token parsing.

## Verification

ACCESS-14 and ACCESS-131/132 must prove one-time secret disclosure, project isolation,
expiry, deletion/revocation, human-only key management, actor attribution, generic
authentication failures, and unchanged human session access through API integration
tests. The full repository quality gate remains required.
