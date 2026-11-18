<!-- cspell:disable -->

# AI Agent Architecture Survey for Postdot

Date: 2026-11-18
Scope: Research survey only (no codebase modifications).

## Baseline: Postdot's Existing Tool and Permission Surface

Postdot runs on Bun (`>=1.4.4`, [package.json](package.json)), Elysia ([apps/api/package.json](apps/api/package.json)), React 19 + TanStack Query + TanStack Router ([apps/web/package.json](apps/web/package.json)), SQLite or PostgreSQL (`packages/db`), and Better Auth under `AGPL-3.0-only`.

Its existing MCP and authorization layers already solve much of the tool-exposure problem:

- **Curated tool catalog ([tool-catalog.ts](apps/api/src/modules/mcp/tool-catalog.ts))**: `mcpToolCatalog` maps roughly 150 API `operationId` values with `guidance`, `rename`, `destructive`, `openWorld`, and `confirm` (`boolean | ((input) => boolean)`, e.g. `schedulesDelivery`).
- **OpenAPI-to-tool compiler ([openapi-tools.ts](apps/api/src/modules/mcp/openapi-tools.ts))**: `buildMcpTools` inspects the live `/openapi/json` schema, binds each endpoint to a `PostdotApiKeyCapability` via `requiredApiKeyCapability(method, path)`, flattens path/query/JSON-body parameters, injects a mandatory `confirm: boolean` parameter for confirmation-required tools (non-waivable for `publication:dispatch`), and emits MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`).
- **Stateless JSON-RPC MCP server ([server.ts](apps/api/src/modules/mcp/server.ts), [routes.ts](apps/api/src/modules/mcp/routes.ts))**: `handleMcpMessage` supports MCP `2025-06-18`, `2025-03-26`, and `2024-11-05` over stateless `POST /mcp` (`routes.ts` returns `405` on `GET`/`DELETE`). Before executing, it checks `context.allows(tool.capability, tool)`, validates arguments, blocks execution when `tool.requiresConfirmation(input) && input.confirm !== true`, dispatches an internal HTTP `Request` through `options.dispatch`, and truncates outputs above 100,000 characters.
- **Scoped permissions ([api-key-permissions.ts](apps/api/src/modules/projects/api-key-permissions.ts))**: Defines 15 granular capabilities (`project:read`, `project:manage`, `project:permanently_delete`, `publication:manage`, `publication:dispatch`, `channel:manage`, `channel:share`, `media:manage`, `analytics:refresh`, `media:permanently_delete`, `project:access_manage`, `publication:approve`, `workspace:manage`, `api_key:manage`, `instance:admin`). Unknown routes fail closed (`null`).
- **Existing AEAD encryption ([encrypted-secret-crypto.ts](packages/db/src/encrypted-secret-crypto.ts), [publisher-credential-crypto.ts](packages/db/src/publisher-credential-crypto.ts))**: Implements AES-256-GCM (`crypto.subtle`) with versioned envelopes, `keyId`, 12-byte random nonces, 128-bit tags, and domain-separated Authenticated Associated Data (AAD) binding `recordId` and `purpose`.
- **Existing durable workers ([worker.ts](apps/api/src/modules/workflow/worker.ts), [runtime.ts](apps/api/src/modules/notifications/runtime.ts))**: Uses `NextEventScheduler`, `createExponentialRetryPolicy`, DB-backed lease tokens (`@postdot/core` + `@postdot/db`), and post-commit wakeups without requiring Redis or an external message broker.

---

## 1. Twenty CRM (`twentyhq/twenty`) Built-in AI Agent

Repository: https://github.com/twentyhq/twenty (AGPL-3.0, NestJS backend + React 19 frontend).

### Framework and Libraries

- **Backend (`packages/twenty-server/package.json`)**:
  - Core agent and provider stack: Vercel AI SDK `ai` (`7.0.126`), `@ai-sdk/openai` (`^4.0.83`), `@ai-sdk/anthropic` (`^4.0.71`), `@ai-sdk/google` (`^4.0.87`), `@ai-sdk/mistral` (`^4.0.56`), `@ai-sdk/xai` (`^5.0.14`), `@ai-sdk/amazon-bedrock` (`^5.0.104`), `@ai-sdk/azure` (`^4.0.89`), `@ai-sdk/openai-compatible` (`^3.0.62`), `@ai-sdk/provider-utils` (`^5.0.53`), and `@ai-sdk/typesafe-ai` (`^3.0.12`).
  - MCP client/server interop: `@modelcontextprotocol/sdk` (`1.32.2`).
  - Queueing and streaming transport: `bullmq` (`5.78.0`), `ioredis` (`5.10.1`), and `graphql-yoga` (`5.24.6`).
- **Frontend (`packages/twenty-front/package.json`)**: React `^19.2.0`, `@apollo/client` (`^4.0.0`), `graphql-sse` (`^2.5.4`), `jotai` (`^2.17.1`), and `ai` (`7.0.126` for shared stream/message types).

### Model Providers Supported and Key Configuration

- **Catalog + custom providers**: Twenty maintains declarative JSON catalogs (`packages/twenty-server/src/engine/metadata-modules/ai/ai-models/ai-providers.json`, `ai-models.json`, and `ai-self-host-spec.json`), synced daily via `.github/workflows/ci-ai-catalog-sync.yaml`.
- **Runtime instantiation (`packages/twenty-server/src/engine/metadata-modules/ai/ai-models/services/sdk-provider-factory.service.ts`)**: `SdkProviderFactoryService` creates and caches AI SDK provider instances by `SdkType`: OpenAI (Chat/Responses), Anthropic, Google (wrapped via `wrapLanguageModel` with `sanitizeGeminiToolResultRefsMiddleware`), Mistral, xAI (using `.responses(modelId)`), Amazon Bedrock (API key or IAM credentials), Azure OpenAI, and OpenAI-compatible (requiring `baseUrl` for proxies or local models).
- **Instance-level keys vs. workspace settings**:
  - `ProviderConfigService` (`packages/twenty-server/src/engine/metadata-modules/ai/ai-models/services/provider-config.service.ts`) reads `AI_PROVIDERS` and environment variables from `TwentyConfigService` (`packages/twenty-server/src/engine/core-modules/twenty-config/config-variables.ts`), managed under instance admin routes (`AdminPanelNewAiProvider` and `AdminPanelAiProviderDetail` in `packages/twenty-shared/src/types/SettingsPath.ts`).
  - Built-in catalog providers resolve `{{ENV_VAR}}` placeholders against `twentyConfigService` / `process.env`. For admin-supplied `AI_PROVIDERS`, `ProviderConfigService` explicitly disables `{{VAR}}` template interpolation to prevent environment variable exfiltration.
  - Workspaces configure data policies (`WorkspaceAiDataPolicyService` in `ai-models/services/workspace-ai-data-policy.service.ts`) and per-workspace credit consumption (`ai-billing/`) rather than separate workspace BYOK credentials. (Whether any private Twenty Cloud billing module overrides this was not verified, but open-source `config-variables.ts` and `SettingsPath.ts` place provider keys at the instance admin layer.)

### Tool Mapping to the Data Model

- **Registry and modular providers (`packages/twenty-server/src/engine/core-modules/tool-provider/`)**:
  - `ToolRegistryService` (`services/tool-registry.service.ts`) aggregates `database-tool.provider.ts`, `action-tool.provider.ts`, `dashboard-tool.provider.ts`, `workflow-tool.provider.ts`, `logic-function-tool.provider.ts`, `front-component-tool.provider.ts`, and `mcp-tool.provider.ts`.
  - `DatabaseToolProvider` dynamically generates CRUD, find-many, merge, and group-by JSON-schema tools from workspace metadata caches (`flatObjectMetadataMaps`, `flatFieldMetadataMaps`, `flatFieldMetadataOptionMaps`), translating descriptions via `i18nService`.
- **Lazy tool loading (`packages/twenty-server/src/engine/metadata-modules/ai/ai-agent-execution/services/agent-toolset.service.ts`)**:
  - Supports four tool access modes (`assistant`, `catalog`, `granted`, `none`).
  - Instead of stuffing dozens of object schemas into every prompt, `AgentToolsetService` exposes meta-tools (`learn_tools`, `execute_tool`, `load_skill`) so the agent discovers schemas on demand, alongside `compactToolOutput` and `ToolOutputSpillService` to keep large results out of context memory.

### Permissions Model

- **Interactive vs. autonomous actor contexts (`packages/twenty-server/src/engine/metadata-modules/ai/ai-agent-execution/services/agent-actor-context.service.ts`)**:
  - **Chat sessions** call `buildUserAndAgentActorContext` / `buildRunAsWorkspaceMemberContext`: tools run under the signed-in user's workspace member `roleIds` (never escalating permissions), tagged with `FieldActorSource.AGENT` for audit trails.
  - **Background / triggered agents** call `buildApplicationAgentContext`: runs without a human session using an explicit agent role via `AiAgentRoleService` (`RoleTargetEntity`, checking `role.canBeAssignedToAgents`).
  - `DatabaseToolProvider` passes `PrincipalPermissionsReadService`, `RecordPermissionsReadService`, and `RecordFieldPermissionsReadService` so object-level and field-level permissions filter both tool discovery and query execution.

### Execution Loop, Streaming UI, and Event/Workflow Triggers

- **Step loop (`packages/twenty-server/src/engine/metadata-modules/ai/ai-agent-execution/services/agent-step-loop.service.ts`)**: Wraps AI SDK `streamText` with `stopWhen` predicates (`AGENT_CONFIG.MAX_STEPS`, `endsOnPausingToolCall`, credit/allowance exhaustion), `repairToolCall`, prompt cache breakpoints (`injectCacheBreakpoint`), and per-step billing (`decrementAndCheckAvailableCredits`).
- **Async BullMQ streaming + Redis catch-up**:
  - Frontend hook `useAgentChat` (`packages/twenty-front/src/modules/ai/hooks/useAgentChat.ts`, verified in GitHub issue `#25286`; direct raw fetch to that exact subpath returned 404, possibly moved in a recent refactor) sends `SEND_CHAT_MESSAGE` over Apollo and subscribes to GraphQL SSE `onAgentChatEvent`.
  - Server-side `AgentChatStreamingService` acquires a stream claim (`streamClaimService`) and enqueues `StreamAgentChatJob` onto BullMQ `MessageQueue.aiStreamQueue`.
  - `AgentTurnStreamService` and `AgentChatEventPublisherService` (`packages/twenty-server/src/engine/metadata-modules/ai/ai-chat/services/agent-chat-event-publisher.service.ts`) publish chunks over `onAgentChatEvent` while buffering them in a Redis list (`agent-chat-stream-chunks:{threadId}`, TTL 3600s, atomic Lua reset script) for client catch-up via `chatStreamCatchupChunks`.
