import { createHmac, randomUUID } from 'node:crypto'

import {
    isCustomHttpAuthentication,
    isWebhookMode,
    validateCustomHttpAuthenticationBinding,
    validateDeclarativeHttpExecution,
    type DeclarativeHttpBodyMapping,
    type DeclarativeHttpRequestMapping,
    type DeclarativeHttpValueExpression,
    type ExternalEffectOutcome,
} from '@postdot/core'

import {
    customHttpLimits,
    POSTDOT_WEBHOOK_EVENT,
    POSTDOT_WEBHOOK_VERSION,
    type CustomHttpConnection,
    type CustomHttpDeliveryContext,
    type CustomHttpDeliveryInput,
    type CustomHttpMediaDescriptor,
    type CustomHttpRequest,
    type CustomHttpRequestBody,
    type CustomHttpResponse,
    type CustomHttpTransportOptions,
    type OpenedCustomHttpMedia,
} from './contract'
import {
    createCustomHttpEndpointAuthorizer,
    CustomHttpPolicyError,
    CustomHttpResolutionError,
    type AuthorizedCustomHttpEndpoint,
} from './egress'
import { createNodeHttpRequester } from './node-requester'

interface EvaluationScope {
    readonly content: Readonly<Record<string, unknown>>
    readonly context: CustomHttpDeliveryContext
    readonly item: unknown | undefined
    readonly mediaUrlResolver:
        | ((
              media: CustomHttpMediaDescriptor,
              context: CustomHttpDeliveryContext
          ) => string | null | Promise<string | null>)
        | undefined
}

interface MultipartMediaPart {
    readonly fieldName: string
    readonly media: CustomHttpMediaDescriptor
}

export interface CustomHttpTransport {
    deliver(input: CustomHttpDeliveryInput): Promise<ExternalEffectOutcome>
}

export function createCustomHttpTransport(
    options: CustomHttpTransportOptions = {}
): CustomHttpTransport {
    const authorizer = createCustomHttpEndpointAuthorizer({
        privateDestinations: options.privateDestinations,
        resolveHostname: options.resolveHostname,
    })
    const requester = options.requester ?? createNodeHttpRequester()
    const timeoutMs = normalizeTimeout(options.timeoutMs ?? customHttpLimits.defaultTimeoutMs)
    const maxResponseBytes = normalizeResponseLimit(
        options.maxResponseBytes ?? customHttpLimits.maximumResponseBytes
    )
    const now = options.now ?? Date.now

    return {
        async deliver(input) {
            const contractIssues = validateDeclarativeHttpExecution(input.execution)
            if (contractIssues.length > 0) {
                return permanentFailure('The custom HTTP execution contract is invalid')
            }
            if (!isSufficientSecret(input.connection.secret)) {
                return permanentFailure('The custom HTTP connection secret is unavailable')
            }
            if (!isCustomHttpAuthentication(input.connection.authentication)) {
                return permanentFailure('The custom HTTP authentication configuration is invalid')
            }
            if (
                validateCustomHttpAuthenticationBinding(
                    input.execution,
                    input.connection.authentication
                ).length > 0
            ) {
                return permanentFailure(
                    'The custom HTTP authentication configuration is incompatible with the execution contract'
                )
            }

            let endpoint: AuthorizedCustomHttpEndpoint
            try {
                endpoint = await authorizer.authorize(input.connection.endpointUrl)
            } catch (error) {
                if (error instanceof CustomHttpResolutionError) {
                    return retryableFailure('The custom HTTP endpoint could not be resolved')
                }
                if (error instanceof CustomHttpPolicyError || error instanceof TypeError) {
                    return permanentFailure(publicErrorMessage(error, input.connection.secret))
                }
                return retryableFailure('The custom HTTP endpoint could not be authorized')
            }

            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), timeoutMs)
            try {
                const request = isWebhookMode(input.execution.mode)
                    ? await buildWebhookRequest(input, endpoint, maxResponseBytes, now())
                    : await buildMappedRequest(input, endpoint, maxResponseBytes, now())
                let response: CustomHttpResponse
                try {
                    input.signal?.throwIfAborted()
                    response = await requester.request(
                        request,
                        input.signal
                            ? AbortSignal.any([input.signal, controller.signal])
                            : controller.signal
                    )
                } catch (error) {
                    return ambiguousFailure(
                        controller.signal.aborted
                            ? 'Custom HTTP delivery timed out after dispatch'
                            : `Custom HTTP delivery failed after dispatch: ${publicErrorMessage(error, input.connection.secret)}`
                    )
                }

                return classifyResponse(
                    response,
                    input.execution.mode === 'mapped_http'
                        ? input.execution.request!.response
                        : undefined,
                    input.connection.secret
                )
            } catch (error) {
                if (error instanceof MappingError) {
                    return permanentFailure(publicErrorMessage(error, input.connection.secret))
                }
                return ambiguousFailure(
                    `Custom HTTP delivery failed after dispatch: ${publicErrorMessage(error, input.connection.secret)}`
                )
            } finally {
                clearTimeout(timeout)
            }
        },
    }
}

