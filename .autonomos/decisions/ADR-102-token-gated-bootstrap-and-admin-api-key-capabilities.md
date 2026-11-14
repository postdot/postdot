# ADR-102 — Token-gated bootstrap and administrative API-key capabilities

- Status: proposed
- Scope: instance bootstrap policy, user API-key capability model, and Better Auth synchronization boundary
- Provenance: [ISSUE-197](../ISSUES.md); design pass following owner direction on 2026-11-14
- Related specs: [SPEC-012](../specs/SPEC-012-agentic-bootstrap-and-privileged-api-access.md)
- Supersedes (if accepted): the human-session-only restrictions on administrative and API-key routes in [ADR-061](ADR-061-human-account-and-instance-access-policy.md), [ADR-075](ADR-075-user-owned-api-keys.md), [ADR-096](ADR-096-mcp-operator-surface.md), and [ADR-098](ADR-098-optional-studio-and-client-authentication.md), plus the blanket rejection of pre-shared bootstrap tokens in ADR-061 where strictly limited to single-use claim of an `unclaimed` / `claimable` instance

## Context

`ADR-061` closed public signup after the first account, relying on either (a) an open unauthenticated `claimable` signup window or (b) the offline `account bootstrap` CLI command prior to server startup. Meanwhile, `ADR-075`, `ADR-096`, and `ADR-098` restricted `api_key` bearer authentication strictly to project-level content operations, forcing instance administration, workspace/member management, API-key issuance, and non-OAuth provider connections through human browser cookie sessions.

For autonomous AI agents deploying and operating Postdot:

1. Relying on an open `claimable` signup window exposes newly provisioned instances to first-comer hijacking before the deploying agent authenticates, while `account bootstrap` currently only supports SQLite, runs offline before HTTP startup, and does not emit an API key.
2. Blocking privileged API keys from instance, user, workspace, settings, and token administration forces agents to either obtain human session cookies (`Set-Cookie`) or halt for manual human intervention in Studio, contradicting Postdot's agentic positioning when an operator intends to grant full privileges.

## Decision (proposed)

### 1. Gate unclaimed HTTP bootstrap with an optional one-time token (`POSTDOT_BOOTSTRAP_TOKEN`)

- Add optional `POSTDOT_BOOTSTRAP_TOKEN` / `POSTDOT_BOOTSTRAP_TOKEN_FILE` (and optional hash configuration `POSTDOT_BOOTSTRAP_TOKEN_HASH`) verified in constant time.
- Unlike a permanent environment admin password or backdoor (still rejected per ADR-061), this secret is strictly bound to `instance_state.state === 'claimable'` and **becomes permanently inert inside the same database transaction that claims the instance** (`state = 'claimed'`). Leaving the variable set across container restarts has zero effect after initial claim.
- While a bootstrap token is configured and `state === 'claimable'`, public unauthenticated `sign-up/email` is closed (`signupAllowed = false`), eliminating the unauthenticated takeover race window. `POST /api/instance/bootstrap` atomically creates the first administrator, default workspace, claimed state, and an optional initial API key.
- Extend offline `account bootstrap` to support PostgreSQL (`--database-url`) and `--issue-api-key` for pre-boot automation that prefers zero HTTP bootstrap surface.

### 2. Extend user-owned API-key capabilities rather than adding a separate root token type

- Reuse Postdot's existing `postdot_pat_` user-owned Better Auth API-key infrastructure (`ADR-075`) and `requiredApiKeyCapability` fail-closed mapper instead of inventing an unaudited root/superuser bypass token.
- Add explicit administrative capabilities (`instance:admin`, `workspace:manage`, `project:access_manage`, `api_key:manage`, `publication:approve`) and expand `project:read` / `channel:manage` where safe.
- Enforce **anti-privilege-escalation** when `api_key:manage` is exercised via an API key: a child key may never exceed the calling key's project scope or action capabilities.
- Replace session-header forwarding to `auth.api.*` in `access/routes.ts` and `workspace-routes.ts` with server-authoritative sync calls guarded by Postdot's `AccessStore` and capability checks, because API-key requests do not carry Better Auth session cookies.

### 3. Open governance choices for owner confirmation before acceptance

1. **Unrestricted key inheritance (`actionAccess: null` / `'all'`):**
   - *Option A (continuity with full-privilege model):* `actionAccess: null` continues to mean "all capabilities the owner holds", so an enabled instance admin's `'all'` key automatically authorizes `instance:admin`, `workspace:manage`, `project:access_manage`, `api_key:manage`, and `publication:approve`, while non-admins remain blocked by live role checks and narrow keys remain bounded.
   - *Option B (explicit admin opt-in):* Keep `actionAccess: null` scoped to project/workspace content capabilities unless `instance:admin` / `api_key:manage` are explicitly included (or an explicit `allowAdminActions` flag is enabled at key creation), preventing previously created `"All actions"` keys from silently gaining user/token-management powers.
2. **Default bootstrap mode when `POSTDOT_BOOTSTRAP_TOKEN` is unset:**
   - *Option A (backward-compatible default):* Keep current open first-user web claim when `POSTDOT_BOOTSTRAP_TOKEN` is unset (zero config for local dev / quick local installs), and recommend `POSTDOT_BOOTSTRAP_TOKEN` in production deployment templates (Docker Compose, Kubernetes, Cloud/VPS guides).
   - *Option B (secure-by-default production mode):* In `NODE_ENV=production` without `POSTDOT_BOOTSTRAP_TOKEN`, auto-generate a one-time setup token at startup (logged once / written to `<data>/bootstrap-token`) unless `POSTDOT_BOOTSTRAP_MODE=open` is explicitly set.
3. **Headless creation of secondary user/agent accounts:**
   - *Option A (existing invitations):* Keep `/api/access/invitations` returning the one-time token + `/api/access/invitations/accept` (works headlessly with zero SMTP!).
   - *Option B (direct provisioning):* Also add `POST /api/access/members` for `instance:admin` to directly create an enabled member/service user (with optional initial API key) in one call without an invite-accept dance.

## Alternatives considered

### Separate static "instance root token" environment variable

Rejected. A static env-var root credential lacks per-agent revocation, expiry, project scoping, or actor attribution, and cannot be rotated without restarting the server. User-owned API keys already store hashes, expiration, prefixes, audit actors, and live role intersection in the database.

### Allowing API keys to obtain Better Auth session cookies via an exchange endpoint

Rejected. Turning API keys into session cookies would bypass `apiKeyPermissions` capability ceilings altogether and collapse least-privilege boundaries between narrow content bots and administrative agents.

### Eliminating human sessions from Studio

Out of scope. Human operators still use Better Auth email/password sessions in Studio and interactive OAuth browser flows; this decision brings privileged API keys to administrative parity rather than removing session auth.

## Consequences

- **Positive:** Agents can provision fresh instances safely without an open registration window and operate every administrative workflow via `POSTDOT_API_KEY` or MCP without human bottlenecks.
- **Costs and risks:** Expanding `requiredApiKeyCapability` and decoupling Better Auth admin/org calls from `request.headers` cookies requires careful test coverage for anti-escalation, role-revocation intersection, last-admin safety, and Better Auth synchronization.
- **Governance:** Remains `proposed` until the owner confirms the open choices above and accepts `SPEC-012` / `ADR-102`.
