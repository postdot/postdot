import type { ValidationIssue } from './validation'

/**
 * Custom profiles saved before the Postdot rename store `postbot_webhook`. Their stored hashes cover
 * that value, so it stays valid and behaves exactly like `postdot_webhook`; new profiles use the latter.
 */
export const legacyWebhookMode = 'postbot_webhook'
export const declarativeHttpModes = ['postdot_webhook', legacyWebhookMode, 'mapped_http'] as const
export const declarativeHttpMethods = ['POST', 'PUT', 'PATCH'] as const
export const declarativeHttpContextPointers = [
    '/deliveryId',
    '/jobId',
    '/projectId',
    '/publicationId',
    '/channelId',
    '/scheduledAt',
    '/attempt',
    '/externalAccountId',
] as const

export type DeclarativeHttpMode = (typeof declarativeHttpModes)[number]

export function isWebhookMode(mode: string): boolean {
    return mode === 'postdot_webhook' || mode === legacyWebhookMode
}
export type DeclarativeHttpMethod = (typeof declarativeHttpMethods)[number]
export type DeclarativeHttpContextPointer = (typeof declarativeHttpContextPointers)[number]
export type JsonPrimitive = null | boolean | number | string

export type DeclarativeHttpValueExpression =
    | {
          readonly kind: 'literal'
          readonly value: JsonPrimitive
      }
    | {
          readonly kind: 'content'
          readonly pointer: string
      }
    | {
          readonly kind: 'context'
          readonly pointer: DeclarativeHttpContextPointer
      }
    | {
          readonly kind: 'item'
          readonly pointer: string
      }
    | {
          readonly kind: 'media_urls'
          readonly pointer: string
      }
    | {
          readonly kind: 'object'
          readonly properties: Readonly<Record<string, DeclarativeHttpValueExpression>>
      }
    | {
          readonly kind: 'array'
          readonly items: readonly DeclarativeHttpValueExpression[]
      }
    | {
          readonly kind: 'map'
          readonly source: {
              readonly kind: 'content'
              readonly pointer: string
          }
          readonly item: DeclarativeHttpValueExpression
          readonly maxItems: number
      }

export type DeclarativeHttpPathSegment =
    | string
    | {
          readonly kind: 'content' | 'context'
          readonly pointer: string
      }
    | {
          readonly kind: 'secret'
      }

export interface DeclarativeHttpMultipartMediaPart {
    readonly fieldName: string
    readonly pointer: string
}

export type DeclarativeHttpBodyMapping =
    | {
          readonly kind: 'json'
          readonly value: DeclarativeHttpValueExpression
      }
    | {
          readonly kind: 'form'
          readonly fields: Readonly<Record<string, DeclarativeHttpValueExpression>>
      }
    | {
          readonly kind: 'multipart'
          readonly fields: Readonly<Record<string, DeclarativeHttpValueExpression>>
          readonly media: readonly DeclarativeHttpMultipartMediaPart[]
      }

export interface DeclarativeHttpResponseMapping {
    readonly successStatuses: readonly number[]
    readonly retryableStatuses: readonly number[]
    readonly rejectedStatuses: readonly number[]
    readonly ambiguousStatuses: readonly number[]
    readonly externalIdPointer?: string
    readonly externalUrlPointer?: string
}

export interface DeclarativeHttpRequestMapping {
    readonly method: DeclarativeHttpMethod
    readonly path: readonly DeclarativeHttpPathSegment[]
    readonly query?: Readonly<Record<string, DeclarativeHttpValueExpression>>
    readonly headers?: Readonly<Record<string, DeclarativeHttpValueExpression>>
    readonly body?: DeclarativeHttpBodyMapping
    readonly idempotencyHeader?: string
    readonly response: DeclarativeHttpResponseMapping
}

export interface DeclarativeHttpExecutionContract {
    readonly kind: 'declarative_http'
    readonly contractId: string
    readonly revision: string
    readonly mode: DeclarativeHttpMode
    readonly request?: DeclarativeHttpRequestMapping
}

export type CustomHttpAuthentication =
    | { readonly kind: 'none' }
    | { readonly kind: 'bearer' }
    | { readonly kind: 'header'; readonly headerName: string }
    | { readonly kind: 'path' }

