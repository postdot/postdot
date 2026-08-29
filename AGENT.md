---
name: "herald"
type: "project"
status: "active"
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
- **Protocol:** Follow `.autonomos/PROTOCOL.md` and the installed harness workflows. Keep task state in `.autonomos/TASKS.md` and session evidence in `.autonomos/worklogs/`.
- **Tooling:** Prefer the `@tala-tools/*` packages already used by the surrounding projects; improve a shared tool when a missing capability belongs there.
- **IDE workspace:** Update `herald.code-workspace` in the same change whenever an app or package under `apps/*` or `packages/*` is added, removed, or renamed.
- **Repository hygiene:** Treat user conversations, personal context, and one-off analysis as private by default. Track only durable, implementation-relevant, public-ready guidance. Comparative research is allowed only when it is deliberately scoped to a repository artifact.

## 🏗 Stack & Architecture

- **Tech:** Bun, Turborepo, TypeScript, Elysia 2 beta (API), Drizzle ORM with Bun SQLite, Better Auth, React 19, TanStack Router, Vite, Tailwind CSS, shadcn/ui with Base UI, Solar Icons React v2 (Linear)
- **Patterns:** A single process for API, static dashboard, scheduler, and worker; framework-independent domain logic in `packages/core`.

## 📁 Key Directories

| Path | Description |
|------|-------------|
| `apps/api/` | Elysia API process |
| `apps/web/` | React 19 + TanStack Router Vite SPA |
| `packages/core/` | Framework-independent domain model |
| `packages/db/` | Drizzle schema, Bun SQLite client, and migrations |
| `packages/auth/` | Better Auth configuration and database adapter boundary |
| `.autonomos/specs/` | Draft and accepted product or engineering target state |
| `.autonomos/decisions/` | Proposed and accepted technical decision records |
| `.autonomos/` | Agent Protocol files, task board, and worklogs |

## ⚠️ Known Constraints

- Do not add Redis, Temporal, Elasticsearch, microservices, multiple workers, or horizontal scaling without a demonstrated need.
- Preserve the distinctions `Post` / `Publication` and `Channel` / optional `Publisher`; a manual channel is a normal channel without a publisher.
- Avoid universal database and plugin abstractions until a real boundary requires them.
- Do not accept placeholder, skipped, or weakened checks on a V1-critical path; consult `.autonomos/specs/SPEC-002-engineering-operating-model.md` for the proposed risk-first milestone order.
