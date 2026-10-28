import type { PostdotApiKeyCapability } from '../projects/api-key-permissions'
import type { McpTool } from './openapi-tools'

export const mcpProtocolVersions = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
const maximumResultCharacters = 100_000

type Json = Record<string, unknown>
type JsonRpcId = string | number | null

export interface McpServerContext {
    readonly tools: readonly McpTool[]
    readonly serverVersion: string
    /** Keys without an action ceiling may use every capability. */
    readonly allows: (capability: PostdotApiKeyCapability) => boolean
    readonly call: (
        tool: McpTool,
        input: Json
    ) => Promise<{ ok: boolean; status: number; body: string }>
}

export type McpReply =
    | { readonly kind: 'response'; readonly body: Json }
    | { readonly kind: 'accepted' }

const errors = {
    parse: -32700,
    invalidRequest: -32600,
    methodNotFound: -32601,
    invalidParams: -32602,
} as const

function failure(id: JsonRpcId, code: number, message: string): McpReply {
    return { kind: 'response', body: { jsonrpc: '2.0', id, error: { code, message } } }
}

function success(id: JsonRpcId, result: Json): McpReply {
    return { kind: 'response', body: { jsonrpc: '2.0', id, result } }
}

function isRecord(value: unknown): value is Json {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toolResult(text: string, isError: boolean): Json {
    return { content: [{ type: 'text', text }], isError }
}

/** Handles one JSON-RPC message. Notifications and client responses are accepted without a body. */
export async function handleMcpMessage(
    message: unknown,
    context: McpServerContext
): Promise<McpReply> {
    if (!isRecord(message) || message.jsonrpc !== '2.0')
        return failure(null, errors.invalidRequest, 'Expected a JSON-RPC 2.0 message')
    const hasId = 'id' in message
    const id = (hasId ? message.id : null) as JsonRpcId
    if (typeof message.method !== 'string') {
        // A response to a server request: this server sends none.
        return hasId && ('result' in message || 'error' in message)
            ? { kind: 'accepted' }
            : failure(id, errors.invalidRequest, 'Missing method')
    }
    if (!hasId) return { kind: 'accepted' }

    const params = isRecord(message.params) ? message.params : {}
    switch (message.method) {
        case 'initialize': {
            const requested =
                typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
            const protocolVersion = (mcpProtocolVersions as readonly string[]).includes(requested)
                ? requested
                : mcpProtocolVersions[0]
            return success(id, {
                protocolVersion,
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: 'postdot', title: 'Postdot', version: context.serverVersion },
                instructions:
                    'Postdot publishes to social destinations. Tools act as the API key owner within the key’s projects and capabilities. Read before writing; calls that can change what is published, when or where need confirm:true after the user agrees.',
            })
        }
        case 'ping':
            return success(id, {})
        case 'tools/list':
            return success(id, {
                tools: context.tools
                    .filter(tool => context.allows(tool.capability))
                    .map(tool => ({
                        name: tool.name,
                        title: tool.annotations.title,
                        description: tool.description,
                        inputSchema: tool.inputSchema,
                        annotations: tool.annotations,
                    })),
            })
        case 'tools/call':
            return callTool(id, params, context)
        default:
            return failure(id, errors.methodNotFound, `Unsupported method ${message.method}`)
    }
}

async function callTool(id: JsonRpcId, params: Json, context: McpServerContext): Promise<McpReply> {
    const tool = context.tools.find(candidate => candidate.name === params.name)
    if (tool === undefined || !context.allows(tool.capability))
        return failure(id, errors.invalidParams, `Unknown tool ${String(params.name)}`)
    const input = params.arguments === undefined ? {} : params.arguments
    if (!isRecord(input)) return failure(id, errors.invalidParams, 'arguments must be an object')

    const schema = tool.inputSchema as { properties: Json; required?: string[] }
    const unknown = Object.keys(input).filter(key => !(key in schema.properties))
    if (unknown.length > 0)
        return success(id, toolResult(`Unknown argument: ${unknown.join(', ')}`, true))
    const missing = (schema.required ?? []).filter(key => input[key] === undefined)
    if (missing.length > 0)
        return success(id, toolResult(`Missing required argument: ${missing.join(', ')}`, true))

    if (tool.requiresConfirmation(input) && input.confirm !== true)
        return success(
            id,
            toolResult(
                `Nothing was sent. ${tool.name} can change what is published, when or where. Ask the user to confirm, then call again with confirm:true.`,
                true
            )
        )

    const result = await context.call(tool, input)
    const text =
        result.body.length > maximumResultCharacters
            ? `${result.body.slice(0, maximumResultCharacters)}\n[Response truncated at ${maximumResultCharacters} characters; narrow the request.]`
            : result.body
    return success(id, toolResult(text || `HTTP ${result.status}`, !result.ok))
}
