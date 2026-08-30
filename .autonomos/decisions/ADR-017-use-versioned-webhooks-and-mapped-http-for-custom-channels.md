# ADR-017 — Use Versioned Webhooks and Mapped HTTP for Custom Channels

- Status: accepted
- Scope: Automatic delivery for runtime-defined custom channels
- Provenance: Owner review of DOMAIN-07 on 2026-08-30
- Related specifications: [SPEC-004](../specs/SPEC-004-publication-content-boundary.md)
- Superseded by: none

## Context

Custom channels need an automatic delivery option without requiring every user-owned
blog, regional platform, or private publication API to become a built-in Herald
module. APIs controlled by the Herald operator can easily accept a stable Herald
webhook, while existing third-party APIs often require a different request shape.

Arbitrary JavaScript or a general expression language would make persisted channel
configuration an in-process plugin system with access to Herald's credentials,
database, filesystem, network, memory, and scheduler. At the other extreme, one fixed
webhook payload would force users to build an intermediate proxy for every existing
API.

## Decision

Automatic custom-channel delivery has two declarative modes implemented by one
bounded HTTP transport:

1. `herald_webhook`: the default automation contract for a service that can accept
   Herald's stable, versioned publication envelope;
2. `mapped_http`: an advanced one-request mapping for an existing HTTP API whose
   request and response shapes differ from Herald's webhook.

The webhook envelope is versioned independently from a channel's target-content
schema. It contains a stable event kind, webhook version, immutable delivery ID,
publication identity and timing, channel identity, validated target content, and
resolved media information needed by the receiver. It excludes unrelated internal
state and all secret material. Herald signs the final request body with a
connection-owned HMAC secret and timestamp so the receiver can authenticate delivery
and reject stale replays.

The mapped request can define:

- `POST`, `PUT`, or `PATCH` against a path or URI template resolved from the
  connection endpoint;
- explicit headers, query parameters, JSON, form, or multipart body structure;
- typed value expressions that select content or execution context through JSON
  Pointer, insert literals, construct objects and arrays, and map a bounded input
  array;
- same-request media as controlled URLs or multipart file parts;
- Herald's immutable delivery ID as an idempotency value;
- bounded response handling and explicit success, retryable, rejected, and ambiguous
  outcome classifications;
- JSON Pointer extraction of remote identifiers and URLs from JSON responses.

The mapping is a structural AST, not a generated JSON string. It cannot execute
scripts, access process state, call arbitrary functions, or perform an unbounded
loop. Credentials remain in the project-owned connection and are referenced by an
approved authentication binding rather than interpolated from content.

Both modes share request limits, timeout and cancellation behavior, logging,
redaction, retry fencing, response limits, and the outbound-network policy. Enabling
automation on a custom channel does not force every publication to use it: each
publication still explicitly chooses manual or automatic delivery.

An API that requires multiple requests, custom signing, provider-specific OAuth,
asynchronous upload orchestration, or other imperative protocol logic requires a
built-in channel module. A separately governed out-of-process connector protocol may
be considered later, but it is not part of this decision.

## Alternatives considered

- **Fixed Herald webhook only:** safe and simple but forces an intermediate proxy for
  existing APIs with a different contract.
- **Mapped HTTP only:** flexible, but denies Herald-owned receivers a stable default
  contract and repeats mappings that Herald can define once.
- **JSONata, JMESPath, or arbitrary JavaScript:** more expressive but introduces an
  execution language, a larger security boundary, harder resource limits, and less
  predictable editor and validation behavior.
- **Treat every integration as built-in:** preserves code-level control but prevents
  users from connecting simple private or niche publication endpoints themselves.

## Consequences

- A custom channel can automate simple publication APIs without shipping a Herald
  release or an intermediate proxy.
- Herald must version and document its canonical webhook envelope and signature
  verification contract.
- The mapped transport needs a small typed interpreter and adversarial resource tests.
- Complex provider protocols remain explicit built-in modules rather than hidden
  workflows in user configuration.
- Public versus private endpoint access and redirect/DNS handling remain a separate
  security decision.
