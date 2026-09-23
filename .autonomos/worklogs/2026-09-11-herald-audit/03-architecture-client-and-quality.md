# Architecture, client, and quality

Reference: `main@60bbb319`.

## The overall structure is defensible

The product is a modular monolith, not an artificial collection of distributed services. Core owns shared concepts and contracts; provider packages own external differences; the DB package owns transactions and durable writes; the API composes adapters and routes; the web client uses the same domain operations as the CLI.

Keeping domain transactions close to SQL is reasonable. Moving them systematically into a “pure” abstract service would not automatically improve the design: atomicity, optimistic concurrency, and revision constraints must remain visible. However, a store receiving `subjectId` without an explicit permission contract makes H-01 more likely. Attribution and authorization need a clearer separation.

## H-05 — P2 — Taxonomy changes do not invalidate other clients

[The taxonomy store](/home/hakim/projects/herald/packages/db/src/taxonomy-store.ts:835) writes `publication.tags_replaced` to the journal and signals the commit. It also emits `project_tag.created`, `renamed`, `archived`, and `restored`. These types do not exist in [the server SSE table](/home/hakim/projects/herald/apps/api/src/modules/projects/realtime-routes.ts:17) or [the browser allowlist](/home/hakim/projects/herald/apps/web/src/lib/project-realtime.tsx:13).

The transformation of a version-1 `publication.tags_replaced` event with a publication subject returns `null`. The journal therefore contains the change, but a remote client receives no signal. The data context uses `staleTime: Infinity`, with no refetch on focus or network reconnect; it depends on the SSE bridge or a local action to refresh.

**Consequence.** In another tab or session, tags and filters can remain stale after a successful operation. Another supported event, an SSE reconnect, or a reload can hide the defect. The reproduction covers the delivery contract; a two-browser scenario was not added to the repository tests during this audit.

**Correction to prepare.** Connect every visible mutation to an explicit invalidation contract and test. Share event types between server and client or verify them automatically. Check taxonomy events, preferences, and recipient-specific notification state; do not assume that a journal row is automatically delivered.

## H-07 — P2 — The full check omits eight script tests

[The root package](/home/hakim/projects/herald/package.json:18) defines `test:unit` as `turbo test`. The graph contains the 17 workspaces, not root tests under `scripts/`. `test:e2e` does not execute them either. CI calls the same `bun run check`.

[CLI tests](/home/hakim/projects/herald/scripts/herald.test.ts) cover session/project-key selection and token handling. [E2E runtime-isolation tests](/home/hakim/projects/herald/scripts/e2e-runtime.test.ts) cover directories, ports, and reuse of the parent runtime. The eight tests pass with `bun test scripts`, but their success is not required by the standard gate.

**Correction to prepare.** Add them to the gate and keep a simple inventory of required test families. The acceptance test should show that a deliberate regression in this family fails in the standard check of a disposable copy.

## Test quality: real, but concentrated on known journeys

The forced run reports 566 tests across 17 workspaces. Many cover revisions, invalid states, ambiguity, media, or provider boundaries. They are not placeholder commands. The 16 Playwright scenarios also cover media, access management, empty/populated states, recovery, and real-time behavior.

However, [the existing role test](/home/hakim/projects/herald/apps/api/src/app.test.ts:1582) checks viewer denial for timezone changes and token restrictions, but does not prove denial of channel or post writes. The gap is not “more tests” in general: it is cross-cutting tests derived from permissions and invariants rather than only from each task's scope.

The browser run before branch cleanup failed while waiting for a “Project invitation” title. On `main`, the full check passed. The earlier failure is retained as a verification observation, not presented as a stable `main` product bug or assigned to a cause without evidence.

## Maintenance cost and client consistency

| Scope, excluding tests and generated code | TS/TSX files | Lines |
| --- | ---: | ---: |
| API | 66 | 15,420 |
| Web | 92 | 17,418 |
| DB | 46 | 23,530 |
| Core | 21 | 6,013 |

These are size measurements, not quality scores. The analytics store is close to 2,000 lines, the media store 1,661, and the publication editor 803. Previous manual-store extractions are useful, but more splitting without clarifying contracts would not prevent the observed defects.

**Global loading.** [The project context](/home/hakim/projects/herald/apps/web/src/lib/dashboard-context.tsx:44) loads five resources together. [The SSE bridge](/home/hakim/projects/herald/apps/web/src/lib/project-realtime.tsx:345) invalidates this project data several times across a catch-up window. A small change can therefore reload channels, publications, connections, and tags. After H-03, increasing volumes without revisiting this granularity will increase the cost. Measure request count, response size, and visible delay during a burst before optimizing.

**Prototype still shipped.** [The real-time prototype route](/home/hakim/projects/herald/apps/web/src/routes/dashboard/projects/$projectId/realtime-prototype.tsx) remains compiled into the application. The build produces a separate chunk of about 318.68 kB uncompressed, 88.65 kB gzip for this prototype. It would be incorrect to attribute the entire chunk to initial loading. Decide whether to keep this surface as an explicit diagnostic tool or remove it from the product; maintaining two prototypes and their dependencies without a clear status increases maintenance.

**Typing.** Workarounds around Elysia beta and Better Auth are localized and explained, including `as unknown as` at their boundaries. This compromise is not a defect by itself. Exported contracts still need real-request tests because a hand-reconstructed type does not guarantee runtime policy. Do not replace the frameworks on this basis alone.

## Governance and documentation

The repository had 69 decisions and 184 top-level Markdown worklogs in the inspected state. This traceability helps explain choices; its volume also requires a clear hierarchy between accepted current state, historical evidence, and obsolete instructions.

[SPEC-005](/home/hakim/projects/herald/.autonomos/specs/SPEC-005-continuous-product-scope.md) defines continuous development and replaces the SPEC-001 V1 framing. Several root texts still use V1 vocabulary. [The README](/home/hakim/projects/herald/README.md) still presents a member-focused LinkedIn procedure and a partial package list. The runtime now supports several providers, configurable applications, and LinkedIn organization destinations. This drift does not make every instruction false, but it weakens understanding of capability and status.

A completed task should point to verified behavior and its limits. H-01 shows that “roles available in the UI and a role test on one route” is not equivalent to “role enforced across the product.” Keep historical audits; improve closure criteria without rewriting evidence retroactively.

## Cache hypothesis rejected

The absence of `dependsOn` on Turbo tests seemed able to leave downstream cache entries stale after a core change. [Official Turbo documentation](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks) justified checking that dependency. A disposable local clone nevertheless showed that, in this repository, changing core changes the internal-dependency hash and invalidates API and DB tests as well. **No cache defect is retained on this evidence.**
