# Historical runtime, recovery and observability issues

Source: .autonomos/ISSUES.md. Historical evidence and superseded mechanisms
remain preserved; applicable current contracts stay in accepted records.

<a id="issue-025"></a>

## [ISSUE-025] Isolate concurrent local and test runtime resources

- Type: problem
- Status: resolved
- Evidence: The browser test configuration uses a shared temporary data root
  that startup and teardown remove, while development and E2E commands rely on
  conventional ports and local database/media paths.
- Impact: Overlapping workers or test runs can collide on ports, erase another
  run's SQLite/media state, or execute against the wrong local runtime.
- Desired outcome: Each concurrent test or explicitly isolated runtime receives
  its own temporary data and media roots and reserved ports, with teardown
  limited to resources owned by that run. Shared/default paths remain a
  serialized orchestrator concern until then.
- Tasks: OPS-139 (completed)
- Resolution: Playwright now creates a unique disposable runtime root and
  invocation-specific loopback ports and output directory. Worker processes
  reuse the parent runtime through explicit environment propagation, while the
  API launcher and global teardown validate and remove only the generated run
  root. The legacy `/tmp/postbot-e2e-data` root is not accepted as a cleanup
  target. Default development ports and data paths remain operator-owned and
  serialized; explicit E2E debug ports remain caller-reserved.
- Verification: The isolated runtime unit tests pass, two concurrent realtime
  Playwright runs pass on distinct ports, the CI-mode browser suite passes all
  15 tests, and no generated E2E data root remains after teardown.

<a id="issue-026"></a>

## [ISSUE-026] Enforce runtime quiescence before backup restore

- Type: problem
- Status: resolved
- Evidence: The restore path can replace the database and media state while the
  API, scheduler, or maintenance runtime may still hold open resources. The
  operator documentation asks for a stop but the restore operation does not
  enforce quiescence.
- Impact: A live process can retain stale SQLite or media handles and diverge
  from the restored state, leaving an inconsistent runtime that is difficult to
  diagnose.
- Desired outcome: Restore has an explicit fail-closed quiescence boundary and
  a verified operator lifecycle for stopping, restoring, and restarting Postbot.
- Tasks: OPS-140 (completed)
- Related decision: [ADR-068](../../decisions/ADR-068-runtime-quiescence-sidecar-lock.md) (proposed)
- Resolution: The API process acquires a database-specific `.runtime.lock`
  sidecar before opening the database, and the database and media restore
  primitives acquire the same lock before validating a backup or touching the
  destination. Atomic exclusive creation prevents an active server and a
  restore from proceeding together. Graceful shutdown releases the marker;
  forced termination leaves it in place so a later startup or restore fails
  closed until an operator verifies that no Postbot process is using the database
  and removes only that exact stale marker.
- Verification: Runtime-lock unit tests cover exclusive ownership, stale-marker
  refusal, release, and in-memory rejection. Backup tests cover restore refusal
  while the server boundary is held and successful retry after release. The
  full repository quality gate and local server readiness checks remain required
  before integration.

<a id="issue-073"></a>

## [ISSUE-073] Keep migration sources outside ordinary build cleanup

- Type: problem
- Status: resolved
- Evidence: `packages/db/package.json` defines `clean` as `rimraf dist .turbo drizzle`,
  while `drizzle` contains the committed migration SQL and metadata. The audit did
  not execute the destructive command against the repository, but the script and
  tracked files establish the behavior statically. See the [reliability audit](../../worklogs/2026-09-11-postbot-audit/02-reliability-data-and-operations.md).
- Impact: A normal cleanup can remove the source history required for a fresh
  startup or package build. Git can restore committed files, but a local migration
  that has not been committed is not recoverable through that path.
- Desired outcome: Routine cleanup removes only disposable build outputs; any
  deliberate migration reset is a separately named, explicit, documented operation
  and cleanup is proven safe in a disposable clone.
