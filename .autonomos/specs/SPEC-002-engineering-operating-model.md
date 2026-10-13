# SPEC-002 — Engineering Operating Model

- Status: accepted
- Scope: Continuous delivery loop, quality gate, footprint gate, milestone order, and Git review discipline
- Provenance: V1 engineering review on 2026-08-28
- Related specs: [SPEC-005](SPEC-005-continuous-product-scope.md), [SPEC-003](SPEC-003-product-foundation.md)
- Related decisions: [ADR-003](../decisions/ADR-003-use-a-single-process-singleton.md), [ADR-004](../decisions/ADR-004-use-bun-and-typescript.md), [ADR-005](../decisions/ADR-005-use-sqlite-first-persistence.md), [ADR-006](../decisions/ADR-006-use-a-next-event-durable-scheduler.md), [ADR-007](../decisions/ADR-007-use-a-react-spa-dashboard.md)
- Superseded by: none

## Intent

Postbot optimizes for durable progress: each change should complete the product and
architectural boundary required for its outcome. Speed is useful only when `main`
remains understandable,
releasable, and cheap to operate.

There is no V1 or MVP release cut. Milestones below sequence risk and evidence; they
are not permission to build temporary substitutes for known product foundations.

## Delivery loop

Every task follows the same six-stage loop.

### 1. Frame

- Link the work to one Autonomos task and one durable product or architectural outcome.
- State acceptance criteria and the user-visible or architectural result.
- Identify the highest-risk assumption; do not begin with low-risk polish.
- Reject additions that do not help describe, prepare, schedule, execute, or audit
  a publication to a channel.

### 2. Verify the knowledge surface

- Read the applicable `AGENT.md` chain and relevant accepted specifications and
  decisions.
- Check current official documentation and package versions for affected tools.
- Find or update a focused agent skill when it materially reduces implementation
  uncertainty.
- Record relevant version or migration evidence in the task worklog.

### 3. Decide deliberately

For a consequential decision, compare the smallest credible alternatives against:

1. Current product need and product coherence;
2. correctness, data-loss, and security risk;
3. runtime, bundle, image, and operational footprint;
4. implementation and maintenance cost;
5. reversibility and migration cost;
6. development experience and ecosystem maturity.

A decision record is expected when a change affects deployment shape, durable
workflow semantics, data ownership, security boundaries, public API compatibility,
or introduces a runtime service. Implementation details do not need a decision
record. Accepted decisions are revisited only when evidence invalidates an
assumption.

### 4. Build one thin vertical slice

- Prefer one complete path through domain, persistence, application service,
  transport, and the smallest required client surface.
- Keep business behavior out of HTTP handlers and UI components.
- Add no generic interface until a second implementation or a useful test seam is
  concrete.
- Keep commits and pull requests focused enough to review without hidden context;
  reviewability must not be achieved by omitting required foundations.

### 5. Prove and measure

- Add tests at the lowest layer that can prove the behavior.
- Run the full quality gate before commit and before merge.
- Measure the relevant footprint delta when dependencies, server startup, web
  assets, persistence, or deployment packaging change.
- Treat an unexplained correctness or resource regression as a blocker.

### 6. Review and crystallize

- Review the diff for scope drift, error handling, security, failure recovery, and
  resource cost.
- Update operational documentation and Autonomos state.
- Write a concise Conventional Commit that describes one logical change.
- Use a short-lived branch and pull request; merge only with green required checks.

## Stop conditions

Stop implementation and surface the issue when any of the following is true:

- publication state or ownership is ambiguous;
- a crash path could lose or duplicate an external effect without being observable;
- the change needs a new service, universal abstraction, or V1 scope expansion;
- tests require unrealistic mocks because the design has no usable boundary;
- a framework beta or provider API behavior cannot be confirmed from authoritative
  sources;
- a quality check is skipped, weakened, or replaced by a placeholder;
- a footprint regression has no measured explanation;
- credentials, authorization, backup, or migration safety is uncertain.

A blocker is useful information. It must be recorded with evidence and a proposed
decision, not hidden behind a fallback that changes semantics.

## Quality gate

The merge gate is one command once the quality-foundation milestone is complete:

```sh
bun run check
```

It must execute, in a deterministic order:

1. formatting verification;
2. lint with warnings denied;
3. strict TypeScript checking;
4. unit and integration tests;
5. production builds.

CI runs the same gate with a frozen lockfile. A green script that only prints “no
tests yet” is not a test gate. Skipped or todo tests require a linked issue and may
not cover a V1-critical path.

### Test responsibilities

