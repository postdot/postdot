# ADR-036 — Use the portable official AT Protocol OAuth client behind a provider adapter

- Status: accepted
- Date: 2026-09-05
- Scope: Bluesky/AT Protocol publisher connection, credential storage, token refresh, and authenticated publication delivery
- Provenance: [ISSUE-041](../archive/foundations-first-deliveries/ISSUES.md#issue-041-add-bluesky-as-the-next-built-in-provider-after-the-boundary-extraction), [PROVIDER-74](../archive/foundations-first-deliveries/worklogs/2026-09-05-PROVIDER-74.md)
- Related decisions: [ADR-012](ADR-012-own-publisher-credentials-and-use-oauth4webapi.md), [ADR-025](ADR-025-use-provider-specific-oauth-request-profiles.md), [ADR-033](ADR-033-use-versioned-built-in-provider-adapters.md)
- Superseded by: none

## Context

Bluesky is the next planned built-in provider, but its authorization model is not
the same as the static OAuth profile currently used by LinkedIn. The authoritative
AT Protocol OAuth specification requires provider discovery, a URL-based client ID
and client metadata, authorization code with PKCE, pushed authorization requests
(PAR), DPoP-bound token requests and resource requests, refresh-token rotation, and
verification that the returned DID is consistent with the authorization server and
the account's PDS.

The current `@postbot/oauth` package intentionally provides focused authorization
code mechanics for providers with explicit metadata and does not implement this
distributed AT Protocol profile. The current project-owned credential model also
does not yet describe DPoP key material, the discovered authorization/resource
servers, or the provider subject needed to refresh and verify an AT Protocol
session.

The official AT Protocol documentation lists the maintained OAuth SDKs and states
that they handle DPoP, token refresh, and session management. The Node wrapper is
not a suitable direct dependency for Postbot: an isolated Bun 1.4 proof with
`@atproto/oauth-client-node@0.5.4` reached the package's Node-only SSRF guard and
failed before a client could be constructed. The portable
`@atproto/oauth-client@0.8.4` core client was then constructed successfully under
Bun with an explicit Web Crypto runtime implementation and an identity resolver.

References:

- [AT Protocol OAuth specification](https://atproto.com/specs/oauth)
- [AT Protocol OAuth implementation patterns](https://atproto.com/guides/oauth-patterns)
- [AT Protocol OAuth SDK guidance](https://atproto.com/guides/about-oauth)

## Decision

Postbot will use the official portable `@atproto/oauth-client` core inside a
provider-owned Bluesky adapter, with `@atproto/jwk-webcrypto` (or the equivalent
official Web Crypto implementation required by the installed SDK version) as the
Bun runtime key implementation. The adapter will translate the SDK's state and
session lifecycle into Postbot-owned project-scoped encrypted stores. The generic
`@postbot/oauth` package remains unchanged, and Better Auth remains unrelated to
publisher connections.

The adapter must not move project ownership, connection lifecycle, or provider
identity into a third-party account model. Before the first real provider call, the
implementation must demonstrate:

- Bun runtime compatibility without a Node-only process or hidden service;
- durable storage and rotation of access tokens, refresh tokens, DPoP key material,
  issuer/resource-server metadata, and the verified DID;
- safe worker refresh and publication requests using the same DPoP session key;
- correct callback, state, PAR, nonce, issuer, PDS, and DID verification behavior;
- a self-hosted deployment story for both the public client metadata URL and the
  official local loopback profile;
- redacted logs, project-scoped ownership, disconnect/reconnect behavior, and
  restart-safe recovery.

### Deployment profiles

Postbot does not make DNS or HTTPS a global application requirement. A local
runtime-managed Bluesky application may use the AT Protocol loopback profile:
the client identifier is the special `http://localhost` value and the redirect
uses a loopback IP literal. Because Postbot's session cookie is host-bound, the
API, dashboard, and callback configuration must consistently use `127.0.0.1`
(or consistently `[::1]`). No tunnel or public metadata document is used.

A deployed web application uses the discoverable web profile. It requires a
stable HTTPS client metadata URL and an exact publicly reachable HTTPS callback.
The Postbot API serves the metadata document itself; a reverse proxy may provide
reachability but is not a Postbot runtime dependency. The provider application
settings and deployment guide expose these as two explicit, provider-specific
profiles rather than inferring a global requirement.

## Alternatives considered

### Extend `@postbot/oauth` with a generic AT Protocol profile

This would keep dependencies centralized, but it would substantially expand a
focused package with discovery, client metadata, PAR, DPoP, nonce handling, DID/PDS
verification, and provider-specific session semantics. It risks creating a second
generic OAuth framework without evidence that other providers need the same profile.
It is not the default direction.

### Use the official portable AT Protocol SDK inside a provider adapter

This keeps AT Protocol truth in the provider module and allows the maintained SDK
to own protocol details. The portable core is compatible with Bun once Postbot
supplies the runtime key, randomness, and digest primitives. The Node wrapper is
not used because its current Node-only fetch/SSRF guard is incompatible with our
runtime. The decision adds a dependency and requires an explicit persistence bridge
for Postbot's worker lifecycle.

### Use Bluesky app passwords as the primary connection flow

This would be simpler to implement, but it replaces the provider's primary OAuth
path with manually created long-lived credentials and a broader permission model.
It would also create a different connection UX and secret lifecycle that must be
accepted deliberately. It must not be introduced as a silent compatibility
shortcut.

### Defer Bluesky until the authorization profile is settled

This preserves the current security and ownership boundaries and avoids a
throwaway credential model. It delays the next provider, but it is safer than
implementing an incompatible flow and rewriting it after the first real test.

## Consequences

- `CHANNEL-75` is unblocked for implementation, but its first real provider call
  remains gated on the acceptance criteria above.
- The LinkedIn path and generic OAuth mechanics remain unchanged.
- A future Bluesky implementation will need provider-specific session state rather
  than assuming that `accessToken`, `refreshToken`, and a static authorization
  server are sufficient for every provider.
- The provider boundary is validated by a real distributed protocol instead of by
  adding a second provider-shaped branch with an incorrect shared abstraction.
