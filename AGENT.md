---
name: 'herald'
type: 'project'
status: 'active'
---

# AGENT CONTEXT: Herald

## 🧠 Context & Objectives

Herald is a lightweight, self-hosted orchestrator for multichannel publications.
It provides one source of truth for automated and manual destinations. It does not
replace project-specific communications repositories or act as an embedded AI
content generator.

## ⚙️ Workflow & Preferences

- **Commits:** Conventional Commits
- **Language:** English
- **Repository language:** Keep code, comments, documentation, Autonomos artifacts,
  and test descriptions in English. French is allowed only in application
  translation catalogs and generated localization output; run the CSpell
  repository spelling gate when adding text.
- **Protocol:** Follow `.autonomos/PROTOCOL.md` and the installed harness workflows. Keep task state in `.autonomos/TASKS.md` and session evidence in `.autonomos/worklogs/`.
- **Design:** Read the root `DESIGN.md` before changing a user-facing surface; keep unresolved visual findings in `.autonomos/worklogs/` and promote only owner-accepted rules.
- **Tooling:** Prefer the `@tala-tools/*` packages already used by the surrounding projects; improve a shared tool when a missing capability belongs there.
- **IDE workspace:** Update `herald.code-workspace` in the same change whenever an app or package under `apps/*` or `packages/*` is added, removed, or renamed.
- **Container inputs:** Update the manifest-only workspace `COPY` list in `Dockerfile` whenever an app or package is added, removed, or renamed, then validate a fresh production image build.
- **Repository hygiene:** Treat user conversations, personal context, and one-off analysis as private by default. Track only durable, implementation-relevant, public-ready guidance. Comparative research is allowed only when it is deliberately scoped to a repository artifact.

### Parallel Agent Protocol (Operational policy)

- The orchestrator owns the canonical checkout, shared development servers, live browser validation, external-provider actions, integration, pull-request decisions, merges, branch deletion, and advancement of `main`.
- Before dispatch, each mission records its Autonomos task ID, base commit, worktree and branch, semantic ownership, allowed paths, forbidden paths and resources, acceptance criteria, permitted checks, stop condition, report format, and cleanup owner.
- Shared governance files and hotspots—including `.autonomos/`, root configuration, lockfiles, migrations, central dispatch code, and integration metadata—are reserved for one owner at a time; file-level separation alone does not make two missions independent.
- Implementation workers run in dedicated Codex-managed Git worktrees with explicitly scoped missions. They may inspect the repository, change only their assigned scope, run named deterministic checks that do not require shared services, commit their own branch when implementation is requested, and report evidence. They must not merge, modify `main`, start shared development servers, use real provider credentials, or trigger external side effects.
- Review workers are read-only by default. They receive only the context needed for the review and return findings with severity, evidence, and file references. Findings become implementation work only after orchestrator triage.
- Safe worker checks are limited to read-only inspection and explicitly isolated package-local format, lint, typecheck, and unit/integration checks. Browser and E2E runs, development servers, restore/backup operations, container validation, real-provider validation, external network calls, default shared ports, default database/media paths, and commands that delete shared or fixed temporary paths belong to the orchestrator.
- Parallel missions require non-overlapping semantic ownership and explicit acceptance criteria. The orchestrator updates each contribution against the current canonical head, integrates one mission at a time, runs the complete gate, then updates Autonomos tracking and cleans up the worktree and branch.
- Worktrees do not receive secrets by default. Any runtime work must use isolated ports, database files, and media roots; ignored credential files remain outside worktrees unless explicitly required and approved.
- The orchestrator must not dispatch Sol-high reviews. If an internal independent review is explicitly justified, prefer a short, bounded Luna-max mission with a neutral prompt; the reviewer may recommend changes but cannot edit, merge, or authorize external effects.
- A delegated mission is not accepted as controlled merely because a tool returned an identifier. Before using an app-managed worktree path as the default, the orchestrator must record and verify a durable mission ID, dispatch/running/final status snapshots, an operator-visible handle, worker attribution, an acknowledged interruption path, and deterministic cleanup evidence. A preparation or client-side identifier is not sufficient.
- Interruption is a request, not proof of cancellation. The orchestrator must wait for a terminal status, record whether the worker stopped or completed concurrently, and close the agent only after that status is observable. A terminal report labelled interrupted but exposed as completed remains an ambiguity and does not satisfy cancellation acceptance.
- The `multi_agent_v1` control plane may expose an orchestrator-side agent ID without making the agent visible in the Codex task list. Do not promise operator visibility from that ID alone; use the explicit-worktree fallback whenever the operator-facing handle or lifecycle evidence is missing.
- If a worktree-task control path does not provide a durable task identity and observable status, the orchestrator uses an explicit-worktree fallback and records the sub-agent identity, status snapshots, base commit, worktree path, branch, scope, checks, result, and cleanup evidence. The fallback must not claim that the app-managed task path itself is observable or controllable.
- `META-61` validated the complete implementation-to-review-to-cleanup lifecycle with the explicit-worktree fallback and a bounded product change. These rules are operational for that fallback. The app-managed task-control path remains gated by `META-62` until identity, status, cancellation, attribution, visibility, and cleanup are proven end to end.