async function buildWebhookRequest(
    input: CustomHttpDeliveryInput,
    endpoint: AuthorizedCustomHttpEndpoint,
    maxResponseBytes: number,
    deliveredAt: number
): Promise<CustomHttpRequest> {
    const context = { ...input.context, deliveredAt }
    const bodyValue = createWebhookEnvelope(context, input.content, input.media)
    const body = JSON.stringify(bodyValue)
    const timestamp = Math.floor(deliveredAt / 1000).toString()
    const signature = createHmac('sha256', input.connection.secret)
        .update(`${timestamp}.${body}`)
        .digest('hex')
    const requestBody = textBody(body, customHttpLimits.maximumRequestBytes)

    return {
        method: 'POST',
        url: endpoint.url,
        address: endpoint.selectedAddress,
        headers: {
            'content-type': 'application/json',
            'x-postdot-webhook-version': POSTDOT_WEBHOOK_VERSION,
            'x-postdot-event': POSTDOT_WEBHOOK_EVENT,
            'x-postdot-delivery-id': input.context.deliveryId,
            'x-postdot-timestamp': timestamp,
            'x-postdot-signature': `sha256=${signature}`,
        },
        body: requestBody,
        maxResponseBytes,
    }
}

async function buildMappedRequest(
    input: CustomHttpDeliveryInput,
    endpoint: AuthorizedCustomHttpEndpoint,
    maxResponseBytes: number,
    deliveredAt: number
): Promise<CustomHttpRequest> {
    const request = input.execution.request
    if (request === undefined) throw new MappingError('The mapped HTTP request is missing')

    const scope: EvaluationScope = {
        content: input.content,
        context: { ...input.context, deliveredAt },
        item: undefined,
        mediaUrlResolver: input.resolveMediaUrl,
    }
    const url = await buildRequestUrl(endpoint.url, request, scope, input.media, input.connection)
    const headers = await evaluateHeaders(request, scope, input.media)
    const body = await buildBody(request.body, scope, input)

    if (body !== null) headers['content-type'] = body.contentType
    if (request.idempotencyHeader !== undefined) {
        headers[request.idempotencyHeader] = input.context.deliveryId
    }
    applyConnectionAuthentication(headers, input.connection)

    return {
        method: request.method,
        url,
        address: endpoint.selectedAddress,
        headers,
        body,
        maxResponseBytes,
    }
}

