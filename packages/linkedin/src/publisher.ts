import {
    LINKEDIN_API_BASE_URL,
    LINKEDIN_DEFAULT_API_VERSION,
    LINKEDIN_DEFAULT_TIMEOUT_MS,
    LINKEDIN_POSTS_PATH,
    LINKEDIN_RESTLI_PROTOCOL_VERSION,
    type LinkedInAmbiguousFailureCode,
    type LinkedInPermanentFailureCode,
    type LinkedInPublishOutcome,
    type LinkedInRetryableFailureCode,
    type LinkedInTextPublisher,
    type LinkedInTextPublisherOptions,
    type PublishLinkedInTextInput,
} from './contract'
import { createLinkedInMemberTextPostPayload } from './payload'

export function createLinkedInTextPublisher(
    options: LinkedInTextPublisherOptions = {}
): LinkedInTextPublisher {
    const apiVersion = normalizeApiVersion(options.apiVersion ?? LINKEDIN_DEFAULT_API_VERSION)
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? LINKEDIN_API_BASE_URL)
    const fetcher = options.fetcher ?? globalThis.fetch
    const timeoutMs = normalizeTimeout(options.timeoutMs ?? LINKEDIN_DEFAULT_TIMEOUT_MS)

    return {
        async publishText(input) {
            const validationError = validateInput(input)
            if (validationError !== null) return validationError

            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), timeoutMs)
            const url = new URL(LINKEDIN_POSTS_PATH, baseUrl)

            try {
                let response: Response
                try {
                    response = await fetcher(url, {
                        method: 'POST',
                        headers: {
                            authorization: `Bearer ${input.accessToken}`,
                            'content-type': 'application/json',
                            'linkedin-version': apiVersion,
                            'x-restli-protocol-version': LINKEDIN_RESTLI_PROTOCOL_VERSION,
                        },
                        body: JSON.stringify(
                            createLinkedInMemberTextPostPayload({
                                memberId: input.memberId.trim(),
                                commentary: input.commentary,
                            })
                        ),
                        signal: controller.signal,
                    })
                } catch (error) {
                    return networkFailure(error, input.accessToken, controller.signal.aborted)
                }

                if (response.status === 201) {
                    const externalId = response.headers.get('x-restli-id')?.trim()
                    if (externalId !== undefined && externalId.length > 0) {
                        return { type: 'published', externalId }
                    }

                    return ambiguousFailure(
                        'missing_post_id',
                        'LinkedIn accepted the post but did not return x-restli-id; the publication outcome is ambiguous'
                    )
                }

                const providerMessage = await readProviderMessage(response, input.accessToken)
                return classifyResponse(response, providerMessage)
            } finally {
                clearTimeout(timeout)
            }
        },
    }
}

function validateInput(input: PublishLinkedInTextInput): LinkedInPublishOutcome | null {
    if (input.accessToken.trim().length === 0) {
        return permanentFailure('invalid_input', 'LinkedIn accessToken must not be blank')
    }
    if (input.memberId.trim().length === 0 || /\s/.test(input.memberId)) {
        return permanentFailure('invalid_input', 'LinkedIn memberId must be a non-whitespace value')
    }
    if (input.memberId.startsWith('urn:')) {
        return permanentFailure(
            'invalid_input',
            'LinkedIn memberId must be the provider member identifier, not a URN'
        )
    }
    if (input.commentary.trim().length === 0) {
        return permanentFailure('invalid_input', 'LinkedIn commentary must not be blank')
    }
    return null
}

