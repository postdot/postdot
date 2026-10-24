# Historical runtime, recovery and observability task records

Source: .autonomos/TASKS.md. Original statuses and wording are retained;
archival does not infer completion dates or create new current instructions.

## 🧪 Runtime isolation follow-up

<a id="ops-139"></a>

- [x] **[OPS-139]** Isolate concurrent E2E runtime data, media, ports, and teardown ownership `Priority: 🔴` `Complexity: M` — every Playwright invocation gets a unique disposable runtime root, OS-selected loopback ports, an invocation-specific output directory, and teardown scoped to that run; Playwright workers reuse the parent runtime instead of creating additional roots.

## 🔒 Recovery quiescence follow-up

<a id="ops-140"></a>

- [x] **[OPS-140]** Enforce fail-closed runtime quiescence before database and media restore `Priority: 🔴` `Complexity: M` — the API runtime and restore paths now acquire one database-specific sidecar lock, graceful shutdown releases it, restore fails before validation or writes while Postbot is active, and forced-stop markers require explicit operator verification.

## 🧱 Foundation consolidation after the 2026-09-11 audit

<a id="ops-148"></a>

- [x] **[OPS-148]** Keep Drizzle migration sources intact during ordinary cleanup `Priority: 🟠` `Complexity: S` — [ISSUE-073]; clean only disposable build outputs and prove the migration directory survives a disposable clean/start cycle.

<a id="qual-149"></a>

- [x] **[QUAL-149]** Add root script tests to the standard repository gate `Priority: 🟠` `Complexity: S` — [ISSUE-074]; make the eight CLI/runtime-isolation tests part of `bun run check` and prove the gate catches a regression in that family.

## 🛑 Runtime shutdown and restart proof

<a id="ops-150"></a>

- [x] **[OPS-150]** Make graceful shutdown drain in-flight work and prove durable restart recovery `Priority: 🔴` `Complexity: L` — [ISSUE-075]; stop new scheduling, await provider/projection/media operations before closing SQLite and releasing the runtime lock, then cover graceful SIGTERM-equivalent draining, restart reconstruction, and explicit forced-stop recovery semantics without adding a supervisor.

## ⚖️ Operational fairness and complete Queue counts

<a id="ops-151"></a>

- [x] **[OPS-151]** Bound multi-project worker fairness and verify provider/media fault checkpoints `Priority: 🟠` `Complexity: L` — [ISSUE-076]; the worker now uses a bounded round-robin quantum while preserving serial lease-fenced effects, and representative provider/MediaStore failure paths are covered without requiring live cloud credentials.

## 🔎 Issue-driven external audit reconciliation

<a id="tooling-190"></a>

- [x] **[TOOLING-190]** Replace the heuristic repository-language check with a standard CSpell gate `Priority: 🔴` `Complexity: M` — keep ordinary code, documentation, tests, and Autonomos artifacts spell-checked in English; exclude only translation catalogs and generated localization output plus standard build/runtime paths; maintain a small reviewed project dictionary; integrate the gate into the existing lint/check flow; and remove the custom regex scanner. — [ISSUE-117]

<a id="ops-193"></a>

- [x] **[OPS-193]** Align local, CI, and release quality gates with their intended scope `Priority: 🟠` `Complexity: S` — verify the fast pre-commit path and complete CI path against the current root scripts, then record the relationship as current evidence. — [ISSUE-108]

<a id="realtime-194"></a>

- [x] **[REALTIME-194]** Revoke user notification streams after session or project-access loss `Priority: 🔴` `Complexity: M` — re-evaluate the user’s visible project set during the long-lived stream, emit a terminal access-revoked control event when it becomes empty, close the browser source, and cover the server/client contracts without exposing notification payloads. — [ISSUE-113]

<a id="notify-199"></a>

- [x] **[NOTIFY-199]** Record the external notification transport boundary `Priority: 🟠` `Complexity: S` — [ISSUE-114]; the owner explicitly defers real Ntfy, Telegram, and provider adapters for now, without permanently excluding them. Keep the transport-neutral store and recording-transport tests; revisit when a concrete destination is requested.

<a id="notify-200"></a>

