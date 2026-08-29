# SPEC-001 — Herald V1 Scope

- Status: accepted
- Scope: V1 product boundary, validation scenarios, and stop criteria
- Provenance: V1 scope review on 2026-08-28
- Related decisions: [ADR-001](../decisions/ADR-001-separate-channel-from-publisher.md), [ADR-002](../decisions/ADR-002-separate-post-from-publication.md), [ADR-003](../decisions/ADR-003-use-a-single-process-singleton.md), [ADR-005](../decisions/ADR-005-use-sqlite-first-persistence.md), [ADR-006](../decisions/ADR-006-use-a-next-event-durable-scheduler.md), [ADR-007](../decisions/ADR-007-use-a-react-spa-dashboard.md)
- Related tasks: `QUAL-05`, `DOMAIN-06`, `WORK-07`, `MANUAL-08`, `PUB-09`, `OPS-10`
- Superseded by: none

## Intent

This specification defines the cut line for Herald V1. A capability is not part of
V1 unless it is listed as a Must Have or is required to complete one of the exit
scenarios.

## Product hypothesis

We believe a technical self-hoster or small team with both supported and unsupported
publication destinations can replace a split scheduler and manual tracker when every
destination is modeled as a `Channel` and automation is an optional `Publisher`.

The hypothesis is validated when one real project uses Herald as its only publication
source of truth for four consecutive weeks, including at least one automatic channel
and one manual custom channel.

## V1 user and deployment

- One technical operator installs and maintains one self-hosted instance.
- A small number of trusted humans and agents may use that instance.
- One process owns the API, static dashboard, scheduler, worker, and SQLite database.
- Multiple projects are supported, but tenant isolation is not.
- The first workflow is text-first. Media is added only if the selected first
  publisher makes it necessary to test the hypothesis.

## Requirements

### Must Have

| Capability                                             | Why V1 needs it                                                                                                                 |   Risk | Size |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -----: | ---: |
| Projects and channels                                  | The real workflow contains multiple projects and multiple named destinations.                                                   |    Low |    M |
| Custom manual channels                                 | An unsupported destination must exist without a built-in integration or plugin.                                                 | Medium |    M |
| Separate posts and publications                        | One source post must produce independently tracked channel publications.                                                        |   High |    L |
| Manual publication workflow                            | A due publication can request human action and then be explicitly completed or failed.                                          |   High |    L |
| One automatic publisher                                | Optional automation cannot be validated with manual channels alone. The provider is selected through a short feasibility spike. |   High |    L |
| Durable scheduling and execution                       | Scheduled work is persisted, reconstructed after restart, and never depends on an in-memory timer as its source of truth.       |   High |   XL |
| Inspectable failure semantics                          | Retryable failures, terminal failures, and ambiguous external outcomes are distinct and auditable.                              |   High |    L |
| REST API and CLI                                       | Humans, scripts, CI, and agents need a non-UI control surface with structured output.                                           | Medium |    L |
| Minimal dashboard                                      | A human can inspect due work, create or edit essential records, and complete a manual publication.                              | Medium |    L |
| Authentication, project-scoped tokens, and attribution | Human and agent actions must be attributable from the first real workflow.                                                      | Medium |    L |
| Single-process deployment and recovery                 | Installation, health checks, SQLite backup, and restore must be documented and tested.                                          |   High |    L |
| Enforced quality and footprint gates                   | V1 is not complete while checks are placeholders or runtime cost is unknown.                                                    | Medium |    M |

### Should Have

These may enter V1 only after all Must Have exit scenarios pass.

| Capability                      | Trigger                                                                              |   Risk | Size |
| ------------------------------- | ------------------------------------------------------------------------------------ | -----: | ---: |
| Second automatic publisher      | The first publisher proves the interface and a real workflow needs another provider. | Medium |    L |
| Basic calendar view             | List and due-work views become insufficient during real use.                         |    Low |    M |
| Human approval                  | A real agent workflow needs a review gate before publication.                        | Medium |    L |
| External due-work notifications | Operators miss manual work when relying on the dashboard and CLI.                    | Medium |    M |
| Basic media attachments         | The first validated publisher or real workflow cannot be tested with text alone.     |   High |    L |
| Fine-grained token scopes       | Project-scoped read/write/publish permissions prove too broad.                       | Medium |    M |

### Could Have

These require evidence from V1 usage and a separate scope decision.

- MCP wrapping the existing API.
- S3-compatible media storage.
- More advanced roles and approval policies.
- Publication templates and reusable channel defaults.
- Basic delivery analytics derived from publication outcomes.
- Additional backup destinations or managed backup automation.

## Acceptance criteria

V1 is complete only when all scenarios pass through supported product interfaces:

