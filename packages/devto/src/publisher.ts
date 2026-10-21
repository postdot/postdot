import {
    DEVTO_API_ACCEPT,
    DEVTO_API_BASE_URL,
    DEVTO_DEFAULT_TIMEOUT_MS,
    DEVTO_MAX_BODY_LENGTH,
    DEVTO_MAX_TITLE_LENGTH,
    type DevtoFetcher,
    type DevtoArticleAnalytics,
    type DevtoOperationFailure,
    type DevtoOperationResult,
    type DevtoPublishOutcome,
    type DevtoPublisher,
    type DevtoPublisherOptions,
    type DevtoUser,
    type PublishDevtoArticleInput,
} from './contract'

function operationSuccess<Value>(value: Value): DevtoOperationResult<Value> {
    return { kind: 'success', value }
}

function operationFailure(outcome: DevtoOperationFailure): DevtoOperationResult<never> {
    return { kind: 'failure', outcome }
}

function retryableFailure(
    code: Extract<DevtoOperationFailure, { readonly type: 'retryable_failure' }>['code'],
    errorMessage: string
): Extract<DevtoOperationFailure, { readonly type: 'retryable_failure' }> {
    return { type: 'retryable_failure', effectOccurred: false, code, errorMessage }
}

function permanentFailure(
    code: Extract<DevtoOperationFailure, { readonly type: 'permanent_failure' }>['code'],
    errorMessage: string
): Extract<DevtoOperationFailure, { readonly type: 'permanent_failure' }> {
    return { type: 'permanent_failure', effectOccurred: false, code, errorMessage }
}

function ambiguousFailure(
    code: Extract<DevtoOperationFailure, { readonly type: 'ambiguous' }>['code'],
    errorMessage: string
): Extract<DevtoOperationFailure, { readonly type: 'ambiguous' }> {
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readNonBlank(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readProviderId(value: unknown): string | null {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
        return String(value)
    }
    return readNonBlank(value)
}

function readDevtoUser(value: unknown): DevtoUser | null {
    if (!isRecord(value)) return null
    const id = readProviderId(value.id)
    const username = readNonBlank(value.username)
    const name = readNonBlank(value.name) ?? username
    return id === null || username === null || name === null ? null : { id, username, name }
}

function readAnalyticsTotal(value: unknown): number | null {
    if (!isRecord(value)) return null
    const total = value.total
    return typeof total === 'number' && Number.isSafeInteger(total) && total >= 0 ? total : null
}

function readDevtoArticleAnalytics(
    value: unknown,
    articleId: string
): DevtoArticleAnalytics | null {
    if (!isRecord(value)) return null
    const comments = readAnalyticsTotal(value.comments)
    const reactions = readAnalyticsTotal(value.reactions)
    const pageViews = readAnalyticsTotal(value.page_views)
    if (comments === null || reactions === null || pageViews === null) return null
    return { articleId, comments, reactions, pageViews }
}

function normalizeArticleId(value: string): string {
    const articleId = readNonBlank(value)
    const numericId = articleId === null ? Number.NaN : Number(articleId)
    if (
        articleId === null ||
        !Number.isSafeInteger(numericId) ||
        numericId <= 0 ||
        String(numericId) !== articleId
    ) {
        throw new TypeError('DEV.to article ID must be a positive integer')
    }
    return articleId
}

function readArticle(value: unknown): { readonly id: string; readonly url?: string } | null {
    if (!isRecord(value)) return null
    const id = readProviderId(value.id)
    if (id === null) return null
    const url = readHttpUrl(value.url)
    return url === null ? { id } : { id, url }
}

function readHttpUrl(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim().length === 0) return null
    try {
        const url = new URL(value)
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
        if (url.username.length > 0 || url.password.length > 0) return null
        return url.toString()
    } catch {
        return null
    }
}

function normalizeBaseUrl(value: string): URL {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new TypeError('DEV.to base URL must use HTTP or HTTPS')
    }
    if (url.username.length > 0 || url.password.length > 0) {
        throw new TypeError('DEV.to base URL must not contain credentials')
    }
    return url
}

function normalizeTimeout(value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError('DEV.to timeoutMs must be a positive safe integer')
    }
    return value
}

export function normalizeDevtoApiKey(value: string): string {
    const key = value.trim()
    if (key.length === 0 || /\s/.test(key)) {
        throw new TypeError('DEV.to API key must not be blank or contain whitespace')
    }
    return key
}

function normalizeMainImageUrl(value: string): string {
    const url = readHttpUrl(value)
    if (url === null) throw new TypeError('DEV.to main image URL must be an absolute HTTP URL')
    return url
}