- **Event triggers (`packages/twenty-server/src/engine/metadata-modules/ai/ai-agent-trigger/jobs/call-agent-database-event-triggers.job.ts`)**:
  - Database mutations enqueue `MessageQueue.triggerQueue`.
  - The job drops events caused by agents (`isDatabaseEventCausedByAgent`), filters readable events (`recordEventPermissionsReadService`), checks conditions (`DatabaseEventTriggerConditionService`), applies throttling (`AgentTriggerThrottlerService.consumeAvailableRuns`), and enqueues `RunAgentTriggerJob` onto `MessageQueue.aiQueue`.
  - `AgentTriggerRunnerService` re-verifies that the agent is active and that its role has not drifted (`dispatchedRoleId`) before executing with `canAskHumans: false`.
- **Workflow triggers (`packages/twenty-server/src/modules/workflow/workflow-executor/workflow-actions/ai-agent/ai-agent.workflow-action.ts`)**: Workflow nodes dispatch an agent run and return `{ wait: { type: 'CALLBACK' } }`, suspending the workflow until the agent completes and calls back.

---

## 2. Other Open Source Apps with Built-in Agents

| Project | Repo / License | Agent Framework Choice | Model Provider & BYOK Strategy | Relevance to Postdot |
| :--- | :--- | :--- | :--- | :--- |
| **Postiz (`postiz-app` / `postiz-agent`)** | https://github.com/gitroomhq/postiz-app (Apache-2.0) | **`mastra`** (`^1.1.4`) + `@ai-sdk/openai` (`^2.0.52`) embedded in the app; separate `postiz-agent` CLI + `SKILL.md` + MCP server for external coding CLIs. | AI SDK / OpenAI adapter inside Mastra; external agent authenticates with a Postiz API key (`X-API-Key`). | Closest domain peer (social scheduling). Shows the split between an embedded chat/autopost agent and an external CLI/MCP client interface. |
| **Dify** | https://github.com/langgenius/dify (Dify Open Source / Apache-2.0 variant) | Python Flask core + Celery; newer standalone `dify-agent` service uses FastAPI + **Pydantic AI**; Go `dify-plugin-daemon` and `dify-sandbox` for isolated plugin/code execution. | Decoupled **Model Provider Plugins** + `ProviderManager` / `LBModelManager` (100+ LLMs, Ollama, vLLM). Workspace BYOK keys encrypted with per-workspace RSA key pairs or Azure Key Vault; multi-key load balancing. | Strong reference for workspace BYOK secret isolation, multi-key pools, and strict step/timeout budgets (`DIFY_AGENT_RUN_TIMEOUT_SECONDS`). |
| **Open WebUI** | https://github.com/open-webui/open-webui (Open WebUI License) | Python FastAPI; legacy `open-webui/pipelines` repo archived in favor of in-process **Pipe Functions** (`class Pipe`), **Filter Functions** (`inlet`/`outlet`/`stream`), and Open Terminal. | **"Protocols, Not Providers"**: native Ollama protocol (`/api/*`, multi-instance load balancing) + OpenAI Chat Completions protocol (plus experimental Open Responses) for vLLM, LM Studio, OpenRouter, LiteLLM. | Proves that supporting Ollama + OpenAI-compatible covers almost every local/proxy setup without maintaining 20 provider SDKs. Also shows Streamable HTTP MCP with `{{USER_ID}}` header forwarding. |
| **n8n AI Nodes** | https://github.com/n8n-io/n8n (`packages/@n8n/nodes-langchain`, Sustainable Use License) | **LangChain.js** wrapped in cluster nodes; V3 Tools Agent (`ToolsAgent/V3/`) uses an `EngineRequest` / `EngineResponse` suspend-and-resume protocol with `workflow-execute.ts`. | `supplyData()` pattern: LLM sub-nodes instantiate LangChain chat models (OpenAI, Anthropic, Google, Ollama, custom OpenAI-compatible `baseUrl`) behind `AiLanguageModel` + `Model Selector` routing node + `MCP Client Tool`. | Clean suspend/resume boundary (`EngineRequest` / `EngineResponse`) separating durable workflow orchestration from synchronous LLM loops. |
| **AFFiNE** | https://github.com/toeverything/AFFiNE (MIT / EE source-available) | Custom NestJS plugin (`packages/backend/server/src/plugins/copilot/`) with explicit provider adapters and tool modules (`doc-compose.ts`, `doc-edit.ts`, `mcp/provider.ts`). | Direct adapters for OpenAI, Anthropic Claude, OpenRouter, and BYOK endpoints without an external agent framework. | Shows how lean a custom server plugin can be when domain data/auth integration is the main complexity. |
| **Huly** | https://github.com/hcengineering/platform / `huly-ai-agent` (EPL-2.0) | Dedicated **Rust** service (`huly-ai-agent`) + `aibot` platform service backed by MongoDB. | Service-isolated model clients running in employee/assistant modes reacting to DMs, presence, activity streams, and scheduled memory maintenance. | Models the agent as an explicit workspace actor reacting to activity streams and periodic maintenance jobs. |
| **Plane** | https://github.com/makeplane/plane (AGPL-3.0 OSS) | Built-in **Plane AI (PI)** is a separate closed commercial microservice (`makeplane/plane-pi-commercial`, BYOK); OSS offers `plane-mcp-server` (FastMCP) and `plane-node-sdk` (`AgentRuns`). | BYOK inside the commercial PI microservice; OSS relies on external MCP clients. | Illustrates separating `AgentRuns` tracking and MCP exposure in AGPL core from hosted AI microservices. |
| **Cal.com** | https://github.com/calcom/cal.com (AGPL-3.0 OSS) | Legacy `calcom/cal.ai-archive` used LangChain for email scheduling; modern `Cal.ai` is closed/hosted, while OSS provides API v2, `@calcom/cli`, and hosted MCP OAuth. | Hosted proprietary orchestration vs. OSS API/MCP primitives. | Same pattern as Plane: OSS exposes clean API + MCP rather than bundling a full OSS agent. |
| **Documenso** | https://github.com/documenso/documenso (AGPL-3.0) | No built-in AI agent (open feature requests such as `#2789`). | None built-in. | Confirms OSS SaaS peers without embedded agents tend to start with MCP/API integration first. |

