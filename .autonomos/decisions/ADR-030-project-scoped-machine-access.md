# ADR-030 — Use Project-Scoped Bearer Tokens for Machine Access

- Status: accepted
- Scope: Initial project access, CLI/agent authentication, and actor attribution
- Provenance: ISSUE-013, ACCESS-14, SPEC-001, SPEC-002, SPEC-003, and SPEC-005
- Related decisions: [ADR-008](ADR-008-enforce-project-scoped-domain-state.md), [ADR-012](ADR-012-own-publisher-credentials-and-use-oauth4webapi.md)
- Superseded by: none

## Context

Herald's human application authentication is deliberately limited to Better Auth
email/password sessions. The REST API is also a first-class surface for scripts,
CI, and external agents, but the current implementation accepts only a human
session cookie and attributes every project operation through a human actor.

The domain already distinguishes project-scoped actors of kind `api_token` from
human, agent, and system actors. The initial product direction supports trusted
humans and machines on a self-hosted instance, while it does not yet require
organizations, invitations, tenant isolation, or fine-grained permissions.

## Decision

### Initial access policy

- Better Auth remains the only application authentication mechanism for humans.
- A project is initially accessible to its creating human actor. Memberships and
  invitations are deferred until a concrete collaborative workflow requires them;
  this is an explicit sequencing boundary, not an implicit global authorization
  rule.
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

- A token is a high-entropy opaque bearer secret with a versioned, recognizable
  prefix suitable for operator identification.
- Herald stores only a SHA-256 digest, a non-secret display prefix, token metadata,
  and revocation/expiry state. The plaintext secret is returned only in the create
  response and is never recoverable afterward.
- Expiry is optional at creation and revocation is durable. Invalid, expired, or
  revoked tokens produce the same generic unauthorized response.
- Clients send the token in `Authorization: Bearer <token>`. If an Authorization
  header is present, it is authoritative; a malformed or invalid bearer token does
  not fall back to a session cookie.

### Attribution and ownership

- Each token has a project-scoped `api_token` actor. Operations authenticated by
  the token resolve through that actor, so audit and domain attribution identify
  the machine credential rather than impersonating the human who created it.
- Token rows and actor rows remain Herald domain data. They do not use Better Auth
  account rows and do not own publisher credentials.
- Revocation prevents future authentication and preserves non-secret metadata and
  audit history. Deleting a project cascades its tokens and token actors with the
  rest of the project-owned state.

## Alternatives considered

### Keep the CLI human-session-only

This avoids a token model but prevents unattended agents, CI, and long-lived
automation from using a stable project boundary. It contradicts the existing
product surface and acceptance direction.

### Use Better Auth accounts or sessions for machines

This would couple machine lifecycle and project authorization to human identity
records, make attribution ambiguous, and risk reusing the wrong authentication
boundary. Rejected because Better Auth authenticates people into Herald only.

### Use instance-wide API keys

An instance-wide key would make a compromised credential reach unrelated projects
and would not express the project's domain ownership. Rejected in favor of a
project-scoped token and actor.

### Add memberships, invitations, and scopes in the same slice

These may become useful, but they would add durable policy and UI surface without
evidence that the current trusted self-hosted operator model is insufficient.
They remain explicit follow-up decisions rather than hidden assumptions in the
token implementation.

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

ACCESS-14 must prove creation, one-time secret disclosure, hash-only persistence,
project isolation, expiry, revocation, human-only token management, actor
attribution, generic authentication failures, and unchanged human session access
through API integration tests. The full repository quality gate remains required.
