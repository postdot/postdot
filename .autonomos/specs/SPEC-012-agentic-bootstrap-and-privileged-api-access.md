# SPEC-012 — Agentic deployment bootstrap and full-privilege API access

- Status: accepted
- Scope: first-run instance bootstrap, user API-key capabilities, administrative HTTP routes, CLI, MCP, and Studio key management
- Provenance: [ISSUE-197](../ISSUES.md); owner direction and design acceptance on 2026-11-14 regarding agent-first administration ("dot" = bot) and eliminating the unauthenticated first-user takeover window
- Related decisions: [ADR-102](../decisions/ADR-102-token-gated-bootstrap-and-admin-api-key-capabilities.md), [ADR-061](../decisions/ADR-061-human-account-and-instance-access-policy.md), [ADR-074](../decisions/ADR-074-workspace-and-access-boundaries.md), [ADR-075](../decisions/ADR-075-user-owned-api-keys.md), [ADR-095](../decisions/ADR-095-workspace-channels-and-project-attachments.md), [ADR-096](../decisions/ADR-096-mcp-operator-surface.md), [ADR-098](../decisions/ADR-098-optional-studio-and-client-authentication.md)
- Related specs: [SPEC-009](SPEC-009-shared-channel-workflows.md), [SPEC-011](SPEC-011-public-cli.md)
- Tasks: `AUTH-648`, `API-649`, `CLI-650` in [`TASKS.md`](../TASKS.md)

## Intent

Postdot must let an AI agent deploy, claim, and administer a self-hosted instance end-to-end without mandatory human Studio interaction, while eliminating the unauthenticated registration window on fresh deployments and preserving least-privilege isolation for restricted keys.

An API key must only be blocked when it lacks the required capability or when its owner lacks the underlying live instance, workspace, or project role — never solely because the caller authenticated with an API key instead of a browser cookie, except where a protocol inherently requires interactive human browser consent (such as third-party OAuth browser redirects).

## Requirements

### 1. Secure, zero-window instance bootstrap

1. **One-time bootstrap token (`POSTDOT_BOOTSTRAP_TOKEN` / `POSTDOT_BOOTSTRAP_TOKEN_FILE`):**
   - Deployments may configure a pre-shared bootstrap secret via `POSTDOT_BOOTSTRAP_TOKEN`, `POSTDOT_BOOTSTRAP_TOKEN_FILE`, or `POSTDOT_BOOTSTRAP_TOKEN_HASH` (Docker secrets, Kubernetes Secrets, Terraform, PaaS secret managers, or agent-generated `.env`).
   - **Default mode when unconfigured:** In `NODE_ENV=production`, if `instance_state.state === 'claimable'` and no bootstrap token is configured (and `POSTDOT_BOOTSTRAP_MODE=open` is not explicitly set), Postdot automatically generates a cryptographically random one-time bootstrap token at startup, persists it with `0600` permissions to `<dataDir>/bootstrap-token`, logs the location/token once for the deploying operator or agent, and activates `token_required` mode. In local development/test (`NODE_ENV !== 'production'`) or when `POSTDOT_BOOTSTRAP_MODE=open` is explicitly set without a token, `bootstrapMode` defaults to `open`.
   - While `instance_state.state === 'claimable'` and `bootstrapMode === 'token_required'`, public unauthenticated account creation (`POST /api/auth/sign-up/email`) is closed (`signupAllowed = false`), preventing any unauthenticated visitor from claiming the instance before the deploying agent or operator acts.
   - `GET /api/instance/status` reports public non-sensitive bootstrap readiness (`setupAvailable: boolean`, `bootstrapMode: 'open' | 'token_required' | 'claimed'`).