1. An authenticated operator creates a project, an automatic channel, and an
   arbitrary manual channel.
2. A post creates separate publications for both channels while preserving each
   publication's own content, schedule, and state.
3. The manual publication becomes due, is visible through the API, CLI, and
   dashboard, and can be marked published with actor attribution.
4. The automatic publication is executed by the selected publisher and records its
   external result.
5. Restarting the process before, during, and after scheduled work does not lose a
   publication or silently duplicate a known successful operation.
6. An uncertain external outcome is represented as ambiguous and requires explicit
   reconciliation instead of a blind retry.
7. A project-scoped API token can run the intended agent workflow without receiving
   social-network credentials.
8. A clean instance can be restored from the documented application data backup.
9. The full quality gate and the measurements in
   [SPEC-002](SPEC-002-engineering-operating-model.md) pass on the reference
   environment.

## Success and stop criteria

### Product success

- One real project runs for four weeks without a parallel JSON or spreadsheet
  publication tracker.
- The period includes successful automatic and manual publications.
- Every publication outcome and material action is attributable and inspectable.

### Technical success

- Restart and crash-injection tests cover the durable workflow state machine.
- No known path can silently lose, duplicate, or falsely report a publication.
- The deployment stays inside the provisional resource budgets in
  [SPEC-002](SPEC-002-engineering-operating-model.md).
- Backup and restore are exercised, not only documented.

### Stop or reconsider

Pause V1 and reassess the product hypothesis when any of these becomes true:

- `Channel != Publisher` does not remove the parallel source of truth.
- Manual publication remains awkward enough that users keep another tracker.
- A correct restart-safe workflow requires infrastructure incompatible with the
  singleton product target.
- Publisher integration and maintenance cost dominates the product value.
- Herald is not providing a distinct user outcome for the intended workflow.

## Risk register

| Risk                                                                      | Likelihood | Impact | Mitigation                                                                                                 |
| ------------------------------------------------------------------------- | ---------: | -----: | ---------------------------------------------------------------------------------------------------------- |
| External publication succeeds before a process crash records the result   |     Medium |   High | Model ambiguous outcomes explicitly; use provider idempotency when available; test crash points.           |
| The first publisher has paid access, review, or unstable API requirements |       High |   High | Run a time-boxed provider spike before committing to the adapter.                                          |
| The domain model mixes post, publication, job, and approval state         |     Medium |   High | Specify invariants and state transitions as executable tests before building a large UI.                   |
| SQLite write contention or locking is worse than expected                 |        Low |   High | Keep transactions short; add concurrent integration tests and measure before considering another database. |
| Elysia 2 beta changes under the project                                   |     Medium | Medium | Pin exact versions, use official migration notes, and isolate transport code in `apps/api`.                |
| Resource usage grows unnoticed through dependencies or assets             |     Medium |   High | Record a reference baseline and require deltas for runtime-affecting changes.                              |
| Strict checks exist in name but execute placeholders                      | High today |   High | Make the quality harness the first implementation milestone and reject fake or skipped checks.             |
| Scope expands toward a full content suite                                 |       High |   High | Apply the Must Have cut line and require evidence plus a scope revision for additions.                     |

## Out of scope

- Redis, Temporal, Elasticsearch, microservices, multiple workers, or horizontal
  scaling.
- PostgreSQL support or a runtime-selectable database abstraction.
- A plugin marketplace, dynamic third-party code loading, or a universal publisher
  description language.
- Billing, organizations, agency tenancy, quotas, or plans.
- Embedded generative AI, content ideation, image or video editing, social inbox,
  CRM, or advanced analytics.
- Desktop and mobile applications.
- Every social provider.

## SQLite-first storage requirement

SQLite through Drizzle and `bun:sqlite` is the only supported V1 database. Herald
does not add a universal database adapter, duplicate schemas, runtime dialect
selection, or cross-database contract suite in anticipation of PostgreSQL.

The future change cost is contained through ordinary boundaries:

- `packages/core` owns domain terms and invariants and does not expose Drizzle rows,
  query builders, or SQLite handles;
- `packages/db` owns schema, migrations, SQL, transaction details, and SQLite-specific
  tuning;
- use-case code asks for the small persistence operations it actually needs; an
  interface is introduced only when it creates a real test or implementation seam;
- portable SQL is preferred when it is equally clear and efficient, but SQLite
  capabilities may be used when they materially improve correctness or performance.

PostgreSQL is reconsidered only after measured evidence such as sustained write
contention, a required multi-instance deployment, managed-database operational
requirements, or unacceptable backup and availability constraints. At that point a
second persistence implementation or a focused rewrite of `packages/db` is allowed.
