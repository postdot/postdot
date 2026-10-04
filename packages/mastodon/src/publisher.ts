import type {
    MastodonAccount,
    MastodonApplication,
    MastodonFetcher,
    MastodonMediaAttachment,
    MastodonMediaUploadOutcome,
    MastodonOperationFailure,
    MastodonOperationResult,
    MastodonPublishOutcome,
    MastodonPublisher,
    MastodonPublisherOptions,
} from './contract'
import { MASTODON_DEFAULT_TIMEOUT_MS } from './contract'

const mastodonBasePath = '/api'

export function normalizeMastodonInstanceOrigin(value: string): string {
    const exact = value.trim()
    if (exact.length === 0 || exact !== value) {
        throw new Error('Mastodon instance URL must not contain outer spaces')
    }
    const url = new URL(exact)
    const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) ||
        url.username.length > 0 ||
        url.password.length > 0 ||
        url.pathname !== '/' ||
        url.search.length > 0 ||
        url.hash.length > 0
    ) {
        throw new Error('Mastodon instance URL must be an HTTPS origin')
    }
    return url.origin
}

function endpoint(baseUrl: string, path: string): string {
    return `${baseUrl}${mastodonBasePath}${path}`
}

function operationSuccess<Value>(value: Value): MastodonOperationResult<Value> {
    return { kind: 'success', value }
}

function operationFailure(outcome: MastodonOperationFailure): MastodonOperationResult<never> {
    return { kind: 'failure', outcome }
}

function retryableFailure(
    code: Extract<MastodonOperationFailure, { readonly type: 'retryable_failure' }>['code'],
    errorMessage: string
): Extract<MastodonOperationFailure, { readonly type: 'retryable_failure' }> {
    return { type: 'retryable_failure', effectOccurred: false, code, errorMessage }
}

function permanentFailure(
    code: Extract<MastodonOperationFailure, { readonly type: 'permanent_failure' }>['code'],
    errorMessage: string
): Extract<MastodonOperationFailure, { readonly type: 'permanent_failure' }> {
    return { type: 'permanent_failure', effectOccurred: false, code, errorMessage }
}

