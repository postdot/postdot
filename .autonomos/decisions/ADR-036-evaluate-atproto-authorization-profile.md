# ADR-036 — Select an AT Protocol authorization profile before Bluesky implementation

- Status: proposed
- Date: 2026-09-05
- Scope: Bluesky/AT Protocol publisher connection, credential storage, token refresh, and authenticated publication delivery
- Provenance: [ISSUE-041](../ISSUES.md#issue-041-add-bluesky-as-the-next-built-in-provider-after-the-boundary-extraction), [PROVIDER-74](../worklogs/2026-09-05-PROVIDER-74.md)
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

The current `@herald/oauth` package intentionally provides focused authorization
code mechanics for providers with explicit metadata and does not implement this
distributed AT Protocol profile. The current project-owned credential model also
does not yet describe DPoP key material, the discovered authorization/resource
servers, or the provider subject needed to refresh and verify an AT Protocol
session.

The official AT Protocol documentation lists `@atproto/oauth-client-node` as the
server-side TypeScript SDK and states that the SDK handles DPoP, token refresh, and
session management. The suitability of that SDK for Herald's Bun runtime and
project-owned, worker-driven credential lifecycle still requires an isolated proof.

References:

- [AT Protocol OAuth specification](https://atproto.com/specs/oauth)
- [AT Protocol OAuth implementation patterns](https://atproto.com/guides/oauth-patterns)
- [AT Protocol OAuth SDK guidance](https://atproto.com/guides/about-oauth)

## Decision

No Bluesky connection or credential implementation is authorized by this record
yet. The project must first select one explicit authorization profile and prove its
fit with Herald's ownership and runtime constraints.

The candidate direction for evaluation is a provider-owned adapter around the
official `@atproto/oauth-client-node` implementation, while keeping the generic
`@herald/oauth` package unchanged. The adapter would translate the SDK's session
and request lifecycle into Herald's project-owned credential and worker ports. It
must not move project ownership, connection lifecycle, or provider identity into a
third-party account model.

The candidate direction is not accepted until the following are demonstrated in an
isolated test harness:

- Bun runtime compatibility without a Node-only process or hidden service;
- durable storage and rotation of access tokens, refresh tokens, DPoP key material,
  issuer/resource-server metadata, and the verified DID;
- safe worker refresh and publication requests using the same DPoP session key;
- correct callback, state, PAR, nonce, issuer, PDS, and DID verification behavior;
- a self-hosted deployment story for the public client metadata URL, including the
  local development case;
- redacted logs, project-scoped ownership, disconnect/reconnect behavior, and
  restart-safe recovery.

## Alternatives considered

### Extend `@herald/oauth` with a generic AT Protocol profile

This would keep dependencies centralized, but it would substantially expand a
focused package with discovery, client metadata, PAR, DPoP, nonce handling, DID/PDS
verification, and provider-specific session semantics. It risks creating a second
generic OAuth framework without evidence that other providers need the same profile.
It is not the default direction.

### Use the official AT Protocol server-side SDK inside a provider adapter

This keeps AT Protocol truth in the provider module and allows the maintained SDK
to own protocol details. It adds a dependency and requires a Bun compatibility
proof plus an explicit persistence bridge for Herald's worker lifecycle. This is
the candidate direction, not an accepted implementation choice.

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

- `CHANNEL-75` remains gated until this proposed decision is accepted or replaced.
- The LinkedIn path and generic OAuth mechanics remain unchanged.
- A future Bluesky implementation will need provider-specific session state rather
  than assuming that `accessToken`, `refreshToken`, and a static authorization
  server are sufficient for every provider.
- The provider boundary is validated by a real distributed protocol instead of by
  adding a second provider-shaped branch with an incorrect shared abstraction.
