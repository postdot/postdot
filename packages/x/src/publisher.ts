import type {
    XFetcher,
    XMediaInput,
    XMediaUploadOutcome,
    XOperationFailure,
    XOperationResult,
    XPublishOutcome,
    XPublisher,
    XPublisherOptions,
    XTweetInput,
    XUser,
} from './contract'
import { X_API_BASE_URL, X_DEFAULT_TIMEOUT_MS, X_MEDIA_CATEGORY_TWEET_IMAGE } from './contract'

function operationSuccess<Value>(value: Value): XOperationResult<Value> {
    return { kind: 'success', value }
}

function operationFailure(outcome: XOperationFailure): XOperationResult<never> {
    return { kind: 'failure', outcome }
}

function retryableFailure(
    code: Extract<XOperationFailure, { readonly type: 'retryable_failure' }>['code'],
    errorMessage: string
): Extract<XOperationFailure, { readonly type: 'retryable_failure' }> {
    return { type: 'retryable_failure', effectOccurred: false, code, errorMessage }
}

function permanentFailure(
    code: Extract<XOperationFailure, { readonly type: 'permanent_failure' }>['code'],
    errorMessage: string
): Extract<XOperationFailure, { readonly type: 'permanent_failure' }> {
    return { type: 'permanent_failure', effectOccurred: false, code, errorMessage }
}

function ambiguousFailure(
    code: Extract<XOperationFailure, { readonly type: 'ambiguous' }>['code'],
    errorMessage: string,
    remoteMediaId?: string
): Extract<XOperationFailure, { readonly type: 'ambiguous' }> {
    return {
        type: 'ambiguous',
        code,
        errorMessage,
        ...(remoteMediaId === undefined ? {} : { remoteMediaId }),
    }
}

interface JsonResponse {
    readonly response: Response
    readonly body: unknown
}

