import type {
    DiscordBotUser,
    DiscordChannel,
    DiscordFetcher,
    DiscordOperationFailure,
    DiscordOperationResult,
    DiscordPublishOutcome,
    DiscordPublisher,
    DiscordPublisherOptions,
} from './contract'
import {
    DISCORD_API_BASE_URL,
    DISCORD_API_VERSION,
    DISCORD_DEFAULT_TIMEOUT_MS,
    DISCORD_MAX_ATTACHMENTS,
    DISCORD_MAX_CONTENT_LENGTH,
    DISCORD_MAX_DESCRIPTION_LENGTH,
} from './contract'

const DISCORD_CHANNEL_ID_PATTERN = /^\d{17,20}$/

function operationSuccess<Value>(value: Value): DiscordOperationResult<Value> {
    return { kind: 'success', value }
}

function operationFailure(outcome: DiscordOperationFailure): DiscordOperationResult<never> {
    return { kind: 'failure', outcome }
}

function retryableFailure(
    code: Extract<DiscordOperationFailure, { readonly type: 'retryable_failure' }>['code'],
    errorMessage: string
): Extract<DiscordOperationFailure, { readonly type: 'retryable_failure' }> {
    return { type: 'retryable_failure', effectOccurred: false, code, errorMessage }
}

function permanentFailure(
    code: Extract<DiscordOperationFailure, { readonly type: 'permanent_failure' }>['code'],
    errorMessage: string
): Extract<DiscordOperationFailure, { readonly type: 'permanent_failure' }> {
    return { type: 'permanent_failure', effectOccurred: false, code, errorMessage }
}

function ambiguousFailure(
    code: Extract<DiscordOperationFailure, { readonly type: 'ambiguous' }>['code'],
    errorMessage: string
): Extract<DiscordOperationFailure, { readonly type: 'ambiguous' }> {
    return { type: 'ambiguous', code, errorMessage }
}

interface JsonResponse {
    readonly response: Response
    readonly body: unknown
}

async function readJsonResponse(response: Response): Promise<JsonResponse> {
    const body = await response.json().catch(() => null)
    return { response, body }
}

function responseMessage(body: unknown, fallback: string, secrets: readonly string[]): string {
    if (body !== null && typeof body === 'object' && 'message' in body) {
        const message = body.message
        if (typeof message === 'string' && message.trim().length > 0) {
            return redactSecrets(message.trim(), secrets).slice(0, 500)
        }
    }
    return fallback
}

function redactSecrets(value: string, secrets: readonly string[]): string {
    return secrets.reduce(
        (redacted, secret) =>
            secret.length === 0
                ? redacted
                : redacted
                      .replaceAll(secret, '[redacted]')
                      .replaceAll(encodeURIComponent(secret), '[redacted]'),
        value
    )
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readNonBlank(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function readSnowflake(value: unknown): string | null {
    const text = readNonBlank(value)
    return text !== null && DISCORD_CHANNEL_ID_PATTERN.test(text) ? text : null
}

function readBotUser(value: unknown): DiscordBotUser | null {
    if (!isRecord(value)) return null
    const id = readSnowflake(value.id)
    const username = readNonBlank(value.username)
    return id === null || username === null ? null : { id, username }
}

function readChannel(value: unknown): DiscordChannel | null {
    if (!isRecord(value)) return null
    const id = readSnowflake(value.id)
    if (id === null) return null
    const name = value.name
    const type = value.type
    if (name !== null && name !== undefined && typeof name !== 'string') return null
    if (typeof type !== 'number' || !Number.isSafeInteger(type)) return null
    return {
        id,
        name: typeof name === 'string' && name.trim().length > 0 ? name : null,
        type,
    }
}

function buildHeaders(accessToken: string): Headers {
    const headers = new Headers()
    headers.set('accept', 'application/json')
    headers.set('authorization', `Bot ${accessToken}`)
    return headers
}

function withTimeout(fetcher: DiscordFetcher, timeoutMs: number): DiscordFetcher {
    return async (input, init) => {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
            return await fetcher(input, { ...init, signal: controller.signal })
        } finally {
            clearTimeout(timer)
        }
    }
}

function classifyResponse(
    response: Response,
    body: unknown,
    context: 'read' | 'message',
    secrets: readonly string[]
): DiscordOperationFailure {
    const message = responseMessage(body, `Discord returned HTTP ${response.status}`, secrets)
    if (response.status === 401) return permanentFailure('authentication_required', message)
    if (response.status === 403) return permanentFailure('forbidden', message)
    if (response.status === 429) {
        const retryAfter =
            isRecord(body) && typeof body.retry_after === 'number' ? body.retry_after : null
        return retryableFailure(
            'rate_limited',
            retryAfter !== null && Number.isFinite(retryAfter)
                ? `Discord rate-limited the request; retry after ${retryAfter} seconds`
                : 'Discord rate-limited the request; retry later'
        )
    }
    if (response.status === 400 || response.status === 404 || response.status === 422) {
        return permanentFailure('invalid_request', message)
    }
    if (response.status >= 500) {
        return context === 'message'
            ? ambiguousFailure('provider_failure', message)
            : retryableFailure('provider_failure', message)
    }
    return context === 'message'
        ? ambiguousFailure('unexpected_response', message)
        : retryableFailure('provider_failure', message)
}

function classifyException(error: unknown, context: 'read' | 'message'): DiscordOperationFailure {
    const isAbort = error instanceof DOMException && error.name === 'AbortError'
    const message = isAbort
        ? 'The Discord request timed out'
        : 'The Discord request could not be completed'
    return context === 'message'
        ? ambiguousFailure(isAbort ? 'provider_timeout' : 'network_failure', message)
        : retryableFailure('provider_failure', message)
}

function normalizeBaseUrl(value: string): URL {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new TypeError('Discord base URL must use HTTP or HTTPS')
    }
    if (url.username.length > 0 || url.password.length > 0) {
        throw new TypeError('Discord base URL must not contain credentials')
    }
    return url
}