---

## 3. TypeScript Frameworks and SDKs (2026 Comparison)

### Comparison Matrix

| Framework / SDK | License (2026) | Provider Coverage | Tool Calling & MCP | Streaming to React | Bun Server Compatibility | Bundle / Dependency Weight | Maturity |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Vercel AI SDK** (`ai` v6 / v7) | **Apache-2.0** | Broadest catalog: `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai-compatible` (Ollama, LM Studio, vLLM, OpenRouter, LiteLLM). | `ToolLoopAgent`, `needsApproval` / `toolApproval`; `@ai-sdk/mcp` (v1 for v6, v2 for v7) supports Streamable HTTP, SSE, stdio, `toolSearch()`, MCP 2026-07-28, MCP Apps. | `@ai-sdk/react` (`useChat`, `DefaultChatTransport`, typed `InferAgentUIMessage`, SSE UI stream). | Supported (`bun add`, Web `fetch`/`ReadableStream`, Vercel Bun 1.4 runtime support). Caveats: pass custom `fetch` for proxies; `convertBase64ToUint8Array` memory spike on large images (`vercel/ai#24324`); `@ai-sdk/google-vertex` needs `google-auth-library@11.3.1+`. | `ai` v7.0.173: ~530 kB min / **135 kB min+gzip** (3 direct deps: `@ai-sdk/gateway`, `@ai-sdk/provider`, `@ai-sdk/provider-utils`; ~24.3 MB disk install with OpenAI + React). | **High**. Industry default in TS (used by Twenty CRM). v7 (June 2026) is ESM-only, Node 22+. |
| **TanStack AI** (`@tanstack/ai` v1.x) | **MIT** | 23-24 adapters including OpenAI, Anthropic, Gemini, native Ollama, OpenRouter, OpenAI-compatible, and `/byok` `keyedAdapter`. | Built-in tool loops, subagents, tool approvals, conversation compaction, `createMCPClient`, plus Code Mode. | `@tanstack/ai-react` (`useChat`) using the AG-UI streaming protocol; aligns closely with TanStack Query/Router. | First-class Bun support, including native Bun QuickJS isolate via `bun:ffi` (`@tanstack/ai-isolate-quickjs-bun`). | Leaner raw bundle than AI SDK v7 in benchmarks, though slower initial cold-start import latency reported vs. `ai` in Node benchmarks. | **Medium (new)**. Beta June 2026, v1.0 Oct 2026 (`1.2.0` Nov 2026). Fewer production references. |
| **Mastra** (`@mastra/core` v1.83+) | **Dual**: Apache-2.0 core; **Mastra EE v2.0** source-available (RBAC, FGA, Agent Builder). | Wraps AI SDK v5/v6 + model router; Ollama via `ollama-ai-provider-v2` or `@ai-sdk/openai-compatible`; Private Model Gateways (`AUTO_BLOCK_EXTERNAL_PROVIDERS`). | `@mastra/mcp` v2.8 supports MCP 2026-07-28, tool discovery, workflows, memory, `AgentController` resumable streams. | Compatible with `@ai-sdk/react` or Mastra client SDK stream adapters. | Runs on Bun at runtime, but `mastra build` has bundler issues in Bun monorepos (recommended to use server adapters directly without `mastra build`). | **Heavy**. Full framework (workflows, DB storage, memory, evals, server). | **Medium-High**. Used by Postiz (`mastra ^1.1.4`). Enterprise RBAC is EE-gated. |
| **LangChain.js / LangGraph.js** (`langchain` 1.6.x, `@langchain/langgraph` 1.7.x) | **MIT** (LangSmith is optional commercial SaaS). | Modular `@langchain/*` packages (`openai`, `anthropic`, `google-genai`, `ollama`, OpenAI-compatible via `baseURL`). | `createAgent` / `StateGraph` with typed `interrupt()`, checkpointers; `@langchain/mcp-adapters` v2 (`MCPAdapter`, stdio + Streamable HTTP, HITL). | Requires custom/LangGraph stream wiring to React UI hooks. | Official `bun add` support and tested in Bun 1.4 CI; core uses Web `fetch`. Some `@langchain/community` loaders depend on Node fs/addons. | **Medium-Heavy**. `@langchain/langgraph` 55.2 kB gzip + `langchain` 124.7 kB gzip + `@langchain/openai` 162.2 kB gzip (~200-700+ kB gzip full stack). | **High**. v1.0 GA since Oct 2025; mature graph state machine (used by n8n). |
| **OpenAI Agents SDK JS** (`@openai/agents` v0.22+) | **MIT** | OpenAI-first (`Responses` + `Chat Completions`). Other models require custom `ModelProvider` or AI SDK bridge (`@openai/agents-extensions`). | `MCPServerStreamableHttp`, `MCPServerStdio`, `HostedMCPTool`, Sandbox Agents, built-in HITL `interruption` approvals. | Backend-focused; requires custom SSE/WebSocket glue for React. | Officially supports **Bun 1.2.5+** (minor `AsyncLocalStorage` tracing caveat with custom AI-SDK adapters). | **Light-Medium** (`@openai/agents` + `openai` v7 + Zod v4). | **Medium-High**. Strong for OpenAI Responses API, weak as a neutral BYOK / local-model layer. |
| **Anthropic SDK / OpenAI SDK** (`@anthropic-ai/sdk` v1.x, `openai` v7.x) | **Apache-2.0** (Anthropic SDK switched MIT -> Apache-2.0 at v1.0 in Oct 2026). | Single vendor each (`openai` SDK can target OpenAI-compatible `baseURL` endpoints). | No built-in agent loop or approval state; must pair manually with `@modelcontextprotocol/client` v2. | Raw `messages.stream()` / SSE iterators; manual React state management. | **Native support** (`Bun >= 1.0`, Bun export map). | **Lightest** if only wrapping 1-2 transports directly. | **Very High** as raw HTTP clients, zero agent abstractions. |
| **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) | **PROPRIETARY** (`© Anthropic PBC. All rights reserved.`) | **Claude only** (Anthropic API, Bedrock, Vertex, Foundry). No OpenAI or local Ollama. | Spawns bundled Claude Code binary; native MCP + shell/file tools + `canUseTool` / `onElicitation`. | Emits SDK stream events (no React UI hook). | Runs via Node/Bun subprocesses, spawning native CLI executable. | **Very Heavy** (bundles CLI agent runtime). | **Medium-High** for coding agents; **unsuitable** as general BYOK runtime in an AGPL-3.0 app. |
| **Cloudflare Agents** (`agents`, `@cloudflare/ai-chat`) | **MIT** | `agents/models/ai-sdk` (`ProviderV4` over Workers AI / AI Gateway or `@ai-sdk/*`). | `MCPClientManager`, stateless `createMcpHandler` (MCP 2026-07-28), `@cloudflare/codemode`. | `AIChatAgent` WebSocket + Durable Object SQLite resumable streams. | **Not applicable to Bun servers**: coupled to Cloudflare Workers & Durable Objects runtime. | N/A for self-hosted Bun/Docker. | **Medium** (Cloudflare-specific). |

