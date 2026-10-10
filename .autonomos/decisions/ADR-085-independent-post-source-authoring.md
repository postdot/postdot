# ADR-085 — Independent post source authoring

- Status: accepted
- Date: 2026-10-10
- Scope: shared source updates from the post page
- Provenance: owner approved CONTENT-380 and explicitly chose source editing even
  when all destination publications are immutable.
- Related: ADR-084, ADR-027

## Decision

Project editors and owners can explicitly save the current shared source without
choosing a destination draft. Eligibility does not depend on publication states or
active channels. The source remains editable after all destinations are published,
cancelled or otherwise locked.

The update checks the expected source revision in an immediate transaction,
validates source content and project-owned available media, and increments the
source revision only when content changes. A conflicting update applies nothing.
A repeated identical save at the current revision is a no-op. The journal records
revision metadata without source text.

No destination draft, selected target, approval, schedule, job or delivery changes.
Existing drafts become stale by their existing source-revision comparison; applying
or retaining adaptations remains the explicit per-destination ADR-084 review.
Historical targets retain their content and source revision. New destination drafts
can use the current source through the existing destination-addition contract.

The post editor uses explicit Save, preserves local text across background refresh
and conflicts, and asks before abandoning changed text. Source review and destination
addition are unavailable while editing the local source. Access uncertainty disables
writes and hides the surface without using an older response to discard local work.

## Alternatives and consequences

Reusing a destination save would retain its lifecycle, profile, channel and draft
revision dependencies, preventing independent source authoring after delivery.
Restricting source editing to posts with an editable destination was rejected by the
owner. Automatic destination propagation could overwrite deliberate adaptations and
is not part of this contract.

This source editor does not create a new persistent browser recovery buffer.
Ordinary navigation and browser unload warn about unsaved changes; unexpected
browser termination can still lose local work.
