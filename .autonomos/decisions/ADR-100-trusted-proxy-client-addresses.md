# ADR-100 — Bind authentication client IPs to the socket and an explicit proxy chain

- Status: accepted — implementation of the owner-approved AUTH-637 scope on 2026-11-13
- Scope: HTTP client-IP provenance, trusted proxies, authentication quotas and session IP tracking
- Related: [ADR-098](ADR-098-optional-studio-and-client-authentication.md),
  [ADR-097](ADR-097-selectable-storage-profiles.md),
  [ADR-075](ADR-075-user-owned-api-keys.md)

## Context

Better Auth 1.7.7 reads IP headers for authentication quotas and session metadata.
Its forwarded-chain helper does not receive the actual TCP peer. Configuring that
helper alone cannot establish that a request came through an approved proxy.
Postdot previously supplied no verified client address and could use Better Auth's
shared per-path fallback bucket. Bun exposes the connected peer through
`server.requestIP(request)`.

## Decision

At the root HTTP request boundary, resolve the peer from Bun's serving handle.
Ignore caller-supplied IP headers when the peer is outside the operator's proxy
allowlist. The default allowlist is empty, including loopback: a direct caller
cannot establish proxy trust by setting a header.

`POSTDOT_TRUSTED_PROXIES` is an optional comma-separated list of IP addresses or
CIDR ranges. Reject invalid entries, empty list items, wildcards, scoped IPv6 and
`/0` ranges at startup. Limit configuration to 64 entries. Use Node's built-in
BlockList for address/subnet matching, including IPv4-mapped IPv6 peers, rather
than adding another network parsing dependency. Operators must choose addresses
exclusively controlled by their ingress; syntax validation does not establish
ownership or protect a backend reachable through an untrusted service in a range.

For an approved peer, inspect X-Forwarded-For from right to left. Skip approved
proxy hops and stop at the first unapproved address. Ignore any prefix to its left,
including forged or malformed tokens: that prefix is beyond the established client
boundary. A missing header, or a chain containing only trusted hops, uses the
connected peer as a conservative shared identity. Malformed addresses encountered
before establishing the client, over 32 hops, or headers over 4,096 characters
return HTTP 400 before authentication. Do not move those attempts to another quota
bucket or accept a caller-selected fallback header.

Overwrite `x-postdot-client-ip` on every incoming HTTP request before mounted
authentication handlers run. Better Auth reads only that internal canonical
header. X-Real-IP, CF-Connecting-IP and a caller's copy of the internal header do
not grant authority. The header is not a secret; its validity comes from the
request boundary overwriting it. Direct calls to the internal auth factory have
no socket provenance and are not a public HTTP mounting pattern.

Preserve the verified peer across Postdot's internal HEAD-to-GET redispatch using
request-object metadata in a WeakMap, never a header supplied over the network.
No peer information means no inferred client IP: Better Auth's conservative shared
bucket remains active rather than disabling rate limiting.

Keep Better Auth's existing production quotas and IP normalization. The installed
release allows three requests per ten seconds on sign-in/sign-up/password-change
paths, with separate rules for recovery; successful attempts consume the same
path quota. IPv6 identities follow its default /64 grouping. Session records use
the same normalized verified address. Preserve the retry response/header from
Better Auth. IP identity determines quotas and session metadata, not permissions,
OAuth callback identity, the public origin or trust in a native application.

## Operational scope

Authentication quotas remain in Better Auth's bounded process memory. Each API
process owns its own counters, and restart clears them. This decision does not
claim one installation-wide quota across ADR-097 replicas. A deployment requiring
a shared ingress quota must qualify that ingress policy separately; no database
migration or distributed limiter is added here.

The proxy must set or append the actual connecting peer, and the backend must be
reachable only through the intended ingress path. A host/Docker proxy gateway may
have a different socket address from the public TLS endpoint. Inspect a new
authenticated session with proxy trust disabled to identify that immediate peer;
do not infer it from forwarded headers. Use a new login after changing policy,
because existing session IPs record the address at creation.

Proxy IP trust does not enable forwarded Host/protocol inference. Public URLs,
origin/CSRF rules, API-key ceilings and human-session-only operations remain under
their existing configuration and authorization policy.

## Alternatives considered

- Trust a configurable IP header without a socket check: caller-controlled values
  could select quota identities when the backend is reachable directly.
- Configure Better Auth trustedProxies alone: parses header hops but cannot prove
  which connected peer submitted them.
- Trust loopback/private networks automatically: broadens authority to unrelated
  local/container callers and hides ingress configuration mistakes.
- Read provider-specific fallback headers: introduces competing identities and
  vendor assumptions before those deployment paths are qualified.
- Add persistent/distributed counters now: a separate state and multi-instance
  policy change; the present lot preserves existing limiter semantics.

## Qualification

Pure and mounted-route tests cover CIDR validation, IPv4/IPv6/mapped peers,
untrusted direct peers, multiple trusted hops, forged prefixes, malformed closest
hops, unknown peers, overwritten internal headers, unchanged request bodies and
HEAD provenance.

The isolated production HTTPS probe uses real loopback source addresses, verifies
the stored session IP, exhausts the sign-in quota while changing forged headers,
and confirms another client remains admitted. It also proves direct untrusted
access cannot select an IP, malformed attacker prefixes do not create buckets,
and malformed chains from a trusted socket are refused before login.

```sh
POSTDOT_E2E_PRODUCTION_WEB=true POSTDOT_E2E_SEPARATE_STUDIO=true POSTDOT_E2E_TLS_PROXY=true POSTDOT_E2E_AUTH_IP=true bun x playwright test e2e/auth-client-ip.spec.ts
```

## Sources

- [Bun requestIP](https://bun.sh/docs/runtime/http/server#server-requestip-request)
- [Better Auth connecting IP policy](https://better-auth.com/docs/concepts/rate-limit#connecting-ip-address)
- [Better Auth advanced IP options](https://better-auth.com/docs/reference/options#advanced)
