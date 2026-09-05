# ADR-039 — Fence External Notification Deliveries behind a Durable Outbox

- Status: accepted
- Date: 2026-09-05
- Scope: external notification destinations, subscriptions, and delivery execution
- Related issue: ISSUE-047

## Context

Herald's fact journal and in-app inbox are durable, but an external notification is a
separate effect with its own ownership, policy, latency, retry, and ambiguity. In-app
preferences must not determine whether an independently enabled Ntfy, Telegram, email,
or webhook destination receives an outcome.

The initial Ntfy candidate uses an HTTP JSON publish API with optional bearer
authentication. Its response can identify a created message, but the provider does not
offer a general request-idempotency guarantee for arbitrary retries. Herald must
therefore retain the same pre-effect and post-effect distinction used for publication.

## Decision

External notification delivery is a separate projection of the versioned project fact
journal. Each projector owns a durable cursor and creates immutable outbox rows only for
current project human actors whose active destination subscribes to the projected
notification kind. The outbox snapshot contains the recipient, destination, source
event, kind, severity, subject, title, and body required for delivery. It does not depend
on an in-app inbox row or its read/archive state.

A destination belongs to a project human actor and declares a transport identifier,
bounded public configuration, and an optional encrypted secret envelope. A
destination/kind subscription is explicit. Account-global defaults may be layered over
this project-scoped ownership later without coupling destinations to Better Auth tables.

Outbox insertion and projection-cursor advancement are atomic. A
project/destination/source-event uniqueness constraint makes replay idempotent. Delivery
workers claim due rows with a lease and commit an effect-started boundary before calling
the transport. Expired pre-effect claims are requeued; expired post-effect claims become
ambiguous. Only failures that explicitly guarantee no external effect may be retried.
Permanent and ambiguous outcomes require explicit later policy rather than automatic
redispatch.

The generic external-effect executor in `@herald/core` is reused by publication and
notification workers. Transport packages implement a narrow effect contract and cannot
write publication or journal state directly.

## Alternatives considered

- Deliver from publication completion: rejected because transport failure would enter
  the publication boundary and manual/reconciled facts would need separate paths.
- Deliver from in-app rows: rejected because disabling the in-app inbox must not disable
  an independently configured external destination.
- Retry every transport error: rejected because a timeout or server failure after
  dispatch may already have created a visible message.
- Use Ntfy `sequence_id` as universal idempotency: rejected because it controls
  notification replacement/deletion semantics and is not documented as a general
  exactly-once request key.

## Consequences

- External transports remain optional and replaceable while sharing one correctness
  model.
- SQLite remains sufficient: polling affects latency only, while claims, leases,
  deduplication, and recovery are durable.
- Transport secrets require the deployment-owned encrypted-secret boundary before a
  real adapter can be configured.
- A post-boundary crash is visible as ambiguous instead of being silently duplicated.

## Verification

Tests must prove project and human ownership, independent subscriptions, atomic cursor
advancement, replay deduplication, concurrent claims, lease recovery on both sides of
the effect boundary, bounded retries, terminal failures, and restart reconstruction.

## References

- Ntfy publish API: https://docs.ntfy.sh/publish/
