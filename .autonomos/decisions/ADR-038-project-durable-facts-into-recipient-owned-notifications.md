# ADR-038 — Project Durable Facts into Recipient-Owned Notifications

- Status: accepted
- Date: 2026-09-05
- Scope: in-app notifications, recipient preferences, and future delivery transports
- Related issue: ISSUE-046

## Context

Herald records project facts in the versioned `audit_events` journal. Those facts
describe what happened and who caused it, but they do not answer who should be
notified, whether a recipient disabled a category, whether an item was read, or whether
an external transport delivered it.

Project access is represented by actors. A Better Auth user may have a human actor in
each accessible project, while system, agent, and API-token actors represent execution
or machine attribution rather than notification recipients.

## Decision

Herald projects an explicit allowlist of supported event names and versions into a
separate persistent notification inbox. The event actor remains attribution only.
Recipients are the project's currently authorized human actors when the projection
processes the fact. This fail-closed rule avoids notifying removed identities and does
not create inboxes for machine actors.

Each inbox item stores its project, recipient actor, source event, notification kind,
severity, subject reference, presentation copy, read timestamp, archive timestamp, and
creation time. A project/recipient/source-event uniqueness constraint makes replay
idempotent. Read and archive state never mutate the source journal.

Preferences are project-, recipient-, and notification-kind scoped. Missing preferences
use the product default for that kind; an explicit disabled preference suppresses new
inbox items without deleting existing ones. The initial kinds cover successful, failed,
and ambiguous publication outcomes. Transient execution steps such as claims, effect
starts, and retries do not create inbox noise.

Each projector owns a durable per-project cursor. Reading facts, inserting inbox items,
and advancing the cursor occur in one immediate SQLite transaction. Unsupported event
names and versions are deliberately skipped and still advance the cursor so one unknown
fact cannot poison the stream. The projector runs from durable state after startup;
process-local wakeups may reduce latency but are never required for correctness.

Future Ntfy, Telegram, email, or webhook transports consume notification or delivery
outbox state through their own recipient endpoints, attempts, leases, idempotency keys,
and retry policy. They must not call publication workflow code directly.

## Alternatives considered

- Treat the journal as the inbox: rejected because acknowledgement and preferences
  would mutate provenance and conflate unrelated lifecycles.
- Notify the source event actor: rejected because workers and API tokens commonly cause
  events but are not human recipients.
- Store recipients as Better Auth user foreign keys: rejected because project access is
  a Herald domain concern and must remain independent from the authentication schema.
- Dispatch transports directly from publication completion: rejected because provider
  latency and failure would enter the publication transaction and lose replay safety.

## Consequences

- Notifications remain durable and independently testable without introducing a broker.
- Membership timing has explicit semantics: newly authorized humans can receive facts
  still pending projection, while removed actors cannot receive them.
- Existing inbox items remain stable when preferences later change.
- External transports can be added without altering publication workflow transitions.

## Verification

Tests must prove human-only recipient resolution, default and explicit preferences,
idempotent replay, atomic cursor advancement, restart continuation, unsupported-event
skipping, project isolation, and idempotent read/archive transitions.