function createWebhookEnvelope(
    context: CustomHttpDeliveryContext,
    content: Readonly<Record<string, unknown>>,
    media: readonly CustomHttpMediaDescriptor[]
) {
    return {
        event: POSTDOT_WEBHOOK_EVENT,
        webhookVersion: POSTDOT_WEBHOOK_VERSION,
        deliveryId: context.deliveryId,
        publication: {
            id: context.publicationId,
            projectId: context.projectId,
            scheduledAt: context.scheduledAt,
            attempt: context.attempt,
            deliveredAt: context.deliveredAt,
        },
        channel: {
            id: context.channelId,
            name: context.channelName,
        },
        content,
        media: media.map(
            ({ storeId: _storeId, objectKey: _objectKey, ...descriptor }) => descriptor
        ),
    }
}

async function buildRequestUrl(
    endpoint: URL,
    request: DeclarativeHttpRequestMapping,
    scope: EvaluationScope,
    media: readonly CustomHttpMediaDescriptor[],
    connection: CustomHttpConnection
): Promise<URL> {
    const segments: string[] = []
    for (const segment of request.path) {
        let value: unknown
        if (typeof segment === 'string') value = segment
        else if (segment.kind === 'secret') {
            if (connection.authentication.kind !== 'path') {
                throw new MappingError('A secret path segment requires path authentication')
            }
            value = connection.secret
        } else if (segment.kind === 'context') {
            value = requiredPointer(scope.context, segment.pointer, 'Context')
        } else {
            value = requiredPointer(scope.content, segment.pointer, 'Content')
        }
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
            throw new MappingError('HTTP path expressions must resolve to scalar values')
        }
        const normalized = String(value)
        if (normalized.length === 0 || normalized.includes('\u0000')) {
            throw new MappingError('HTTP path expressions must not be blank')
        }
        segments.push(normalized)
    }

    const url = new URL(`/${segments.map(encodeURIComponent).join('/')}`, endpoint)
    if (request.query !== undefined) {
        for (const [name, expression] of Object.entries(request.query)) {
            const value = await evaluateExpression(expression, scope, media)
            url.searchParams.set(name, scalarString(value, 'Query expressions'))
        }
    }
    return url
}

async function evaluateHeaders(
    request: DeclarativeHttpRequestMapping,
    scope: EvaluationScope,
    media: readonly CustomHttpMediaDescriptor[]
): Promise<Record<string, string>> {
    const headers: Record<string, string> = {}
    if (request.headers === undefined) return headers
    for (const [name, expression] of Object.entries(request.headers)) {
        const value = await evaluateExpression(expression, scope, media)
        const stringValue = scalarString(value, 'Header expressions')
        if (stringValue.length > 8_192 || containsHeaderControlCharacter(stringValue)) {
            throw new MappingError(`Header ${name} has an invalid value`)
        }
        headers[name] = stringValue
    }
    return headers
}

async function buildBody(
    body: DeclarativeHttpBodyMapping | undefined,
    scope: EvaluationScope,
    input: CustomHttpDeliveryInput
): Promise<CustomHttpRequestBody | null> {
    if (body === undefined) return null
    if (body.kind === 'json') {
        const value = await evaluateExpression(body.value, scope, input.media)
        const serialized = JSON.stringify(value)
        if (serialized === undefined) throw new MappingError('JSON body mapping produced no value')
        const bytes = new TextEncoder().encode(serialized)
        if (bytes.byteLength > customHttpLimits.maximumRequestBytes) {
            throw new MappingError('JSON request body exceeds the configured limit')
        }
        return bytesBody(bytes, 'application/json')
    }
    if (body.kind === 'form') {
        const params = new URLSearchParams()
        for (const [name, expression] of Object.entries(body.fields)) {
            params.set(
                name,
                scalarString(
                    await evaluateExpression(expression, scope, input.media),
                    'Form expressions'
                )
            )
        }
        const bytes = new TextEncoder().encode(params.toString())
        if (bytes.byteLength > customHttpLimits.maximumRequestBytes) {
            throw new MappingError('Form request body exceeds the configured limit')
        }
        return bytesBody(bytes, 'application/x-www-form-urlencoded')
    }
    if (body.kind === 'multipart') {
        if (input.mediaReader === undefined && body.media.length > 0) {
            throw new MappingError('Multipart media delivery is not configured')
        }
        const fields = new Map<string, string>()
        for (const [name, expression] of Object.entries(body.fields)) {
            fields.set(
                name,
                scalarString(
                    await evaluateExpression(expression, scope, input.media),
                    'Multipart field expressions'
                )
            )
        }
        const mediaParts = body.media.flatMap(mapping =>
            selectMedia(input.media, mapping.pointer).map(media => ({
                fieldName: mapping.fieldName,
                media,
            }))
        )
        return multipartBody(
            fields,
            mediaParts,
            input.mediaReader,
            customHttpLimits.maximumRequestBytes
        )
    }
    throw new MappingError('HTTP body mapping kind is not supported')
}

