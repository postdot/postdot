# Postbot — Agent handover

Prepared 2026-10-19. This is a temporary handover requested by the owner for a new multi-agent collaboration experiment. Read it, verify current Git state, then delete it in a deliberate cleanup commit once its useful context has been consumed. Do not start new implementation merely because this document lists possible next tasks.

## Stable stopping point

- Repository: `/home/hakim/projects/herald`. Product name: **Postbot**, despite the historical directory name.
- Branch: local `main`. Latest implementation commit: `1f47f1a7f` (`fix(web): preserve overlapping publication refresh signals`). This handover is committed separately afterward.
- No implementation is intentionally left in progress. REALTIME-513 is complete as a bounded concurrency repair; ISSUE-177 remains open because the original Facebook/proxy observation has not been replayed.
- No push, release, public deployment or PR was performed. The owner's current convention is local integration directly into `main`.
- The isolated API and Cloudflare tunnel used for Facebook acceptance were stopped. The isolated realtime API was also stopped gracefully. At handover preparation, no listeners were found on ports 3002, 3003, 3010, 5173, 5174 or 6006. A browser tab showing an old URL does not establish that its service is running.
- `apps/docs/AGENTS.md` and `apps/docs/CLAUDE.md` were pre-existing untracked Next.js-generated guidance. They are preserved and committed with this handover to leave a clean tree, rather than deleted or silently ignored.

## Read first

1. Root `AGENT.md`, `DESIGN.md`, `.autonomos/PROTOCOL.md`, and the session/task/crystallize workflows in `.agent/workflows/`.
2. `.autonomos/TASKS.md` and the particular issues relevant to the newly chosen scope. The ledger is long and contains many completed tasks; do not interpret every old proposal as current priority.
3. Applicable ancestor `AGENT.md` files before editing a subtree. Consult relevant project skills in `.agents/skills/`.
4. Recent worklogs:
    - `.autonomos/worklogs/2026-10-18-FACEBOOK-512.md`
    - `.autonomos/worklogs/2026-10-19-REALTIME-513.md`

Read the installed Turborepo documentation before changing its configuration/commands. Next.js generates version-specific guidance under `apps/docs/`; use installed documentation rather than assuming familiar framework behavior.

## Product intent

Postbot is a lightweight self-hosted multichannel publication orchestrator for humans and agents. A single-service SQLite-first deployment, local storage and S3 compatibility are central; do not introduce services casually. Resource efficiency is a product goal, not permission to advertise unmeasured capacity claims.

- Studio is the human web client. CLI, API and MCP are complementary interfaces.
- Agent usage should be understood as a person talking naturally to their existing agent (ChatGPT, Claude, etc.), connected to Postbot through MCP and skills. A terminal is not the default visual metaphor for this audience.
- Workspaces, projects, permissions, multiple languages and custom/manual channels matter. Do not collapse workspace/project concepts or invent a campaign entity: internal tags can carry campaign names without Postbot assigning that meaning.
- Future mobile clients, n8n integration, agent skills and additional deployment resources have been discussed. Verify actual implementation and existing issues before promising availability.
- The recent priority moved from website polish to integration and product completeness: platforms, publishing formats, analytics, comments, tags and intuitive custom-channel configuration.

## Collaboration and UX expectations

The owner wants substantive autonomous progress on bounded, justified tasks, with separate reviewable commits. They dislike repeated requests for routine approval, tiny cosmetic passes and invented tasks to fill a quota. This handoff explicitly pauses that work so a new collaboration method can be established.

- Code, repository prose, tests and worklogs are English. Discuss with the owner in French. French application text belongs in localization catalogs.
- UI should be intuitive and concise. Avoid permanent tutorial paragraphs. Use familiar labels and contextual help only where needed; help must also work beyond hover.
- Dialog header/footer stay visible; only the body scrolls when necessary.
- Reuse real components, particularly the real publication editor and toolbar. Do not maintain a fake look-alike that drifts when the original evolves.
- Titles are a channel capability: absent, optional or required. Most social posts have no title; blog-like destinations may require one.
- Never expose raw JSON as the default configuration experience. Existing structured custom-channel/mapped-request builders should preserve advanced data losslessly.
- Use the actual Solar icon catalog. `check-read` means message read receipts, not generic success. Avoid decorative status dots and Unicode arrow substitutes.
- Avoid duplicated marketing sections, extra labels above headings, verbose feature documentation inside cards and invented screenshots/interfaces. Established visual direction is in DESIGN.md; do not restart the design from guesses.
- Keep authored documentation skills (`postbot-writing`, `stop-slop`, etc.) separate from Fumadocs mechanics (`postbot-fumadocs`).

## Recent integration work

Telegram tasks TELEGRAM-498 through TELEGRAM-503 and STUDIO-504 are marked complete in the ledger. The agreed initial publishing scope is **text or one media item with caption**; albums are deferred. Inspect package contracts/tests for precise supported media and limits rather than assuming all Telegram features.

Facebook tasks FACEBOOK-506 through FACEBOOK-512 added and activated a native Pages integration, including OAuth, encrypted app/connection configuration, explicit Page selection, native profile and durable worker execution. Current scope is text/link/single-photo; do not imply Instagram, albums or video delivery are included.

Facebook text length is explicitly **unknown**, represented by `TextFieldCapability.maxLength: null`. This is not unlimited. The UI displays a count without an invented numeric ceiling. Known numeric limits remain enforced elsewhere.

### Facebook live acceptance

