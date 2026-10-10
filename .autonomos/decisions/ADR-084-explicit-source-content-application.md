# ADR-084 — Explicit source content application

- Status: accepted
- Scope: Source review across saved destination drafts
- Provenance: Owner accepted the CONTENT-378 recommendation on 2026-10-10
- Complements: [ADR-027](ADR-027-use-explicit-publication-draft-rebase.md)

## Decision

Review each destination separately. The default action retains its adaptation and
uses the existing explicit rebase contract. A separately selected action may copy
source text, headline and ordered media into that saved working draft. No automatic
merge, propagation, promotion or delivery is implied.

Copy uses the draft's persisted profile bindings. It overwrites only `primary_text`,
`headline` and `ordered_media`; unrelated destination fields remain unchanged.
Absent source copy removes the corresponding bound target value; an empty media
list replaces the previous list. Existing profile and media validation classify
the resulting draft, including invalid drafts requiring review.

Both choices carry the reviewed source revision and the expected draft revision.
Replacement without a source revision is refused. A conflicting edit applies
nothing. Rebase without replacement retains its previous compatibility behavior.
The operation is atomic per destination, not across several destinations. Existing
lifecycle restrictions and approval supersession continue to apply.

Selected execution targets, schedules, delivery modes and lifecycle states remain
unchanged. Already locked executions are listed but cannot be changed through this
review. Browser-local unsaved work is not copied, merged or discarded: the review
entry is unavailable while that editor has local changes or an active mutation.

## Alternatives

Silent regeneration could discard deliberate adaptations. Whole-target replacement
would discard provider-specific fields. Batch application would introduce another
transaction and all-or-nothing decision without a demonstrated operator need. The
accepted per-destination choice reuses existing authoring and revision boundaries.