async function readJsonResponse(response: Response): Promise<JsonResponse> {
    const body = await response.json().catch(() => null)
    return { response, body }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function responseMessage(body: unknown, fallback: string, secrets: readonly string[]): string {
    const raw = readResponseText(body)
    if (raw === null) return fallback
    return redactSecrets(raw, secrets).slice(0, 500)
}

function readResponseText(body: unknown): string | null {
    if (!isRecord(body)) return null
    if (typeof body.detail === 'string' && body.detail.trim().length > 0) {
        return body.detail.trim()
    }
    if (Array.isArray(body.errors) && body.errors.length > 0) {
        const first = body.errors[0]
        if (
            isRecord(first) &&
            typeof first.message === 'string' &&
            first.message.trim().length > 0
        ) {
            return first.message.trim()
        }
    }
    if (typeof body.title === 'string' && body.title.trim().length > 0) {
        return body.title.trim()
    }
    if (typeof body.error === 'string' && body.error.trim().length > 0) {
        return body.error.trim()
    }
    return null
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

function readUser(value: unknown): XUser | null {
    if (!isRecord(value) || !isRecord(value.data)) return null
    const data = value.data
    const id = readString(data.id)
    const name = readString(data.name)
    const username = readString(data.username)
    if (id === null || name === null || username === null) return null
    return { id, name, username }
}

interface MediaUploadResult {
    readonly mediaId: string
    readonly expiresAfterSecs: number | null
}

function readMediaId(value: unknown): string | null {
    if (typeof value === 'string') return readString(value)
    if (typeof value === 'number' || typeof value === 'bigint') {
        const text = String(value)
        return /^[0-9]{1,19}$/.test(text) ? text : null
    }
    return null
}

function readExpiresAfterSecs(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null
    return value
}

/**
 * Reads a v2 simple-upload response body of the documented shape
 * `{ data: { id, expires_after_secs?, processing_info? } }`.
 */
function readMediaUploadResult(value: unknown): MediaUploadResult | null {
    if (!isRecord(value) || !isRecord(value.data)) return null
    const mediaId = readMediaId(value.data.id)
    if (mediaId === null) return null
    return { mediaId, expiresAfterSecs: readExpiresAfterSecs(value.data.expires_after_secs) }
}

function readProcessingState(value: unknown): string | null {
    if (!isRecord(value) || !isRecord(value.data)) return null
    const processing = value.data.processing_info
    if (!isRecord(processing) || typeof processing.state !== 'string') return null
    return processing.state
}

function readProcessingError(value: unknown, secrets: readonly string[]): string {
    if (isRecord(value) && isRecord(value.data) && isRecord(value.data.processing_info)) {
        const error = value.data.processing_info.error
        if (isRecord(error) && typeof error.message === 'string') {
            const message = error.message.trim()
            if (message.length > 0) return redactSecrets(message, secrets).slice(0, 500)
        }
    }
    return 'X could not process the uploaded media'
}

function buildHeaders(accessToken?: string, extra?: RequestInit['headers']): Headers {
    const headers = new Headers(extra)
    headers.set('accept', 'application/json')
    if (accessToken !== undefined) headers.set('authorization', `Bearer ${accessToken}`)
    return headers
}

function withTimeout(fetcher: XFetcher, timeoutMs: number): XFetcher {
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
    context: 'read' | 'media' | 'tweet',
    secrets: readonly string[],
    remoteMediaId?: string
): XOperationFailure {
    const message = responseMessage(body, `X returned HTTP ${response.status}`, secrets)
    if (response.status === 401) return permanentFailure('authentication_required', message)
    if (response.status === 403) return permanentFailure('forbidden', message)
    if (response.status === 409) return retryableFailure('conflict', message)
    if (response.status === 429) return retryableFailure('rate_limited', message)
    if (response.status === 400 || response.status === 404 || response.status === 422) {
        return permanentFailure('invalid_request', message)
    }
    if (response.status >= 500) {
        return context === 'tweet' || context === 'media'
            ? ambiguousFailure('provider_failure', message, remoteMediaId)
            : retryableFailure('provider_failure', message)
    }
    return context === 'tweet' || context === 'media'
        ? ambiguousFailure('unexpected_response', message, remoteMediaId)
        : retryableFailure('provider_failure', message)
}

function classifyException(
    error: unknown,
    context: 'read' | 'media' | 'tweet',
    remoteMediaId?: string
): XOperationFailure {
    const isAbort = error instanceof DOMException && error.name === 'AbortError'
    const message = isAbort ? 'The X request timed out' : 'The X request could not be completed'
    return context === 'tweet' || context === 'media'
        ? ambiguousFailure(isAbort ? 'provider_timeout' : 'network_failure', message, remoteMediaId)
        : retryableFailure('provider_failure', message)
}

export function createXPublisher(options: XPublisherOptions = {}): XPublisher {
    const apiBaseUrl = (options.apiBaseUrl ?? X_API_BASE_URL).replace(/\/+$/, '')
    const fetcher = withTimeout(options.fetcher ?? fetch, options.timeoutMs ?? X_DEFAULT_TIMEOUT_MS)

    async function request(
        url: string,
        init: RequestInit,
        accessToken: string | undefined,
        context: 'read' | 'media' | 'tweet',
        remoteMediaId?: string
    ): Promise<JsonResponse | { readonly failure: XOperationFailure }> {
        try {
            const response = await fetcher(url, {
                ...init,
                headers: buildHeaders(accessToken, init.headers),
            })
            const parsed = await readJsonResponse(response)
            if (!response.ok) {
                return {
                    failure: classifyResponse(
                        response,
                        parsed.body,
                        context,
                        accessToken === undefined ? [] : [accessToken],
                        remoteMediaId
                    ),
                }
            }
            return parsed
        } catch (error) {
            return { failure: classifyException(error, context, remoteMediaId) }
        }
    }

    return {
        async getMe(accessToken) {
            const result = await request(
                `${apiBaseUrl}/2/users/me`,
                { method: 'GET' },
                accessToken,
                'read'
            )
            if ('failure' in result) return operationFailure(result.failure)
            const user = readUser(result.body)
            return user === null
                ? operationFailure(
                      retryableFailure('provider_failure', 'X returned an invalid user profile')
                  )
                : operationSuccess(user)
        },

        async uploadMedia(accessToken: string, input: XMediaInput): Promise<XMediaUploadOutcome> {
            let file: Blob
            try {
                file = await new Response(input.stream).blob()
            } catch {
                return {
                    type: 'retryable_failure',
                    effectOccurred: false,
                    code: 'provider_failure',
                    errorMessage: 'The pinned X media could not be read',
                }
            }

            // Simple v2 upload: one multipart POST carries the image bytes plus
            // the required media_category for the tweet_image use case.
            const form = new FormData()
            form.append('media', new Blob([file], { type: input.contentType }), input.filename)
            form.append('media_category', X_MEDIA_CATEGORY_TWEET_IMAGE)

            const uploadResult = await request(
                `${apiBaseUrl}/2/media/upload`,
                { method: 'POST', body: form },
                accessToken,
                'media'
            )
            if ('failure' in uploadResult) return uploadResult.failure

            const uploaded = readMediaUploadResult(uploadResult.body)
            if (uploaded === null) {
                return ambiguousFailure(
                    'missing_media_id',
                    'X returned no media attachment identifier'
                )
            }
            const mediaId = uploaded.mediaId
            const processingState = readProcessingState(uploadResult.body)
            if (processingState === 'failed') {
                return {
                    type: 'permanent_failure',
                    effectOccurred: false,
                    code: 'invalid_request',
                    errorMessage: readProcessingError(uploadResult.body, [accessToken]),
                }
            }
            if (processingState === 'pending' || processingState === 'in_progress') {
                return ambiguousFailure(
                    'provider_failure',
                    'The X media processing outcome is unknown',
                    mediaId
                )
            }

            // Metadata step: attach alt text after the upload and before the
            // post is created. A metadata failure fails the execution rather
            // than publishing without the declared accessibility text.
            if (input.accessibilityText && input.accessibilityText.trim().length > 0) {
                const metadataResult = await request(
                    `${apiBaseUrl}/2/media/metadata`,
                    {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                            id: mediaId,
                            metadata: {
                                alt_text: { text: input.accessibilityText.trim() },
                            },
                        }),
                    },
                    accessToken,
                    'media',
                    mediaId
                )
                if ('failure' in metadataResult) {
                    return metadataResult.failure
                }
            }

            return {
                type: 'uploaded',
                remoteMediaId: mediaId,
                ready: true,
                expiresAfterSecs: uploaded.expiresAfterSecs,
            }
        },

        async publishTweet(input: XTweetInput): Promise<XPublishOutcome> {
            const body: Record<string, unknown> = {
                text: input.text,
            }
            if (input.mediaIds && input.mediaIds.length > 0) {
                body.media = {
                    media_ids: [...input.mediaIds],
                }
            }

            const result = await request(
                `${apiBaseUrl}/2/tweets`,
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body),
                },
                input.accessToken,
                'tweet'
            )
            if ('failure' in result) return result.failure

            if (!isRecord(result.body) || !isRecord(result.body.data)) {
                return ambiguousFailure('missing_post_id', 'X returned no tweet data')
            }

            const externalId = readString(result.body.data.id)
            if (externalId === null) {
                return ambiguousFailure('missing_post_id', 'X returned an invalid tweet identifier')
            }

            return {
                type: 'published',
                externalId,
                externalUrl: `https://x.com/i/web/status/${externalId}`,
            }
        },
    }
}
