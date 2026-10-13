# ADR-040 — Version External Notification Secrets behind an Encrypted Boundary

- Status: accepted
- Date: 2026-09-06
- Scope: external notification destination credentials and delivery snapshots
- Related issue: ISSUE-048
- Supersedes: none

## Context

NOTIFY-81 deliberately stores only bounded public destination configuration. A real
notification transport may additionally require bearer tokens, topic credentials,
signing keys, or another provider-specific secret. Putting those values into the
public configuration JSON would expose them through metadata reads and immutable
delivery snapshots.

The existing publisher credential boundary already establishes the required
deployment-owned AES-256-GCM model, but publisher credentials and notification
destination secrets belong to different domains. Reusing a publisher-specific field
or Better Auth account would couple unrelated ownership and lifecycle models.

Secret rotation also has to be explicit. A queued delivery must not silently start
using a newly rotated credential, while a retry of the same delivery must still be
able to resolve the credential version captured when the delivery was projected.

## Decision

Postbot stores notification destination secrets in a dedicated versioned table. Each
secret row contains only a versioned AES-256-GCM envelope, its key identifier, the
destination reference, the transport identifier used as authenticated context, and
timestamps. The deployment encryption key is injected into an explicit cipher
boundary and is never persisted in SQLite or its backups.

The cipher implementation is domain-neutral and reuses the same Web Crypto
implementation as publisher credentials. Publisher and notification stores supply
different authenticated domains and contexts; neither domain uses Better Auth as a
secret owner.

A destination has at most one active secret version. Rotation retires the current
version and inserts a new version atomically. Projection snapshots the active secret
row's identifier into each delivery. Delivery history never stores plaintext secret
material or a copy of the public secret payload. A worker resolves and decrypts the
referenced envelope only after it has claimed the delivery and only for the matching
project, destination, transport, and lease.

Destinations without credentials keep a null secret reference. Public destination
configuration remains separately bounded JSON and may not contain provider secrets.
The initial implementation exposes storage and resolution primitives only; no real
transport, provider credential, or management API is introduced by NOTIFY-82.

## Alternatives considered

- **Put encrypted fields directly on `notification_destinations`:** rejected because
  rotation would overwrite the credential needed by already-projected deliveries.
- **Copy the encrypted envelope into every delivery:** rejected because it duplicates
  secret material in delivery history and makes retention and rotation harder to
  reason about.
- **Reuse publisher credential rows or Better Auth accounts:** rejected because
  notification destinations have project-human ownership and transport lifecycles,
  not publisher-provider account semantics or application-login ownership.
- **Store provider secrets in public configuration JSON:** rejected because a
  metadata/read API or an immutable snapshot would become a plaintext secret path.
- **Depend on an external secret manager now:** rejected for the current monolith;
  deployment-owned key injection preserves the local single-process model while
  leaving a future provider-owned secret backend possible.

## Consequences

- Secret rotation is explicit and does not change the credential used by existing
  delivery snapshots.
- Old encrypted versions must be retained while referenced by pending, running, or
  ambiguous deliveries; cleanup requires a later retention policy.
- Losing the deployment encryption key makes notification credentials unrecoverable,
  just as it does publisher credentials. Backup and restore procedures must handle
  that key separately.
- A compromised Postbot process can still access plaintext while executing a transport;
  at-rest encryption does not replace process isolation.
- A real adapter remains gated on this boundary and must never log, return, or place
  plaintext secret material in public configuration, delivery history, or errors.

## Verification

The implementation must prove encryption round trips, fresh nonces, authenticated
context, wrong-key and tamper failure, secret rotation, delivery-version snapshotting,
project/actor isolation, and the absence of plaintext in SQLite rows and public
metadata. It must also prove that a claimed delivery can resolve only its own secret
version. The implementation now additionally enforces the project/destination/secret
relationship at the SQLite foreign-key boundary and repeats it in the claimed-delivery
resolver. The complete repository gate passed before this final relationship
hardening and after it: formatting, lint, strict typecheck, unit/integration tests,
browser E2E, and package builds all pass.