async function evaluateExpression(
    expression: DeclarativeHttpValueExpression,
    scope: EvaluationScope,
    media: readonly CustomHttpMediaDescriptor[]
): Promise<unknown> {
    switch (expression.kind) {
        case 'literal':
            return expression.value
        case 'content':
            return requiredPointer(scope.content, expression.pointer, 'Content')
        case 'context':
            return requiredPointer(scope.context, expression.pointer, 'Context')
        case 'item':
            if (scope.item === undefined)
                throw new MappingError('Item expression has no mapped item')
            return requiredPointer(scope.item, expression.pointer, 'Mapped item')
        case 'media_urls': {
            const selected = selectMedia(media, expression.pointer)
            const resolver = scope.mediaUrlResolver
            if (resolver === undefined) {
                throw new MappingError('Media URL delivery is not configured')
            }
            const urls: string[] = []
            for (const candidate of selected) {
                const url = await resolver(candidate, scope.context)
                if (url === null || url.trim().length === 0) {
                    throw new MappingError(
                        `No public URL is available for media ${candidate.assetId}`
                    )
                }
                const normalized = url.trim()
                validateMediaUrl(normalized)
                urls.push(normalized)
            }
            return urls
        }
        case 'object': {
            const object: Record<string, unknown> = {}
            for (const [name, value] of Object.entries(expression.properties)) {
                object[name] = await evaluateExpression(value, scope, media)
            }
            return object
        }
        case 'array':
            return Promise.all(expression.items.map(item => evaluateExpression(item, scope, media)))
        case 'map': {
            const source = requiredPointer(scope.content, expression.source.pointer, 'Map source')
            if (!Array.isArray(source)) throw new MappingError('Mapped source must be an array')
            if (source.length > expression.maxItems) {
                throw new MappingError('Mapped source exceeds its configured item limit')
            }
            return Promise.all(
                source.map(item => evaluateExpression(expression.item, { ...scope, item }, media))
            )
        }
    }
}

function applyConnectionAuthentication(
    headers: Record<string, string>,
    connection: CustomHttpConnection
): void {
    switch (connection.authentication.kind) {
        case 'none':
            return
        case 'bearer':
            headers.authorization = `Bearer ${connection.secret}`
            return
        case 'header':
            headers[connection.authentication.headerName] = connection.secret
            return
        case 'path':
            return
        default:
            throw new MappingError('Custom HTTP authentication is not supported')
    }
}