- Tasks: OPS-148
- Related issues: ISSUE-001, ISSUE-008, ISSUE-026, ISSUE-067
- Related decisions: ADR-005, ADR-064
- Resolution: The database package cleanup now removes only `dist` and `.turbo`;
  the committed Drizzle migration directory is outside ordinary cleanup. A
  disposable clean verification preserved the baseline SQL and migration journal
  byte-for-byte.

<a id="issue-074"></a>

## [ISSUE-074] Include repository-level test families in the standard quality gate

- Type: problem
- Status: resolved
- Evidence: `bun run check` reaches workspace tests through Turbo but does not run
  the eight tests under `scripts/`; those tests are only green when invoked
  separately with `bun test scripts`. The audit confirmed the omission in the Turbo
  task graph and the root package scripts. See the [client and quality audit](../../worklogs/2026-09-11-postbot-audit/03-architecture-client-and-quality.md).
- Impact: Regressions in the CLI and runtime-isolation helpers can merge while the
  repository's advertised check remains green. This weakens confidence in the same
  orchestration paths used by local development and browser validation.
- Desired outcome: The normal repository quality gate executes every required test
  family, including root-level scripts, and a deliberate regression in that family
  fails the gate.
- Tasks: QUAL-149
- Related issues: ISSUE-017, ISSUE-025, ISSUE-066
- Related decisions: ADR-029
- Resolution: The root `test:unit` command now runs the Turbo workspace suites
  and the dedicated `test:scripts` command. The eight CLI and runtime-isolation
  tests pass through that explicit gate, so root script regressions are no longer
  outside the normal repository check.

<a id="issue-075"></a>

## [ISSUE-075] Prove graceful runtime shutdown and durable restart recovery

- Type: problem
- Status: resolved
- Evidence: The foundation audit's medium-term follow-up identified shutdown during
  a provider effect, notification projection, or media reconciliation as unverified.
  `NextEventScheduler.stop()`, the publication worker, and media maintenance stop
  scheduling synchronously, while the production entrypoint closes the database
  immediately afterward. Existing tests cover idle cleanup and restart-readable
  state, but do not prove that in-flight work drains before the database and runtime
  lock are released.
- Impact: A SIGTERM during an external effect can close SQLite while the worker is
  still completing its durable outcome, or can leave a provider/media operation
  without a clear final checkpoint. A process that exits without a durable final
  state must be recoverable on restart without claiming that an unknown external
  effect was successful.
- Desired outcome: Graceful shutdown prevents new work, waits for in-flight worker,
  projection, and media maintenance operations to settle before closing resources,
  and releases the runtime boundary only after that drain. Restart tests must prove
  durable job recovery, notification projection recovery, media maintenance
  lifecycle, and an explicit behavior for forced-stop leftovers.
- Scope boundary: This issue proves the existing single-process lifecycle and
  recovery contracts; it does not introduce a supervisor, a distributed lock,
  provider-specific cancellation APIs, or a new deployment architecture.
- Tasks: OPS-150
- Related issues: ISSUE-012, ISSUE-026, ISSUE-067
- Related decisions: ADR-005, ADR-038, ADR-058, ADR-064
- Resolution: The scheduler now stops planning new work and exposes an async
  drain barrier; the worker and media maintenance propagate it, and production
  awaits those drains before closing SQLite or releasing the runtime lock.
  Restart, notification projection, workflow lease, backup/restore, and stale
  lock tests preserve durable recovery and explicit forced-stop handling.

<a id="issue-076"></a>

## [ISSUE-076] Prove fair multi-project execution and provider media boundaries

- Type: risk
- Status: resolved
- Evidence: The publication worker currently iterates projects sequentially and
  drains one project's due jobs in an unbounded inner loop before it visits the
  next project. The provider conformance suite and MediaStore contract suite use
  deterministic doubles, but no representative fixture proves that a busy
  project cannot delay another project indefinitely, or that provider/media
  fault paths preserve their durable checkpoints together.
