# Project Issues

## [ISSUE-021] Validate the central publication loop through real use

- Type: proposal
- Status: open
- Evidence: The repository has deterministic unit, integration, browser, and
  provider tests, but the continuous product direction has not yet been validated
  through a sustained real workflow using multiple destinations and the dashboard,
  API, and CLI together. EVAL-53 established and exercised the safe local
  validation loop; the automatic-provider stage remains gated by an explicit
  destination and action-time approval.
- Impact: Technical foundations can appear complete while the real publication
  manager still requires a parallel tracker or awkward manual workarounds.
- Desired outcome: Postbot periodically exercises and records the complete intended
  publication workflow in realistic use, including automatic and manual channels,
  failures, edits, and recovery, without reintroducing a release-oriented MVP
  boundary.
- Tasks: EVAL-53 (completed; repeat periodically), EVAL-54 (completed), PUB-55 (completed), EVAL-57 (completed; repeat periodically)
- EVAL-54 completed the automatic-provider stage with an operator-approved,
  organization-scoped LinkedIn smoke test. The provider acknowledged the text
  publication, Postbot persisted the successful job and publication outcome, and
  the dashboard displayed the target as published. This issue remains open as
  a recurring validation practice rather than a one-time implementation task.
- EVAL-57 completed the automatic image-provider stage with an operator-approved
  disposable publication. The provider acknowledged the image delivery, Postbot
  persisted the successful media checkpoint and publication outcome, and the
  dashboard displayed the target as published. This remains a recurring
  validation practice rather than a release gate.
- The 2026-09-11 validation completed the same controlled loop with the Bluesky
  provider: the local loopback OAuth flow was accepted on the real provider,
  the project-owned connection was restored, and an automatic text publication
  was acknowledged by Bluesky and displayed as published in the Postbot queue.
  The validation also corrected two provider-boundary defects found during the
  run: the OAuth grant now requests the granular repository/blob permissions
  required for publication, and a revoked credential is reactivated with the
  scopes from a fresh grant instead of being rejected by the uniqueness guard.
  The publication scheduler is explicitly woken after a reschedule so the
  requested run time is applied without waiting for the previous timer.

- Remaining scope (ALPHA-578, 2026-10-24): Recurring real publication-loop validation; retain actual provider/action authorization. Not a missing publisher implementation.

## [ISSUE-127] Recover safely after an abrupt runtime termination

- Type: problem
- Status: accepted
- Evidence: ADR-068 deliberately uses a database-specific sidecar marker and
  fails closed when it remains after forced termination. The operator must
  establish that no Postbot process is using the database and then remove that
  exact marker manually before restarting.
- Impact: A normal host crash or forced stop can turn the next startup into a
  manual recovery procedure, adding friction to the self-hosted operating
  model even though the marker correctly prevents concurrent restore.
- Desired outcome: Runtime exclusion is released after process death while
  restore remains unable to race an active Postbot process. Recovery must not
  depend on marker age or PID checks alone.
- Tasks: OPS-217
- Related issue: ISSUE-026
- Related decision: ADR-068
- Scope note: The current fail-closed behavior is intentional, not a newly
  reproduced regression. OPS-217 is an evaluation task only; changing the lock
  contract requires a separately accepted decision.
- Evaluation (OPS-217, 2026-09-26): A forced-stop experiment on the current
  sidecar confirmed that SIGKILL leaves the marker and blocks restore, while a
  Linux `flock` prototype on the repository's local ext4 filesystem excluded a
  concurrent process and released after SIGKILL. This proves feasibility on this
  Linux host, not Bun integration or cross-platform behavior. The documented
  container is Linux, but the project has no explicit host-platform support
  matrix. Keep the existing contract until the owner chooses whether direct
  Windows/macOS deployment is supported and accepts a platform-tested kernel
  lock implementation; do not use heartbeat expiry or PID-only reclamation as a
  substitute. See the [OPS-217 worklog](archive/runtime-recovery-observability/worklogs/2026-09-26-OPS-217.md).

- Remaining scope (ALPHA-578, 2026-10-24): Choose host-platform support and accept/test a kernel-lock contract before replacing the fail-closed sidecar. OPS-217 evaluated feasibility only; automatic stale-marker removal is not implemented.

## [ISSUE-160] Explore a mobile Postbot client

- Type: proposal
- Status: open
- Priority: later — exploratory, not a first-launch commitment
- Evidence: The owner envisages a future mobile client alongside Studio and machine-facing tools. No dedicated mobile app workspace exists; the responsive website is not a shipped mobile application.
- Impact: Future marketing could overstate availability or a mobile implementation could duplicate domain behavior without a clear user need.
- Desired outcome: Define the mobile audience, high-value workflows, platforms and access boundaries before choosing delivery technology. Keep mobile visibly future-facing until implemented and validated; this issue does not authorize building an app.
- Tasks: none — recorded for triage; no implementation authorized by intake
- Source: owner direction, 2026-10-15; public-site planning captured in
  [public positioning](archive/root-documentation-2026-10-25/source/docs/project/public-positioning.md).

- Remaining scope (ALPHA-578, 2026-10-24): Mobile client remains an exploration proposal, not an alpha release prerequisite.

## [ISSUE-184] Validate the product with sustained real use before widening scope

