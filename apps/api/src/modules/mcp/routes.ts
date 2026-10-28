import type { PostdotAuth } from '@postdot/auth'
import { Elysia } from 'elysia'

import { createUserApiKeyAuthenticator } from '../access/user-api-key-authentication'
import { apiKeyHasCapability, type PostdotApiKeyCapability } from '../projects/api-key-permissions'
import { buildMcpTools, type McpTool } from './openapi-tools'
import { handleMcpMessage, type McpServerContext } from './server'

export interface McpRoutesOptions {
    readonly auth: PostdotAuth
    readonly enabled: boolean
    /** Dispatches a request through the complete API, exactly as an external caller would. */
    readonly dispatch: (request: Request) => Promise<Response>
    readonly allowedOrigins?: readonly string[]
    readonly serverVersion?: string
}

const maximumRequestBytes = 1_000_000
/** The protocol endpoint is documented in the MCP guide, not as an API operation. */
const hidden = () => ({ detail: { hide: true } })

function problem(status: number, message: string, headers: Record<string, string> = {}) {
    return Response.json({ error: { code: 'mcp_error', message } }, { status, headers })
}

function bearerToken(request: Request): string | null {
    return /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? null
}

/** Stateless Streamable HTTP MCP endpoint (ADR-096). Disabled deployments simply do not mount it. */
export function createMcpRoutes(options: McpRoutesOptions) {
    const authenticate = createUserApiKeyAuthenticator(options.auth)
    let tools: Promise<readonly McpTool[]> | undefined
    const loadTools = (origin: string) =>
        (tools ??= (async () => {
            const response = await options.dispatch(new Request(`${origin}/openapi/json`))
            return buildMcpTools((await response.json()) as Record<string, unknown>)
        })().catch(error => {
            tools = undefined
            throw error
        }))

    return new Elysia({ name: 'postdot-mcp' })
        .post('/mcp', hidden(), async ({ request }) => {
            if (!options.enabled) return problem(404, 'MCP is disabled')
            const origin = request.headers.get('origin')
            if (origin !== null && !(options.allowedOrigins ?? []).includes(origin))
                return problem(403, 'Origin not allowed')
            const token = bearerToken(request)
            const key = token === null ? null : await authenticate(token)
            if (token === null || key === null)
                return problem(401, 'A valid Postdot API key is required', {
                    'www-authenticate': 'Bearer realm="Postdot MCP"',
                })
            const declaredLength = Number(request.headers.get('content-length') ?? 0)
            if (declaredLength > maximumRequestBytes) return problem(413, 'Request too large')

            let payload: unknown
            try {
                payload = JSON.parse(await request.text())
            } catch {
                return Response.json(
                    {
                        jsonrpc: '2.0',
                        id: null,
                        error: { code: -32700, message: 'Parse error' },
                    },
                    { status: 400 }
                )
            }

            const requestOrigin = new URL(request.url).origin
            const context: McpServerContext = {
                tools: await loadTools(requestOrigin),
                serverVersion: options.serverVersion ?? '0.1.0',
                allows: (capability: PostdotApiKeyCapability) =>
                    apiKeyHasCapability(key.permissions, capability),
                call: async (tool, input) => {
                    let path = tool.path
                    for (const name of tool.pathParameters)
                        path = path.replace(`{${name}}`, encodeURIComponent(String(input[name])))
                    const query = new URLSearchParams()
                    for (const name of tool.queryParameters) {
                        const value = input[name]
                        if (value === undefined) continue
                        for (const item of Array.isArray(value) ? value : [value])
                            query.append(name, String(item))
                    }
                    const body =
                        tool.bodyProperties === null
                            ? undefined
                            : Object.fromEntries(
                                  tool.bodyProperties
                                      .filter(({ input: name }) => input[name] !== undefined)
                                      .map(({ input: name, field }) => [field, input[name]])
                              )
                    const response = await options.dispatch(
                        new Request(`${requestOrigin}${path}${query.size > 0 ? `?${query}` : ''}`, {
                            method: tool.method,
                            headers: {
                                authorization: `Bearer ${token}`,
                                accept: 'application/json',
                                ...(body === undefined
                                    ? {}
                                    : { 'content-type': 'application/json' }),
                            },
                            body: body === undefined ? undefined : JSON.stringify(body),
                        })
                    )
                    return {
                        ok: response.ok,
                        status: response.status,
                        body: await response.text(),
                    }
                },
            }

            const messages = Array.isArray(payload) ? payload : [payload]
            if (messages.length === 0)
                return Response.json(
                    {
                        jsonrpc: '2.0',
                        id: null,
                        error: { code: -32600, message: 'Empty batch' },
                    },
                    { status: 400 }
                )
            const replies = []
            for (const message of messages) replies.push(await handleMcpMessage(message, context))
            const bodies = replies.flatMap(reply => (reply.kind === 'response' ? [reply.body] : []))
            if (bodies.length === 0) return new Response(null, { status: 202 })
            return Response.json(Array.isArray(payload) ? bodies : bodies[0])
        })
        .get('/mcp', hidden(), () =>
            problem(405, 'This server does not offer a stream', { allow: 'POST' })
        )
        .delete('/mcp', hidden(), () =>
            problem(405, 'This server keeps no session', { allow: 'POST' })
        )
}
