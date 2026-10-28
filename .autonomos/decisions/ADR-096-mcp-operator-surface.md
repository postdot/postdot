# ADR-096 — Expose Postdot to agents through a hosted MCP endpoint

- Status: accepted — implementation under MCP-593
- Scope: external agent access, API-key capabilities, public documentation
- Provenance: owner direction on 2026-10-28 reopening ISSUE-036; the owner chose a hosted
  HTTP endpoint over a local stdio relay and full parity with the CLI's project workflows
- Related decisions: [ADR-075](ADR-075-user-owned-api-keys.md), [ADR-095](ADR-095-workspace-channels-and-project-attachments.md)

## Context

Agents need a protocol surface that works against a remote Postdot instance without installing
anything beside the agent. A stdio server would be a second process on every client machine that only
forwards to the API; it also excludes hosted agents. The API already enforces user-owned keys, project
scope, action capabilities, attribution and lifecycle rules. A new surface must not duplicate them.

## Decision

1. **Transport.** The API serves the Model Context Protocol over stateless Streamable HTTP at `POST /mcp`:
   JSON-RPC requests receive JSON responses, notifications receive 202, and `GET`/`DELETE` return 405
   (no server-initiated stream or session). It implements `initialize`, `ping`, `tools/list` and
   `tools/call` only; no resources, prompts, sampling or OAuth server. The protocol is small enough to
   implement directly; the official SDK is used only as a test client.
2. **Authentication.** Only `Authorization: Bearer <user API key>`. Cookies are never read. A request
   without a valid key receives 401 with `WWW-Authenticate: Bearer`. A browser `Origin` that is not the
   configured web origin is refused (DNS-rebinding protection); requests without `Origin` are allowed.
   OAuth for hosted connectors that cannot set headers is a separate decision.
3. **No second authorization layer.** A tool call is dispatched in-process as an ordinary API request
   carrying the caller's `Authorization` header. Roles, project scope, capabilities, lifecycle guards,
   concurrency checks and actor attribution are therefore exactly those of the HTTP API and CLI.
   `tools/list` additionally hides tools whose required capability the key lacks.
4. **Explicit allow-list.** Tools are an explicit table of operation IDs with a name, a description,
   annotations and a confirmation rule. Input schemas are derived from the live OpenAPI document, so
   contracts are not copied. Session-only operations (account, API keys, access administration,
   installation, OAuth connection, realtime, binary uploads) are not exposed. Parity with the CLI's
   project workflows is the target; file upload is replaced by import from URL.
5. **Effects are explicit.** Every tool carries MCP annotations (`readOnlyHint`, `destructiveHint`,
   `idempotentHint`, `openWorldHint`). Operations that can schedule, publish, retry, reconcile or change
   external timing require `confirm: true`; without it the call returns an error result describing the
   effect and performs nothing. Revision and cadence-confirmation fields of the API remain the caller's
   responsibility.
6. **Controls.** `POSTDOT_MCP_ENABLED` (default true) disables the endpoint. Responses are capped in size.
   A test fails when an allow-listed operation is missing, has no capability, or a dispatch-capability
   operation lacks a confirmation rule.

## Consequences

Hosted agents that need OAuth cannot connect yet. Adding a public operation to MCP is a deliberate table
entry. The MCP surface cannot exceed what the same key could do over HTTP.