function normalizeTimeout(value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError('Discord timeoutMs must be a positive safe integer')
    }
    return value
}

function messageEndpoint(baseUrl: URL, channelId: string): string {
    const base = baseUrl.toString().replace(/\/$/, '')
    return `${base}/api/${DISCORD_API_VERSION}/channels/${encodeURIComponent(channelId)}/messages`
}

function readMessageResult(
    body: unknown,
    channelId: string
): {
    readonly messageId: string
    readonly attachmentIds: readonly string[]
    readonly guildId: string | null
} | null {
    if (!isRecord(body)) return null
    const messageId = readSnowflake(body.id)
    if (messageId === null) return null
    const responseChannelId = readNonBlank(body.channel_id)
    if (responseChannelId !== null && responseChannelId !== channelId) return null
    const guildId = body.guild_id
    const normalizedGuildId =
        typeof guildId === 'string' && DISCORD_CHANNEL_ID_PATTERN.test(guildId) ? guildId : null
    const attachments = body.attachments
    if (attachments === undefined)
        return { messageId, attachmentIds: [], guildId: normalizedGuildId }
    if (!Array.isArray(attachments)) return null
    const attachmentIds: string[] = []
    for (const attachment of attachments) {
        if (!isRecord(attachment)) return null
        const attachmentId = readSnowflake(attachment.id)
        if (attachmentId === null) return null
        attachmentIds.push(attachmentId)
    }
    return { messageId, attachmentIds, guildId: normalizedGuildId }
}