- Impact: A project with a large ready backlog can monopolize the single worker and
  make another project's scheduled publication late even when both are due. A
  green provider or S3-shaped test can also hide a missing error/checkpoint
  contract if the failure path is not exercised explicitly.
- Desired outcome: The single worker services projects with a bounded round-robin
  quantum, preserves serial external effects and lease fencing, and has
  representative provider/media fault tests that distinguish durable outcomes
  from unknown external outcomes. Deployment-specific cloud behavior remains an
  explicit verification boundary rather than an unearned claim.
- Scope boundary: This issue does not add concurrent workers, a broker, a
  distributed scheduler, live provider credentials, or a required cloud service.
- Tasks: OPS-151
- Related issues: ISSUE-028, ISSUE-067, ISSUE-075
- Related decisions: ADR-005, ADR-019, ADR-038, ADR-064
- Resolution: The publication worker now services each project with a bounded
  round-robin quantum instead of draining one project's due backlog before
  visiting the next. Serial provider effects, project-scoped actor leases, and
  claim fencing remain unchanged. Existing provider fault coverage exercises
  success, retryable, failed, and ambiguous outcomes; local and S3-shaped
  MediaStore contract coverage exercises atomic replacement and failed writes
  without leaving partial objects. These checks remain deterministic and do not
  claim live cloud-provider behavior.

<a id="issue-108"></a>

## [ISSUE-108] Align quality gates with the repository test topology

- Type: problem
- Status: resolved
- Evidence: The supplied audit questions whether root-level script tests are included consistently in local hooks, CI, and the standard check, and whether the complete gate is unnecessarily duplicated.
- Impact: A green local check may fail to represent the checks required before integration, while an over-broad hook can discourage ordinary commits.
- Desired outcome: Each quality gate has an explicit purpose, stable coverage, and a documented relationship between local, CI, and release validation.
- Tasks: OPS-193
- Resolution: `check:quick` is the bounded local pre-commit path. `check` runs
  format, lint, typecheck, unit tests, browser tests, and build; CI invokes that
  complete path. Root script tests are included through `test:unit`, so the
  reported topology gap is not reproduced in the current checkout.

<a id="issue-113"></a>

## [ISSUE-113] Reauthorize global user event streams after session or membership changes

- Type: problem
- Status: resolved
- Evidence: The supplied audit reports that a long-lived user notification stream may remain open after session expiry or loss of all relevant project memberships.
- Impact: A connected client could continue receiving events after its authentication or visibility authority is no longer valid.
- Desired outcome: Long-lived user event streams stop or reauthorize within a defined contract after authentication or access changes.
- Tasks: REALTIME-194
- Resolution: User streams now revalidate the session and visible project set on
  pulls, emit a terminal `user.access-revoked` frame, close the server stream,
  and close the browser source. Focused API and web tests cover the contract.

<a id="issue-116"></a>

## [ISSUE-116] Prove worker fairness and multi-process execution policy

- Type: problem
- Status: resolved
- Evidence: The supplied audit questions project scheduling fairness, timer behavior, claim races, and the absence of runtime execution metrics.
- Impact: A busy project or multiple process instances could delay or duplicate external effects, while operators lack evidence about backlog and claim health.
- Desired outcome: The supported worker topology, fairness guarantees, lease behavior, shutdown semantics, and operational measurements are explicit and tested.
- Tasks: WORKFLOW-201
- Current classification: The worker uses bounded round-robin service, atomic
  lease-fenced claims, and awaited scheduler drain behavior. The supported
  deployment remains one process and one worker; multi-process execution is not
  claimed. Runtime metrics are tracked separately under ISSUE-122.
