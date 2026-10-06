# ADR-079 — Explicit Draft Profile Adoption

- Status: proposed
- Scope: UX-324; editable publication drafts only
- Provenance: owner authorized a concrete proposal on 2026-10-06
- Related decisions: ADR-020, ADR-078
- Related specification: SPEC-004

## Context

Existing drafts retain their owned profile after channel activation. A bounded
probe moving `/body` to `/article/body` demonstrated that saving the new shape
does not adopt the active profile. Ordinary promotion and approval now reject
incompatible content. Adoption needs an explicit repair path, not an exception
to those checks.

Working draft saves update a mutable row. A selected target does not necessarily
contain the latest saved or invalid work. Browser recovery alone therefore cannot
provide durable preservation of the draft replaced by adoption. Existing media
retention checks scan source, working draft, target and execution records; a new
preservation record must participate in retention rather than merely keep IDs.

## Recommended interaction

An editable publication with a newer channel profile offers **Adapt to current
profile** beside its review state. Compatible older drafts may use it too; they
are not forced to migrate merely because a newer version exists.

Open a focused adaptation view inside the publication route. Keep the existing
editor suspended from autosave while this view is open, with its local recovery
buffer intact. Do not create a second permanently visible editor or a stack of
dialogs.

The view shows the proposed fields and their validation issues. Previous content
is available through **Previous draft**, read-only and copyable. Surface removed
or incompatible fields explicitly; do not bury them in a generic JSON diff.
For arbitrary profiles without supported field controls, expose the existing
structured-content editing capability rather than pretending a text field can
represent the schema.

Use declared binding identities and semantic roles to offer explicit reuse
choices. For example, offer the previous body as the value of the new body field,
showing that its path changed. A suggestion is not an implicit conversion:
the operator chooses reuse or edits the value. Never infer a destination from a
similar label, coerce types, remove unknown fields silently, or fetch media.

The primary action is **Save adapted draft**. It is available only when the
candidate passes the active profile and media requirements. Cancel leaves the
working draft and local work unchanged. Saving adaptation is not approval,
publication, or rescheduling; those remain explicit existing actions.

If unsaved edits exist, the candidate includes them only after an explicit choice
to use the local working copy. Preserve that copy until the committed result is
confirmed; never clear a recovery buffer because a preview validated.

## Proposed persistence contract

One transaction, with existing edit permissions and lifecycle restrictions:

1. Require expected draft revision, source revision, old owned profile version,
   and expected active profile version. Reject concurrent edits or activation;
   retain the candidate so the operator can review the new state.
2. Validate the exact candidate and its media under the still-active profile.
3. Preserve the complete previous saved draft in an immutable adoption snapshot,
   including its profile, content, source baseline, revision and media references.
   This is a narrow adoption history, not a general history of every autosave.
4. Write the adapted working draft with the active profile and a new revision.
   Create a new validated, unselected target revision as required by ADR-020 and
   SPEC-004; do not silently replace the scheduled execution target.
5. Supersede pending approvals, record attribution and old/new profile and revision
   references in the existing fact journal, and emit the existing refresh signal.

Keep source content, selected target, execution history, schedule and jobs intact.
Existing promotion or approval later selects the adapted target through the
normal lifecycle. A changed automatic execution contract needs a separate review
of that selection path; adoption alone must not claim execution support.

Extend media retention and complete backup coverage to the adoption snapshot.
Do not place full content in audit metadata as a substitute for a content record.
Read historical previews using their own target profile, independently from the
new working draft profile. Local recovery must carry enough version identity to
avoid interpreting old buffered content under new bindings.

## Alternatives

- Change only the draft profile pointer: small change, but can lose fields and
  reinterpret local buffers or historical previews; rejected.
- Require a new publication and manual copying: avoids a new operation but loses
  the continuity of the publication and leaves the repair gap unresolved.
- Adapt and immediately promote: fewer clicks but combines content repair with
  scheduling and approval consequences; not recommended.
- Prepare, preserve and save adaptation, then use normal promotion: recommended.
  It adds a migration-backed snapshot and an explicit intermediate revision.

## Acceptance evidence before delivery

- Body path changes, removed fields, type changes, media requirements, and an
  already-compatible old draft.
- Invalid candidate and cancellation produce no persistent changes.
- Concurrent draft/source/profile changes fail without discarding the candidate.
- Saved old content and referenced media remain recoverable after reload and
  complete backup; local unsaved content survives failed or late responses.
- Historical title, body and media keep their old profile interpretation.
- Adaptation does not approve, select a target, schedule, cancel jobs or publish.
- Promotion of the adapted draft remains governed by current compatibility checks.

## Owner checkpoint

Approve or adjust the prepare-and-save interaction and the narrow durable
preservation record before implementation. No product code or schema change is
authorized by this proposal itself. Exact API and snapshot schema remain an
implementation design step after acceptance.
