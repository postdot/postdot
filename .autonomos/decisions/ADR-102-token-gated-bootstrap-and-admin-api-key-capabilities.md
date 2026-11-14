# ADR-102 — Token-gated bootstrap and administrative API-key capabilities

- Status: accepted
- Scope: instance bootstrap policy, user API-key capability model, and Better Auth synchronization boundary
- Provenance: [ISSUE-197](../ISSUES.md); design pass following owner direction on 2026-11-14 and owner confirmation of governance choices
- Related specs: [SPEC-012](../specs/SPEC-012-agentic-bootstrap-and-privileged-api-access.md)
- Supersedes: the human-session-only restrictions on administrative and API-key routes in [ADR-061](ADR-061-human-account-and-instance-access-policy.md), [ADR-075](ADR-075-user-owned-api-keys.md), [ADR-096](ADR-096-mcp-operator-surface.md), and [ADR-098](ADR-098-optional-studio-and-client-authentication.md), plus the blanket rejection of pre-shared bootstrap tokens in ADR-061 where strictly limited to single-use claim of an `unclaimed` / `claimable` instance

## Context

`ADR-061` closed public signup after the first account, relying on either (a) an open unauthenticated `claimable` signup window or (b) the offline `account bootstrap` CLI command prior to server startup. Meanwhile, `ADR-075`, `ADR-096`, and `ADR-098` restricted `api_key` bearer authentication strictly to project-level content operations, forcing instance administration, workspace/member management, API-key issuance, and non-OAuth provider connections through human browser cookie sessions.

For autonomous AI agents deploying and operating Postdot:

1. Relying on an open `claimable` signup window exposes newly provisioned instances to first-comer hijacking before the deploying agent authenticates, while `account bootstrap` currently only supports SQLite, runs offline before HTTP startup, and does not emit an API key.
2. Blocking privileged API keys from instance, user, workspace, settings, and token administration forces agents to either obtain human session cookies (`Set-Cookie`) or halt for manual human intervention in Studio, contradicting Postdot's agentic positioning when an operator intends to grant full privileges.

## Decision

### 1. Gate unclaimed HTTP bootstrap with a one-time token (`POSTDOT_BOOTSTRAP_TOKEN` / production auto-token)

- Add optional `POSTDOT_BOOTSTRAP_TOKEN` / `POSTDOT_BOOTSTRAP_TOKEN_FILE` / `POSTDOT_BOOTSTRAP_TOKEN_HASH` verified in constant time.
- **Zero-window production default:** In `NODE_ENV=production`, if `instance_state.state === 'claimable'` and no bootstrap token is configured, Postdot automatically generates a one-time startup token (`<dataDir>/bootstrap-token` with `0600` permissions, logged once at startup) unless `POSTDOT_BOOTSTRAP_MODE=open` is explicitly set. Local development/test defaults to `open` when unconfigured so developer ergonomics remain frictionless.
- Unlike a permanent environment admin password or backdoor (still rejected per ADR-061), this secret is strictly bound to `instance_state.state === 'claimable'` and **becomes permanently inert inside the same database transaction that claims the instance** (`state = 'claimed'`). Leaving the variable or file mounted across container restarts has zero effect after initial claim.
- While `bootstrapMode === 'token_required'`, public unauthenticated `sign-up/email` is closed (`signupAllowed = false`), eliminating the unauthenticated takeover race window. `POST /api/instance/bootstrap` atomically creates the first administrator, default workspace, claimed state, and an optional initial API key.
- Extend offline `account bootstrap` to support PostgreSQL (`--database-url`) and `--issue-api-key` for pre-boot automation that prefers zero HTTP bootstrap surface.

### 2. Extend user-owned API-key capabilities rather than adding a separate root token type

- Reuse Postdot's existing `postdot_pat_` user-owned Better Auth API-key infrastructure (`ADR-075`) and `requiredApiKeyCapability` fail-closed mapper instead of inventing an unaudited root/superuser bypass token.
- Add explicit administrative capabilities (`instance:admin`, `workspace:manage`, `project:access_manage`, `api_key:manage`, `publication:approve`) and expand `project:read` / `channel:manage` where safe.
- **Unrestricted key inheritance (`actionAccess: null` / `'all'`):** Keys without explicit action restrictions inherit all capabilities permitted by their owning user's live instance, workspace, and project roles (including administrative capabilities for an enabled instance admin, while non-admins remain blocked by live role intersection and narrow keys remain bounded).
- **Direct headless member/agent provisioning (`POST /api/access/members`):** Alongside existing invitation tokens (`/api/access/invitations`), `instance:admin` can directly provision an enabled user or agent account (and optionally mint its initial API key) in one HTTP call without SMTP or an invite-accept step.
- Enforce **anti-privilege-escalation** when `api_key:manage` is exercised via an API key: a child key may never exceed the calling key's project scope or action capabilities.
- Replace session-header forwarding to `auth.api.*` in `access/routes.ts` and `workspace-routes.ts` with server-authoritative sync calls guarded by Postdot's `AccessStore` and capability checks, because API-key requests do not carry Better Auth session cookies.

## Alternatives considered

### Separate static "instance root token" environment variable

Rejected. A static env-var root credential lacks per-agent revocation, expiry, project scoping, or actor attribution, and cannot be rotated without restarting the server. User-owned API keys already store hashes, expiration, prefixes, audit actors, and live role intersection in the database.

### Allowing API keys to obtain Better Auth session cookies via an exchange endpoint

Rejected. Turning API keys into session cookies would bypass `apiKeyPermissions` capability ceilings altogether and collapse least-privilege boundaries between narrow content bots and administrative agents.

### Requiring explicit opt-in even for "All actions" (`actionAccess: null`) keys

Considered and rejected by owner direction: when an administrator grants an agent a full-privilege (`all`) key, that agent must be able to perform all administrative actions allowed by the owner's role; narrower agents should receive scoped capability lists instead.

### Eliminating human sessions from Studio

Out of scope. Human operators still use Better Auth email/password sessions in Studio and interactive OAuth browser flows; this decision brings privileged API keys to administrative parity rather than removing session auth.

## Consequences

- **Positive:** Agents can provision fresh instances safely without an open registration window and operate every administrative workflow via `POSTDOT_API_KEY` or MCP without human bottlenecks.
- **Costs and risks:** Expanding `requiredApiKeyCapability` and decoupling Better Auth admin/org calls from `request.headers` cookies requires careful test coverage for anti-escalation, role-revocation intersection, last-admin safety, direct member provisioning, and Better Auth synchronization.
- **Governance:** Accepted by owner on 2026-11-14; implementation tracked under `AUTH-648`, `API-649`, and `CLI-650` in [`TASKS.md`](../TASKS.md).
