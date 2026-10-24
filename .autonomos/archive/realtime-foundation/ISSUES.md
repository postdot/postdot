# Historical issues: realtime and foundation maintenance

Source: .autonomos/ISSUES.md. Earlier assessments and subsequent corrections
remain historical evidence, not simultaneous current instructions.

<a id="issue-050"></a>

## [ISSUE-050] Keep notifications and project work views synchronized

- Type: problem
- Status: resolved
- Evidence: The notification inbox loads when its component mounts or opens, and
  project queue/publication data is initially loaded and refreshed after local
  mutations. The browser currently has no general push, polling, SSE, or
  WebSocket subscription for worker-generated changes, while the server-side
  notification projection runs independently on a short interval.
- Impact: A worker outcome or another browser session can leave the visible
  inbox and queue stale until the user performs a manual refresh or another
  local action. The product's durable event journal exists, but its update
  semantics are not yet exposed as a client-facing reactivity contract.
- Desired outcome: The web client receives or safely discovers relevant project
  changes without a full-page refresh, with explicit reconnect, missed-event,
  deduplication, authorization, and fallback semantics. The design must reuse
  the existing durable event and notification projections rather than create a
  second source of truth, and must be validated against worker-generated
  publication outcomes.
- Tasks: REALTIME-96, REALTIME-102, REALTIME-103, REALTIME-104, REALTIME-105, REALTIME-106
- Related issues: ISSUE-045, ISSUE-046
- Resolution: REALTIME-96 and REALTIME-102 through REALTIME-106 established
  authenticated reconnectable SSE, post-commit project invalidation, durable
  replay and recovery semantics, and production Query integration. NOTIFY-127
  and NOTIFY-128 extended the inbox to a user-wide scope with one authenticated
  invalidation stream. The signal remains process-local by design; a future
  multi-process deployment would require a separate cross-process boundary.

<a id="issue-189"></a>

## [ISSUE-189] Assess the risk of pre-stable foundation dependencies

- Type: question
- Status: resolved
- Evidence: The runtime and client depend on pre-stable or very recent major versions: Elysia 2 beta (API), TypeScript 7.0, TanStack DB 0.x with its query collection, and Bun 1.4. The product promises a durable self-hosted runtime and an upgrade path (RELEASE-303).
- Impact: Breaking upstream changes, regressions or abandonment can force unplanned migrations on a product that self-hosters expect to upgrade safely.
- Desired outcome: An explicit, recorded position for each pre-stable dependency (accepted risk with an exit path, pin, or replacement), reviewed before the first published release.
- Related: RELEASE-303
- Tasks: FOUND-570

- Assessment (2026-10-23): FOUND-570 corrects the production exposure: TanStack DB is development-only and TypeScript 7.0.2 is a stable compiler. Elysia remains an experimental multi-package integration; host Bun is canary while CI/image select 1.4.2. ADR-092 proposes one runtime-alignment and exact-pin batch, with stable Bun 1.4.4 qualification prioritized after upstream security fixes, plus explicit risk review and exit paths. No dependency changed. The issue remains open until the owner accepts the positions. [Proposal](../../decisions/ADR-092-propose-foundation-release-baseline.md).

- Owner clarification (2026-10-23): prereleases are acceptable before users or a stable product release; no additional freeze is justified solely by a prerelease label. The initial exact-pin batch is withdrawn in revised ADR-092. TypeScript has no reproduced issue; TanStack DB's prototype-only use is not a production restriction. Stable Bun updates should be reviewed approximately every one to two weeks, with validation and runtime alignment. No dependency changed.

- Resolution (2026-10-23): The owner accepted ordinary prerelease maintenance before users/stable product release, without a label-driven freeze. ADR-092 records the corrected direction. FOUND-571 qualifies stable Bun 1.4.4, aligns version declarations/types/container stages, and removes the completed TanStack DB comparison after confirming ADR-047's Query choice. Elysia and TypeScript receive no special freeze or replacement. All 1,566 unit/script tests, 140 browser cases, 21 builds and container recovery pass; remaining release architecture qualification stays with RELEASE-303. [Evidence](worklogs/2026-10-23-FOUND-571.md).