### Recommendation for Postdot

1. **Primary choice: Vercel AI SDK (`ai` v6 or v7 + `@ai-sdk/react` + `@ai-sdk/openai` + `@ai-sdk/anthropic` + `@ai-sdk/google` + `@ai-sdk/openai-compatible`)**.
   - **Why**: Apache-2.0 is clean alongside Postdot's `AGPL-3.0-only` license. It runs natively on Bun and Elysia Web Streams, pairs directly with React 19 via `@ai-sdk/react` (`useChat`), and models confirmation gates cleanly via `ToolLoopAgent` and `needsApproval`. Covering OpenAI Responses + Chat Completions, Anthropic Messages, Gemini, and `@ai-sdk/openai-compatible` handles commercial BYOK, proxies (OpenRouter, LiteLLM), and local models (Ollama, LM Studio, vLLM) with one unified interface.
   - **Caution**: Watch the AI SDK v6 -> v7 ecosystem split: ensure any community Ollama adapter targets `@ai-sdk/provider@4.x` if adopting v7, or simply target Ollama's OpenAI-compatible `/v1` or stateless `/v1/responses` endpoint directly via `@ai-sdk/openai-compatible` / `@ai-sdk/openai`.
2. **Runner-up: TanStack AI (`@tanstack/ai` + `@tanstack/ai-react`)**.
   - Fits Postdot's existing TanStack stack (Query + Router), is MIT-licensed, includes `keyedAdapter` for BYOK and native Ollama support, and avoids `@ai-sdk/gateway` bloat. Wait for slightly more production mileage (v1.0 shipped Oct 2026) or treat it as a clean swap target behind a thin Postdot provider registry.