function classifyResponse(
    response: CustomHttpResponse,
    mapping: DeclarativeHttpRequestMapping['response'] | undefined,
    secret: string
): ExternalEffectOutcome {
    if (mapping === undefined) {
        if (response.status >= 200 && response.status < 300) return { type: 'published' }
        if (response.status === 429) {
            return retryableFailure(
                `Custom webhook receiver rate limited delivery: ${response.status}`
            )
        }
        if (response.status >= 400 && response.status < 500 && response.status !== 408) {
            return permanentFailure(
                `Custom webhook receiver rejected delivery: HTTP ${response.status}`
            )
        }
        return ambiguousFailure(
            `Custom webhook delivery returned HTTP ${response.status}; the outcome is ambiguous`
        )
    }

    const detail = responseDetail(response, secret)
    if (mapping.successStatuses.includes(response.status)) {
        if (
            response.bodyTruncated &&
            (mapping.externalIdPointer !== undefined || mapping.externalUrlPointer !== undefined)
        ) {
            return ambiguousFailure(
                'The successful custom HTTP response exceeded the response limit'
            )
        }
        const requiresJson =
            mapping.externalIdPointer !== undefined || mapping.externalUrlPointer !== undefined
        if (!requiresJson) return { type: 'published' }
        const parsed = responseJson(response.body, true)
        if (parsed.error !== null)
            return ambiguousFailure(`The custom HTTP response was not valid JSON: ${parsed.error}`)
        const externalId = readOptionalString(parsed.value, mapping.externalIdPointer)
        const externalUrl = readOptionalString(parsed.value, mapping.externalUrlPointer)
        if (containsSecret(externalId, secret) || containsSecret(externalUrl, secret)) {
            return ambiguousFailure(
                'The custom HTTP response contained protected credential material'
            )
        }
        if (mapping.externalIdPointer !== undefined && externalId === null) {
            return ambiguousFailure(
                'The custom HTTP response did not contain the configured external ID'
            )
        }
        if (mapping.externalUrlPointer !== undefined && externalUrl === null) {
            return ambiguousFailure(
                'The custom HTTP response did not contain the configured external URL'
            )
        }
        return {
            type: 'published',
            ...(externalId === null ? {} : { externalId }),
            ...(externalUrl === null ? {} : { externalUrl }),
        }
    }
    if (mapping.retryableStatuses.includes(response.status)) {
        return retryableFailure(
            `Custom HTTP delivery can be retried (HTTP ${response.status}): ${detail}`
        )
    }
    if (mapping.rejectedStatuses.includes(response.status)) {
        return permanentFailure(
            `Custom HTTP receiver rejected delivery (HTTP ${response.status}): ${detail}`
        )
    }
    if (mapping.ambiguousStatuses.includes(response.status)) {
        return ambiguousFailure(
            `Custom HTTP delivery outcome is ambiguous (HTTP ${response.status}): ${detail}`
        )
    }
    return ambiguousFailure(`Custom HTTP response status ${response.status} was not classified`)
}

function multipartBody(
    fields: ReadonlyMap<string, string>,
    mediaParts: readonly MultipartMediaPart[],
    mediaReader:
        | { open(media: CustomHttpMediaDescriptor): Promise<OpenedCustomHttpMedia | null> }
        | undefined,
    maximumBytes: number
): CustomHttpRequestBody {
    const boundary = `----postdot-${randomUUID().replaceAll('-', '')}`
    const encodedFields = [...fields.entries()].map(([name, value]) => ({
        header: encodeText(
            `--${boundary}\r\nContent-Disposition: form-data; name="${escapeQuoted(name)}"\r\n\r\n`
        ),
        value: encodeText(value),
        trailer: encodeText('\r\n'),
    }))
    const encodedMedia = mediaParts.map(part => ({
        header: encodeText(
            `--${boundary}\r\nContent-Disposition: form-data; name="${escapeQuoted(part.fieldName)}"; filename="${escapeQuoted(safeFilename(part.media))}"\r\nContent-Type: ${part.media.contentType}\r\n\r\n`
        ),
        trailer: encodeText('\r\n'),
        part,
    }))
    const closing = encodeText(`--${boundary}--\r\n`)
    const knownLength =
        encodedFields.reduce(
            (sum, field) =>
                sum + field.header.byteLength + field.value.byteLength + field.trailer.byteLength,
            0
        ) +
        encodedMedia.reduce(
            (sum, field) =>
                sum +
                field.header.byteLength +
                field.trailer.byteLength +
                field.part.media.byteSize,
            0
        ) +
        closing.byteLength
    if (knownLength > maximumBytes)
        throw new MappingError('Multipart request body exceeds the configured limit')

    return {
        contentType: `multipart/form-data; boundary=${boundary}`,
        contentLength: knownLength,
        async write(writeChunk) {
            let written = 0
            const emit = async (bytes: Uint8Array) => {
                written += bytes.byteLength
                if (written > maximumBytes)
                    throw new MappingError('Multipart request body exceeds the configured limit')
                await writeChunk(bytes)
            }
            for (const field of encodedFields) {
                await emit(field.header)
                await emit(field.value)
                await emit(field.trailer)
            }
            for (const field of encodedMedia) {
                await emit(field.header)
                if (mediaReader === undefined)
                    throw new MappingError('Multipart media delivery is not configured')
                const opened = await mediaReader.open(field.part.media)
                if (opened === null || opened.size !== field.part.media.byteSize) {
                    throw new Error(
                        `Media ${field.part.media.assetId} could not be opened for delivery`
                    )
                }
                if (opened.contentType !== field.part.media.contentType) {
                    throw new Error(
                        `Media ${field.part.media.assetId} content type changed before delivery`
                    )
                }
                if (opened.sha256 !== field.part.media.sha256) {
                    throw new Error(
                        `Media ${field.part.media.assetId} checksum changed before delivery`
                    )
                }
                const reader = opened.stream.getReader()
                try {
                    while (true) {
                        const next = await reader.read()
                        if (next.done) break
                        await emit(next.value)
                    }
                } catch (error) {
                    try {
                        await reader.cancel(error)
                    } catch {
                        // Preserve the original multipart write failure.
                    }
                    throw error
                } finally {
                    reader.releaseLock()
                }
                await emit(field.trailer)
            }
            await emit(closing)
        },
    }
}

