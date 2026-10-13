# ADR-043 — Guard Per-Instance Provider Egress at the Runtime Boundary

- Status: accepted
- Date: 2026-09-06
- Scope: per-instance built-in provider requests, operator network policy, DNS
  resolution, and Mastodon connection/execution flows
- Related task: SECURITY-88
- Related decisions: [ADR-033](ADR-033-use-versioned-built-in-provider-adapters.md),
  [ADR-041](ADR-041-mastodon-per-instance-oauth.md)
- Superseded by: none

## Context

Mastodon is a built-in provider whose instance origin is selected when a project
connects a channel. The origin is stored as project-owned publisher state and is
used later by both the OAuth connection flow and the worker. URL validation alone
does not prevent a hostname from resolving to loopback, private, link-local, or
cloud metadata addresses, and using the platform `fetch` directly would leave a
DNS-rebinding window between validation and connection.

Postbot already has a tested egress authorizer and a Node requester for bounded
custom HTTP delivery. Duplicating that policy in every provider would create
multiple security boundaries with different behavior. The policy is operator
owned; a project user must not be able to opt a destination into private network
access through a channel or publisher payload.

## Decision

- Reuse the existing custom HTTP egress implementation as Postbot's shared
  operator-controlled outbound network boundary. Add a provider-neutral fetcher
  adapter to that package rather than introducing a second resolver/requester
  stack or a speculative network service.
- Every runtime request to a per-instance provider authorizes the request origin,
  resolves all addresses, rejects metadata addresses, and rejects restricted
  addresses unless the operator has explicitly allowed the exact hostname or
  CIDR, port, and scheme through server configuration.
- Public destinations must use HTTPS. HTTP is available only when an operator
  rule explicitly allows the destination, which keeps local development possible
  without making loopback reachable by default.
- The validated address is pinned in the Node requester's `lookup` callback and
  the request does not follow redirects. The original hostname remains the TLS
  SNI and HTTP `Host` value, so certificate and virtual-host routing still work.
- The operator policy is configured once by the process through
  `POSTBOT_OUTBOUND_PRIVATE_DESTINATIONS`. It applies to custom HTTP and
  per-instance built-in providers; provider code does not read environment
  variables or make authorization decisions.
- Mastodon receives the controlled fetcher in both OAuth connection routes and
  worker execution. A policy denial is a permanent, non-ambiguous outcome before
  the external effect begins; DNS resolution and transient transport failures
  retain retryable or ambiguous semantics according to the provider operation.
- The policy remains an application composition concern. Provider packages keep
  protocol knowledge and accept an injected fetcher, while custom HTTP remains
  the only package that owns the shared low-level egress implementation for now.

## Alternatives considered

### Use the platform `fetch` for Mastodon

Rejected because it does not expose the resolved address pinning needed to close
the DNS-rebinding gap, and it would bypass the existing private-destination
policy.

### Copy the policy into `@postbot/mastodon`

Rejected because every future per-instance provider would need another security
implementation and the policies could drift. Mastodon remains testable through
its injected fetcher.

### Allow private destinations by default for local development

Rejected because a self-hosted development convenience would turn into a server-
side request forgery risk in deployments where project users are not fully
trusted. Operators can allow an exact local destination explicitly.

### Introduce a separate network package immediately

Deferred. The existing `@postbot/custom-http` boundary already owns the hardened
resolver and Node requester, and the new provider-neutral adapter is small. A
separate package becomes justified only if the shared boundary needs independent
runtime consumers or lifecycle that cannot remain coherent here.

## Consequences

- Mastodon local instances require an explicit operator rule; a malformed or
  missing rule fails closed rather than silently using the global fetcher.
- The same egress semantics apply to Mastodon OAuth registration, callback
  verification, token-backed media operations, and status publication.
- A policy denial is visible as a stable machine-readable provider outcome while
  internal addresses and credentials remain absent from public errors.
- The environment variable name is generalized because the policy is no longer
  custom-channel-specific. This is a young private project, so no legacy alias is
  retained.
- Redirects remain disabled for controlled provider requests. A provider that
  requires a redirecting upload flow will need an explicit provider implementation
  rather than silently weakening this boundary.

## Verification requirements

- Test public HTTPS success, public HTTP denial, private/CIDR allowlisting, mixed
  DNS answers, metadata denial, IPv4-mapped IPv6 handling, and address pinning.
- Test the provider-neutral fetcher with GET, form, and streamed media request
  bodies and confirm it does not follow redirects.
- Test Mastodon policy-denied registration and publication as permanent failures,
  while preserving retryable resolution failures and ambiguous post-effect
  transport failures.
- Run the complete repository quality gate before integrating the task.