3. **Avoid as core runtime**: Claude Agent SDK (proprietary license, Claude-only, subprocess blast radius), Mastra (Bun monorepo bundler friction, EE-gated RBAC, redundant persistence/workflow engine next to `@postdot/core` + `@postdot/db`), and Cloudflare Agents (Durable Objects lock-in).

---

## 4. Bring-Your-Own-Key (BYOK): Standards, Storage, and Cost Control

### Protocol Standards to Support

1. **OpenAI Chat Completions (`POST /v1/chat/completions`)**:
   - The baseline protocol for local inference and gateways: **Ollama**, **LM Studio**, **vLLM**, **llama.cpp**, **OpenRouter**, **LiteLLM**, Mistral, Groq, DeepSeek, and custom corporate proxies.
   - Must allow optional or empty API keys when `baseUrl` points to a local server (Ollama/LM Studio).
2. **OpenAI Responses API (`POST /v1/responses`)**:
   - Mandatory for recent OpenAI reasoning models with tools: starting with GPT-5.4, OpenAI Chat Completions rejects tool calls whenever `reasoning_effort` is not `'none'` (and GPT-6 Astra drops tool calling on Chat Completions entirely); the Assistants API shut down on August 26, 2026.
   - **Always use stateless mode (`store: false`)**: OpenRouter's OpenResponses endpoint strictly rejects `store: true` or `previous_response_id` with HTTP `400`; Ollama v0.13.3+ supports stateless `/v1/responses` only. Keeping conversation history in Postdot's own DB works consistently across OpenAI, OpenRouter, LiteLLM, and Ollama, and aligns with Zero Data Retention (ZDR).
   - **Encrypted reasoning (`include: ["reasoning.encrypted_content"]`)**: When using stateless Responses with OpenAI/OpenRouter reasoning models, store and replay returned `reasoning` output items untouched within the same provider/key for cache hits and reasoning continuity. Never replay `encrypted_content` across a different OpenAI org, key, or fallback provider (it fails with `invalid_encrypted_content` unless stripped on failover, as LiteLLM v1.102+ does).
3. **Anthropic Messages API (`POST /v1/messages`)**:
   - Needed for direct Anthropic keys (`x-api-key`, or `Authorization: Bearer` in API version `2026-10-21`), explicit prompt caching (`cache_control` breakpoints), thinking blocks, and Anthropic-compatible proxy endpoints (LiteLLM / OpenRouter).
4. **Google Gemini API**:
   - Optional fourth native adapter for users bringing Google AI Studio keys (`AIza...`), applying a tool-call ref sanitization middleware (as Twenty does) or routing Gemini via OpenRouter.

**Configuration UX**: Provide preset templates (OpenAI, Anthropic, Google, OpenRouter, Ollama, LM Studio, LiteLLM / Custom OpenAI-Compatible) backed by `{ protocol, baseUrl, apiKeyEncrypted, defaultModel, extraHeaders }`. Enforce SSRF safeguards on user-supplied `baseUrl` values in multi-tenant deployments (blocking cloud metadata IPs `169.254.169.254` and private ranges unless an instance setting explicitly allows local/LAN endpoints for self-hosted Ollama).

### Secure Storage of Keys at Rest

Postdot already provides production-ready AEAD encryption in [`packages/db/src/encrypted-secret-crypto.ts`](packages/db/src/encrypted-secret-crypto.ts):

