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

## [ISSUE-197] Enable 100% agentic deployment onboarding and full privileged-agent administration

- Type: proposal
- Status: open
- Evidence: Fresh Postdot installations currently require a human to open Studio and register the first administrator account before issuing an API key for an AI agent, creating both a human bottleneck and a brief unauthenticated first-user registration window on newly deployed instances. In addition, instance administration, user management, and token/API-key management remain restricted to human sessions even when an operator intends to grant an agent full privileges (raised during 2026-11-14 GitHub #35 triage).
- Impact: AI agents deploying or operating Postdot autonomously cannot self-bootstrap securely or administer an instance end-to-end without human intervention, weakening Postdot's agent-first positioning.
- Desired outcome: An AI agent with authorized deployment or operator privileges can securely bootstrap a fresh Postdot installation without leaving an open first-user takeover window, take immediate programmatic control, and perform instance, user, and API-key administration with explicit privilege boundaries.
- Related: GH #35, ADR-075, ADR-096
- Tasks: none — recorded for future specification and design; not authorized for immediate implementation

