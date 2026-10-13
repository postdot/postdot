# ADR-021 — Make the Channel Own the Content Profile Contract

- Status: accepted
- Scope: Channel creation, profile selection, publication target revisions, and publisher attachment
- Provenance: Owner review of the DOMAIN-21 boundary on 2026-08-30
- Related specifications: [SPEC-004](../specs/SPEC-004-publication-content-boundary.md)
- Related decisions: [ADR-001](ADR-001-separate-channel-from-publisher.md), [ADR-014](ADR-014-separate-autosaved-drafts-from-execution-revisions.md), [ADR-020](ADR-020-version-and-assess-channel-profile-changes.md)
- Superseded by: none

## Context

A channel is a project-owned destination. A publisher is an optional automation
connection for that destination. The current transitional model lets a channel
exist without a content contract and lets a later publisher kind implicitly provide
the destination shape. That makes it impossible to validate or snapshot a target
before automation is connected, and it conflates destination identity with the
mechanism used to deliver a publication.

Postbot must also support manual publications on channels that have an available
publisher, automatic publications only when a compatible publisher is connected,
and custom channels whose schema is materialized at creation time.

## Decision

Every channel is created with one resolved profile version. The profile belongs to
the channel and is immutable once materialized. A built-in channel selects a
provider-owned profile module. A custom channel stores a validated copy of its
runtime profile; a preset only accelerates creation and has no live authority after
that point.

A publication target revision references the channel profile version that validated
it. Its delivery mode is explicit (`manual` or `automatic`) and is not inferred
from publisher availability. A publisher may be attached later and provides only
automation credentials and execution capability. It must be compatible with the
channel profile; it does not choose, mutate, or own the channel's content contract.

The web editor may keep a mutable auto-saved working draft, but scheduling or
applying changes explicitly promotes a validated snapshot to a new immutable target
revision. Once an execution effect starts, the execution revision remains pinned to
that target revision and its profile version for all retries and reconciliation.
Working-draft writes use the persisted draft revision as a compare-and-swap token;
an editor holding an older revision receives a conflict and must reload or reconcile
before writing again. Because one source post may seed several publication drafts, a
write that includes shared source content also requires the draft's recorded source
revision to match the current post revision. A stale source editor receives the same
conflict instead of overwriting another publication's source.

## Alternatives considered

- **Let the publisher select the content contract:** rejected because manual work
  would have no stable contract and connecting or disconnecting a publisher would
  change the meaning of existing publications.
- **Keep a mutable profile directly on the channel:** rejected because scheduled
  targets and retries could silently acquire new validation or transport semantics.
- **Allow unprofiled manual channels:** rejected because manual content still needs
  a durable, inspectable contract and review state.
- **Require one hard-coded profile per built-in channel:** rejected because custom
  channels need runtime-defined schemas and built-in modules may evolve through
  immutable profile versions.

## Consequences

- Channel creation must receive or resolve a profile before the channel is
  committed.
- Profile versions, working drafts, target revisions, and execution pins become
  separate persistence concerns.
- Draft autosave clients must carry the last revision they observed so an out-of-order
  request cannot silently replace newer work.
- Source autosave clients must also treat a source-revision conflict as a reload or
  reconciliation boundary when the post is shared by several publications.
- Connecting a publisher no longer changes the publication's representation or
  delivery mode.
- Existing transitional text-only tables are regenerated as part of the young,
  unreleased project; no legacy migration path is preserved solely for compatibility.
- Profile activation and compatibility assessment remain a later channel-management
  task, but DOMAIN-21 persists the version references and review state required by
  that task.
