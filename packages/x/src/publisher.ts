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
import { X_API_BASE_URL, X_DEFAULT_TIMEOUT_MS, X_UPLOAD_BASE_URL } from './contract'

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

function responseMessage(body: unknown, fallback: string): string {
    if (isRecord(body)) {
        if (typeof body.detail === 'string' && body.detail.trim().length > 0) {
            return body.detail.trim().slice(0, 500)
        }
        if (Array.isArray(body.errors) && body.errors.length > 0) {
            const first = body.errors[0]
            if (
                isRecord(first) &&
                typeof first.message === 'string' &&
                first.message.trim().length > 0
            ) {
                return first.message.trim().slice(0, 500)
            }
        }
        if (typeof body.title === 'string' && body.title.trim().length > 0) {
            return body.title.trim().slice(0, 500)
        }
        if (typeof body.error === 'string' && body.error.trim().length > 0) {
            return body.error.trim().slice(0, 500)
        }
    }
    return fallback
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
    remoteMediaId?: string
): XOperationFailure {
    const message = responseMessage(body, `X returned HTTP ${response.status}`)
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
    const uploadBaseUrl = (options.uploadBaseUrl ?? X_UPLOAD_BASE_URL).replace(/\/+$/, '')
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
                return { failure: classifyResponse(response, parsed.body, context, remoteMediaId) }
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

            const form = new FormData()
            form.append('media', new Blob([file], { type: input.contentType }), input.filename)

            const uploadResult = await request(
                `${uploadBaseUrl}/1.1/media/upload.json`,
                { method: 'POST', body: form },
                accessToken,
                'media'
            )
            if ('failure' in uploadResult) return uploadResult.failure

            if (!isRecord(uploadResult.body)) {
                return ambiguousFailure(
                    'missing_media_id',
                    'X returned no media attachment identifier'
                )
            }

            const mediaId =
                readString(uploadResult.body.media_id_string) ??
                (typeof uploadResult.body.media_id === 'number' ||
                typeof uploadResult.body.media_id === 'bigint'
                    ? String(uploadResult.body.media_id)
                    : null)

            if (mediaId === null) {
                return ambiguousFailure(
                    'missing_media_id',
                    'X returned no media attachment identifier'
                )
            }

            if (input.accessibilityText && input.accessibilityText.trim().length > 0) {
                const metadataResult = await request(
                    `${uploadBaseUrl}/1.1/media/metadata/create.json`,
                    {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                            media_id: mediaId,
                            alt_text: { text: input.accessibilityText.trim() },
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
