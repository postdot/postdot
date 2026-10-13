# ADR-027 — Use Explicit Publication-Draft Rebase

- Status: accepted
- Scope: Shared source editing, publication working drafts, and conflict recovery
- Provenance: Owner review of DOMAIN-39 on 2026-09-02
- Related specifications: [SPEC-004](../specs/SPEC-004-publication-content-boundary.md), [SPEC-005](../specs/SPEC-005-continuous-product-scope.md)
- Related decisions: [ADR-002](ADR-002-separate-post-from-publication.md), [ADR-014](ADR-014-separate-autosaved-drafts-from-execution-revisions.md), [ADR-015](ADR-015-use-a-small-semantic-source-content-vocabulary.md)
- Superseded by: none

## Context

A `Post` owns reusable source content while each `Publication` owns an
independently editable target. A working draft records the source revision from
which it was authored. When one publication edits the shared source, sibling
drafts become stale. Silently replacing their target content would risk losing
channel-specific work, while refusing every subsequent edit leaves a legitimate
editor without a recovery path.

The current model stores the source revision number but not the source snapshot
used by a stale draft. A recovery flow therefore needs a durable base snapshot and
an explicit operation that does not confuse source reconciliation with target
promotion or external execution.

## Decision

Postbot uses explicit per-publication draft rebasing:

1. Every publication working draft stores the validated source snapshot associated
   with its `sourceRevision`.
2. A stale working draft may be explicitly rebased to the current `Post` source
   through a project-scoped API operation guarded by the draft's expected revision.
3. Rebasing updates only the working draft's source base and revision. It preserves
   the target content, target validation state, selected target revision, schedule,
   delivery mode, and execution state.
4. Rebasing increments the working-draft revision and records an attributable audit
   event. It is safe to retry only when the caller supplies the current draft
   revision; a concurrent edit remains a write conflict.
5. Rebasing never promotes a target revision, starts or pauses delivery, merges
   browser-local buffers, or silently rewrites target content. The editor must let
   the user review the source base/current/local values and explicitly save and
   promote the resulting draft.
6. Normal draft saves and target promotion continue to fail closed while the draft
   source base is stale. A rebase is the explicit transition that makes the draft
   eligible for a subsequent save.

The first implementation does not infer a three-way merge or regenerate target
content automatically. A later decision may add assisted regeneration for an
untouched target only if real authoring evidence justifies its additional state and
semantics.

## Alternatives considered

- **Silent sibling propagation:** minimizes code but can overwrite deliberate
  channel-specific edits and violates zero-loss authoring.
- **Discard the sibling draft:** protects consistency by losing user work and is
  incompatible with Postbot's recovery goal.
- **Automatic regeneration based on heuristics:** may reduce repetitive work but
  requires tracking whether target changes were intentional and risks hiding a
  semantic change behind a convenience action.

## Consequences

- Working drafts contain one additional validated source snapshot, increasing
  SQLite storage proportionally to the number of editable publications.
- The API and web editor have a visible recovery action instead of treating a
  `409` as an unrecoverable dead end.
- Target revisions and external execution remain immutable and deterministic.
- A future assisted merge can build on explicit base/current/local evidence without
  changing the ownership boundary between source and target content.