2. **Atomic HTTP bootstrap endpoint (`POST /api/instance/bootstrap`):**
   - Accepts the bootstrap token (`Authorization: Bearer <token>` or `X-Postdot-Bootstrap-Token`), validated with constant-time digest comparison.
   - Accepts initial administrator account details (`name`, `email`, `password`) and an optional `apiKey` creation descriptor (`name`, `projectIds`, `actionAccess`, `expiresAt`).
   - In a single database transaction: creates the initial enabled instance `admin` user and default workspace, claims `instance_state` (`state = 'claimed'`, recording `claimed_by_user_id` and `claimed_at`), and optionally mints the initial user-owned API key.
   - Returns `{ user, instance, apiKey?: { key, token } }`, exposing the plaintext `token` once.
   - Because `instance_state.state` becomes `'claimed'` atomically, any subsequent call to `POST /api/instance/bootstrap` fails closed (`409` or `403`), even if the environment variable or secret file remains mounted across container restarts.
   - Studio's onboarding form supports supplying the bootstrap token when `bootstrapMode === 'token_required'` so human operators using hardened deployment templates can complete bootstrap from Studio too.
3. **Enhanced offline/pre-start bootstrap (`account bootstrap`):**
   - Extend `bun /app/postdot.js account bootstrap` to support both SQLite (`--database`) and PostgreSQL (`--database-url` / `POSTDOT_DATABASE_URL`) consistently with `account recover-password` and ADR-097.
   - Add optional key issuance (`--issue-api-key`, `--api-key-name`, `--api-key-output <path>` written with `0600` permissions, or `--json`) so pre-boot automation receives a ready `postdot_pat_...` key without a follow-up sign-in cookie exchange.

### 2. Full-privilege API-key capabilities and parity

Add explicit capabilities so narrow keys remain fail-closed while privileged keys can operate every administrative surface:

1. **New capability identifiers (alongside ADR-075 capabilities):**
   - `instance:admin` — read/update instance members (roles, enable/disable), directly create enabled member or agent service accounts (`POST /api/access/members`, optionally minting an initial API key in the same call without requiring SMTP or an invite-accept round-trip), manage instance invitations, manage instance taxonomy categories, manage runtime provider application configurations, manage installation SMTP/email settings, view/resume restore recovery holds, and inspect cross-instance retirements. Requires live `access.isInstanceAdmin(user.id)`.
   - `workspace:manage` — create workspaces, read workspace administration details, manage workspace members, invitations, and teams, and archive/restore workspaces. Requires live workspace `owner`/`admin` authority where applicable (`workspace:permanently_delete` or `project:permanently_delete` / explicit permanent deletion capability governs permanent workspace deletion).
   - `project:access_manage` — list and mutate project members, project invitations, user grants, and group grants. Requires live project `owner` or workspace `owner`/`admin` authority.
   - `api_key:manage` — list, create, update, and revoke API keys owned by the calling user (and, when paired with `instance:admin`, inspect/revoke keys during member offboarding).
   - `publication:approve` — approve or reject publication approval requests. Kept separate from `publication:manage` so draft-authoring agents still cannot self-approve.
2. **Unrestricted key inheritance (`actionAccess: null` / `'all'`):**
   - Keys configured with `actionAccess: null` (`'all'`) inherit every capability permitted by the owning user's live instance, workspace, and project roles — including `instance:admin`, `workspace:manage`, `project:access_manage`, `api_key:manage`, and `publication:approve`. Keys belonging to non-admin users remain blocked by live role intersection, and keys with an explicit action list remain bounded to their granted capabilities.