export function isCustomHttpAuthentication(value: unknown): value is CustomHttpAuthentication {
    if (!isRecord(value)) return false
    if (value.kind === 'none' || value.kind === 'bearer' || value.kind === 'path') return true
    return (
        value.kind === 'header' &&
        typeof value.headerName === 'string' &&
        value.headerName.length > 0 &&
        value.headerName.length <= maximumHeaderNameLength &&
        httpTokenPattern.test(value.headerName) &&
        !forbiddenHeaderNames.has(value.headerName.toLowerCase()) &&
        !value.headerName.toLowerCase().startsWith('x-postdot-')
    )
}

const maximumMappingNodes = 256
const maximumPathSegments = 32
const maximumObjectProperties = 64
const maximumArrayItems = 100
const maximumMapItems = 100
const maximumHeaderNameLength = 128
const maximumFieldNameLength = 128
const maximumStaticPathSegmentLength = 256
const httpTokenPattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const forbiddenHeaderNames = new Set([
    'authorization',
    'connection',
    'content-length',
    'content-type',
    'host',
    'keep-alive',
    'proxy-connection',
    'te',
    'transfer-encoding',
    'upgrade',
])

export function validateDeclarativeHttpExecution(
    execution: DeclarativeHttpExecutionContract
): readonly ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const addIssue = (path: string, code: string, message: string) => {
        issues.push({ path, code, message, severity: 'error', source: 'domain' })
    }

    if (!isRecord(execution)) {
        addIssue('/execution', 'execution.invalid', 'Execution contract must be an object')
        return issues
    }

    if (execution.kind !== 'declarative_http') {
        addIssue(
            '/execution/kind',
            'execution.kind_invalid',
            'Execution kind must be declarative_http'
        )
        return issues
    }
    if (!isNonBlank(execution.contractId)) {
        addIssue(
            '/execution/contractId',
            'execution.identity_blank',
            'Contract ID must not be blank'
        )
    }
    if (!isNonBlank(execution.revision)) {
        addIssue(
            '/execution/revision',
            'execution.identity_blank',
            'Contract revision must not be blank'
        )
    }
    if (!(declarativeHttpModes as readonly string[]).includes(execution.mode)) {
        addIssue(
            '/execution/mode',
            'execution.mode_invalid',
            'HTTP execution mode is not supported'
        )
        return issues
    }

    if (isWebhookMode(execution.mode)) {
        if (execution.request !== undefined) {
            addIssue(
                '/execution/request',
                'execution.webhook_request_forbidden',
                'A Postdot webhook contract must not define a mapped request'
            )
        }
        return issues
    }

    if (execution.request === undefined) {
        addIssue(
            '/execution/request',
            'execution.request_required',
            'A mapped HTTP contract must define a request'
        )
        return issues
    }

    validateRequest(execution.request, addIssue)
    return issues
}

export function validateCustomHttpAuthenticationBinding(
    execution: DeclarativeHttpExecutionContract,
    authentication: CustomHttpAuthentication
): readonly ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const addIssue = (path: string, code: string, message: string) => {
        issues.push({ path, code, message, severity: 'error', source: 'domain' })
    }

    if (!isCustomHttpAuthentication(authentication)) {
        addIssue(
            '/authentication',
            'authentication.invalid',
            'Custom HTTP authentication configuration is invalid'
        )
        return issues
    }

    const secretPathSegments =
        execution.mode === 'mapped_http' && execution.request !== undefined
            ? execution.request.path.filter(
                  segment => typeof segment !== 'string' && segment.kind === 'secret'
              ).length
            : 0

    if (authentication.kind === 'path') {
        if (execution.mode !== 'mapped_http' || execution.request === undefined) {
            addIssue(
                '/authentication/kind',
                'authentication.path_mode_invalid',
                'Path authentication requires a mapped HTTP execution contract'
            )
        }
        if (secretPathSegments !== 1) {
            addIssue(
                '/execution/request/path',
                'mapping.secret_path_required',
                'Path authentication requires exactly one secret path segment'
            )
        }
        return issues
    }

    if (secretPathSegments > 0) {
        addIssue(
            '/execution/request/path',
            'mapping.secret_path_auth_required',
            'A secret path segment requires path authentication'
        )
    }

    return issues
}