- Type: problem
- Status: open
- Evidence: SPEC-001 defined a falsifiable hypothesis: one real project uses Postbot as its only publication source of truth for four consecutive weeks, including an automatic and a manual channel. SPEC-005 superseded the release framing with continuous development and did not carry over a validation milestone. No task, issue or worklog records that test being run. In about eight weeks the repository reached roughly 1,000 commits, nine built-in providers, analytics, replies, first comments, approvals, workspaces/groups, an image editor and webcam capture.
- Impact: Scope grows from internal design logic rather than observed demand, and every feature added before real use increases maintenance and later rework. Real friction (onboarding, provider setup, daily workflow) remains unknown.
- Desired outcome: A recorded, time-boxed period of real operation (for example the Postdot launch communication itself) produces evidence that drives prioritization, and an explicit owner decision states how new scope is admitted relative to that evidence.
- Related: ISSUE-181, ISSUE-190
- Tasks: none

- Remaining scope (ALPHA-578, 2026-10-24): Run a time-boxed real project workflow and prioritize from observed friction. This is product validation, not additional provider breadth.

## [ISSUE-198] The post editor fails as a whole when one channel cannot be read

- Type: problem
- Status: open
- Evidence: `loadExistingPost` (`apps/web/src/components/post-composer/load-existing-post.ts`) reads the post, every publication summary page, then every channel's editor state with `Promise.all`. One failed channel read rejects the whole load, so the route shows its error page instead of the editor. The post editor also issues one editor read per channel on every open and every refresh. Seen during UX-683: a test that failed one sibling read made the review action disappear until the load was retried.
- Impact: A transient error on one channel blocks editing every other channel of the post; posts with many channels cost N+2 requests per open and per realtime refresh.
- Desired outcome: A channel that cannot be read shows as unavailable (with retry) on its own tab while the others stay editable; consider a single post-level read for all channel states.
- Source: UX-683 migration, 2026-11-18.
- Tasks: none

## [ISSUE-199] A required media description is not signalled on the thumbnail

- Type: question
- Status: open
- Evidence: Bluesky's channel profile sets `accessibilityTextRequired: true`. Since UX-683 the description sits behind an optional "ALT" badge on the composer thumbnail, which only distinguishes empty and filled. The default description comes from the media library, so most items have one, but an item without it is not marked on the badge.
- Impact: For a channel that requires a description, the person may learn it only from a validation message elsewhere, or not before publishing.
- Desired outcome: Verify what happens today when a Bluesky media item has no description; if it blocks or fails, mark the badge (attention state) on that channel's tab only, without making the field mandatory elsewhere.
- Source: owner review, 2026-11-18.
- Tasks: none

## [ISSUE-200] Opt-in and development-only browser suites rot unnoticed

- Type: problem
- Status: open
- Evidence: `realtime-automatic-acceptance.spec.ts` (needs `POSTDOT_E2E_REALTIME_ACCEPTANCE`), the experience audit (`POSTDOT_EXPERIENCE_AUDIT`) and `editor-experiment.spec.ts` (development builds only) are excluded from the default run. During UX-683 all three had fallen behind the product: stale selectors, an obsolete menu locator, a contrast check measured mid-transition. Running the realtime acceptance found a real bug (a channel published elsewhere stayed editable under unsaved text).
- Impact: The suites that cover the riskiest paths give false confidence and find bugs late.
- Desired outcome: Run them on a schedule or as a release gate (see ADR-093 acceptance), with their results recorded in the release worklog.
- Source: UX-683, 2026-11-18.
- Tasks: none

## [ISSUE-201] Text rendered outside a language subscription stays in English

- Type: problem
- Status: open
- Evidence: Non-English catalogs load lazily (ISSUE-193). A component that renders messages without `useLanguage()` and has no subscribed ancestor keeps the English strings it rendered first. The French setup and login pages showed mixed languages until UX-683 added the subscription to the auth pages; only one browser test (setup in French) caught it.
- Impact: Any other surface outside the dashboard shell can regress the same way silently.
- Desired outcome: A guard (lint rule or a test that renders each public route in fr, es and de and finds no English base strings) instead of relying on per-component discipline.
- Source: UX-683, 2026-11-18.
- Tasks: none

## [ISSUE-202] Unused Studio message keys and retired editor leftovers

- Type: proposal
- Status: open
- Evidence: About 209 keys of `apps/web/messages/en.json` are not referenced statically from `apps/web/src` (some may be built dynamically); UX-683 removed only the 43 its deletions orphaned. The development-only `?editor=legacy` switch (`configuredEditor`) still exists on the post and publication routes, and recovery still reads legacy `postdot:publication-editor:v3:` local copies.
- Impact: Translators and the copy guards maintain text nobody sees; dead switches keep code paths alive.
- Desired outcome: Classify the unused keys (dynamic or dead), delete the dead ones with a guard against new ones; retire the legacy editor switch; drop the v3 recovery reader one release after 0.1.0-alpha.8.
- Source: UX-683, 2026-11-18.
- Tasks: none

## [ISSUE-203] Should "Save" apply channels the person did not change?

- Type: question
- Status: open
- Evidence: In the post editor, "Save" applies every channel with pending changes, which includes a channel whose draft was never applied even when the person only edited another channel (SPEC-013 "applies the post text and every changed channel version"). Seen while migrating `publication-concurrent-editing.spec.ts`.
- Impact: Probably what people expect ("what will be published equals what is shown"), but it can surprise someone who edited one channel on purpose.
- Desired outcome: Owner decision; if it stays, name the channels Save will apply (for example in its tooltip or a count).
- Source: UX-683, 2026-11-18.
- Tasks: none
