# ADR-025 — Use Provider-Specific OAuth Request Profiles

- Status: accepted
- Scope: OAuth authorization request and token-exchange behavior for publisher adapters
- Provenance: PUB-09 live LinkedIn smoke test, provider source comparison, and
  official LinkedIn OAuth documentation reviewed on 2026-08-31
- Related decisions: [ADR-011](ADR-011-select-linkedin-member-text-publisher.md),
  [ADR-012](ADR-012-own-publisher-credentials-and-use-oauth4webapi.md)
- Superseded by: none

## Context

Postbot shares authorization-code mechanics across publisher adapters, but an
OAuth provider's documented web and native flows do not necessarily have the
same request requirements. The shared implementation originally sent PKCE
parameters by default. The configured LinkedIn application accepted the
standard web authorization and client authentication only after the request was
aligned with LinkedIn's standard three-legged flow.

LinkedIn documents two distinct patterns:

- the standard web flow uses `/oauth/v2/authorization` and
  `/oauth/v2/accessToken`, with the client secret submitted during token
  exchange;
- the native PKCE flow uses a separate authorization endpoint and provider
  setup.

Treating these as one universal request profile would either reject a valid
provider flow or silently weaken the security properties of another provider.

## Decision

OAuth provider adapters declare an explicit request profile for the selected
provider flow. The profile owns:

- authorization and token endpoints;
- client authentication method;
- scope and provider-specific parameters;
- PKCE policy;
- account identity and token lifecycle behavior.

The shared OAuth layer follows these rules:

1. `state` is generated, persisted, validated, and consumed for every flow.
2. PKCE S256 is enabled by default for flows that support it.
3. A provider may explicitly disable PKCE only when its selected documented flow
   does not support the PKCE parameters. This exception is local to that adapter
   and flow; it is not a deployment-wide setting.
4. When PKCE is disabled, the authorization URL contains no PKCE parameters and
   the token exchange uses the provider-declared client authentication method.
5. When PKCE is enabled, the verifier remains encrypted, transaction-bound, and
   single-use until the authorization code exchange completes.

The LinkedIn member web adapter uses the standard three-legged profile with
client-secret-post and no PKCE. A future LinkedIn native-client integration, or
another provider, must use a separate explicitly reviewed profile rather than
changing the shared default.

## Alternatives considered

### Force PKCE for every provider

This is a strong default for compatible flows, but it is incompatible with the
selected LinkedIn web flow and prevents a valid production connection. Rejected
as a universal rule.

### Disable PKCE in the shared OAuth implementation

This would make one provider work by weakening every provider's default and
would make security behavior depend on call-site discipline. Rejected.

### Add arbitrary provider parameters at each call site

This duplicates security-sensitive request construction and makes it difficult
to audit which flow a provider actually uses. Rejected in favor of a typed,
provider-owned profile.

## Consequences

### Positive

- Provider deviations remain visible in the adapter and reviewable in one place.
- The shared OAuth implementation keeps a secure PKCE default for compatible
  flows without blocking providers with different documented requirements.
- State validation, encrypted attempt storage, and one-use semantics remain
  uniform across profiles.
- A future native or provider-specific flow can be added without changing the
  meaning of existing authorization attempts.

### Costs and risks

- Each provider adapter must document and test its selected OAuth flow.
- A non-PKCE confidential-client flow relies on the provider's TLS-protected
  client authentication and must not be generalized to public clients.
- Provider documentation and endpoint behavior need to be rechecked when a
  profile changes.

## Evidence

- The live LinkedIn authorization completed after the standard web flow was
  represented without PKCE; token exchange and profile resolution then
  succeeded.
- The same live connection persisted a project-owned credential and delivered a
  real text post through the worker.
- [LinkedIn authorization-code flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)
- [LinkedIn native PKCE flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow-native)