### Decision Discipline

- Autonomy authorizes execution within accepted boundaries; it does not authorize silent decisions about product scope, architecture, data ownership, security, lifecycle semantics, or public contracts.
- Before a consequential decision, state the problem, assumptions, credible alternatives, trade-offs, reversibility, and supporting evidence. Stop for explicit project-governance approval when more than one credible direction remains.
- Do not confuse a dependency's technical capability with ownership of a domain responsibility.
- Existing code and effort are not evidence that a direction should be preserved. Discard or revise work when its foundation is unsound.
- Optimize for durable progress and solutions expected to remain, not for local speed, the smallest immediate diff, or the least code written.
- Never conceal structural uncertainty behind a temporary fallback on a critical path. Make the ambiguity visible and resolve it before implementation continues.

## 🏗 Stack & Architecture

- **Tech:** Bun, Turborepo, TypeScript, Elysia 2 beta (API), Drizzle ORM with Bun SQLite, Better Auth, React 19, TanStack Router, Vite, Tailwind CSS, shadcn/ui with Base UI, Recursive Variable, and Solar Icons React v2 Linear
- **Patterns:** A single process for API, static dashboard, scheduler, and worker; framework-independent domain logic in `packages/core`.
- **Authentication boundary:** Better Auth authenticates people into Herald and currently uses email/password only. OAuth belongs exclusively to publisher-channel connections unless a later accepted decision explicitly changes the application-authentication strategy.
- **Publisher ownership:** Channel connections and their credentials belong to a project. The actor who connects one is audit attribution, not its owner; actor departure or account deletion does not revoke the project connection.

## 📁 Key Directories

| Path                    | Description                                                |
| ----------------------- | ---------------------------------------------------------- |
| `apps/api/`             | Elysia API process                                         |
| `apps/web/`             | React 19 + TanStack Router Vite SPA                        |
| `packages/core/`        | Framework-independent domain model                         |
| `packages/db/`          | Drizzle schema, Bun SQLite client, and migrations          |
| `packages/media/`       | Narrow object-storage contract and Bun local/S3 adapters   |
| `packages/auth/`        | Better Auth configuration and database adapter boundary    |
| `packages/oauth/`       | OAuth protocol mechanics for publisher-channel connections |
| `.autonomos/specs/`     | Draft and accepted product or engineering target state     |
| `.autonomos/decisions/` | Proposed and accepted technical decision records           |
| `.autonomos/`           | Agent Protocol files, task board, and worklogs             |

## ⚠️ Known Constraints

- Do not add Redis, Temporal, Elasticsearch, microservices, multiple workers, or horizontal scaling without a demonstrated need.
- Preserve the distinctions `Post` / `Publication` and `Channel` / optional `Publisher`; a manual channel is a normal channel without a publisher.
- Avoid universal database and plugin abstractions until a real boundary requires them.
- Do not accept placeholder, skipped, or weakened checks on a product-critical path; consult `.autonomos/specs/SPEC-002-engineering-operating-model.md` for the risk-first milestone order.