- [x] **[NOTIFY-200]** Confirm transactional email failure handling `Priority: 🟠` `Complexity: L` — [ISSUE-115]; ADR-066 already decides the current behavior: SMTP is optional, email sends do not hold up the request, failures are logged, and Postbot does not retry failed messages. Local/manual-link operation remains available. Closed as confirmation of the accepted current contract; durable retries remain future work if a deployment needs a delivery guarantee.

<a id="workflow-201"></a>

- [x] **[WORKFLOW-201]** Close the worker fairness and deployment-topology audit `Priority: 🟠` `Complexity: M` — [ISSUE-116]; one process/worker remains the supported boundary (ADR-003); OPS-150 and OPS-151 verify shutdown/restart, fairness, claims, retries, cancellation, and ambiguous outcomes. Metrics remain under OPS-207; no multi-process policy or coordination is implied.

<a id="ops-207"></a>

- [x] **[OPS-207]** Implement the owner-approved self-hosted metrics surface `Priority: 🟠` `Complexity: M` — [ISSUE-122]; use the approved Prometheus JavaScript client direction for a bounded scrape endpoint and operational process/worker metrics. Do not add a hosted service. Leave scrape cadence, retention, dashboards, and alert thresholds to the deployment operator; verify endpoint exposure and tests before enabling it. Evidence: `GET /metrics` is covered by unauthenticated route and OpenAPI tests; fixed-cardinality process/scheduler/worker metrics are covered by API unit tests; deployment network restriction is documented in `docs/deployment/metrics.md`.

<a id="ops-208"></a>

- [x] **[OPS-208]** Verify and document current deployment and recovery boundaries `Priority: 🟠` `Complexity: M` — confirm the production image, health/readiness contract, Mailpit development boundary, database/media backup, restore lock, and publisher-key recovery instructions. — [ISSUE-123]

## Local development reliability

<a id="ops-211"></a>

- [x] **[OPS-211]** Restore authenticated local app loading and unblock the media Trash pull request `Priority: 🟠` `Complexity: M` — identify why the Vite proxy returns a non-Postbot response for authentication, restore the local API without changing user data, add the permanent-delete route to the OpenAPI inventory test, and merge PR #198 only after all required checks pass. Evidence: PR #198 merged as `d8b96ed9`; CI `Verify` passed after merge. Local API and Vite now use ports 3002 and 5173.

## Prometheus scrape hardening

<a id="ops-212"></a>

- [x] **[OPS-212]** Secure, document, and verify opt-in Prometheus metrics `Priority: 🟠` `Complexity: M` — [ISSUE-125]; disable `/metrics` by default, require a configured bearer token when enabled, document safe local/private-network scraping and enable/disable settings, and add HTTP end-to-end coverage for disabled, unauthorized, authorized, and changing worker metrics. Do not expand to OpenTelemetry in this task. Evidence: the endpoint is mounted only when enabled with a dedicated token (minimum 32 characters), uses a constant-time token comparison, and documents Prometheus `credentials_file` plus private-network protections. Real HTTP tests verify 404 when disabled, 401 without/with an invalid token, authenticated exposition, process/scheduler/worker values, and updated worker counters/duration buckets. Checks: `bun run check:quick`, 181 API tests, and `bun run build` pass.

## Production backup and restore execution

<a id="ops-213"></a>

- [x] **[OPS-213]** Make the documented backup and restore commands executable from the production image `Priority: 🔴` `Complexity: M` — [ISSUE-123]; dispatch maintenance without requiring unrelated web-authentication or publisher-encryption secrets, retain any credentials genuinely required by the configured media store, verify documented media bundle backup/restore against an isolated production image and disposable data, and keep CI and operator instructions aligned. Evidence: [OPS-213 worklog](worklogs/2026-09-25-OPS-213.md).

## External product diagnostic — prioritized follow-ups

<a id="ops-216"></a>

- [x] **[OPS-216]** Log unexpected HTTP failures in production without enabling routine request logs `Priority: 🔴` `Complexity: M` — [ISSUE-128]; emit structured, correlated, secret-redacted records for unexpected failures while retaining generic client responses and the current quiet-success default; test production logging configuration and error paths. Evidence: [OPS-216 worklog](worklogs/2026-09-25-OPS-216.md).

<a id="ops-217"></a>