function withTimeout(fetcher: DevtoFetcher, timeoutMs: number): DevtoFetcher {
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

function buildHeaders(apiKey: string): Headers {
    const headers = new Headers()
    headers.set('accept', DEVTO_API_ACCEPT)
    headers.set('api-key', apiKey)
    headers.set('user-agent', 'Postdot/0.1')
    return headers
}

function classifyResponse(response: Response, context: 'read' | 'publish'): DevtoOperationFailure {
    if (response.status === 401) {
        return permanentFailure('authentication_required', 'DEV.to rejected the API key')
    }
    if (response.status === 403) {
        return permanentFailure('forbidden', 'DEV.to rejected the API key permissions')
    }
    if (response.status === 429) {
        return retryableFailure('rate_limited', 'DEV.to rate-limited the request')
    }
    if ([400, 404, 422].includes(response.status)) {
        return permanentFailure('invalid_request', 'DEV.to rejected the request')
    }
    if (response.status >= 500) {
        return context === 'publish'
            ? ambiguousFailure('provider_failure', 'DEV.to did not confirm the article outcome')
            : retryableFailure('provider_failure', 'DEV.to could not verify the account')
    }
    return context === 'publish'
        ? ambiguousFailure('unexpected_response', 'DEV.to did not confirm the article outcome')
        : retryableFailure('provider_failure', 'DEV.to returned an unexpected account response')
}

function classifyException(error: unknown, context: 'read' | 'publish'): DevtoOperationFailure {
    const isAbort = error instanceof DOMException && error.name === 'AbortError'
    if (context === 'publish') {
        return ambiguousFailure(
            isAbort ? 'provider_timeout' : 'network_failure',
            isAbort
                ? 'The DEV.to article request timed out'
                : 'The DEV.to article outcome is unknown'
        )
    }
    return retryableFailure(
        'provider_failure',
        isAbort ? 'The DEV.to account request timed out' : 'DEV.to could not verify the account'
    )
}

function mergeHeaders(extra: RequestInit['headers'], auth: Headers): Headers {
    const headers = new Headers(extra)
    for (const [name, value] of auth.entries()) headers.set(name, value)
    return headers
}

export function createDevtoPublisher(options: DevtoPublisherOptions = {}): DevtoPublisher {
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEVTO_API_BASE_URL)
    const fetcher = withTimeout(
        options.fetcher ?? globalThis.fetch,
        normalizeTimeout(options.timeoutMs ?? DEVTO_DEFAULT_TIMEOUT_MS)
    )
    const base = baseUrl.toString().replace(/\/$/, '')

    async function request(
        path: string,
        init: RequestInit,
        apiKey: string,
        context: 'read' | 'publish'
    ): Promise<JsonResponse | { readonly failure: DevtoOperationFailure }> {
        try {
            const response = await fetcher(`${base}${path}`, {
                ...init,
                headers: mergeHeaders(init.headers, buildHeaders(apiKey)),
            })
            const parsed = await readJsonResponse(response)
            if (!response.ok) return { failure: classifyResponse(response, context) }
            return parsed
        } catch (error) {
            return { failure: classifyException(error, context) }
        }
    }

    return {
        async getMe(apiKey) {
            let normalizedKey: string
            try {
                normalizedKey = normalizeDevtoApiKey(apiKey)
            } catch {
                return operationFailure(
                    permanentFailure('invalid_input', 'The DEV.to API key is invalid')
                )
            }

            const result = await request('/api/users/me', { method: 'GET' }, normalizedKey, 'read')
            if ('failure' in result) return operationFailure(result.failure)
            const user = readDevtoUser(result.body)
            return user === null
                ? operationFailure(
                      retryableFailure('provider_failure', 'DEV.to returned an invalid account')
                  )
                : operationSuccess(user)
        },

        async getArticleAnalytics(input) {
            let normalizedKey: string
            let articleId: string
            try {
                normalizedKey = normalizeDevtoApiKey(input.apiKey)
                articleId = normalizeArticleId(input.articleId)
            } catch {
                return operationFailure(
                    permanentFailure('invalid_input', 'The DEV.to analytics request is invalid')
                )
            }

            const query = new URLSearchParams({ article_id: articleId })
            const result = await request(
                `/api/analytics/totals?${query.toString()}`,
                { method: 'GET' },
                normalizedKey,
                'read'
            )
            if ('failure' in result) return operationFailure(result.failure)
            const analytics = readDevtoArticleAnalytics(result.body, articleId)
            return analytics === null
                ? operationFailure(
                      retryableFailure(
                          'invalid_response',
                          'DEV.to returned invalid article analytics'
                      )
                  )
                : operationSuccess(analytics)
        },

        async publishArticle(input: PublishDevtoArticleInput): Promise<DevtoPublishOutcome> {
            let apiKey: string
            try {
                apiKey = normalizeDevtoApiKey(input.apiKey)
            } catch {
                return permanentFailure('invalid_input', 'The DEV.to API key is invalid')
            }
            if (input.title.trim().length === 0 || input.title.length > DEVTO_MAX_TITLE_LENGTH) {
                return permanentFailure('invalid_input', 'The DEV.to article title is invalid')
            }
            if (
                input.bodyMarkdown.trim().length === 0 ||
                input.bodyMarkdown.length > DEVTO_MAX_BODY_LENGTH
            ) {
                return permanentFailure('invalid_input', 'The DEV.to article body is invalid')
            }

            let mainImageUrl: string | undefined
            if (input.mainImageUrl !== undefined) {
                try {
                    mainImageUrl = normalizeMainImageUrl(input.mainImageUrl)
                } catch {
                    return permanentFailure('invalid_input', 'The DEV.to main image URL is invalid')
                }
            }

            const article = {
                title: input.title,
                body_markdown: input.bodyMarkdown,
                published: true,
                ...(mainImageUrl === undefined ? {} : { main_image: mainImageUrl }),
            }
            const result = await request(
                '/api/articles',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ article }),
                },
                apiKey,
                'publish'
            )
            if ('failure' in result) return result.failure
            const parsed = readArticle(result.body)
            if (parsed === null) {
                return ambiguousFailure(
                    'missing_article_id',
                    'DEV.to returned no article identifier'
                )
            }
            return {
                type: 'published',
                externalId: parsed.id,
                ...(parsed.url === undefined ? {} : { externalUrl: parsed.url }),
            }
        },
    }
}
