import {
    requiredApiKeyCapability,
    type PostdotApiKeyCapability,
} from '../projects/api-key-permissions'
import { mcpToolCatalog, type McpToolEntry } from './tool-catalog'

type Json = Record<string, unknown>

export interface McpToolAnnotations {
    readonly title: string
    readonly readOnlyHint: boolean
    readonly destructiveHint: boolean
    readonly idempotentHint: boolean
    readonly openWorldHint: boolean
}

export interface McpTool {
    readonly name: string
    readonly description: string
    readonly inputSchema: Json
    readonly annotations: McpToolAnnotations
    readonly capability: PostdotApiKeyCapability
    readonly method: string
    readonly path: string
    readonly pathParameters: readonly string[]
    readonly queryParameters: readonly string[]
    /** Body fields flattened into the tool input (input name → body field), or null without a JSON body. */
    readonly bodyProperties: readonly { readonly input: string; readonly field: string }[] | null
    readonly requiresConfirmation: (input: Readonly<Record<string, unknown>>) => boolean
}

interface OpenApiParameter {
    readonly name: string
    readonly in: 'path' | 'query' | 'header' | 'cookie'
    readonly required?: boolean
    readonly description?: string
    readonly schema?: Json
}

const confirmProperty = {
    type: 'boolean',
    description:
        'Set to true to acknowledge that this call can change what is published, when, or where. Without it nothing is sent.',
} as const

function snakeCase(value: string): string {
    return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

function asRecord(value: unknown): Json {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Json)
        : {}
}

/** Builds the tool list from an OpenAPI document; throws when the catalog and the API disagree. */
export function buildMcpTools(
    document: Json,
    catalog: readonly McpToolEntry[] = mcpToolCatalog
): readonly McpTool[] {
    const operations = new Map<string, { method: string; path: string; operation: Json }>()
    for (const [path, item] of Object.entries(asRecord(document.paths))) {
        for (const [method, operation] of Object.entries(asRecord(item))) {
            const operationId = asRecord(operation).operationId
            if (typeof operationId === 'string')
                operations.set(operationId, {
                    method: method.toUpperCase(),
                    path,
                    operation: asRecord(operation),
                })
        }
    }

    const names = new Set<string>()
    return catalog.map(entry => {
        const found = operations.get(entry.operationId)
        if (found === undefined)
            throw new Error(`MCP catalog operation ${entry.operationId} is not in the API`)
        const capability = requiredApiKeyCapability(
            found.method,
            found.path.replace(/\{[^}]+\}/g, 'x')
        )
        if (capability === null)
            throw new Error(`MCP catalog operation ${entry.operationId} has no API-key capability`)

        const parameters = (
            Array.isArray(found.operation.parameters) ? found.operation.parameters : []
        ) as OpenApiParameter[]
        const properties: Record<string, Json> = {}
        const required: string[] = []
        const pathParameters: string[] = []
        const queryParameters: string[] = []
        for (const parameter of parameters) {
            if (parameter.in !== 'path' && parameter.in !== 'query') continue
            properties[parameter.name] = {
                ...parameter.schema,
                ...(parameter.description === undefined
                    ? {}
                    : { description: parameter.description }),
            }
            if (parameter.in === 'path') {
                pathParameters.push(parameter.name)
                required.push(parameter.name)
            } else {
                queryParameters.push(parameter.name)
                if (parameter.required === true) required.push(parameter.name)
            }
        }

        let bodyProperties: { input: string; field: string }[] | null = null
        const bodySchema = asRecord(
            asRecord(asRecord(asRecord(found.operation.requestBody).content)['application/json'])
                .schema
        )
        if (Object.keys(bodySchema).length > 0) {
            const bodyProps = asRecord(bodySchema.properties)
            const renamed = (field: string) => entry.rename?.[field] ?? field
            bodyProperties = Object.keys(bodyProps).map(field => ({ input: renamed(field), field }))
            for (const { input, field } of bodyProperties) {
                if (input in properties || input === 'confirm')
                    throw new Error(`MCP tool ${entry.operationId} input name ${input} collides`)
                properties[input] = asRecord(bodyProps[field])
            }
            if (Array.isArray(bodySchema.required))
                required.push(...(bodySchema.required as string[]).map(renamed))
        }

        const method = found.method
        const dispatches = capability === 'publication:dispatch'
        const confirmation = entry.confirm ?? (dispatches ? true : undefined)
        if (dispatches && entry.confirm === false)
            throw new Error(`MCP tool ${entry.operationId} cannot waive confirmation`)
        if (confirmation !== undefined) properties.confirm = { ...confirmProperty }

        const name = snakeCase(entry.operationId)
        if (names.has(name)) throw new Error(`MCP tool name ${name} is duplicated`)
        names.add(name)

        const summary = typeof found.operation.summary === 'string' ? found.operation.summary : name
        const effect =
            confirmation === undefined
                ? ''
                : ' Requires confirm:true when the call can change delivery.'
        return {
            name,
            description: [summary + '.', entry.guidance, effect.trim()].filter(Boolean).join(' '),
            inputSchema: {
                type: 'object',
                properties,
                ...(required.length > 0 ? { required: [...new Set(required)] } : {}),
                additionalProperties: false,
            },
            annotations: {
                title: summary,
                readOnlyHint: method === 'GET',
                destructiveHint:
                    method === 'GET' ? false : (entry.destructive ?? method === 'DELETE'),
                idempotentHint: method === 'GET' || method === 'PUT' || method === 'DELETE',
                openWorldHint: entry.openWorld ?? dispatches,
            },
            capability,
            method,
            path: found.path,
            pathParameters,
            queryParameters,
            bodyProperties,
            requiresConfirmation:
                confirmation === undefined
                    ? () => false
                    : typeof confirmation === 'function'
                      ? confirmation
                      : () => true,
        }
    })
}
