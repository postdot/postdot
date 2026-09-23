# Reliability, data, and operations

Reference: `main@60bbb319`.

## H-03 — P1 — The publication list becomes incomplete beyond 100 items

[The publication reader](/home/hakim/projects/herald/packages/db/src/manual-store/publication-read-store.ts:302) passes a fixed limit of 100 to the SQL query. [The route](/home/hakim/projects/herald/apps/api/src/modules/projects/publication-routes.ts:33) exposes an array without a cursor or continuation indicator. [The client](/home/hakim/projects/herald/apps/web/src/lib/api.ts:946) has no pagination. [The project context](/home/hakim/projects/herald/apps/web/src/lib/dashboard-context.tsx:44) treats this result as the project's full publication set.

**Reproduction.** Create 101 publications in a fictional project: the database contains 101, the route returns 100, and the only response key is `publications`.

**Consequence.** The Queue, filters, and calendar work on a subset. The query sorts first by whether a date exists, then by ascending date: old history can occupy the window before future publications. An item can remain reachable by ID; no data deletion is demonstrated. The defect is silent view incompleteness and the absence of a standard path to the next page.

**Correction to prepare.** Define a stable paginated read for the Queue, server-side filters, and a time-range read for the calendar. Return continuation metadata explicitly. Simply removing the limit would move the resource problem and would not fix the contract.

**Acceptance.** Cover 101, 1,000, and several thousand publications, including published history, undated drafts, and future publications. Every result matching a filter must remain reachable, counters must have an explicit scope, and the calendar must cover the selected period independently of project age.

## H-04 — P2 — Notification projection can abandon durable backlog

[The runtime](/home/hakim/projects/herald/apps/api/src/modules/notifications/runtime.ts:43) processes at most ten batches per project, then resets its state to `started` even when `hasMore` remains true. [The store](/home/hakim/projects/herald/packages/db/src/notification-store.ts:17) uses 100 events per batch by default. [Production composition](/home/hakim/projects/herald/apps/api/src/index.ts:106) creates the runtime without a recovery interval; other runs are triggered by a post-commit signal.

**Runtime-level reproduction.** A control store reports that twelve batches are required. After `start()` and the microtask run, only ten calls occur and the state is `started`. No follow-up processing is scheduled. This is a deterministic projection-scheduler reproduction, not a production load measurement.

**Affected scenario.** Catch-up after interruption, rebuilding a projection, or backlog above 1,000 events can leave the end of the journal unprojected until a new signal or restart. The journal keeps the facts; the issue concerns notification availability. [Readiness](/home/hakim/projects/herald/apps/api/src/modules/health/routes.ts:121) treats `started` as active and does not detect the backlog.

**Correction to prepare.** Keep batches bounded but schedule their continuation while work remains. Provide retry after transient failure and a lag indicator distinct from runtime existence. Avoid an unbounded synchronous loop that would block the API.

**Acceptance.** Process more than ten batches to completion without a new commit, recover after a transient error, project with no SSE subscribers, and shut down cleanly during catch-up.

## H-06 — P2 — Cleanup can delete source migrations

[The DB package `clean` script](/home/hakim/projects/herald/packages/db/package.json:19) contains `rimraf dist .turbo drizzle`. The `drizzle` directory contains SQL migrations and metadata tracked in Git. [The root command](/home/hakim/projects/herald/package.json:25) invokes `turbo clean`.

A build-output cleanup command therefore also removes an asset required for startup and packaging. Git can restore committed files, but not necessarily an uncommitted local migration. The destructive command was not run during this audit.

**Correction to prepare.** Limit cleanup to disposable outputs. Reserve migration-history reset for a separate, explicitly named and documented operation. Verify in a disposable copy that cleanup leaves migrations intact and that a clean install and startup still work.

## Strong points

[The durable workflow](/home/hakim/projects/herald/packages/db/src/workflow-store.ts) distinguishes claim, effect start, and result. Claims are protected by a token; recovery distinguishes work that never started from an effect that may have been committed. This does not guarantee “exactly once” at an external provider, but it avoids claiming that guarantee. Workflow and provider-conformance suites cover failures, retries, and ambiguous outcomes.

[Backups](/home/hakim/projects/herald/packages/db/src/backup.ts) combine the database, manifest, checksums, and media bytes, with protection against physical deletion during the copy. [The runtime quiescence lock](/home/hakim/projects/herald/packages/db/src/runtime-quiescence.ts) blocks concurrent restores in the nominal runtime path. Separation between the encryption key and bundle is documented. These choices address real risks.

The recent migration-history reset is explicitly allowed for a private application with disposable development data. It is therefore not, by itself, an error. Before important data is retained long term, that assumption must end and schema migrations must be tested against populated databases.

## Risks to investigate, not reproduced incidents

**Graceful shutdown.** [Server shutdown](/home/hakim/projects/herald/apps/api/src/index.ts:230) calls `worker.stop()`, then closes the app and database. [The scheduler](/home/hakim/projects/herald/packages/core/src/scheduler.ts:107) stops timers without exposing a wait for the current asynchronous effect. The worker has no drain method. A provider success during shutdown may therefore fail to be recorded as it would during a controlled stop. Crash handling limits duplication risk but can require avoidable reconciliation. Evidence is missing for shutdown during a delayed provider call, including lock release; no real runtime crash was triggered here.

**Availability after forced stop.** The lock marker intentionally remains after a hard kill and requires operator verification. This is a documented conservative choice, not a hidden bug. It does make autonomous recovery after OOM or machine restart incomplete. Either accept this cost or design another proof of lock ownership before promising automatic restart.

**Scheduling fairness across projects.** [The worker](/home/hakim/projects/herald/apps/api/src/modules/workflow/worker.ts:97) processes projects sequentially and exhausts one project's work before moving to the next. A slow destination can delay others. Measure lag and batch duration before considering concurrency, round-robin scheduling, or quotas. This audit alone does not justify adding workers.
