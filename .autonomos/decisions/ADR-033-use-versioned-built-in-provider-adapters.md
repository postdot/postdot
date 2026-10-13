# ADR-033 — Use Versioned Adapters for Built-in Provider Execution

- Status: accepted
- Scope: Built-in provider dispatch, credential preparation, provider execution, and workflow boundaries
- Provenance: [ISSUE-027](../ISSUES.md), [PROVIDER-69](../worklogs/2026-09-04-PROVIDER-69.md), owner approval on 2026-09-04
- Related decisions: [ADR-001](ADR-001-separate-channel-from-publisher.md), [ADR-009](ADR-009-fence-external-effects-with-durable-claims.md), [ADR-012](ADR-012-own-publisher-credentials-and-use-oauth4webapi.md), [ADR-021](ADR-021-channel-owns-profile-contract.md), [ADR-026](ADR-026-linkedin-single-image-delivery.md)
- Superseded by: none

## Context

Postbot's workflow worker owns durable claims, retries, and external-effect
completion. It also currently performs several LinkedIn-specific decisions: provider
selection, credential refresh, destination validation, content extraction, image
upload sequencing, and reconnect handling. LinkedIn already has typed publisher
interfaces and a versioned channel profile, but adding another built-in provider
would enlarge the central dispatch hotspot.

Custom HTTP is a different execution kind. It is defined by a bounded runtime
profile and declarative transport rules, and must not be conflated with code-owned
built-in provider modules.

## Decision

### Built-in registry and adapter

- Code-owned built-in providers are registered behind a small typed adapter port.
- The registry resolves a provider by its versioned execution identity, at minimum
  `contractId` and `revision`, and validates the provider/profile match before any
  external request.
- The first registered adapter is the existing LinkedIn execution contract. The
  extraction must preserve current text, image, token refresh, outcome, and media
  delivery behavior.
- Unknown contract identities, unsupported revisions, and mismatched provider
  identities fail closed before credential use or network dispatch.

### Adapter responsibilities

An adapter owns provider-specific behavior:

- matching its built-in execution contract and revision;
- preparing provider credentials through a narrow injected credential port,
  including provider-specific refresh behavior;
- validating provider destinations and extracting provider content from the pinned
  target revision;
- performing provider-specific request sequencing, including multi-step media
  operations;
- mapping provider responses to the generic external-effect outcome while retaining
  provider-specific diagnostic codes and permanent, retryable, or ambiguous
  classification.

The adapter does not own Postbot's database schema, project authorization, publisher
credential encryption, publication state, job claims, or audit persistence.

### Generic worker responsibilities

The workflow worker retains:

- claim fencing and durable execution lifecycle;
- loading the immutable, project-scoped execution target;
- generic retries, completion, and ambiguous-outcome handling;
- shared execution-media integrity and provider-media delivery invariants where they
  apply to the workflow boundary;
- explicit routing of the separate custom HTTP execution kind;
- audit attribution, redaction, and failure handling around the adapter call.

Channel profiles remain the source of truth for channel capabilities and target
content validation. The built-in registry is not a second capability catalog and
does not replace the channel-owned profile contract.

### Credential boundary

The adapter may receive a narrow resolver and token-rotation port. Postbot continues
to own project-scoped encrypted publisher credentials and their persistence. Better
Auth remains limited to application email/password authentication and is not part of
provider execution.

### Custom HTTP boundary

The custom HTTP transport remains outside the built-in registry. Its bounded request
mapping, network egress policy, secret handling, media delivery, and response
classification remain governed by the runtime channel profile and custom HTTP
package. The adapter port is not a general script or plugin execution mechanism.

## Alternatives considered

### Keep provider dispatch in the worker

This keeps the immediate diff small and is safe for the current single provider, but
the hotspot grows with each provider and makes provider-specific assumptions harder
to review. It is not retained as the long-term boundary before the next built-in
provider.

### Introduce a universal provider DSL

A universal DSL would hide important provider differences, weaken type safety, and
duplicate the runtime custom-channel problem. It is rejected without concrete
evidence requiring it.

### Move providers to separate processes or services

This would add coordination, deployment, and failure modes and contradicts Postbot's
current single-process self-hosting posture. No measured need justifies it.

## Consequences

- The current LinkedIn implementation can be extracted incrementally without
  changing database ownership or publication semantics.
- A future built-in provider adds an adapter and registration entry instead of a
  new provider branch spread through the generic worker.
- Provider modules remain precise and typed; the worker remains readable and
  testable as orchestration code.
- Credential refresh and multi-step media behavior remain explicit rather than being
  hidden behind a false one-size-fits-all `publish` operation.
- The registry is intentionally small. It must not become a speculative plugin
  framework or an alternate source of capability truth.

## Verification requirements

- Test unknown contracts, unsupported revisions, and provider/profile mismatches
  fail before any external request.
- Preserve LinkedIn text, image, refresh, reconnect, permanent, retryable, and
  ambiguous outcome tests.
- Preserve custom HTTP webhook, mapped payload, media, and egress tests unchanged
  in meaning.
- Verify claim loss, retry, and ambiguous external-effect behavior across the
  adapter boundary.
- Verify provider secrets remain absent from logs, audit events, and generic
  outcomes.
- Run the complete repository quality gate before integrating the extraction.