function textBody(value: string, maximumBytes: number): CustomHttpRequestBody {
    const bytes = new TextEncoder().encode(value)
    if (bytes.byteLength > maximumBytes) {
        throw new MappingError('HTTP request body exceeds the configured limit')
    }
    return bytesBody(bytes, 'application/json')
}

function bytesBody(bytes: Uint8Array, contentType: string): CustomHttpRequestBody {
    return {
        contentType,
        contentLength: bytes.byteLength,
        async write(writeChunk) {
            await writeChunk(bytes)
        },
    }
}

function selectMedia(
    media: readonly CustomHttpMediaDescriptor[],
    pointer: string
): readonly CustomHttpMediaDescriptor[] {
    return media.filter(
        candidate =>
            candidate.contentPath === pointer || candidate.contentPath.startsWith(`${pointer}/`)
    )
}

function requiredPointer(root: unknown, pointer: string, label: string): unknown {
    const value = readJsonPointer(root, pointer)
    if (value === undefined) throw new MappingError(`${label} pointer ${pointer} did not resolve`)
    return value
}

function readJsonPointer(root: unknown, pointer: string): unknown {
    let current = root
    for (const segment of pointer
        .slice(1)
        .split('/')
        .map(value => value.replaceAll('~1', '/').replaceAll('~0', '~'))) {
        if (Array.isArray(current)) {
            if (!/^\d+$/.test(segment)) return undefined
            current = current[Number(segment)]
        } else if (isRecord(current)) {
            current = current[segment]
        } else {
            return undefined
        }
    }
    return current
}

function scalarString(value: unknown, label: string): string {
    if (value === null) return ''
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        const result = String(value)
        if (!Number.isFinite(value as number) && typeof value === 'number') {
            throw new MappingError(`${label} must not contain non-finite numbers`)
        }
        return result
    }
    throw new MappingError(`${label} must resolve to scalar values`)
}

function responseJson(
    body: string,
    required: boolean
): { readonly value: unknown; readonly error: string | null } {
    if (!required && body.trim().length === 0) return { value: null, error: null }
    try {
        return { value: JSON.parse(body), error: null }
    } catch {
        return { value: null, error: 'invalid JSON' }
    }
}