function validateRequest(
    request: DeclarativeHttpRequestMapping,
    addIssue: (path: string, code: string, message: string) => void
): void {
    if (!(declarativeHttpMethods as readonly string[]).includes(request.method)) {
        addIssue(
            '/execution/request/method',
            'mapping.method_invalid',
            'HTTP method is not supported'
        )
    }

    if (!Array.isArray(request.path) || request.path.length > maximumPathSegments) {
        addIssue(
            '/execution/request/path',
            'mapping.path_limit',
            `HTTP paths may contain at most ${maximumPathSegments} segments`
        )
    } else {
        let secretPathSegments = 0
        request.path.forEach((segment, index) => {
            const path = `/execution/request/path/${index}`
            if (typeof segment === 'string') {
                if (
                    segment.length === 0 ||
                    segment.length > maximumStaticPathSegmentLength ||
                    segment === '.' ||
                    segment === '..' ||
                    segment.includes('/') ||
                    segment.includes('?') ||
                    segment.includes('#') ||
                    segment.includes('\\') ||
                    segment.includes('\u0000')
                ) {
                    addIssue(
                        path,
                        'mapping.path_segment_invalid',
                        'Static path segments are not valid'
                    )
                }
                return
            }

            if (
                !isRecord(segment) ||
                !['content', 'context', 'secret'].includes(String(segment.kind))
            ) {
                addIssue(path, 'mapping.path_segment_invalid', 'Path expressions are not valid')
                return
            }
            if (segment.kind === 'secret') {
                secretPathSegments += 1
                if (secretPathSegments > 1) {
                    addIssue(
                        path,
                        'mapping.secret_path_limit',
                        'HTTP mappings may contain at most one secret path segment'
                    )
                }
                return
            }
            validatePointerExpression(segment, path, addIssue, segment.kind === 'context')
        })
    }

    validateExpressionMap(request.query, '/execution/request/query', addIssue)
    validateExpressionMap(request.headers, '/execution/request/headers', addIssue, {
        headerNames: true,
    })

    if (request.idempotencyHeader !== undefined) {
        validateHeaderName(
            request.idempotencyHeader,
            '/execution/request/idempotencyHeader',
            addIssue
        )
    }

    if (request.body !== undefined) validateBody(request.body, addIssue)
    validateResponse(request.response, addIssue)
}

function validateBody(
    body: DeclarativeHttpBodyMapping,
    addIssue: (path: string, code: string, message: string) => void
): void {
    if (!isRecord(body)) {
        addIssue(
            '/execution/request/body',
            'mapping.body_invalid',
            'HTTP body mapping must be an object'
        )
        return
    }

    if (body.kind === 'json') {
        validateValueExpression(body.value, '/execution/request/body/value', addIssue, 0, false)
        return
    }
    if (body.kind === 'form') {
        validateExpressionMap(body.fields, '/execution/request/body/fields', addIssue)
        return
    }
    if (body.kind === 'multipart') {
        validateExpressionMap(body.fields, '/execution/request/body/fields', addIssue)
        if (!Array.isArray(body.media) || body.media.length > maximumArrayItems) {
            addIssue(
                '/execution/request/body/media',
                'mapping.media_limit',
                `Multipart media mappings may contain at most ${maximumArrayItems} entries`
            )
        } else {
            body.media.forEach((media, index) => {
                const path = `/execution/request/body/media/${index}`
                if (!isRecord(media)) {
                    addIssue(
                        path,
                        'mapping.media_invalid',
                        'Multipart media mapping must be an object'
                    )
                    return
                }
                validateFieldName(media.fieldName, `${path}/fieldName`, addIssue)
                validatePointer(media.pointer, `${path}/pointer`, addIssue)
            })
        }
        if (
            isRecord(body.fields) &&
            Object.keys(body.fields).length === 0 &&
            Array.isArray(body.media) &&
            body.media.length === 0
        ) {
            addIssue(
                '/execution/request/body',
                'mapping.body_empty',
                'Multipart body mapping must define fields or media'
            )
        }
        return
    }

    addIssue(
        '/execution/request/body/kind',
        'mapping.body_kind_invalid',
        'HTTP body kind is not supported'
    )
}

