# ADR-078 — Ordinary approval and explicit superseded-profile consent

- Status: proposed; no approval policy change authorized or implemented
- Scope: approval of publications whose working profile differs from the active channel profile
- Provenance: UX-321, UX-322 and UX-323; owner requested continuation on 2026-10-06
- Related decisions: [ADR-020](ADR-020-version-and-assess-channel-profile-changes.md)
- Related specifications: [SPEC-004](../specs/SPEC-004-publication-content-boundary.md)

## Problem and measured boundary

UX-322 blocks ordinary promotion when persisted content fails the active profile,
including media constraints and changed automatic execution contracts. Ordinary
approval submission and approval deliberately remain outside that guard. A fresh
submission can therefore schedule the same incompatible content without establishing
conscious consent to retain an old contract.

Requests submitted before activation already become `superseded` through
`updateWorkingDraftAssessment` in `manual-store.ts`. An isolated in-memory probe
confirmed that the old request disappears from the pending list and approval fails
with `invalid_transition`. Preserve this mechanism; do not build a parallel one.

An approval currently binds a target revision, draft revision, proposed schedule and
human attribution. It does not bind an active-profile assessment or record consent
to disregard that assessment. A normal editorial approval is not such consent.

## Recommended delivery sequence

1. Close the ordinary approval exception first. Require compatibility with both the
   owned and active profiles on submission and again on approval, reusing the
   promotion guard. Preserve compatible old profiles, existing request invalidation,
   immutable targets, draft bytes and transactional rollback. Return an actionable
   refusal without creating a request, target or job when the new requirement fails.
2. Defer the explicit exception UI and persistence until its contract below is
   accepted and execution-support checks are available at the decision boundary.
   This does not remove ADR-020's eventual explicit re-approval capability; it leaves
   known-incompatible work blocked until a supported resolution is implemented.

This sequence reduces immediate scope and closes a demonstrated silent bypass.
Its limitation is deliberate: an incompatible old target cannot yet be retained
for delivery by overriding the active assessment. Content and history remain
available, but no automatic migration or replacement payload is supplied.

## Proposed eventual consent contract

- Offer a distinct action, **Retain previous profile**, only on affected work. Never
  turn a normal approval button or a project-wide setting into this exception.
- Show the retained and active versions and the actual incompatibilities before
  confirmation. Explain that this is consent to a known mismatch, not evidence that
  the provider will accept the payload. Avoid a second general approval workflow.
- Require the existing human session and editor authorization. Do not require a
  different approver unless a separate product decision establishes that policy.
- Bind consent to the exact target revision and content hash, pinned media snapshot,
  owned and assessed active profile version IDs, normalized issues and execution
  identity. Retain the actor, time, decision and schedule through immutable audit
  evidence. Do not rely on a client-provided assessment or hash.
- Revalidate these inputs transactionally at confirmation. Any changed content,
  media snapshot, profile assessment or execution identity requires fresh consent.
  An earlier editorial approval cannot be converted into consent after activation.
- Preserve content and historical profiles. Record the accepted exception separately
  from compatibility; do not report incompatible content as newly compatible.
- Require current support for the retained execution contract before scheduling and
  again before an external effect. Unsupported or security-disabled execution is
  never overridable by a project administrator.

The built-in runtime registry resolves an exact contract/revision and the worker
refuses missing adapters before execution. That is useful existing enforcement,
but the database approval boundary does not currently receive that registry. This
proposal does not assume that schema validation proves execution support, or that
an explicit per-contract security-disable mechanism already exists. Resolve those
boundaries before shipping the exception, without importing API runtime code into
the persistence package or adding another service.

## Alternatives requiring owner choice

- **Recommended: ordinary compatibility first, explicit consent later.** Small
  immediate behavioral change with focused regressions; blocks the bypass while
  deferring the new exception interface and data model.
- **Deliver both together.** Restores the intentional old-contract path immediately,
  but requires consent persistence, support enforcement, UI and concurrency proofs
  before the ordinary approval exception can be closed coherently.
- **Keep ordinary approval as implicit consent.** Rejected recommendation: the
  existing decision neither presents nor binds the active mismatch and does not
  satisfy ADR-020's requirement for deliberate re-approval.

## Acceptance evidence for an approved implementation

For the first tranche, deterministic store tests must cover an incompatible fresh
submission, an incompatible approval decision, compatible old content, activation
superseding a pending request and rollback with unchanged targets, jobs and audit.
One focused browser scenario must prove the actual approval refusal and preserved
work. Do not duplicate the entire authoring journey.

For the later consent tranche, additionally prove changed-input rejection, exact
audit bindings, human authorization, unsupported/security-disabled refusal and
support lost between approval and execution. Apply ADR-077 to validation; this
proposal alone requires no E2E or full integration rerun.