3. **Existing capability expansions:**
   - `project:read` additionally authorizes `GET /api/access` (current user summary), `GET /api/categories`, `GET /api/search`, `GET /api/resource-removals`, workspace detail reads, project member/grant reads, and approval-request listing (all filtered to the caller's live access).
   - `channel:manage` additionally authorizes non-interactive credential connections where no browser OAuth consent is involved (`devto` API key, `discord` bot token, `telegram` bot token, `bluesky` app-password, in addition to existing `custom-http`).
4. **Anti-escalation and attribution invariants:**
   - **No privilege escalation through `api_key:manage`:** An API key creating or updating another API key cannot grant `projectIds === null` (`all`) if the calling key is restricted to `selected` projects, cannot include project IDs outside the calling key's project scope, cannot grant `actionAccess === null` (`all`) if the calling key has a bounded action list, and cannot grant any capability the calling key does not itself hold.
   - **Live role intersection:** Every administrative request continues to verify the owner's live instance/workspace/project membership and role, last-admin protection, and self-demotion/self-disable guards.
   - **Server-authoritative Better Auth sync:** Routes in `apps/api/src/modules/access/routes.ts` and `workspace-routes.ts` that currently forward `headers: request.headers` to Better Auth's session-expecting `auth.api.*` methods must invoke server-authoritative sync paths after Postdot capability + role verification, so `Bearer postdot_pat_...` requests succeed identically to cookie sessions.
   - **Audit attribution:** Audit events record the acting user and API-key actor identity (`api-key:<id>` / `displayName`) consistently with ADR-075.
5. **Surfaces intentionally left interactive/human-session-first:**
   - Browser OAuth consent handshakes (`/oauth/*`, `POST .../oauth/start`) remain interactive browser flows because third-party identity providers enforce user consent in a browser.
   - Browser realtime SSE streams (`/api/projects/:id/events`, `/api/notifications/events`) and personal account password change remain session-scoped unless a distinct machine streaming requirement is accepted later.

### 3. CLI, MCP, and Studio parity

1. **CLI (`@postdot/cli` and `scripts/postdot.ts`):**
   - Remove blanket `requireSession` gates on `api-keys` and `workspaces` lifecycle commands so `--token` / `POSTDOT_API_KEY` works whenever the key carries the required capability.
   - Expose administrative commands (`instance bootstrap`, `access`, `workspaces`, `api-keys`, `settings`) with `--json` and non-interactive secret file/stdin options.
2. **MCP (`/mcp`):**
   - Add explicit `mcpToolCatalog` entries (with `confirm: true` on mutating/destructive administrative actions) for workspace management, access/invitation administration, API-key management (with explicit security warnings that returned `token` secrets are visible in tool outputs), provider-application configuration, and non-OAuth provider connections.
   - Continue filtering `tools/list` and `tools/call` strictly by the presented API key's effective capabilities.
3. **Studio API-key UI:**
   - Expose the new administrative capabilities in the API-key editor with clear risk labeling, and enforce/reflect anti-escalation rules when inspected.

## Acceptance criteria

- A fresh Postdot instance started with `POSTDOT_BOOTSTRAP_TOKEN` (or in `NODE_ENV=production` without `POSTDOT_BOOTSTRAP_MODE=open`, using the auto-generated `<dataDir>/bootstrap-token`) rejects unauthenticated `POST /api/auth/sign-up/email`, creates the initial administrator and unrestricted API key atomically via `POST /api/instance/bootstrap`, and permanently rejects replay after `state === 'claimed'`.
- `account bootstrap` supports PostgreSQL (`--database-url`) and optional initial API-key issuance.
- A privileged API key (`instance:admin`, `workspace:manage`, `project:access_manage`, `api_key:manage`, `publication:approve`, or unrestricted `'all'` owned by an admin) can create workspaces, directly provision enabled member/agent accounts (`POST /api/access/members`) with optional initial API keys, invite/manage instance and project members, mint/update/revoke narrower API keys, configure runtime provider apps, connect non-OAuth providers (`devto`, `discord`, `telegram`, `bluesky`), approve publications, and search accessible content.
- A bounded API key cannot escalate privileges (e.g., mint a wider key, demote the last admin, bypass project scope, or self-approve without `publication:approve`).
- Existing narrow-key, session-cookie, and browser OAuth security guarantees continue to pass regression suites.

## Out of scope

- Removing human Studio login or replacing Better Auth email/password authentication.
- Headless bypass of third-party interactive OAuth consent flows (X, LinkedIn, Mastodon, Facebook, Instagram) without a browser session.
- Automated multi-node secret distribution outside standard environment/file secrets.