function validateResponse(
    response: DeclarativeHttpResponseMapping,
    addIssue: (path: string, code: string, message: string) => void
): void {
    if (!isRecord(response)) {
        addIssue(
            '/execution/request/response',
            'mapping.response_invalid',
            'Response mapping must be an object'
        )
        return
    }

    const names = [
        'successStatuses',
        'retryableStatuses',
        'rejectedStatuses',
        'ambiguousStatuses',
    ] as const
    const seenStatuses = new Set<number>()
    for (const name of names) {
        const values = response[name]
        if (!Array.isArray(values) || values.length === 0 || values.length > 64) {
            addIssue(
                `/execution/request/response/${name}`,
                'mapping.statuses_invalid',
                `${name} must contain between one and 64 HTTP statuses`
            )
            continue
        }
        for (const [index, status] of values.entries()) {
            if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
                addIssue(
                    `/execution/request/response/${name}/${index}`,
                    'mapping.status_invalid',
                    'HTTP statuses must be integers between 100 and 599'
                )
                continue
            }
            if (seenStatuses.has(status)) {
                addIssue(
                    `/execution/request/response/${name}/${index}`,
                    'mapping.status_duplicate',
                    `HTTP status ${status} is assigned to more than one outcome`
                )
            }
            seenStatuses.add(status)
        }
    }

    if (response.externalIdPointer !== undefined) {
        validatePointer(
            response.externalIdPointer,
            '/execution/request/response/externalIdPointer',
            addIssue
        )
    }
    if (response.externalUrlPointer !== undefined) {
        validatePointer(
            response.externalUrlPointer,
            '/execution/request/response/externalUrlPointer',
            addIssue
        )
    }
}

function validateExpressionMap(
    value: unknown,
    path: string,
    addIssue: (path: string, code: string, message: string) => void,
    options: { readonly headerNames?: boolean } = {}
): void {
    if (value === undefined) return
    if (!isRecord(value)) {
        addIssue(path, 'mapping.fields_invalid', 'HTTP mapping fields must be an object')
        return
    }
    const entries = Object.entries(value)
    if (entries.length > maximumObjectProperties) {
        addIssue(
            path,
            'mapping.fields_limit',
            `HTTP mappings may contain at most ${maximumObjectProperties} fields`
        )
    }
    for (const [name, expression] of entries) {
        const fieldPath = `${path}/${escapePointerSegment(name)}`
        if (options.headerNames) validateHeaderName(name, fieldPath, addIssue)
        else validateFieldName(name, fieldPath, addIssue)
        validateValueExpression(expression, fieldPath, addIssue, 0, false)
    }
}