function ambiguousFailure(
    code: Extract<MastodonOperationFailure, { readonly type: 'ambiguous' }>['code'],
    errorMessage: string,
    remoteMediaId?: string
): Extract<MastodonOperationFailure, { readonly type: 'ambiguous' }> {
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

function responseMessage(body: unknown, fallback: string, secrets: readonly string[]): string {
    if (body !== null && typeof body === 'object' && 'error' in body) {
        const error = body.error
        if (typeof error === 'string' && error.trim().length > 0) {
            return redactSecrets(error.trim(), secrets).slice(0, 500)
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

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function readApplication(value: unknown): MastodonApplication | null {
    if (!isRecord(value)) return null
    const clientId = readString(value.client_id)
    const clientSecret = readString(value.client_secret)
    return clientId === null || clientSecret === null ? null : { clientId, clientSecret }
}

function readAccount(value: unknown): MastodonAccount | null {
    if (!isRecord(value)) return null
    const id = readString(value.id)
    const acct = readString(value.acct)
    const username = readString(value.username)
    const displayName = value.display_name
    if (
        id === null ||
        acct === null ||
        username === null ||
        (displayName !== null && typeof displayName !== 'string')
    ) {
        return null
    }
    return { id, acct, username, displayName: displayName === null ? null : displayName }
}

function readMediaAttachment(value: unknown): MastodonMediaAttachment | null {
    if (!isRecord(value)) return null
    const id = readString(value.id)
    const type = readString(value.type)
    const url = value.url
    if (id === null || type === null || (url !== null && typeof url !== 'string')) return null
    return { id, type, url: url === null ? null : url }
}

function buildHeaders(accessToken?: string, extra?: RequestInit['headers']): Headers {
    const headers = new Headers(extra)
    headers.set('accept', 'application/json')
    if (accessToken !== undefined) headers.set('authorization', `Bearer ${accessToken}`)
    return headers
}

function withTimeout(fetcher: MastodonFetcher, timeoutMs: number): MastodonFetcher {
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
    context: 'read' | 'application' | 'media' | 'status',
    secrets: readonly string[],
    remoteMediaId?: string
): MastodonOperationFailure {
    const message = responseMessage(body, `Mastodon returned HTTP ${response.status}`, secrets)
    if (response.status === 401) return permanentFailure('authentication_required', message)
    if (response.status === 403) return permanentFailure('forbidden', message)
    if (response.status === 409) return retryableFailure('conflict', message)
    if (response.status === 429) return retryableFailure('rate_limited', message)
    if (response.status === 400 || response.status === 404 || response.status === 422) {
        return permanentFailure('invalid_request', message)
    }
    if (response.status >= 500) {
        return context === 'status' || context === 'media'
            ? ambiguousFailure('provider_failure', message, remoteMediaId)
            : retryableFailure('provider_failure', message)
    }
    return context === 'status' || context === 'media'
        ? ambiguousFailure('unexpected_response', message, remoteMediaId)
        : retryableFailure('provider_failure', message)
}

function classifyException(
    error: unknown,
    context: 'read' | 'application' | 'media' | 'status',
    remoteMediaId?: string
): MastodonOperationFailure {
    if (hasErrorCode(error, 'network_policy_denied')) {
        return permanentFailure(
            'network_policy_denied',
            'The Mastodon instance is blocked by the server network policy'
        )
    }
    const isAbort = error instanceof DOMException && error.name === 'AbortError'
    const message = isAbort
        ? 'The Mastodon request timed out'
        : 'The Mastodon request could not be completed'
    return context === 'status' || context === 'media'
        ? ambiguousFailure(isAbort ? 'provider_timeout' : 'network_failure', message, remoteMediaId)
        : retryableFailure('provider_failure', message)
}

function hasErrorCode(error: unknown, code: string): boolean {
    return isRecord(error) && error.code === code
}

export function createMastodonPublisher(options: MastodonPublisherOptions): MastodonPublisher {
    const baseUrl = normalizeMastodonInstanceOrigin(options.baseUrl)
    const fetcher = withTimeout(
        options.fetcher ?? fetch,
        options.timeoutMs ?? MASTODON_DEFAULT_TIMEOUT_MS
    )

    async function request(
        path: string,
        init: RequestInit,
        accessToken: string | undefined,
        context: 'read' | 'application' | 'media' | 'status',
        remoteMediaId?: string
    ): Promise<JsonResponse | { readonly failure: MastodonOperationFailure }> {
        try {
            const response = await fetcher(endpoint(baseUrl, path), {
                ...init,
                headers: buildHeaders(accessToken, init.headers),
            })
            const parsed = await readJsonResponse(response)
            if (!response.ok)
                return {
                    failure: classifyResponse(
                        response,
                        parsed.body,
                        context,
                        accessToken === undefined ? [] : [accessToken],
                        remoteMediaId
                    ),
                }
            return parsed
        } catch (error) {
            return { failure: classifyException(error, context, remoteMediaId) }
        }
    }

    return {
        async registerApplication(input) {
            const body = new URLSearchParams({
                client_name: input.clientName,
                redirect_uris: input.redirectUri,
                scopes: input.scopes.join(' '),
                ...(input.website === undefined ? {} : { website: input.website }),
            })
            const result = await request(
                '/v1/apps',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/x-www-form-urlencoded' },
                    body,
                },
                undefined,
                'application'
            )
            if ('failure' in result) return operationFailure(result.failure)
            const application = readApplication(result.body)
            return application === null
                ? operationFailure(
                      ambiguousFailure(
                          'unexpected_response',
                          'Mastodon returned an invalid application registration'
                      )
                  )
                : operationSuccess(application)
        },

        async verifyCredentials(accessToken) {
            const result = await request(
                '/v1/accounts/verify_credentials',
                { method: 'GET' },
                accessToken,
                'read'
            )
            if ('failure' in result) return operationFailure(result.failure)
            const account = readAccount(result.body)
            return account === null
                ? operationFailure(
                      retryableFailure(
                          'provider_failure',
                          'Mastodon returned an invalid account profile'
                      )
                  )
                : operationSuccess(account)
        },

        async uploadMedia(accessToken, input): Promise<MastodonMediaUploadOutcome> {
            let file: Blob
            try {
                file = await new Response(input.stream).blob()
            } catch {
                return {
                    type: 'retryable_failure',
                    effectOccurred: false,
                    code: 'provider_failure',
                    errorMessage: 'The pinned Mastodon media could not be read',
                }
            }
            const form = new FormData()
            form.append('file', new Blob([file], { type: input.contentType }), input.filename)
            form.append('description', input.accessibilityText)
            const result = await request(
                '/v2/media',
                { method: 'POST', body: form },
                accessToken,
                'media'
            )
            if ('failure' in result) return result.failure
            const attachment = readMediaAttachment(result.body)
            if (attachment === null) {
                return ambiguousFailure(
                    'missing_media_id',
                    'Mastodon returned no media attachment identifier'
                )
            }
            return {
                type: 'uploaded',
                remoteMediaId: attachment.id,
                ready: attachment.url !== null,
            }
        },

        async getMedia(accessToken, mediaId) {
            const result = await request(
                `/v1/media/${encodeURIComponent(mediaId)}`,
                { method: 'GET' },
                accessToken,
                'read',
                mediaId
            )
            if ('failure' in result) return operationFailure(result.failure)
            const attachment = readMediaAttachment(result.body)
            return attachment === null
                ? operationFailure(
                      retryableFailure(
                          'provider_failure',
                          'Mastodon returned an invalid media attachment'
                      )
                  )
                : operationSuccess(attachment)
        },

        async publishStatus(input): Promise<MastodonPublishOutcome> {
            const body = new URLSearchParams({ status: input.text })
            for (const mediaId of input.mediaIds) body.append('media_ids[]', mediaId)
            if (input.visibility !== undefined) body.set('visibility', input.visibility)
            if (input.sensitive !== undefined) body.set('sensitive', String(input.sensitive))
            if (input.spoilerText !== undefined) body.set('spoiler_text', input.spoilerText)
            if (input.language !== undefined) body.set('language', input.language)

            const result = await request(
                '/v1/statuses',
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/x-www-form-urlencoded',
                        'idempotency-key': input.idempotencyKey,
                    },
                    body,
                },
                input.accessToken,
                'status'
            )
            if ('failure' in result) return result.failure
            if (!isRecord(result.body)) {
                return ambiguousFailure('missing_post_id', 'Mastodon returned no status')
            }
            const externalId = readString(result.body.id)
            const externalUrl = result.body.url
            if (externalId === null || (externalUrl !== null && typeof externalUrl !== 'string')) {
                return ambiguousFailure('missing_post_id', 'Mastodon returned an invalid status')
            }
            return {
                type: 'published',
                externalId,
                ...(externalUrl === null ? {} : { externalUrl }),
            }
        },
    }
}