| Layer              | What it proves                                                                     | Typical subjects                                                                       |
| ------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Unit               | Pure invariants and deterministic transitions                                      | post/publication separation, state machine, scheduling decisions, retry classification |
| SQLite integration | Real schema, queries, constraints, and transactions                                | migrations, repositories, claims, recovery, concurrent writes                          |
| API integration    | Transport contracts and auth boundaries without a network dependency when possible | validation, status codes, token scope, error shape                                     |
| Publisher contract | Every adapter obeys common behavior while preserving provider truth                | capability checks, idempotency, result mapping, retryability                           |
| End to end         | Only the few V1 exit journeys that cross the built product                         | manual publication, scheduled automatic publication, backup/restore                    |

Tests use temporary databases, controlled clocks, and fake provider servers. Network
access to real providers belongs in explicit opt-in smoke tests, never the default
gate. Coverage is reported once meaningful business code exists, but a global
percentage is not a substitute for critical-path tests. After the first baseline,
coverage may not regress silently and critical state transitions must be fully
exercised.

## Footprint gate

Measurements use a documented Linux amd64 reference environment and fixed fixture
data. The exact command, Bun version, build mode, sample duration, and result are
kept with milestone evidence so numbers remain comparable.

| Metric                                       | When measured                          |                                   Initial V1 budget |
| -------------------------------------------- | -------------------------------------- | --------------------------------------------------: |
| Idle resident memory after warm-up           | Runtime-affecting server change        |    target at or below 150 MiB; hard ceiling 250 MiB |
| Peak resident memory for one publication job | Scheduler, worker, or publisher change |      baseline in M2, then no unexplained regression |
| Cold start to healthy                        | Runtime or startup change              |      baseline in M0, then no unexplained regression |
| API production artifact                      | Server dependency or bundling change   |                           target at or below 15 MiB |
| Initial web JavaScript, gzip                 | Web dependency or routing change       |                          target at or below 180 KiB |
| Compressed production OCI image              | Packaging or runtime dependency change |          target below 100 MiB; hard ceiling 150 MiB |
| Runtime process and service count            | Deployment change                      | one Postbot process, zero required external services |

The budgets are provisional guardrails, not marketing claims. M0 records the first
reproducible baseline; M5 validates the production image. A budget may change only
with measured evidence and an explicit trade-off. Every runtime dependency must earn
its footprint and maintenance cost.

## Risk-first milestones

### M0 — Trustworthy engineering loop

- Replace every placeholder test script with real Bun test execution.
- Add valuable foundation tests for API, database migrations, and authentication.
- Make the local and CI quality gates identical.
- Record the first reproducible build, web bundle, startup, and idle-memory baseline.

### M1 — Executable domain model

- Define Project, Channel, Post, Publication, Publisher, Job, and Actor invariants.
- Model manual channels without a fake `ManualPublisher`.
- Prove transitions in unit tests before exposing a large API or UI.
- Add the minimal migrated SQLite schema and integration tests.

### M2 — Durable workflow proof

- Persist jobs and arm only the next-event timer.
- Reconstruct scheduling state after restart.
- Test claims, retries, cancellation, crash points, and ambiguous outcomes.
- Do not integrate a real publisher until the execution state machine is credible.

### M3 — Manual vertical slice

- Create and inspect projects, channels, posts, and publications through the REST API.
- Add scriptable CLI JSON output.
- Show due manual work and complete it through the minimal dashboard.
- Persist actor attribution and audit events.

### M4 — One automatic publisher

- Time-box selection and feasibility of one production-relevant provider.
- Implement the common publisher contract and one adapter.
- Exercise real provider behavior in opt-in smoke tests and deterministic contract
  tests in the default gate.
- Complete the automatic publication workflow with its durable contract and failure
  evidence.

### M5 — Operable initial deployment

- Complete Better Auth and project-scoped API token flows.
- Serve the production dashboard from the Elysia process.
- Produce the minimal production image and document install, health, backup, restore,
  and upgrade procedures.
- Run the four-week real-workflow validation without a parallel tracker.

Milestones are ordered by risk, not visual completeness. Each milestone may be split
into multiple small tasks and pull requests, but it is complete only when its
evidence and checks are reproducible.

## Git and review requirements

- Branch from green `main` with an intent name such as `feat/...`, `fix/...`,
  `docs/...`, or `chore/...`.
- Use one logical change per pull request and link the Autonomos task and relevant
  issue, specification, or decision.
- Use Conventional Commits with an imperative subject and a short body only when the
  rationale is not obvious from the diff.
- Do not mix dependency updates, formatting sweeps, refactors, and product behavior.
- Update short-lived branches before merge according to the hosting policy; never
  bypass required checks.
- Squash merge is the provisional default for a clean public history.
- Delete merged branches and keep unrelated local changes out of commits.

## Out of scope

- A global coverage percentage without meaningful critical-path tests.
- Mandatory external provider access in the default test gate.
- Architecture records for trivial implementation details.
- Infrastructure or abstractions justified only by hypothetical future use.
