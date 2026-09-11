# ADR-069 — Bind custom HTTP path authentication to one encrypted secret segment

- Status: proposed
- Date: 2026-09-11
- Scope: Runtime-defined custom HTTP connection authentication and mapped delivery
- Provenance: ISSUE-031, SECURITY-141, and owner approval to implement the bounded path-authentication follow-up
- Related decisions: [ADR-017](ADR-017-use-versioned-webhooks-and-mapped-http-for-custom-channels.md), [ADR-018](ADR-018-restrict-custom-channel-network-egress.md)

## Context

Herald's custom HTTP connection stores one origin-only endpoint so project-owned
configuration cannot expand the network authority granted to the instance. The
mapped execution contract already constructs a bounded path beneath that origin,
but its path expressions previously could not consume the encrypted connection
secret. Some receivers use a secret-bearing path as their authentication or
routing mechanism instead of a header.

Putting that path in `endpointUrl` would turn credential material into ordinary
connection metadata, make redaction and rotation harder, and weaken the origin
boundary. Allowing a general secret expression would also make it too easy to
reuse the credential in content, query parameters, headers, or bodies.

## Decision

The custom HTTP contract adds a `path` authentication kind and a dedicated
`{ "kind": "secret" }` declarative path segment:

- only `mapped_http` executions may use `path` authentication;
- the active profile must contain exactly one secret path segment;
- the secret is resolved only from the connection credential at delivery time and
  encoded as one URL path component, so reserved characters cannot create new
  path segments, queries, fragments, or authority components;
- a secret path segment is invalid with `none`, `bearer`, or `header`
  authentication, and a path-authenticated connection is invalid without the
  dedicated segment;
- `endpointUrl` remains origin-only and still passes the existing execution-time
  DNS, address-classification, private-destination, redirect, and pinned-address
  egress boundary;
- the secret is not available to query, header, body, webhook-envelope, profile
  content, or arbitrary expression evaluation; extracted response identifiers and
  URLs containing the raw or encoded credential are rejected before persistence;
- Herald's built-in transport redacts both the raw and encoded secret from
  diagnostics. The receiver and any infrastructure in front of it can still see
  the URL, so operators must treat path authentication as appropriate only for
  receivers whose access-log and proxy policy accepts that exposure.

No database migration is required: authentication is already stored as a
project-owned encrypted credential binding, and the new value is validated at the
API, connection-store, and transport boundaries.

## Alternatives considered

- **Store a full path-bearing endpoint:** rejected because the secret would live
  in ordinary endpoint metadata and could bypass the profile-owned execution
  contract.
- **Allow a generic secret expression:** rejected because it would permit secret
  reuse in query, headers, bodies, or content-shaped mappings and would make the
  security review depend on every expression location.
- **Put the secret in a query parameter:** rejected for this scope because query
  strings are commonly retained by access logs, proxies, browser tooling, and
  observability systems; a future query-authentication request needs a separate
  explicit decision.
- **Keep rejecting path-authenticated receivers:** safe but needlessly excludes
  bounded receivers that can be represented without a new imperative connector.

## Consequences

- A custom receiver can use a path token without giving project configuration a
  second network origin or a free-form credential interpolation primitive.
- A path-authenticated request necessarily places the credential in the outbound
  URL, which is an explicit receiver-side exposure trade-off rather than a secret
  storage improvement.
- Profile authors must version the execution contract when adding or removing the
  secret segment; connection creation fails closed when the authentication and
  profile do not agree.
- Query-secret authentication, multi-secret paths, and imperative signing remain
  separate future decisions rather than implicit extensions of this contract.

## Verification

SECURITY-141 covers structural validation, API response typing and connection
creation, encoded path construction, fail-closed dispatch, response redaction,
and the existing custom HTTP egress/transport test suite. This record remains
proposed until the owner explicitly accepts the technical decision.