- Resolution: ADR-003 defines the current single-process boundary. OPS-150
  verifies graceful shutdown and durable restart recovery; OPS-151 verifies
  round-robin fairness, lease-fenced claims, retries, cancellation, and
  ambiguous outcomes in a local provider sandbox. No evidence justifies adding
  multi-process coordination. Observability remains separately tracked under
  ISSUE-122.

<a id="issue-117"></a>

## [ISSUE-117] Enforce the repository language boundary and vocabulary

- Type: problem
- Status: resolved
- Evidence: The supplied audit reports French text outside translation catalogs, inconsistent Post/Publication vocabulary, and identical untranslated catalog values.
- Impact: Repository artifacts become harder to review and localization drift can enter unnoticed.
- Desired outcome: Non-translation repository artifacts remain English, application translations remain catalog-owned, and intentional identical localized values are explicit and reviewable.
- Tasks: TOOLING-190
- Resolution: CSpell now owns the repository spelling gate; the translation
  catalogs and generated localization output are excluded, and intentional
  identical localized values are allowlisted by the i18n coverage check. The
  cache-reset spelling run, full lint, typecheck, unit tests, browser suite, and
  production build all pass.

<a id="issue-122"></a>

## [ISSUE-122] Define an operational observability contract

- Type: problem
- Status: resolved
- Evidence: The supplied audit reports health/readiness checks and domain analytics but no accepted metrics, tracing, dashboards, or alert thresholds.
- Impact: Operators may detect failures only after users report them and cannot distinguish backlog, provider, notification, or storage degradation quickly.
- Desired outcome: Supported deployments have a bounded observability contract tied to concrete service-level and recovery goals.
- Tasks: OPS-207
- Resolution: OPS-207 adds an unauthenticated Prometheus scrape endpoint backed
  by the approved Prometheus JavaScript client, with process CPU, memory, and
  uptime measurements plus fixed-cardinality scheduler and worker metrics. No
  user, workspace, project, channel, or provider identifiers are emitted. The
  deployment guide requires network-level restriction of the scrape endpoint.
  Scrape cadence, retention, dashboards, and alert thresholds remain
  deployment-owned; no hosted monitoring service was added.

<a id="issue-123"></a>

## [ISSUE-123] Define production deployment and recovery boundaries

- Type: problem
- Status: resolved
- Evidence: The supplied audit reports a production image and development Mailpit compose file but no complete production orchestration, TLS, backup retention, or restore policy.
- Impact: Operators may deploy a technically runnable image without a supported secure lifecycle for networking, persistence, and recovery.
- Recent revalidation (2026-09-25): The documented Docker `backup --media` and
  `restore --media` commands start the production entrypoint without an env file.
  The entrypoint constructs the complete server configuration before dispatching
  maintenance, and that configuration rejects the image defaults because the
  authentication, signed-media-URL, and publisher-encryption secrets are absent.
  This was reproduced with the production environment values declared by the
  Dockerfile and `createPostbotConfig`; the commands therefore cannot run as
  documented. This finding reopens the operational recovery contract; it does
  not invalidate the historical implementation work below.
- Desired outcome: Supported deployment modes state their network, secret, persistence, retention, upgrade, and restore responsibilities, and the documented backup/restore commands execute successfully against the production image with only the configuration each operation actually needs.
- Tasks: OPS-208, OPS-213
- Previous resolution (OPS-208): The repository documents the supported single-process container,
  health/readiness checks, development-only Mailpit, database/media backup and
  restore commands, runtime locking, and separate publisher-key recovery. Full
  orchestration, TLS termination, and retention remain deployment-owned concerns
  rather than undocumented application behavior.
- Resolution (OPS-213, 2026-09-25): Maintenance commands now parse only the
  database and media-store configuration they need. The local media bundle
  commands run without server secrets; S3 credentials remain validated when S3
  storage is configured. README instructions match this contract, and CI builds
  and starts the production image, backs up, restores, and starts the restored
  database using disposable data.

<a id="issue-125"></a>

