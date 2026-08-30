# ADR-012 — Own Publisher Credentials and Use oauth4webapi for OAuth Mechanics

- Status: accepted
- Scope: Publisher credential ownership, OAuth protocol mechanics, secret storage,
  and worker access
- Provenance: [ISSUE-006](../ISSUES.md), [CRED-15](../TASKS.md), official OAuth and
  provider documentation, and a Bun compatibility spike on 2026-08-29
- Related specifications: [SPEC-001](../specs/SPEC-001-v1-scope.md),
  [SPEC-002](../specs/SPEC-002-engineering-operating-model.md)
- Related decisions: [ADR-001](ADR-001-separate-channel-from-publisher.md),
  [ADR-005](ADR-005-use-sqlite-first-persistence.md),
  [ADR-011](ADR-011-select-linkedin-member-text-publisher.md)
- Superseded by: none

## Context

Herald has two distinct authorization boundaries:

1. application authentication identifies people and establishes sessions for access
   to Herald;
2. publisher credentials authorize Herald to act against an external destination.

The first LinkedIn implementation used Better Auth accounts for both boundaries.
That implementation can complete an OAuth flow, encrypt tokens, and refresh tokens
for a trusted server caller, but its account model remains owned by a Better Auth
user. Herald publisher connections are project-owned resources with different
membership, deletion, transfer, revocation, audit, and background-execution
semantics.

The coupling is observable in the current implementation: publisher connections
reference Better Auth account rows, the worker resolves credentials through Better
Auth with the account owner's user ID, and publisher requirements alter global
account-linking policy. A future organization plugin would not change the ownership
of Better Auth account rows and therefore would not resolve this mismatch.

OAuth protocol code is security-sensitive and should not be implemented ad hoc when
a focused, standards-oriented primitive is available. The dependency must not own
Herald storage, users, projects, sessions, or publisher lifecycle state.

## Decision

### Separate the boundaries

- Better Auth is responsible only for authenticating people into Herald and managing
  their application sessions. Its V1 strategy is email/password only: no OAuth or
  social provider is configured through Better Auth. Any future application login
  strategy requires a separate explicit decision and does not expand Better Auth's
  responsibility into publisher credentials.
- Herald owns publisher credentials and authorization attempts as project-scoped
  domain resources.
- `connectedByActorId` is audit attribution, not a reference to a Better Auth account
  that mechanically owns token storage. Actor departure or application-user deletion
  does not revoke or delete the project-owned publisher credential.
- Publisher tables must not reference Better Auth account rows. Workers must not
  require a Better Auth session or user ID to resolve publisher credentials.
- Project authorization determines who may connect, inspect, reconnect, or
  disconnect a publisher credential. Moving a credential between projects is not a
  transfer operation; the destination project establishes its own connection.

### Keep deployment credentials distinct from publisher credentials

- OAuth client registration values such as a provider client ID, client secret, and
  callback URL are deployment configuration. They remain explicit environment
  configuration because changing them changes the deployed OAuth application.
- Access tokens, refresh tokens, granted scopes, external account identity,
  expiration, and connection health are dynamic product data stored by Herald.
- API keys and other non-OAuth credentials must not be forced into OAuth or
  application-identity records. Their exact storage model remains deferred until a
  concrete publisher requires it.

### Delegate only OAuth protocol mechanics

Use `oauth4webapi` as the low-level OAuth client primitive for authorization-code
flows, PKCE, authorization-response validation, token exchange, refresh, and
revocation where supported.

Provider adapters remain responsible for:

- fixed authorization and token endpoint metadata when discovery is unavailable;
- client authentication method, required scopes, and provider-specific parameters;
- resolving a stable external account identifier and display metadata;
- classifying provider deviations and reconnect conditions;
- declaring whether refresh or revocation is actually available for that provider.

Do not create a provider configuration language or universal publisher DSL. Shared
OAuth routines are a protocol implementation boundary; provider truth remains in
provider-specific code.