function readOptionalString(root: unknown, pointer: string | undefined): string | null {
    if (pointer === undefined) return null
    const value = readJsonPointer(root, pointer)
    return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function responseDetail(response: CustomHttpResponse, secret: string): string {
    const parsed = responseJson(response.body, false).value
    const raw =
        isRecord(parsed) && typeof parsed.message === 'string'
            ? parsed.message
            : response.body.trim()
    return limitMessage(redactSecret(raw, secret)) || 'No response details returned'
}

function validateMediaUrl(value: string): void {
    let url: URL
    try {
        url = new URL(value)
    } catch {
        throw new MappingError('Mapped media URL is invalid')
    }
    if (
        (url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.username.length > 0 ||
        url.password.length > 0
    ) {
        throw new MappingError('Mapped media URL must use HTTP or HTTPS without credentials')
    }
}

function isSufficientSecret(value: string): boolean {
    return (
        typeof value === 'string' &&
        new TextEncoder().encode(value).byteLength >= customHttpLimits.minimumSecretBytes
    )
}

function normalizeTimeout(value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0 || value > customHttpLimits.maximumTimeoutMs) {
        throw new TypeError('Custom HTTP timeout is outside the supported range')
    }
    return value
}

function normalizeResponseLimit(value: number): number {
    if (
        !Number.isSafeInteger(value) ||
        value <= 0 ||
        value > customHttpLimits.maximumResponseBytes
    ) {
        throw new TypeError('Custom HTTP response limit is outside the supported range')
    }
    return value
}

function publicErrorMessage(error: unknown, secret: string): string {
    const message = error instanceof Error ? error.message : 'Unknown custom HTTP error'
    return limitMessage(redactSecret(message, secret))
}

function redactSecret(value: string, secret: string): string {
    if (secret.length === 0) return value
    return value
        .replaceAll(secret, '[redacted]')
        .replaceAll(encodeURIComponent(secret), '[redacted]')
}

function containsSecret(value: string | null, secret: string): boolean {
    return (
        value !== null &&
        secret.length > 0 &&
        (value.includes(secret) || value.includes(encodeURIComponent(secret)))
    )
}

function limitMessage(value: string): string {
    const normalized = value.trim().replace(/\s+/g, ' ')
    return normalized.length > customHttpLimits.maximumErrorMessageLength
        ? `${normalized.slice(0, customHttpLimits.maximumErrorMessageLength - 3)}...`
        : normalized
}

function permanentFailure(
    errorMessage: string
): Extract<ExternalEffectOutcome, { type: 'permanent_failure' }> {
    return { type: 'permanent_failure', effectOccurred: false, errorMessage }
}

function retryableFailure(
    errorMessage: string
): Extract<ExternalEffectOutcome, { type: 'retryable_failure' }> {
    return { type: 'retryable_failure', effectOccurred: false, errorMessage }
}

function ambiguousFailure(
    errorMessage: string
): Extract<ExternalEffectOutcome, { type: 'ambiguous' }> {
    return { type: 'ambiguous', errorMessage }
}

class MappingError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'MappingError'
    }
}

function encodeText(value: string): Uint8Array {
    return new TextEncoder().encode(value)
}

function escapeQuoted(value: string): string {
    return value
        .replaceAll('\\', '_')
        .replaceAll('"', '_')
        .replaceAll('\r', '_')
        .replaceAll('\n', '_')
        .replaceAll('\u0000', '_')
}

function safeFilename(media: CustomHttpMediaDescriptor): string {
    const normalized = media.originalFilename
        .replaceAll('\\', '_')
        .replaceAll('/', '_')
        .replaceAll('\r', '_')
        .replaceAll('\n', '_')
        .replaceAll('\u0000', '_')
        .replaceAll('"', '_')
        .trim()
    return normalized.length > 0 ? normalized.slice(0, 255) : `media-${media.assetId}`
}

function containsHeaderControlCharacter(value: string): boolean {
    return value.includes('\r') || value.includes('\n') || value.includes('\u0000')
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}