- **Reuse `createSecretCipher`**: Add a dedicated domain (e.g. `'postdot.ai-provider-secret'`) using the existing AES-256-GCM (128-bit tag, 12-byte random nonce per write, `keyId` rotation support) and AAD context (`recordId`, `scopeType`, `scopeId`, `'api_key'`) so encrypted blobs cannot be moved across workspaces, users, or rows.
- **Zero-echo API**: Never send decrypted keys back in API responses or SSE payloads; expose only a masked preview (last 4 characters) and `hasApiKey: boolean`.
- **No env-var templating in DB records**: Follow Twenty's rule in `ProviderConfigService`: never resolve `{{VAR}}` placeholders from `process.env` inside user-supplied DB provider configs, blocking environment variable exfiltration (e.g. `BETTER_AUTH_SECRET` or `DATABASE_URL`).
- **Clear credential precedence**: Support explicit scopes (instance default set by `instance:admin`, workspace key set by `workspace:manage`, optional personal key) and display which key is billed before a chat or trigger runs.

### Cost Control (Budgets and Per-User Limits)

- **Hard execution bounds**: Enforce `maxSteps` per turn (e.g. `15-20`, matching Twenty's `AGENT_CONFIG.MAX_STEPS`), `maxTokens` per model call, and wall-clock run timeouts (matching Dify's `DIFY_AGENT_RUN_TIMEOUT_SECONDS`). Truncate oversized tool outputs before appending to message history (Postdot MCP caps at 100k chars; an interactive chat loop should summarize or cap at ~8k-16k chars).
- **Pre-call reservation + post-call reconciliation**: Checking budgets only after a run completes lets concurrent tabs or parallel trigger events overspend. Reserve an estimated worst-case ceiling (or concurrency slot) before dispatching a step, then settle against actual `usage` (`inputTokens`, `outputTokens`, `cachedInputTokens`) when the stream ends.
- **Usage ledger and separated quotas**: Store every call in `ai_usage_ledger` (`workspaceId`, `userId`, `triggerId`, `providerConfigId`, `model`, tokens, estimated USD micros). Set tighter daily/hourly dollar/token and RPM caps on autonomous event triggers than on interactive user chat so a retry storm cannot drain a BYOK balance overnight.
- **Model tiering**: Let admins restrict background triggers to cheaper or local models while allowing frontier models in interactive chat.
- **External gateway caveats (if users proxy via LiteLLM or OpenRouter)**:
  - **LiteLLM**: Budgets fail open unless PostgreSQL is attached (and per-pod in clusters without Redis + `fail_closed_budget_enforcement: true`).
  - **OpenRouter**: BYOK requests are **excluded** from OpenRouter Workspace Budgets, Guardrails, and key limits by default unless `include_byok_in_budgets: true` / `include_byok_in_limit` is explicitly enabled, and OpenRouter falls back to paid OpenRouter credits on BYOK rate limits unless fallback is disabled.

---

## 5. Subscription-Based Coding CLIs as Backends (`pingdotgg/t3code` Study and Docker Feasibility)

### How T3 Code (`pingdotgg/t3code`) Drives Coding CLIs

Repository: https://github.com/pingdotgg/t3code (MIT). Inspected files: `docs/internals/providers.md`, `docs/user/faq.md`, `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts`, `ClaudeAdapterV2.ts`, `packages/effect-codex-app-server/package.json`, and `packages/effect-acp/package.json`.

- **Control plane model**: T3 Code does not implement its own LLM loop. It registers driver adapters (`ProviderAdapterRegistry`, `ProviderInstanceRegistry` in `docs/internals/providers.md`) and supervises external agent CLIs as child processes via Effect (`ChildProcessSpawner`, `AgentScope`).
- **Process models and protocols**:
  1. **Codex CLI (`CodexAdapterV2.ts` + `packages/effect-codex-app-server`)**: Launches a shared **`codex app-server`** subprocess over **stdio JSON-RPC** (`protocol.ts`, `client.ts`, `stdio.ts`, generated schemas in `_generated/meta.gen.ts`). Uses line-delimited JSON-RPC with `Deferred` request promises and `Semaphore` / `Queue` backpressure.
  2. **Claude Code (`ClaudeAdapterV2.ts`)**: Uses **`@anthropic-ai/claude-agent-sdk`**, which spawns the Claude Code executable. T3 Code wraps the binary with `agentScope.wrap`, feeds prompts through an async iterable `Queue`, passes MCP credentials over **stdin** (avoiding `argv`/`env` leaks), tracks descendant pids via `ps` (`trackDescendants`) to clean up orphan jobs, and invokes a helper worker (`getSessionMessages`) to compute revert/resume boundaries (`resumeSessionAt`).
  3. **ACP (Agent Client Protocol) (`packages/effect-acp`, `packages/provider-acp`, `packages/provider-acp-registry`)**: Shared stdio/JSON-RPC adapter for ACP-capable CLIs (such as Gemini CLI). `scripts/generate.ts` pins upstream ACP schemas (`schema-v1.21.0` and `schema-v2.0.0-alpha.3`); prefers ACP v2 preview and falls back to ACP v1.
  4. **Additional harnesses**: OpenCode (v1 per-thread server or v2 per-instance HTTP), Pi (RPC mode), Cursor, Muse.
- **Auth isolation**: Uses per-instance shadow profile directories (`materializeCodexShadowHome` in `CodexHomeLayout.ts`, `antigravityAuthSupport.ts`), strips ambient host credentials from child `env`, and performs ephemeral OAuth handoffs (`CodexChatGptHandoff.ts`) so concurrent threads do not invalidate shared refresh tokens in `~/.codex/auth.json`.
- **Update handling (`providerMaintenanceRunner.ts`)**: Resolves binary symlinks to identify package-manager ownership (Homebrew, npm, pnpm, Bun, Volta, mise, Chocolatey) or delegates to native CLI updaters, holding version leases against active threads so updates do not kill running sessions.

### Feasibility for a Server Deployment (Docker Image)

#### 1. Installing and Updating CLIs in Docker
- Shipping Node/Bun plus `@anthropic-ai/claude-code`, `@openai/codex`, and `@google/gemini-cli` inflates the image by hundreds of megabytes and requires a glibc-based image (Debian/Ubuntu-slim rather than Alpine) for native binaries.
- Container filesystems are immutable across redeploys, so in-app self-updates break unless pinned in image builds or stored on a persistent tool volume with process-lease restarts.
- Coding CLIs assume a local workspace `cwd` and shell/filesystem tools. Even with built-in tools disabled (`disallowedTools`), Postdot would inherit constant upstream CLI protocol churn (evidenced by T3 Code issues like `#30993`, `#28697`, `#24300`, `#35830`).