### Persist authorization attempts safely

An OAuth authorization attempt is a short-lived, single-use record bound to the
authenticated actor, project, channel, provider, exact callback URI, requested
scopes, and intended return path.

- Generate a fresh high-entropy `state` value and PKCE verifier for every attempt.
- Persist only a digest of `state`; encrypt the PKCE verifier while it is needed.
- Reject missing, expired, consumed, mismatched, or replayed attempts before token
  exchange.
- Use an allowlisted return path and provider-specific callback routes. Never accept
  an arbitrary redirect target from a query parameter.
- Use authorization code flow and PKCE S256 when the provider supports it. Retain
  transaction-bound `state` validation even when PKCE is present.

These requirements follow the current OAuth security best current practice, which
recommends PKCE for confidential clients and requires explicit CSRF and authorization
server mix-up defenses.

### Encrypt publisher secrets under a Herald-owned key

- Encrypt access tokens, refresh tokens, and temporary PKCE verifiers with Bun's
  Web Crypto AES-256-GCM implementation.
- Use a fresh random 96-bit nonce for every encrypted value and authenticated
  additional data that binds the ciphertext to its credential, provider, and field.
- Store a versioned encryption envelope so key and format rotation can be added
  without changing domain identifiers.
- Use a dedicated 256-bit deployment secret that is distinct from
  `BETTER_AUTH_SECRET`. Never persist that key in SQLite or its backups.
- Never return token material from project APIs or include it in logs, audit metadata,
  errors, or test snapshots.

Encryption protects a copied database or backup. It does not protect credentials
from a compromised Herald process that holds the decryption key.

### Make connection health explicit

A publisher credential has an operator-visible lifecycle independent of publication
job state:

- `active`: usable now or refreshable without operator interaction;
- `reconnect_required`: expired, revoked, rejected with an authorization failure, or
  unable to refresh without another browser authorization flow;
- `revoked`: deliberately disconnected and no longer usable.

Refresh-token rotation must replace token material atomically. A temporary token
endpoint failure remains distinguishable from `invalid_grant` or another durable
reconnect condition. Providers such as LinkedIn that do not grant programmatic
refresh to every application must support browser reauthorization as a normal
lifecycle path.

Disconnecting attempts provider revocation when supported, always removes local
token usability, and preserves non-secret audit evidence. Removing a project removes
its publisher credentials without deleting an application user.

### Keep publisher ownership project-scoped

A connected external destination belongs to its Herald project, including when an
authenticated project member completed the provider authorization flow. The actor is
recorded for audit but does not retain personal ownership of the resulting local
connection.

- Removing the actor from the project or deleting their Herald account leaves the
  connection usable by the project.
- An authorized project member may explicitly disconnect or reconnect it.
- Provider revocation, durable authorization failure, or project deletion removes
  its usability according to the credential lifecycle above.
- No foreign key from publisher credentials to Better Auth users or accounts may
  infer ownership or cascade credential deletion.
- External providers may impose their own authorization validity rules. Herald
  reflects those rules as connection health without changing local project ownership.

## Alternatives considered

### Continue using Better Auth accounts

This minimizes immediate code but assigns a project-owned publisher secret to a
user-owned application identity record. User deletion, account unlinking, global
linking policy, organization membership, and background worker access remain
coupled. Rejected because the domain ownership is wrong even though the API is
technically capable.

### Implement token requests directly with `fetch`

This has no dependency cost, but Herald would own more security-critical protocol
validation and provider error parsing than necessary. Rejected while a focused,
zero-dependency implementation of the current security practices exists.

### Use `openid-client`

`openid-client` 6.8.7 supports Bun and provides a higher-level OAuth and OpenID
Connect API. It depends on `oauth4webapi` and `jose`. Herald does not need its OIDC
identity and discovery convenience for the publisher boundary, so the additional
surface and dependency are not justified for V1.

### Use `@badgateway/oauth2-client`