## [ISSUE-125] Protect the optional Prometheus scrape endpoint

- Type: problem
- Status: resolved
- Evidence: `GET /metrics` is mounted on the same HTTP server as the public API
  and has no authentication. The deployment guide asks operators to restrict it,
  but the application does not enforce that boundary.
- Impact: A public Postbot deployment can expose process and publication-worker
  activity to unauthenticated callers, and the scrape handler can be repeatedly
  invoked from the public network.
- Desired outcome: Operators can intentionally enable metrics and allow only
  authenticated monitoring scrapes, with clear setup and verification guidance.
- Tasks: OPS-212
- Resolution: `/metrics` is absent by default and requires a dedicated bearer
  token of at least 32 characters when enabled. HTTP tests cover disabled,
  unauthorized, and authenticated scrapes, including changing worker metrics;
  deployment guidance documents configuration and network restrictions.

<a id="issue-128"></a>

## [ISSUE-128] Log unexpected HTTP failures in production by default

- Type: problem
- Status: resolved
- Evidence: Production defaults `LOG_LEVEL` to `silent`, which disables the
  request-logger error hook. The global HTTP error handler returns a generic
  500 response but does not independently log unexpected exceptions.
- Impact: An operator can receive a server error without a corresponding
  diagnostic record, making a self-hosted failure difficult to investigate.
- Desired outcome: Unexpected server failures produce structured, correlated
  and secret-redacted error records in production while successful request
  logging can remain disabled and clients continue to receive generic errors.
- Tasks: OPS-216
- Resolution: Production now defaults to `LOG_LEVEL=error`: successful request
  records remain below the threshold, while unexpected 5xx responses emit one
  structured Pino record with a generated request ID, route template, safe error
  type, and bounded stack frames that omit the exception message. Dynamic route
  values such as signed media tokens are not logged, the generic client error
  response is unchanged, and `LOG_LEVEL=silent` remains an explicit full opt-out.

<a id="issue-129"></a>

## [ISSUE-129] Verify dashboard delivery from the production image

- Type: problem
- Status: resolved
- Evidence: The CI recovery acceptance test now builds and starts the production
  image, checks `/ready`, and exercises backup and restore. It does not request
  the dashboard entry point or verify that its referenced assets are served by
  that image.
- Impact: A healthy API and successful recovery test could still miss a broken
  production static-asset path that prevents users from loading Postbot.
- Desired outcome: CI verifies the production image serves the dashboard shell
  and its built assets, in addition to the existing readiness and recovery
  checks.
- Tasks: OPS-218
- Related issue: ISSUE-123
- Related task: OPS-213
- Resolution (OPS-218, 2026-09-26): The existing production-image acceptance
  command now fetches the root dashboard document, checks its Postbot title and
  application root, discovers its same-origin built asset references, and
  requests each one. It verifies successful responses, non-empty bodies, and
  JavaScript/CSS content types. The check runs against both the initial and
  restored production containers; CI already invokes this command, so no new
  workflow step was needed.
- Verification: The production image served the dashboard shell and all 17
  referenced assets before backup and after restore. Missing-asset and wrong-shell
  behavior are unit tested. See the [OPS-218 worklog](worklogs/2026-09-26-OPS-218.md).

<a id="issue-151"></a>

## [ISSUE-151] Shutdown can report success while its runtime marker remains

- Type: problem
- Status: resolved by OPS-306
- Evidence: On 9e0de695f, an isolated permission-failure probe leaves the marker while release() returns normally. removeLockIfOwned catches unlink errors; the shutdown exception guard therefore does not detect incomplete release. See worklogs/2026-10-04-OPS-305.md.
- Impact: Exit 0 can contradict the documented cleanup contract and a subsequent launch is refused. No automatic deletion is justified.
- Desired outcome: Cleanup success and incomplete cleanup are accurately observable without weakening ownership or stale-marker exclusion.
- Tasks: OPS-306
- Resolution: `release()` now returns whether the marker is gone (removal errors, unreadable content, and foreign tokens report retained without deleting); the shutdown handler maps a retained marker to exit 2 while token ownership, drain-before-cleanup, and the no-automatic-reclaim rule are preserved. Behavioral tests cover release failure, close failure, drain ordering with a pending operation, and the ignored second signal. See worklogs/2026-10-04-OPS-306.md.