function classifyResponse(
    response: Response,
    providerMessage: string | undefined
): LinkedInPublishOutcome {
    const detail = providerMessage ?? 'No provider details returned'

    if (response.status === 429) {
        return retryableFailure(
            'rate_limited',
            `LinkedIn rate limited the post request (HTTP 429): ${detail}`
        )
    }
    if (response.status === 401) {
        return permanentFailure(
            'authentication_required',
            `LinkedIn rejected the access token (HTTP 401): ${detail}`
        )
    }
    if (response.status === 403) {
        return permanentFailure(
            'forbidden',
            `LinkedIn rejected the publishing permission (HTTP 403): ${detail}`
        )
    }
    if (response.status === 408) {
        return ambiguousFailure(
            'provider_timeout',
            `LinkedIn timed out the post request (HTTP 408); the publication outcome is ambiguous: ${detail}`
        )
    }
    if (response.status >= 400 && response.status < 500) {
        return permanentFailure(
            'invalid_request',
            `LinkedIn rejected the post request (HTTP ${response.status}): ${detail}`
        )
    }
    if (response.status >= 500) {
        return ambiguousFailure(
            'provider_failure',
            `LinkedIn returned a server error (HTTP ${response.status}); the publication outcome is ambiguous: ${detail}`
        )
    }

    return ambiguousFailure(
        'unexpected_response',
        `LinkedIn returned an unexpected HTTP ${response.status} response; the publication outcome is ambiguous: ${detail}`
    )
}

async function readProviderMessage(
    response: Response,
    accessToken: string
): Promise<string | undefined> {
    let body: string
    try {
        body = await response.text()
    } catch {
        return undefined
    }

    const redactedBody = redactSecret(body.trim(), accessToken)
    if (redactedBody.length === 0) return undefined

    try {
        const parsed: unknown = JSON.parse(redactedBody)
        if (isRecord(parsed)) {
            for (const key of ['message', 'error_description', 'error']) {
                const value = parsed[key]
                if (typeof value === 'string' && value.trim().length > 0) {
                    return limitMessage(value)
                }
            }
        }
    } catch {
        // LinkedIn may return plain text for a gateway or proxy failure.
    }

    return limitMessage(redactedBody)
}

function networkFailure(
    error: unknown,
    accessToken: string,
    timedOut: boolean
): LinkedInPublishOutcome {
    const reason = timedOut
        ? 'request timed out'
        : `request failed${error instanceof Error && error.message.trim() ? `: ${redactSecret(error.message.trim(), accessToken)}` : ''}`
    return ambiguousFailure(
        timedOut ? 'provider_timeout' : 'network_failure',
        `LinkedIn ${reason} after dispatch; the publication outcome is ambiguous`
    )
}

function permanentFailure(
    code: LinkedInPermanentFailureCode,
    errorMessage: string
): LinkedInPublishOutcome {
    return { type: 'permanent_failure', effectOccurred: false, code, errorMessage }
}

function retryableFailure(
    code: LinkedInRetryableFailureCode,
    errorMessage: string
): LinkedInPublishOutcome {
    return { type: 'retryable_failure', effectOccurred: false, code, errorMessage }
}

function ambiguousFailure(
    code: LinkedInAmbiguousFailureCode,
    errorMessage: string
): LinkedInPublishOutcome {
    return { type: 'ambiguous', code, errorMessage }
}

function normalizeApiVersion(value: string): string {
    if (!/^\d{6}$/.test(value)) {
        throw new TypeError('LinkedIn API version must use the YYYYMM format')
    }

    const month = Number(value.slice(4))
    if (month < 1 || month > 12) {
        throw new TypeError('LinkedIn API version must contain a valid month')
    }

    return value
}

function normalizeBaseUrl(value: string): URL {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new TypeError('LinkedIn base URL must use HTTP or HTTPS')
    }
    if (url.username.length > 0 || url.password.length > 0) {
        throw new TypeError('LinkedIn base URL must not contain credentials')
    }
    return url
}

function normalizeTimeout(value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError('LinkedIn timeoutMs must be a positive safe integer')
    }
    return value
}

function redactSecret(value: string, secret: string): string {
    return value.replaceAll(secret, '[redacted]')
}

function limitMessage(value: string): string {
    const normalized = value.trim().replace(/\s+/g, ' ')
    return normalized.length > 256 ? `${normalized.slice(0, 253)}...` : normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