#### 2. Headless Login
- Consumer subscriptions rely on browser OAuth (`localhost` redirects or device codes). In Docker, users must run interactive `docker exec` auth flows or copy/mount token files (`~/.claude`, `~/.codex/auth.json`).
- Shared containers suffer OAuth refresh-token race conditions unless each session/user gets an isolated profile home like T3 Code's shadow-home pattern.

#### 3. Provider Terms of Service (Factual Assessment)

| Provider | Personal Subscription from a Server / Multi-User App | Official Policy Basis |
| :--- | :--- | :--- |
| **Anthropic (Claude Pro / Max)** | **Prohibited** for third-party/multi-user apps and OAuth embedding. | Anthropic's Claude Agent SDK docs and Commercial Terms prohibit third-party developers from offering `claude.ai` subscription OAuth login or routing third-party/multi-user products through consumer Pro/Max OAuth tokens without prior Anthropic approval. Production and multi-user apps must use `ANTHROPIC_API_KEY` (or Bedrock/Vertex/Foundry). Since October 2026, Max/Ultra/Team plans include monthly Console API credits usable via a linked `ANTHROPIC_API_KEY` (https://platform.claude.com/docs/en/agent-sdk/overview). |
| **OpenAI (ChatGPT Plus / Pro + Codex CLI)** | **Prohibited** for shared/multi-user servers or hosted SaaS; heavily restricted even for single-user remote servers. | OpenAI Terms of Use and Services Agreement prohibit sharing credentials across users or reselling/leasing access. OpenAI's Codex auth documentation states: *"Use API key authentication for programmatic Codex CLI workflows, such as CI/CD jobs. Don't expose Codex execution in untrusted or public environments."* Single-stream `auth.json` reuse is documented only for trusted private runners. Under **Sign in with ChatGPT (SIWC)** terms, open dynamic OAuth is restricted to open-source/local apps (hosted SaaS requires allowlisting), tokens must stay local under the user's control (*"not in a remote or managed environment"*), and another user's activity must never trigger requests on a user's account (https://developers.openai.com/codex/auth/). |
| **Google (Gemini CLI / Antigravity)** | **Prohibited** for third-party wrappers, proxies, headless servers, or multi-user sharing; consumer Gemini CLI OAuth deprecated June 2026. | Effective June 18, 2026, Google ended consumer-tier (`Gemini Code Assist for individuals`, `Google AI Pro`/`Ultra`) access on Gemini CLI, migrating personal login to Antigravity. Both Gemini CLI FAQ/docs and **Section 6 of the Google Antigravity Additional Terms of Service** prohibit third-party tools, wrappers, or proxies from using personal OAuth tokens (`cloudcode-pa.googleapis.com`), enforcing automated `403 PERMISSION_DENIED` account suspensions. Official Gemini CLI docs require **Gemini API Key** or **Vertex AI** for headless/server use (https://geminicli.com/docs/get-started/authentication/). |

#### 4. Security of Running an Agent CLI Next to the App

- **Secret exposure**: Coding CLIs execute bash/file operations by design. If invoked in the same container as Postdot's API, a prompt injection in an inbound comment, RSS item, or draft could read `DATABASE_URL`, `BETTER_AUTH_SECRET`, SQLite files, or the `createSecretCipher` encryption key, bypassing all `PostdotApiKeyCapability` checks.
- **Verdict**: Do **not** bundle subscription coding CLIs in Postdot's server image. Single-user self-hosters who want to spend their Claude/ChatGPT/Gemini subscription can already point their *local* Claude Code, Codex CLI, Gemini CLI, or T3 Code at Postdot's existing `POST /mcp` server over HTTPS with a scoped API key, staying both secure and within provider ToS.

---

## 6. Event-Triggered Agents and Human-in-the-Loop Approvals

### Event-to-Agent Pipeline Patterns

Combining Twenty CRM's trigger architecture (`ai-agent-trigger/`), n8n's `EngineRequest`/`EngineResponse` suspension, and Postdot's existing [`worker.ts`](apps/api/src/modules/workflow/worker.ts):

1. **Loop prevention (anti-echo)**: Twenty's `CallAgentDatabaseEventTriggersJob` filters out mutations where `isDatabaseEventCausedByAgent` is true. Postdot should stamp agent-originated mutations with an `agent:{triggerId}` actor so `draft.created` or publication retries never re-trigger the agent recursively.
2. **Idempotency & coalescing**: Deduplicate events with deterministic idempotency keys (`eventType:entityId:version`), following Postdot's post-commit coalescing pattern in [`notifications/runtime.ts`](apps/api/src/modules/notifications/runtime.ts).
3. **Brokerless durable queue & retries**: Keep Postdot's zero-Redis deployment footprint (SQLite and PostgreSQL) by using a DB `ai_trigger_jobs` table polled/woken by `@postdot/core`'s `NextEventScheduler`, `claimToken` leases, and `createExponentialRetryPolicy`. Re-check that the trigger rule and its capability grant are still active when claimed (`AgentTriggerRunnerService` pattern).
4. **Throttling & circuit breaking**: Rate-limit trigger executions per project/rule (`AgentTriggerThrottlerService` pattern), separate transient `429`/`5xx` retries from permanent failures, and auto-pause failing rules.
5. **Audit logging**: Persist immutable `ai_agent_runs` and `ai_agent_run_steps` records capturing trigger source, effective capabilities/`projectIds`, provider/model, token usage, tool inputs/outputs, and approval actors.

### Human Approval Before Risky Actions

1. **Interactive chat pause/resume**:
   - Postdot's [`tool-catalog.ts`](apps/api/src/modules/mcp/tool-catalog.ts) and [`openapi-tools.ts`](apps/api/src/modules/mcp/openapi-tools.ts) already classify every risky operation with `confirm: true`, `confirm(input)` (e.g. `schedulesDelivery`), or `destructive: true`, and make `publication:dispatch` confirmation non-waivable.
   - Map `tool.requiresConfirmation(input)` directly to Vercel AI SDK's `needsApproval` (or a Twenty-style `ProposeToolCallPausingTool`). Persist a pending proposal row containing the target `operationId`, proposed arguments, and an entity concurrency snapshot (such as `publication.updatedAt` and `status`).
   - On human approval in Studio (optionally allowing edits strictly limited to proposed fields, as in Twenty), re-verify the user still holds the required `PostdotApiKeyCapability` and `projectIds`, verify the entity snapshot has not drifted, execute with `confirm: true`, and resume the chat stream.
2. **Background / event-triggered runs (`canAskHumans: false`)**:
   - Never allow an autonomous trigger to execute `publication:dispatch`, `*:permanently_delete`, `channel:share`, or `api_key:manage` directly.
   - Restrict event triggers to read/draft/notify capabilities (or a `propose_action` tool) that create a draft or pending approval card and notify the user in Studio/email/webhook to review and dispatch manually.

---

## Recommended Architecture Sketch for Postdot

1. **Framework**: Adopt Vercel AI SDK (`ai` v6/v7 + `@ai-sdk/react` `useChat`) in `apps/api` and `apps/web` (`Apache-2.0` fits `AGPL-3.0-only`; native Bun/Elysia Web Streams and React 19 hooks).
2. **Provider & BYOK Layer**: Build an `AiProviderRegistry` mapping DB configs (`openai-responses` with `store: false`, `openai-chat`, `anthropic`, plus presets for OpenRouter, LiteLLM, Ollama, LM Studio) to `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, and `@ai-sdk/openai-compatible`.
3. **Secret Storage**: Encrypt BYOK API keys at rest via Postdot's existing AES-256-GCM [`createSecretCipher`](packages/db/src/encrypted-secret-crypto.ts) under a new `'postdot.ai-provider-secret'` domain; block `{{ENV}}` interpolation and never return plaintext keys.
4. **Reuse the MCP Tool Catalog**: Extract a shared in-process `PostdotToolExecutor` from [`openapi-tools.ts`](apps/api/src/modules/mcp/openapi-tools.ts) and [`tool-catalog.ts`](apps/api/src/modules/mcp/tool-catalog.ts) so Studio chat shares the exact ~150 OpenAPI schemas, guidance, and `confirm` rules without HTTP loopback overhead.
5. **Lazy Tool Loading**: Expose core discovery meta-tools (`learn_tools` / `execute_tool` or capability-filtered subsets) instead of loading all 150 schemas upfront, preserving accuracy on small local Ollama models.
6. **Permissions via API Key Capabilities**: Reuse [`api-key-permissions.ts`](apps/api/src/modules/projects/api-key-permissions.ts); derive effective `PostdotApiKeyCapability[]` and `projectIds` from the Better Auth user's role in chat, or from a bounded per-trigger capability grant for event runs, enforcing `canApiKeyAccessRequest` on every tool call.
7. **Human Approval Gate**: Bind AI SDK `needsApproval` to `tool.requiresConfirmation(input)`; persist proposals with entity `updatedAt` snapshots, re-verify permissions on approval, and block `publication:dispatch` / `*:permanently_delete` in unattended triggers.
8. **Streaming Chat UI**: Expose an Elysia SSE endpoint (`POST /api/ai/threads/:id/messages`) backed by `ai_threads` and `ai_messages` tables in SQLite/PostgreSQL.
9. **Brokerless Event Triggers**: Dispatch `publication.failed`, `publication.due_manual`, and `draft.created` post-commit into an `ai_trigger_jobs` table run by `@postdot/core`'s `NextEventScheduler` + `createExponentialRetryPolicy`, with anti-echo `agent` actor tags and per-rule rate limits.
10. **Cost Guardrails**: Log every step in `ai_usage_ledger` with pre-call reservation, `maxSteps` (`<= 15`), `maxTokens`, run timeouts, and stricter daily caps on background triggers than interactive chat.

## Key Risks

1. **Tool Schema Bloat on Local Models**: Sending 150 tool schemas breaks context budgets and degrades tool selection on 7B-32B Ollama/LM Studio models (mitigate with lazy `learn_tools` / domain filtering).
2. **Privilege Escalation**: Running tools under an internal admin context instead of the caller's `PostdotApiKeyCapability[]` + `projectIds` leaks cross-project data (mitigate by routing every call through `canApiKeyAccessRequest`).
3. **Indirect Prompt Injection**: Malicious post comments, RSS feeds, or webhook payloads can hijack an event-triggered agent (mitigate by defaulting triggers to draft/propose-only and gating `publication:dispatch` behind human approval).
4. **BYOK Cost Runaways**: Infinite `publication.failed` retry loops or large tool payloads can drain user API balances (mitigate with anti-echo stamps, trigger cooldowns, `maxSteps`, ~8k-16k char tool output truncation in chat, and daily trigger budgets).
5. **Reasoning Replay Errors on Failover**: Replaying OpenAI `reasoning.encrypted_content` after switching keys or providers causes `invalid_encrypted_content` errors (mitigate by tagging turns with `providerConfigId` and stripping opaque encrypted reasoning on provider switch).
6. **Subscription CLI ToS & RCE Risk**: Bundling Claude Code, Codex CLI, or Gemini CLI into Postdot's server container violates consumer ToS for multi-user/server apps and exposes server secrets if bash/file tools are reachable (mitigate by keeping subscription CLIs on users' local machines via `POST /mcp`).
7. **AI SDK Churn & Bun Runtime Quirks**: Rapid major releases (v6 -> v7) and Bun caveats (`convertBase64ToUint8Array` memory spikes, proxy `fetch`) require pinning tested versions and isolating vendor packages behind Postdot's `AiProviderRegistry`.