function validateValueExpression(
    value: unknown,
    path: string,
    addIssue: (path: string, code: string, message: string) => void,
    depth: number,
    insideMap: boolean,
    state: { nodes: number } = { nodes: 0 }
): void {
    state.nodes += 1
    if (state.nodes > maximumMappingNodes) {
        addIssue(
            path,
            'mapping.node_limit',
            `HTTP mappings may contain at most ${maximumMappingNodes} expressions`
        )
        return
    }
    if (depth > 16) {
        addIssue(path, 'mapping.depth_limit', 'HTTP mapping expression depth is too large')
        return
    }
    if (!isRecord(value)) {
        addIssue(path, 'mapping.expression_invalid', 'HTTP value expressions must be objects')
        return
    }

    switch (value.kind) {
        case 'literal':
            if (!isJsonPrimitive(value.value)) {
                addIssue(
                    `${path}/value`,
                    'mapping.literal_invalid',
                    'Literal values must be JSON primitives'
                )
            }
            return
        case 'content':
            validatePointerExpression(value, path, addIssue, false)
            return
        case 'context':
            validatePointerExpression(value, path, addIssue, true)
            return
        case 'item':
            if (!insideMap) {
                addIssue(
                    path,
                    'mapping.item_outside_map',
                    'Item expressions are only valid inside a map'
                )
            }
            validatePointer(value.pointer, `${path}/pointer`, addIssue)
            return
        case 'media_urls':
            validatePointer(value.pointer, `${path}/pointer`, addIssue)
            return
        case 'object':
            if (!isRecord(value.properties)) {
                addIssue(
                    `${path}/properties`,
                    'mapping.object_properties_invalid',
                    'Object expressions must define a properties object'
                )
                return
            }
            const properties = Object.entries(value.properties)
            if (properties.length > maximumObjectProperties) {
                addIssue(
                    `${path}/properties`,
                    'mapping.fields_limit',
                    `HTTP mappings may contain at most ${maximumObjectProperties} fields`
                )
            }
            for (const [name, expression] of properties) {
                validateFieldName(
                    name,
                    `${path}/properties/${escapePointerSegment(name)}`,
                    addIssue
                )
                validateValueExpression(
                    expression,
                    `${path}/properties/${escapePointerSegment(name)}`,
                    addIssue,
                    depth + 1,
                    insideMap,
                    state
                )
            }
            return
        case 'array':
            if (!Array.isArray(value.items) || value.items.length > maximumArrayItems) {
                addIssue(
                    `${path}/items`,
                    'mapping.array_limit',
                    `HTTP mapping arrays may contain at most ${maximumArrayItems} items`
                )
                return
            }
            value.items.forEach((item, index) =>
                validateValueExpression(
                    item,
                    `${path}/items/${index}`,
                    addIssue,
                    depth + 1,
                    insideMap,
                    state
                )
            )
            return
        case 'map':
            if (!isRecord(value.source)) {
                addIssue(
                    `${path}/source`,
                    'mapping.map_source_invalid',
                    'Mapped sources must be content pointer expressions'
                )
            } else {
                validatePointerExpression(value.source, `${path}/source`, addIssue, false)
            }
            const maxItems = value.maxItems
            if (
                typeof maxItems !== 'number' ||
                !Number.isSafeInteger(maxItems) ||
                maxItems < 1 ||
                maxItems > maximumMapItems
            ) {
                addIssue(
                    `${path}/maxItems`,
                    'mapping.map_limit',
                    `Mapped input arrays must contain between one and ${maximumMapItems} items`
                )
            }
            validateValueExpression(value.item, `${path}/item`, addIssue, depth + 1, true, state)
            return
        default:
            addIssue(
                `${path}/kind`,
                'mapping.expression_kind_invalid',
                'HTTP value expression kind is not supported'
            )
    }
}

function validatePointerExpression(
    value: Record<string, unknown>,
    path: string,
    addIssue: (path: string, code: string, message: string) => void,
    context: boolean
): void {
    if (context) {
        if (
            !(declarativeHttpContextPointers as readonly string[]).includes(String(value.pointer))
        ) {
            addIssue(
                `${path}/pointer`,
                'mapping.context_pointer_invalid',
                'The context pointer is not available to custom HTTP delivery'
            )
        }
        return
    }
    validatePointer(value.pointer, `${path}/pointer`, addIssue)
}

function validatePointer(
    value: unknown,
    path: string,
    addIssue: (path: string, code: string, message: string) => void
): void {
    if (typeof value !== 'string' || !isJsonPointer(value)) {
        addIssue(
            path,
            'mapping.pointer_invalid',
            'HTTP mapping pointers must be non-root JSON Pointers'
        )
    }
}

function validateHeaderName(
    value: unknown,
    path: string,
    addIssue: (path: string, code: string, message: string) => void
): void {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > maximumHeaderNameLength ||
        !httpTokenPattern.test(value) ||
        forbiddenHeaderNames.has(value.toLowerCase()) ||
        value.toLowerCase().startsWith('x-postdot-')
    ) {
        addIssue(path, 'mapping.header_invalid', 'HTTP header names are not allowed')
    }
}

function validateFieldName(
    value: unknown,
    path: string,
    addIssue: (path: string, code: string, message: string) => void
): void {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > maximumFieldNameLength ||
        value !== value.trim() ||
        value.includes('\r') ||
        value.includes('\n') ||
        value.includes('\u0000')
    ) {
        addIssue(path, 'mapping.field_name_invalid', 'HTTP field names are not allowed')
    }
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
    return (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
    )
}

function isJsonPointer(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.startsWith('/') &&
        value
            .slice(1)
            .split('/')
            .every(segment => !/~(?:[^01]|$)/.test(segment))
    )
}

function isNonBlank(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function escapePointerSegment(value: string): string {
    return value.replaceAll('~', '~0').replaceAll('/', '~1')
}