- [x] **[OPS-217]** Evaluate crash-safe runtime exclusion and restore coordination `Priority: 🟠` `Complexity: L` — [ISSUE-127]; compare the current fail-closed sidecar with process-lifetime lock options on supported platforms, prove crash release and active-restore exclusion, and present trade-offs without changing the lock contract or promoting ADR-068. Evidence: [OPS-217 worklog](worklogs/2026-09-26-OPS-217.md).

<a id="ops-218"></a>

- [x] **[OPS-218]** Verify dashboard shell and assets from the production image `Priority: 🟠` `Complexity: M` — [ISSUE-129]; extend the isolated image acceptance test to request the production web entry point and its built assets, alongside the existing readiness and backup/restore checks. Evidence: [OPS-218 worklog](worklogs/2026-09-26-OPS-218.md).

## Browser UX audit — incremental follow-ups

<a id="ops-271"></a>

- [x] **[OPS-271]** Restart the development API gracefully on source changes `Priority: 🟠` `Complexity: M` — Bun watch restarts retain the runtime lock after disposing the previous module, preventing the next startup. Preserve the fail-closed lock contract; coordinate process shutdown/drain before a replacement starts, cover repeated reloads, and avoid automatic stale-lock deletion. [Evidence](../../worklogs/2026-10-01-UX-268.md). Serialized development launcher implemented and validated with delayed-drain subprocess tests, three isolated real API reloads and the full root gate. [Completion](worklogs/2026-10-03-OPS-271.md).

<a id="ops-289"></a>

- [x] **[OPS-289]** Diagnose unexpected shared development launcher termination `Priority: 🟠` `Complexity: M` — After isolated editor checks and a read-only browser review, the shared API launcher session exited zero without a shutdown explanation. Repeated isolated source reloads pass; separate terminal/session lifecycle from API natural exit and watch persistence before changing behavior. Services restored without deleting locks. [Observation](worklogs/2026-10-03-OPS-271.md). Investigation reproduced terminal hangup orphaning the API or retaining its lock under group closure; both graceful paths are corrected and lifecycle logs distinguish future exits. Historical trigger remains unknown. Full gate and real API/launcher regression checks pass. [Diagnosis and completion](worklogs/2026-10-03-OPS-289.md).

<a id="ops-299"></a>

- [x] **[OPS-299]** Verify Bun runtime and production packaging `Priority: 🔵` `Complexity: M` — Verify production versus development/tooling runtime boundaries after the Node 25 Vite abort. Reproduced a Bun/Vite configuration failure in the fresh Docker build; explicit Bun execution with Vite's native loader corrects it. Browser loading/hot updates, production image startup/restore and the complete root gate pass. The exact historical V8 trigger remains unknown; production shutdown acceptance is tracked in OPS-300. [Evidence](worklogs/2026-10-04-OPS-299.md).

<a id="ops-300"></a>

- [x] **[OPS-300]** Verify graceful production container shutdown `Priority: 🔴` `Complexity: M` — OPS-299 observed exit code 137 during the existing recovery check despite successful startup and restore. The `@elysia/static` asset cache owns a TTL sweep interval that is never cleared, so the process could not exit after serving dashboard files and Docker SIGKILLed it after the stop grace period. The server now drains worker/maintenance runtimes, closes the listener and SQLite, releases the runtime lock, then exits explicitly with the drain outcome; `STOPSIGNAL SIGTERM` is explicit. The recovery acceptance requires exit 0 with a released lock for both containers and proves forced termination stays visible (137, retained lock, refused restart). Preserve recovery exclusion and avoid deleting retained runtime locks. Evidence: [OPS-300 worklog](worklogs/2026-10-04-OPS-300.md). Review: [OPS-300 review](worklogs/2026-10-04-OPS-300-review.md) — exit contract hardened to 0/1/2 with guarded close/release stages, refused-restart probe bounded with guaranteed cleanup, shutdown logging redacted and unit-tested.

## Publication reliability audit follow-ups

<a id="ops-305"></a>

- [x] **[OPS-305]** Review shutdown hardening and audit publication reliability `Priority: 🟠` `Complexity: M` — Independent targeted tests and fresh container acceptance pass; existing crash/retry/fencing guarantees remain supported. Reproduced silent lock-release failure; raw diagnostic propagation needs investigation. [Evidence](worklogs/2026-10-04-OPS-305.md).