<a id="issue-186"></a>

## [ISSUE-186] Serial publication execution and unrenewed claim leases

- Type: problem
- Status: resolved
- Evidence: `createPublicationWorker` in `apps/api/src/modules/workflow/worker.ts` awaits each external effect sequentially across all projects (one job per project per round, rounds repeated until idle), after first awaiting replies and first-comment processing. The default lease is 5 minutes and no code path renews a lease while an effect is running. Expired claims are classified as requeue or ambiguous by `classifyExpiredClaim` during subsequent claims.
- Impact: A slow effect, such as a large video upload or provider processing poll, delays every other due publication in every project, so scheduled times are not met under load. Effects that legitimately exceed the lease duration have undefined or unverified outcomes. They may end up ambiguous, or the completion may be fenced out even though the provider succeeded.
- Desired outcome: Investigate and document the actual behavior when an effect outlives its lease. Then make one slow destination unable to delay unrelated publications beyond a stated bound, keep long effects owned by their claim for their whole duration, and preserve the single-process constraint (ADR-003) and fencing semantics (ADR-009). Any change to execution semantics needs an explicit owner decision.
- Related: ADR-003, ADR-006, ADR-009, ADR-090
- Tasks: WORK-568

- Resolution (2026-10-23): WORK-568 implements owner-approved ADR-090: two shared internal publication/reply/first-comment slots, one effect per project, independent project/family rotation, fresh admission within one second when capacity is available, strict token-fenced renewal and cooperative deadlines. Shutdown drains actual effects; expired ownership cannot be revived or finalized. The original over-lease behavior is documented, and late uncertain outcomes remain ambiguous. 1,567 unit/script tests, all 134 main browser cases with four environmental reruns, two automatic-delivery cases, four SMTP cases and fresh production-container recovery validated. [Evidence](worklogs/2026-10-23-WORK-568.md).

<a id="issue-187"></a>

## [ISSUE-187] Main SQLite connection lacks WAL and busy-timeout configuration

- Type: problem
- Status: resolved
- Evidence: `createDatabase` in `packages/db/src/client.ts`, used by the API runtime, maintenance and migrations, only sets `PRAGMA foreign_keys = ON`. No runtime path sets `journal_mode` or `synchronous`; `busy_timeout` is set only on dedicated backup and local-account-recovery connections. The default rollback journal therefore applies to the main process.
- Impact: Writers block readers (including heavier analytics queries) in the main process. A second connection (CLI, backup, maintenance) can make the main connection fail immediately with `SQLITE_BUSY` instead of waiting. Durability and throughput settings are implicit rather than chosen.
- Desired outcome: The main connection's journal mode, synchronous level and busy timeout are deliberate, documented and covered by tests, and remain compatible with the existing backup, restore, quiescence lock (ADR-068) and container recovery acceptance.
- Related: ADR-005, ADR-068, ADR-089, ISSUE-175
- Tasks: DB-555

- Resolution (2026-10-23): Owner approved WAL, FULL durability and a 5-second busy timeout. DB-555 configures main connections, strictly closes prepared statements and retires old destination WAL through SQLite before either restore mode replaces the database. Concurrent-reader/writer, online snapshot, migration and forced-stop restore tests pass; omitting WAL retirement makes the new tests detect corruption. Static gates, 1,550 unit/script tests, 137 browser/SMTP scenarios and fresh production-container recovery passed. [Evidence](worklogs/2026-10-23-DB-555.md).