export function createDiscordPublisher(options: DiscordPublisherOptions = {}): DiscordPublisher {
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? DISCORD_API_BASE_URL)
    const fetcher = withTimeout(
        options.fetcher ?? globalThis.fetch,
        normalizeTimeout(options.timeoutMs ?? DISCORD_DEFAULT_TIMEOUT_MS)
    )

    async function request(
        url: string,
        init: RequestInit,
        accessToken: string,
        context: 'read' | 'message'
    ): Promise<JsonResponse | { readonly failure: DiscordOperationFailure }> {
        try {
            const response = await fetcher(url, {
                ...init,
                headers: mergeHeaders(init.headers, buildHeaders(accessToken)),
            })
            const parsed = await readJsonResponse(response)
            if (!response.ok)
                return {
                    failure: classifyResponse(response, parsed.body, context, [accessToken]),
                }
            return parsed
        } catch (error) {
            return { failure: classifyException(error, context) }
        }
    }

    return {
        async getBotUser(accessToken) {
            if (accessToken.trim().length === 0) {
                return operationFailure(
                    permanentFailure('invalid_input', 'The Discord Bot token is unavailable')
                )
            }
            const base = baseUrl.toString().replace(/\/$/, '')
            const result = await request(
                `${base}/api/${DISCORD_API_VERSION}/users/@me`,
                { method: 'GET' },
                accessToken,
                'read'
            )
            if ('failure' in result) return operationFailure(result.failure)
            const user = readBotUser(result.body)
            return user === null
                ? operationFailure(
                      retryableFailure(
                          'provider_failure',
                          'Discord returned an invalid bot profile'
                      )
                  )
                : operationSuccess(user)
        },

        async getChannel(accessToken, channelId) {
            if (accessToken.trim().length === 0) {
                return operationFailure(
                    permanentFailure('invalid_input', 'The Discord Bot token is unavailable')
                )
            }
            if (!DISCORD_CHANNEL_ID_PATTERN.test(channelId)) {
                return operationFailure(
                    permanentFailure('invalid_input', 'The Discord channel ID is invalid')
                )
            }
            const base = baseUrl.toString().replace(/\/$/, '')
            const result = await request(
                `${base}/api/${DISCORD_API_VERSION}/channels/${encodeURIComponent(channelId)}`,
                { method: 'GET' },
                accessToken,
                'read'
            )
            if ('failure' in result) return operationFailure(result.failure)
            const channel = readChannel(result.body)
            return channel === null
                ? operationFailure(
                      retryableFailure('provider_failure', 'Discord returned an invalid channel')
                  )
                : operationSuccess(channel)
        },

        async createMessage(input): Promise<DiscordPublishOutcome> {
            if (input.accessToken.trim().length === 0) {
                return permanentFailure('invalid_input', 'The Discord Bot token is unavailable')
            }
            if (!DISCORD_CHANNEL_ID_PATTERN.test(input.channelId)) {
                return permanentFailure('invalid_input', 'The Discord channel ID is invalid')
            }
            if (
                input.content.trim().length === 0 ||
                input.content.length > DISCORD_MAX_CONTENT_LENGTH
            ) {
                return permanentFailure(
                    'invalid_input',
                    'The Discord message text must contain 1 to 2000 characters'
                )
            }
            if (input.attachments.length > DISCORD_MAX_ATTACHMENTS) {
                return permanentFailure(
                    'invalid_input',
                    `Discord messages support up to ${DISCORD_MAX_ATTACHMENTS} attachments`
                )
            }
            for (const attachment of input.attachments) {
                if (
                    attachment.contentType !== 'image/jpeg' &&
                    attachment.contentType !== 'image/png'
                ) {
                    return permanentFailure(
                        'invalid_input',
                        'Discord image posts support JPEG and PNG images only'
                    )
                }
                if (
                    attachment.filename.trim().length === 0 ||
                    attachment.description.trim().length === 0 ||
                    attachment.description.length > DISCORD_MAX_DESCRIPTION_LENGTH
                ) {
                    return permanentFailure(
                        'invalid_input',
                        'The Discord attachment metadata is invalid'
                    )
                }
            }

            const url = messageEndpoint(baseUrl, input.channelId)
            let result: JsonResponse | { readonly failure: DiscordOperationFailure }
            if (input.attachments.length === 0) {
                result = await request(
                    url,
                    {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                            content: input.content,
                            allowed_mentions: { parse: [] },
                        }),
                    },
                    input.accessToken,
                    'message'
                )
            } else {
                let form: FormData
                try {
                    form = new FormData()
                    const payloadAttachments = input.attachments.map((attachment, index) => ({
                        id: index,
                        filename: attachment.filename,
                        description: attachment.description,
                    }))
                    form.append(
                        'payload_json',
                        JSON.stringify({
                            content: input.content,
                            allowed_mentions: { parse: [] },
                            attachments: payloadAttachments,
                        })
                    )
                    for (let index = 0; index < input.attachments.length; index += 1) {
                        const attachment = input.attachments[index]
                        if (attachment === undefined) continue
                        const blob = await new Response(attachment.stream).blob()
                        form.append(
                            `files[${index}]`,
                            new Blob([blob], { type: attachment.contentType }),
                            attachment.filename
                        )
                    }
                } catch {
                    return {
                        type: 'retryable_failure',
                        effectOccurred: false,
                        code: 'provider_failure',
                        errorMessage: 'The pinned Discord media could not be read',
                    }
                }
                result = await request(
                    url,
                    { method: 'POST', body: form },
                    input.accessToken,
                    'message'
                )
            }

            if ('failure' in result) return result.failure
            const parsed = readMessageResult(result.body, input.channelId)
            if (parsed === null) {
                return ambiguousFailure(
                    'missing_message_id',
                    'Discord returned no message identifier'
                )
            }
            if (parsed.attachmentIds.length !== input.attachments.length) {
                return ambiguousFailure(
                    'missing_attachment_id',
                    'Discord returned an incomplete attachment list'
                )
            }
            return {
                type: 'published',
                externalId: parsed.messageId,
                ...(parsed.guildId === null
                    ? {}
                    : {
                          externalUrl: `https://discord.com/channels/${parsed.guildId}/${input.channelId}/${parsed.messageId}`,
                      }),
                ...(parsed.attachmentIds.length === 0
                    ? {}
                    : { attachmentIds: parsed.attachmentIds }),
            }
        },
    }
}

function mergeHeaders(extra: RequestInit['headers'], auth: Headers): Headers {
    const headers = new Headers(extra)
    const authorization = auth.get('authorization')
    const accept = auth.get('accept')
    if (authorization !== null) headers.set('authorization', authorization)
    if (accept !== null) headers.set('accept', accept)
    return headers
}
