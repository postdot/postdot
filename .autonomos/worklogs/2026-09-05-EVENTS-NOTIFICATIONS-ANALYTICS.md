# Events, notifications, and analytics inventory

## Scope

This is an inventory and design proposal, not an accepted product decision. No
notification schema, external delivery adapter, or analytics collector was
implemented during this pass.

## Existing durable facts

- `audit_events` stores project-scoped actions with an actor, entity type and
  entity id, JSON metadata, and a creation timestamp. Existing writers cover
  project and channel lifecycle, profile changes, publication creation and
  authoring, target promotion, publication outcomes, publisher connections,
  access-token changes, and automatic execution milestones.
- Automatic execution already records claim, effect-boundary, success, retry,
  failure, ambiguity, recovery, and cancellation actions. The `jobs` table
  separately owns due work, leases, attempts, and execution state.
- Publication, target-revision, execution-revision, provider-media-delivery,
  and audit records already preserve enough operational history to reconstruct
  the current publication lifecycle and many future operational aggregates.
- The API exposes project audit history, but there is no general domain-event
  contract, event subscription model, notification inbox, notification read
  state, delivery outbox, or external notification route.
- Project access is currently represented by project-scoped actors whose
  `subjectId` identifies the authenticated principal. Actor attribution is not
  yet a complete notification-recipient or preference model.

## Important boundary

Audit history is not a notification system. It answers “what happened and who
performed it?” A notification system must additionally answer “who should be
told, through which channel, with what state, and how do we retry delivery
without duplicating an external effect?” Reusing `audit_events` as an external
delivery queue would conflate provenance, user presentation, and delivery
reliability.

The scheduler is also not a general event bus. Its durable `jobs` and next-event
calculation are correctly focused on publication execution and must not become
the hidden transport for unrelated notification work.

## Proposed direction for discussion

1. Keep audit records as the operator-facing provenance history.
2. Introduce a small, versioned domain-event contract for durable facts that
   other subsystems may consume. State mutation and the event record should be
   committed in the same SQLite transaction. This is an event log for
   integration and projections, not event sourcing of the whole application.
3. Build the first consumer as an in-app notification projection. Persist a
   project/user-scoped notification with a stable deduplication key, severity,
   event reference, display context, creation time, and read/archive state.
4. Model subscriptions as user/project preference rules over named event types,
   with safe defaults and explicit opt-out. Do not treat a publisher channel or
   Better Auth account as a notification recipient.
5. Add external transports only after the in-app projection is useful. Ntfy,
   Telegram, email, or webhooks should consume durable delivery work with
   per-destination idempotency, retry/backoff, and attempt history. An in-memory
   dispatcher may optimize latency but must never be the source of truth.
6. Keep the implementation SQLite-first and single-process. A polling or
   next-event loop can process the durable work without Redis. A future worker
   process can consume the same contract if measured demand justifies it.

## Analytics readiness

Analytics has two different meanings:

- Operational analytics: publication states, scheduled and actual timestamps,
  attempts, provider outcomes, retry/ambiguity rates, media delivery results,
  and manual reconciliation. These facts are already partly present and should
  remain attributable, UTC-based, and free of secrets.
- Provider performance analytics: impressions, clicks, reactions, and similar
  metrics returned by individual providers. These require provider-specific
  read APIs, permissions, polling/webhooks, retention rules, and a product
  decision. They should not be invented from publication execution records.

The immediate preparation is therefore to preserve complete operational facts,
stable provider identifiers, outcome codes, timestamps, and correlation or
idempotency context where a real workflow needs them. A later read model can
aggregate those facts without adding third-party telemetry or prematurely
committing Herald to a provider-specific analytics shape.

## Recommended sequence

1. Agree on the event taxonomy, recipient model, event retention, and the
   distinction between audit, domain events, notifications, and deliveries.
2. Implement a narrow in-app notification slice for a few high-value events,
   with transactionally created facts and idempotent projection tests.
3. Add external delivery adapters behind the durable delivery boundary, starting
   with one transport only after its operational and security contract is clear.
4. Add operational analytics read models after the event contract proves useful;
   defer provider engagement analytics until a concrete provider use case exists.