Version 3.3.1 is small and dependency-free and offers PKCE, refresh, discovery, and
revocation. It is a credible fallback, but has a smaller maintenance and conformance
surface than `oauth4webapi`, and its declared runtime support is Node and browsers
rather than Bun explicitly.

### Use Arctic

Arctic 3.7.0 offered a convenient generic and provider-specific API, including
LinkedIn, but the package and project were deprecated in July 2026. It is not a
viable new foundation.

### Use a provider SDK as the credential manager

A provider SDK may remain useful inside one publisher adapter, but it cannot own the
cross-provider credential lifecycle. The available LinkedIn client also brings an
Axios-based HTTP stack that duplicates Herald's existing focused publisher adapter.

## Evidence

- `oauth4webapi` 3.8.7 is active, MIT licensed, dependency-free, tree-shakeable ESM,
  explicitly supports Bun, and covers PKCE authorization code flow, refresh, and
  revocation. Its installed package contains six files and occupies approximately
  332 KiB before bundling.
- A temporary Bun 1.4.0 spike generated PKCE verifier/challenge and state values and
  loaded client-secret-post, refresh, and revocation functions successfully. The
  spike did not modify project dependencies and was removed after measurement.
- LinkedIn documents authorization-code exchange with client credentials in the
  request body, mandatory callback matching and scope selection, CSRF `state`, and
  an interactive reauthorization fallback. Programmatic refresh tokens are limited
  to eligible applications.

Sources:

- [oauth4webapi](https://github.com/panva/oauth4webapi)
- [OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700)
- [Proof Key for Code Exchange](https://www.rfc-editor.org/rfc/rfc7636)
- [OAuth 2.0 Token Revocation](https://www.rfc-editor.org/rfc/rfc7009)
- [LinkedIn 3-legged OAuth flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)

## Consequences

### Positive

- Application authentication remains a small, independent email/password boundary;
  any later strategy can evolve through its own explicit decision.
- Application user rows no longer mechanically own or cascade-delete publisher
  secrets; actor departure does not affect project-owned connection availability.
- Workers resolve credentials without impersonating or retaining a human session.
- OAuth security primitives are delegated without outsourcing Herald's domain or
  storage model.
- Non-OAuth credentials remain free to adopt an evidence-backed lifecycle without
  artificial Better Auth account rows.
- The runtime dependency has no transitive dependency or service cost.

### Costs and risks

- Herald must own encrypted storage, authorization-attempt persistence, key
  operations, connection health, and provider-specific OAuth metadata.
- Losing the deployment encryption key makes stored publisher credentials
  unrecoverable. Backup and restore procedures must cover the key separately without
  placing it in the database archive.
- Provider deviations still require contract tests and explicit adapter behavior;
  the standards library cannot make a non-compliant provider compliant.
- Replacing the current Better Auth coupling requires a schema and API migration
  before the LinkedIn smoke test can resume.

## Implementation gate

Do not resume PUB-09 until a follow-up task proves all of the following:

- no publisher schema, route, client contract, or worker references a Better Auth
  account or uses Better Auth to obtain a publisher token;
- Better Auth exposes only the accepted email/password login strategy, with login and
  session behavior covered independently;
- authorization attempts are expiring, single-use, actor/project/provider-bound,
  and resistant to state replay and redirect injection;
- distinct external accounts from the same provider can be connected without
  ambiguity;
- raw SQLite files, API responses, logs, errors, and audit events contain no token
  plaintext;
- encryption round trips, wrong-key failure, ciphertext tampering, and envelope
  version handling are tested;
- refresh rotation and reconnect-required behavior are transactionally tested with
  a fake provider server;
- actor departure and application-user deletion leave project-owned publisher
  credentials intact without relying on Better Auth account rows or cascades;
- disconnect and project deletion remove local token usability and preserve only
  non-secret audit evidence;
- `bun run check` and the relevant footprint measurements remain green.
