---
name: 'postdot'
type: 'project'
status: 'active'
---

# AGENT CONTEXT: Postdot

## 🧠 Context & Objectives

Postdot is a lightweight, self-hosted orchestrator for multichannel publications.
It provides one source of truth for automated and manual destinations. It does not
replace project-specific communications repositories or act as an embedded AI
content generator.

- **Licensing:** Original Postdot code is AGPL-3.0-only with minimal third-party attribution; follow [ADR-086](.autonomos/decisions/ADR-086-agpl-only-distribution.md) for license review and distribution scope.
- **Naming, hosting, provider access, and publication scope:** Follow [SPEC-005](.autonomos/specs/SPEC-005-continuous-product-scope.md) for the Postdot naming/legacy-prefix boundary, `apps/docs` static hosting, self-hosted provider-access documentation, public readiness, publication history preservation, and repository hygiene.

## ⚙️ Workflow & Preferences

- **Commits:** Conventional Commits
- **Language:** English
- **Repository language:** Keep code, comments, documentation, Autonomos artifacts,
  and test descriptions in English. French is allowed only in application
  translation catalogs and generated localization output; run the CSpell
  repository spelling gate when adding text.
- **Protocol:** Follow `.autonomos/PROTOCOL.md` and the installed harness workflows. Keep task state in `.autonomos/TASKS.md` and session evidence in `.autonomos/worklogs/`.
- **Handoff:** End every completed pass with a concrete recommended next task, or explicitly state that no next task was identified so the owner can plan another sprint.
- **Validation, integration cadence, and testing:** Follow [ADR-077](.autonomos/decisions/ADR-077-two-validation-obligations.md) for local integration into `main`, proportionate validation, browser modes (`/editor-lab` vs `POSTDOT_E2E_PRODUCTION_WEB=true`), documentation-only changes, flake investigation, and evolving test assertions.
- **Engineering operating model, batching, dependencies, parallel agents, and decision discipline:** Follow [SPEC-002](.autonomos/specs/SPEC-002-engineering-operating-model.md) for work batching, prerelease/Bun dependency maintenance, `postdot.code-workspace` and `Dockerfile` manifest updates, the Parallel Agent Protocol (work directly in parent unless delegated, canonical checkout on `main`, isolated worktree dependencies), and decision discipline.
- **Public documentation:** Use `.agents/skills/postdot-writing/SKILL.md` for authored reader-facing documentation. Use `.agents/skills/postdot-fumadocs/SKILL.md` when changing its MDX presentation, navigation or generation. These project skills coordinate the installed writing skills; routine worklogs and generated endpoint files are not prose-rewrite targets. Public documentation is authored only under `apps/docs/content/docs/`; do not recreate a root `docs/` tree in parallel. Keep development state in Autonomos and distribution notices in root `licenses/`. Treat archived material as dated evidence, not current authority.
- **Design:** Read the root `DESIGN.md` before changing a user-facing surface; keep unresolved visual findings in `.autonomos/worklogs/` and promote only owner-accepted rules.
- **Experience standard (owner, 2026-10-28):** Journeys, navigation, scope changes, page width and wayfinding follow `.autonomos/specs/SPEC-010-web-experience-standard.md`; review them with `postdot-experience-review` and cite rule identifiers. Postdot's governing values are intuitiveness, modernity, performance and completeness; take initiative when you can name the value that motivates it, and report the trade-off when values conflict.
- **Tooling:** Prefer the `@tala-tools/*` packages already used by the surrounding projects; improve a shared tool when a missing capability belongs there.
- **Skills maintenance:** Periodically refresh installed skills with `npx skills update`, review the resulting changes, and use the Solar catalog when choosing icons rather than guessing glyph names.

## 🏗 Stack & Architecture

- **Tech:** Bun, Turborepo, TypeScript, Elysia 2 beta (API), Bun SQLite or PostgreSQL behind Postdot's persistence port, Better Auth, React 19, TanStack Router, Vite, Tailwind CSS, shadcn/ui with Base UI, Host Grotesk, and Solar Icons React v2 Linear
- **Patterns:** The integrated deployment serves API, Studio, scheduler and worker; optional database topology follows ADR-097. [ADR-098](.autonomos/decisions/ADR-098-optional-studio-and-client-authentication.md) governs optional Studio serving and client authentication boundaries. Domain logic stays in `packages/core`.
- **Authentication boundary:** Better Auth authenticates people into Postdot and currently uses email/password only. OAuth belongs exclusively to publisher-channel connections unless a later accepted decision explicitly changes the application-authentication strategy.
- **Publisher ownership:** Workspace-owned channels, profiles, publishers, connections and credentials with explicit project attachments per [ADR-095](.autonomos/decisions/ADR-095-workspace-channels-and-project-attachments.md) and [SPEC-009](.autonomos/specs/SPEC-009-shared-channel-workflows.md); every new project belongs to a workspace, and connecting actors provide audit attribution rather than personal secret ownership.

## 📁 Key Directories

| Path                    | Description                                                |
| ----------------------- | ---------------------------------------------------------- |
| `apps/api/`             | Elysia API process                                         |
| `apps/web/`             | React 19 + TanStack Router Vite SPA                        |
| `packages/core/`        | Framework-independent domain model                         |
| `packages/db/`          | Persistence port, SQLite/PostgreSQL adapters, migrations   |
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