<a id="ops-306"></a>

- [x] **[OPS-306]** Make shutdown cleanup failure observable and test the exit contract `Priority: 🟠` `Complexity: M` — [ISSUE-151]. Ensure exit 0 cannot imply lock release when removal failed. Preserve token ownership, no automatic stale-marker deletion, drain-before-cleanup and one supported Bun runtime. Cover release failure, close failure, successful drain ordering and a pending operation; verify actual exit outcomes rather than only diagnostic formatting. Review the approach against all lock callers before implementation. [Evidence](worklogs/2026-10-04-OPS-305.md). Completed: `release()` returns whether the marker is gone (throw rejected to protect restore/recovery `finally` blocks); the extracted shutdown handler maps a retained marker to exit 2 with behavioral coverage of release, close, and drain ordering. Evidence: [OPS-306 worklog](worklogs/2026-10-04-OPS-306.md).

## Product sequencing reset

<a id="ops-371"></a>

- [x] **[OPS-371]** Evaluate scheduled full backups and retention `Priority: 🟡` `Complexity: M` — Product proposal from PRODUCT-368, subject to owner scope approval. Reuse existing database/media backup facilities inside the monolith; define destination, retention, overlap control, and visible failure. Manual backups already exist; no new service or implied recovery guarantee. Evaluation complete; automatic scheduling and retention proposal withdrawn after owner discussion on 2026-10-10. Scheduling remains administrator-owned; restoration boundary follows in OPS-376. [Evaluation](worklogs/2026-10-09-OPS-371.md).

<a id="ops-376"></a>

- [x] **[OPS-376]** Define the backup and restoration responsibility boundary `Priority: 🟠` `Complexity: M` — Inspect existing database/media recovery and external-effect restart behavior; document archive coverage, deployment prerequisites and rollback limits. Keep scheduling and retention administrator-owned. Propose controlled restart separately from implemented guarantees.

<a id="ops-377"></a>

- [x] **[OPS-377]** Implement controlled restart after database restoration `Priority: 🟠` `Complexity: M` — Owner-approved follow-up to OPS-376: durable recovery hold covering provider and external email effects, direct API actions and background executors, explicit inspection and resume, normal restart unchanged. External restore commands, inspection readiness, administration acknowledgement and media-cleanup suspension delivered. All validation layers and fresh container acceptance passed; the outdated readiness assertion was corrected and rerun without replaying the successful matrix. No automatic provider reconciliation. [Implementation and evidence](worklogs/2026-10-10-OPS-377.md).

<a id="db-555"></a>

- [x] **[DB-555]** Configure deliberate SQLite WAL durability and bounded contention `Priority: 🟠` `Complexity: M` — ISSUE-187; owner-approved WAL, FULL, 5-second busy timeout and safe restoration delivered under ADR-089. Strict close finalizes prepared statements; restore retires destination WAL through SQLite. Static gates, 1,550 unit/script tests, 133 browser scenarios plus 4 SMTP/recovery scenarios and fresh production-container recovery passed without retries. [Evidence](worklogs/2026-10-23-DB-555.md).

<a id="build-556"></a>

- [x] **[BUILD-556]** Exclude generated browser outputs and runtime data from Docker contexts `Priority: 🟠` `Complexity: S` — ISSUE-176; exclude root runtime/browser outputs and recursively exclude generated workspace outputs/dependencies. Actual context audit preserves 26 manifests/configuration files and 3 fixtures; audited copy reduced from 1.6 GB after initial root exclusions to 47 MB. Normal production build, complete container recovery and static gates pass. [Evidence](worklogs/2026-10-23-BUILD-556.md).

<a id="work-568"></a>

- [x] **[WORK-568]** Bound concurrent project effects and renew active claims `Priority: 🟠` `Complexity: L` — ISSUE-186; two shared internal slots, one effect per project, fair admission, strict renewable claims, cooperative deadlines and actual-operation draining under ADR-090. 1,567 unit/script tests, 134 main browser cases with four environmental reruns, two automatic cases, four SMTP cases and production-container recovery validated. [Evidence](worklogs/2026-10-23-WORK-568.md).

