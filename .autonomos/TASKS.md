# PROJECT TASKS & ROADMAP

> **LEGEND**
> **Priority:** [🔴 Critical] [🟠 High] [🔵 Medium] [⚪ Low]
> **Complexity:** [S] Small (1h), [M] Medium (4h), [L] Large (1-2 days), [XL] Huge (Planning req.)
> **Status:** [ ] Todo, [/] In Progress, [x] Done, [!] Blocked

- [/] **[SITE-626]** Publish and verify public documentation updates `Priority: 🟠` `Complexity: S`

- [/] **[PUB-627]** Complete GitHub profile, application releases and clean-install acceptance `Priority: 🟠` `Complexity: L`

- [ ] **[AUTH-648]** Implement token-gated zero-window instance bootstrap and CLI/Studio setup onboarding ([SPEC-012](specs/SPEC-012-agentic-bootstrap-and-privileged-api-access.md), [ADR-102](decisions/ADR-102-token-gated-bootstrap-and-admin-api-key-capabilities.md)) `Priority: 🔴` `Complexity: M`

- [ ] **[API-649]** Implement admin API-key capabilities, anti-escalation, and `POST /api/access/members` ([SPEC-012](specs/SPEC-012-agentic-bootstrap-and-privileged-api-access.md), [ADR-102](decisions/ADR-102-token-gated-bootstrap-and-admin-api-key-capabilities.md)) `Priority: 🔴` `Complexity: L`

- [ ] **[CLI-650]** Expose admin API-key parity across CLI, MCP catalog, Studio UI, and docs ([SPEC-012](specs/SPEC-012-agentic-bootstrap-and-privileged-api-access.md), [ADR-102](decisions/ADR-102-token-gated-bootstrap-and-admin-api-key-capabilities.md)) `Priority: 🟠` `Complexity: M`

## Current direction

Shared-channel implementation follows [ADR-095](decisions/ADR-095-workspace-channels-and-project-attachments.md)
and [SPEC-009](specs/SPEC-009-shared-channel-workflows.md) under SHARE-592/GitHub #12.
Source now includes workspace-owned channels/profiles/connections/credentials,
explicit project attachments and management transfer, live session/key scope
checks, contextual Studio/API/CLI, shared-calendar occupancy, optional cadence,
destination confirmation and revalidated pending-publication moves. Authored public
guides and CLI/authentication reference explain these source workflows and their
access, concurrency and lifecycle boundaries. The published `0.1.0-alpha.3` image includes this milestone
(release run 40586044797).

Local grouped acceptance now covers migration/rollback, sharing/detach/deletion,
cadence concurrency/restart/retry, shared credential renewal, moves and Studio
journeys. A synthetic native AMD64 alpha.2 upgrade/restoration and full container
recovery passed after correcting retirement of original/derived media graphs.
The final unit/scripts gate passed 1,741 tests; 159 distinct default/SMTP browser
journeys passed across the full run and focused reprises (see the worklog for the
two initial failures and their causes).

Released as `0.1.0-alpha.3` (source `cf7d7e9`, native AMD64/ARM64 acceptance with
alpha.2 as the previous image). An operator-copied backup and real-provider
acceptance remain unclaimed. Owner visual review remains separate from automated
acceptance.

Production realtime uses TanStack Query with authenticated SSE invalidation and
the durable server journal; see [ADR-047](decisions/ADR-047-evaluate-reactive-client-data-layer.md)
and [ADR-050](decisions/ADR-050-post-commit-project-realtime-signal.md).
The comparison experiment is retired; future DB adoption requires a concrete need.
Foundation maintenance follows [ADR-092](decisions/ADR-092-propose-foundation-release-baseline.md).
The current published image is `0.1.0-alpha.7`, with native AMD64/ARM64 upgrade
and restoration acceptance from `0.1.0-alpha.6` under RELEASE-621. Distribution
notices remain packaged; release policy follows ADR-093.
The anonymous login entry meets the 180 KiB JavaScript target under WEB-587; build CI guards it.

Calendar/Queue delivery follows the current route, timezone and reading contracts
in [ADR-057](decisions/ADR-057-propose-route-information-architecture.md),
[ADR-032](decisions/ADR-032-use-project-timezone-for-civil-scheduling.md),
[ADR-070](decisions/ADR-070-calendar-reading-history-policy.md) and
[ADR-073](decisions/ADR-073-in-cell-calendar-actions-and-sticky-time-gutter.md).
Route, navigation, responsive and visual-foundation contracts follow SPEC-010
and DESIGN.md (UX-389 through UX-403, UX-415); ISSUE-063, ISSUE-064, ISSUE-065
and ISSUE-145 are resolved.

Access/recovery follows [ADR-061](decisions/ADR-061-human-account-and-instance-access-policy.md),
[ADR-063](decisions/ADR-063-adopt-better-auth-access-plugins.md),
[ADR-064](decisions/ADR-064-clean-development-access-baseline.md) and
[ADR-066](decisions/ADR-066-smtp-auth-email-delivery.md); user-owned API keys
inherit live access with explicit action ceilings. See the
[API-key guide](../apps/docs/content/docs/reference/authentication.mdx) and current scoped API guidance.
The accepted deployment-key limitation remains in ADR-012.
The [channel builder reference](<../apps/docs/content/docs/(guides)/(studio)/channels.mdx>) describes
bounded lossless content/mapped-request editing and explicit profile activation;
Manual template loading/activation remains explicit; automatic upstream discovery is not implemented.

Runtime and recovery follow the [operational boundary](<../apps/docs/content/docs/(self-hosting)/(operations)/operations.mdx>)
and [deployment guide](<../apps/docs/content/docs/(developers)/(architecture)/architecture.mdx>): restore
requires quiescence and an explicit recovery acknowledgement; backup scheduling,
retention and off-machine protection remain administrator-owned. SQLite durability
is governed by [ADR-089](decisions/ADR-089-explicit-sqlite-wal-policy.md); project-effect
admission and renewable ownership by [ADR-090](decisions/ADR-090-bounded-project-effects-and-renewal.md).
ISSUE-127 retains the unaccepted kernel-lock alternative. Metrics stay opt-in and bearer-protected; transactional
SMTP and durable personal outcome alerts have separate delivery contracts.

Current evidence exceptions: the 0.8 migration (META-622) moved every checked task
to `archive/closed/TASKS.md`, including two with unresolved evidence. WORK-07 has
child execution proofs but ADR-009 still states an umbrella closure condition;
DESIGN-97 is checked while its own worklog lacks validation evidence. Reconcile
both before relying on them as complete. Recurring provider validation remains
under ISSUE-021; historical successes authorize no new effects.

Project/workspace retirement follows [ADR-094](decisions/ADR-094-project-and-workspace-lifecycle.md).
Restore does not requeue cancelled work; permanent deletion retains a minimal
receipt while durable media cleanup retries independently.

## Deferred backlog

- [ ] **[UX-283]** Specify and implement animated attachments for supported destinations `Priority: 🔵` `Complexity: L` — Owner-deferred until core workflows are ready; contracts first, no GIF-editor substitute. [Criteria](archive/worklogs-format-1/2026-10-03-UX-286-gif-deferral.md).

- [ ] **[UX-287]** Reassess external GIF catalogs after core workflow readiness `Priority: 🔵` `Complexity: M` — Owner-deferred; needs provider terms fit for self-hosting; no registration or contact authorized. [Criteria](archive/worklogs-format-1/2026-10-03-UX-286-gif-deferral.md).