- A dedicated Meta app and Page named **Postbot Test** were created using the owner's test account.
- The app remains unpublished. The grant was limited to the existing test Page, not future Pages.
- A separate temporary Postbot database/media/credential store and HTTPS tunnel were used; normal local user data was untouched.
- Real text and PNG-with-caption posts were delivered through the worker and independently observed on Facebook.
- Secrets are not included here. Do not copy credentials, password history, session cookies or temporary configuration into Git or new agent prompts. A prior conversation contained a password; there is no need to recover or reuse it.
- The temporary callback was removed from Meta and verified absent, and the tunnel/API were stopped. Do not assume a reusable live test setup remains running. Existing persistent encrypted grants do not authorize unrelated actions or broader access.
- The owner authorized test posts and setup on that dedicated account/Page. Browser contractual/security-sensitive actions still require their applicable action-time confirmation; do not infer permission for other accounts, Pages or production publishing.

Commit `8a29ca9fa` fixed a real reverse-proxy OAuth defect: build the provider callback URL from trusted configured `publisher.facebookCallbackUri`, then copy the incoming query string. Do not derive it from the internal HTTP request origin or untrusted forwarded headers. Regression coverage includes internal HTTP and hostile forwarded headers.

## Latest repair: REALTIME-513

Observed during Facebook acceptance: database and remote post showed success while the open Studio detail still showed Queued; reload showed Published. This became **ISSUE-177**.

Investigation established:

- Ordinary manual publication updates already worked before the fix.
- `ProjectRealtimeBridge` coalesced refreshes by returning an existing promise, discarding subsequent request scopes.
- If a project-only refresh was running, a publication event requesting editor refresh could be lost. A late signal could also arrive after a read started, leaving stale state.

Commit `1f47f1a7f` introduced a scoped refresh queue that merges stronger scopes and repeats after an overlapping signal. It preserves failure recovery and independent resource keys. It does not add polling or change editor reconciliation/local-edit protection.

Key files:

- `apps/web/src/lib/project-realtime.tsx`
- `apps/web/src/lib/realtime-refresh.ts`
- `apps/web/src/lib/realtime-refresh.test.ts`
- `apps/web/src/lib/project-realtime.test.ts`
- `apps/web/src/routes/dashboard/projects/$projectId/publications/$publicationId.tsx`
- `apps/web/src/components/publication-editor.tsx`

Backend journal/SSE lives under `apps/api/src/modules/projects/realtime-*`; database commit notifications wake streams after commit, and streams reread durable audit events. Existing backend realtime tests cover that boundary.

Validation:

- 13 focused realtime/queue tests, 33 assertions passed.
- Three concurrency regressions fail with the previous coalescing behavior and pass with the fix.
- `bun run check:quick`: formatting, lint/spelling and typechecks passed across 20 workspaces, including the commit hook.
- `bun run --cwd apps/web build` passed.
- CUA verified the rebuilt Studio changing to Published without reload after a separate local API request, with the background-update notice.
- No real provider request or shared user-data mutation was used for this repair.

**Remaining uncertainty:** this does not prove that the queue race was the sole cause of the original Facebook observation. ISSUE-177 intentionally remains open. Do not report automatic Facebook/TLS-proxy replay as completed.

## Suggested next bounded work, subject to the new collaboration plan

The most direct continuation is an isolated automatic-worker fixture that updates an already open Studio detail while project events overlap. Use a local synthetic provider/transport and private storage; prove worker completion reaches the editor without reload and local edits are not overwritten. Revisit a TLS proxy only if evidence still suggests a transport problem.

This is a recommendation, not an instruction to resume immediately. The owner requested a stopping point and intends to establish a multi-agent experiment first. Further integration/analytics/comment work should be selected from existing issues with clear acceptance criteria, not started concurrently without ownership boundaries.

## Multi-agent handoff constraints

The root AGENT.md already contains a parallel-agent protocol. Read it before dispatch. In particular:

- One orchestrator owns canonical main, shared servers, browser verification, external actions and integration.
- Assign each worker a task ID, base commit, dedicated worktree/branch, allowed paths, forbidden shared resources, acceptance criteria, checks and cleanup owner.
- Reserve shared governance, migrations, lockfiles and central dispatch hotspots for one owner at a time. File separation alone does not prove semantic independence.
- Workers must not use real credentials, publish, mutate shared databases, start shared services, merge main or run competing browser workflows.
- Integrate contributions serially, verify at the appropriate scope and keep commits attributable.
- Do not create user-visible Codex chats unless the owner asks for them. The new session should clarify the experiment's execution model before dispatching agents, rather than assuming a particular tool or model setup.

## Local verification and operational hygiene

- Inspect package scripts and configured environment before restarting services. Do not create a fresh default database over user data or overwrite existing environment files.
- API, Studio, docs and Storybook commonly use 3002, 5173, 5174 and 6006 respectively; verify configuration and actual listeners rather than assuming these values.
- Use private temporary directories, unique ports, database files and media roots for fixture tests.
- Browser interactions in this session used CUA. Follow the current tool/runtime browser instructions and do not launch a competing browser automation path merely because an existing test uses Playwright.
- Gracefully stop runtimes. Open SSE tabs can delay draining: leave the test page first. Never delete runtime lock files to force startup.
- Focus checks on semantic impact; do not run the whole repository mechanically for a small local change, and do not weaken assertions. The recent build/check evidence is not a claim that every historical E2E scenario passes today.
- Temporary screenshots and private fixture directories under `/tmp` are not durable deliverables or configuration to reuse blindly. The worklogs record their purpose; no secret material belongs in this file.
