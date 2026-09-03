import {
    LINKEDIN_API_BASE_URL,
    LINKEDIN_DEFAULT_API_VERSION,
    LINKEDIN_DEFAULT_TIMEOUT_MS,
    LINKEDIN_IMAGES_PATH,
    LINKEDIN_POSTS_PATH,
    LINKEDIN_RESTLI_PROTOCOL_VERSION,
    type LinkedInAmbiguousFailureCode,
    type LinkedInImagePublisher,
    type LinkedInImagePublisherOptions,
    type LinkedInMediaUploadAmbiguousFailureCode,
    type LinkedInMediaUploadOutcome,
    type LinkedInPermanentFailureCode,
    type LinkedInPublishOutcome,
    type LinkedInRetryableFailureCode,
    type LinkedInTextPublisher,
    type LinkedInTextPublisherOptions,
    type PublishLinkedInImagePostInput,
    type PublishLinkedInImageUploadInput,
    type PublishLinkedInTextInput,
} from './contract'
import {
    createLinkedInDestinationUrn,
    createLinkedInImagePostPayload,
    createLinkedInTextPostPayload,
} from './payload'

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
                            createLinkedInTextPostPayload({
                                destination: normalizeDestination(input.destination),
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

export function createLinkedInImagePublisher(
    options: LinkedInImagePublisherOptions = {}
): LinkedInImagePublisher {
    const apiVersion = normalizeApiVersion(options.apiVersion ?? LINKEDIN_DEFAULT_API_VERSION)
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? LINKEDIN_API_BASE_URL)
    const fetcher = options.fetcher ?? globalThis.fetch
    const timeoutMs = normalizeTimeout(options.timeoutMs ?? LINKEDIN_DEFAULT_TIMEOUT_MS)

    return {
        async uploadImage(input) {
            const validationError = validateImageUploadInput(input)
            if (validationError !== null) return validationError

            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), timeoutMs)
            let remoteMediaId: string | undefined

            try {
                const initializeUrl = new URL(LINKEDIN_IMAGES_PATH, baseUrl)
                initializeUrl.searchParams.set('action', 'initializeUpload')

                let initializeResponse: Response
                try {
                    initializeResponse = await fetcher(initializeUrl, {
                        method: 'POST',
                        headers: linkedInJsonHeaders(input.accessToken, apiVersion),
                        body: JSON.stringify({
                            initializeUploadRequest: {
                                owner: createLinkedInDestinationUrn(
                                    normalizeDestination(input.destination)
                                ),
                            },
                        }),
                        signal: controller.signal,
                    })
                } catch {
                    return mediaNetworkFailure(controller.signal.aborted)
                }

                if (initializeResponse.status !== 200) {
                    const providerMessage = await readProviderMessage(
                        initializeResponse,
                        input.accessToken
                    )
                    return classifyImageResponse(
                        initializeResponse,
                        providerMessage,
                        'image initialization'
                    )
                }

                const initializeBody = await readProviderPayload(initializeResponse, [
                    input.accessToken,
                ])
                const value =
                    isRecord(initializeBody.parsed) && isRecord(initializeBody.parsed.value)
                        ? initializeBody.parsed.value
                        : null
                const imageId =
                    value !== null && typeof value.image === 'string' ? value.image.trim() : ''
                const uploadUrlValue =
                    value !== null && typeof value.uploadUrl === 'string'
                        ? value.uploadUrl.trim()
                        : ''

                if (imageId.length > 0 && isLinkedInImageId(imageId)) remoteMediaId = imageId
                if (uploadUrlValue.length === 0) {
                    return ambiguousMediaFailure(
                        'missing_upload_url',
                        'LinkedIn registered the image upload but did not return an upload URL',
                        remoteMediaId
                    )
                }
                if (imageId.length === 0) {
                    return ambiguousMediaFailure(
                        'missing_image_id',
                        'LinkedIn returned an upload URL without an image identifier; the media outcome is ambiguous'
                    )
                }
                if (!isLinkedInImageId(imageId)) {
                    return ambiguousMediaFailure(
                        'unexpected_response',
                        'LinkedIn returned an invalid image identifier; the media outcome is ambiguous'
                    )
                }

                let uploadUrl: URL
                try {
                    uploadUrl = normalizeUploadUrl(uploadUrlValue)
                } catch {
                    return ambiguousMediaFailure(
                        'unexpected_response',
                        'LinkedIn returned an invalid image upload URL; the media outcome is ambiguous',
                        remoteMediaId
                    )
                }

                let uploadResponse: Response
                try {
                    uploadResponse = await fetcher(uploadUrl, {
                        method: 'PUT',
                        headers: {
                            authorization: `Bearer ${input.accessToken}`,
                            'content-length': String(input.media.size),
                            'content-type': input.media.contentType,
                        },
                        body: input.media.stream,
                        redirect: 'error',
                        signal: controller.signal,
                    })
                } catch {
                    return mediaNetworkFailure(controller.signal.aborted, remoteMediaId)
                }

                if (!uploadResponse.ok) {
                    const providerMessage = await readProviderMessage(
                        uploadResponse,
                        input.accessToken,
                        [uploadUrl.toString()]
                    )
                    return classifyImageResponse(
                        uploadResponse,
                        providerMessage,
                        'image upload',
                        remoteMediaId
                    )
                }

                return { type: 'uploaded', remoteMediaId: imageId }
            } finally {
                clearTimeout(timeout)
            }
        },

        async publishImage(input) {
            const validationError = validateImagePostInput(input)
            if (validationError !== null) return validationError

            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), timeoutMs)
            try {
                let response: Response
                try {
                    response = await fetcher(new URL(LINKEDIN_POSTS_PATH, baseUrl), {
                        method: 'POST',
                        headers: linkedInJsonHeaders(input.accessToken, apiVersion),
                        body: JSON.stringify(
                            createLinkedInImagePostPayload({
                                destination: normalizeDestination(input.destination),
                                commentary: input.commentary,
                                imageId: input.imageId.trim(),
                                accessibilityText: input.accessibilityText,
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
                        'LinkedIn accepted the image post but did not return x-restli-id; the publication outcome is ambiguous'
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
    const destinationError = validateDestination(input.destination)
    if (destinationError !== null) {
        return permanentFailure(destinationError.code, destinationError.errorMessage)
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
    if (response.status === 409) {
        return retryableFailure(
            'conflict',
            `LinkedIn reported a write conflict for the post request (HTTP 409): ${detail}`
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

function classifyImageResponse(
    response: Response,
    providerMessage: string | undefined,
    operation: string,
    remoteMediaId?: string
): LinkedInMediaUploadOutcome {
    const detail = providerMessage ?? 'No provider details returned'

    if (response.status === 429) {
        return mediaRetryableFailure(
            'rate_limited',
            `LinkedIn rate limited the ${operation} request (HTTP 429): ${detail}`
        )
    }
    if (response.status === 409) {
        return mediaRetryableFailure(
            'conflict',
            `LinkedIn reported a write conflict during the ${operation} request (HTTP 409): ${detail}`
        )
    }
    if (response.status === 401) {
        return mediaPermanentFailure(
            'authentication_required',
            `LinkedIn rejected the access token during ${operation} (HTTP 401): ${detail}`
        )
    }
    if (response.status === 403) {
        return mediaPermanentFailure(
            'forbidden',
            `LinkedIn rejected the publishing permission during ${operation} (HTTP 403): ${detail}`
        )
    }
    if (response.status === 408) {
        return ambiguousMediaFailure(
            'provider_timeout',
            `LinkedIn timed out the ${operation} request (HTTP 408); the media outcome is ambiguous: ${detail}`,
            remoteMediaId
        )
    }
    if (response.status >= 400 && response.status < 500) {
        return mediaPermanentFailure(
            'invalid_request',
            `LinkedIn rejected the ${operation} request (HTTP ${response.status}): ${detail}`
        )
    }
    if (response.status >= 500) {
        return ambiguousMediaFailure(
            'provider_failure',
            `LinkedIn returned a server error during ${operation} (HTTP ${response.status}); the media outcome is ambiguous: ${detail}`,
            remoteMediaId
        )
    }

    return ambiguousMediaFailure(
        'unexpected_response',
        `LinkedIn returned an unexpected HTTP ${response.status} response during ${operation}; the media outcome is ambiguous: ${detail}`,
        remoteMediaId
    )
}

async function readProviderMessage(
    response: Response,
    accessToken: string,
    additionalSecrets: readonly string[] = []
): Promise<string | undefined> {
    let body: string
    try {
        body = await response.text()
    } catch {
        return undefined
    }

    return providerMessageFromBody(redactSecrets(body.trim(), [accessToken, ...additionalSecrets]))
}

async function readProviderPayload(
    response: Response,
    secrets: readonly string[]
): Promise<{ readonly parsed: unknown; readonly message: string | undefined }> {
    let body: string
    try {
        body = await response.text()
    } catch {
        return { parsed: undefined, message: undefined }
    }

    const redactedBody = redactSecrets(body.trim(), secrets)
    if (redactedBody.length === 0) return { parsed: undefined, message: undefined }

    let parsed: unknown
    try {
        parsed = JSON.parse(redactedBody)
    } catch {
        parsed = undefined
    }

    return { parsed, message: providerMessageFromBody(redactedBody) }
}

function providerMessageFromBody(redactedBody: string): string | undefined {
    if (redactedBody.length === 0) return undefined

    if (isRecordFromJson(redactedBody)) {
        const parsed = JSON.parse(redactedBody) as Record<string, unknown>
        for (const key of ['message', 'error_description', 'error']) {
            const value = parsed[key]
            if (typeof value === 'string' && value.trim().length > 0) {
                return limitMessage(value)
            }
        }
    }

    return limitMessage(redactedBody)
}

function networkFailure(
    error: unknown,
    accessToken: string,
    timedOut: boolean,
    additionalSecret?: string
): LinkedInPublishOutcome {
    const reason = timedOut
        ? 'request timed out'
        : `request failed${error instanceof Error && error.message.trim() ? `: ${redactSecrets(error.message.trim(), [accessToken, ...(additionalSecret === undefined ? [] : [additionalSecret])])}` : ''}`
    return ambiguousFailure(
        timedOut ? 'provider_timeout' : 'network_failure',
        `LinkedIn ${reason} after dispatch; the publication outcome is ambiguous`
    )
}

function mediaNetworkFailure(
    timedOut: boolean,
    remoteMediaId?: string
): LinkedInMediaUploadOutcome {
    const reason = timedOut ? 'request timed out' : 'request failed'
    return ambiguousMediaFailure(
        timedOut ? 'provider_timeout' : 'network_failure',
        `LinkedIn image upload ${reason} after dispatch; the media outcome is ambiguous`,
        remoteMediaId
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

function mediaPermanentFailure(
    code: LinkedInPermanentFailureCode,
    errorMessage: string
): LinkedInMediaUploadOutcome {
    return { type: 'permanent_failure', effectOccurred: false, code, errorMessage }
}

function mediaRetryableFailure(
    code: LinkedInRetryableFailureCode,
    errorMessage: string
): LinkedInMediaUploadOutcome {
    return { type: 'retryable_failure', effectOccurred: false, code, errorMessage }
}

function ambiguousFailure(
    code: LinkedInAmbiguousFailureCode,
    errorMessage: string
): LinkedInPublishOutcome {
    return { type: 'ambiguous', code, errorMessage }
}

function ambiguousMediaFailure(
    code: LinkedInMediaUploadAmbiguousFailureCode,
    errorMessage: string,
    remoteMediaId?: string
): LinkedInMediaUploadOutcome {
    return { type: 'ambiguous', code, errorMessage, remoteMediaId }
}

function validateImageUploadInput(
    input: PublishLinkedInImageUploadInput
): LinkedInMediaUploadOutcome | null {
    const commonError = validateCommonInput(input.accessToken, input.destination)
    if (commonError !== null) {
        return mediaPermanentFailure(commonError.code, commonError.errorMessage)
    }
    if (input.media.contentType !== 'image/jpeg' && input.media.contentType !== 'image/png') {
        return mediaPermanentFailure(
            'invalid_input',
            'LinkedIn image contentType must be image/jpeg or image/png'
        )
    }
    if (!Number.isSafeInteger(input.media.size) || input.media.size <= 0) {
        return mediaPermanentFailure(
            'invalid_input',
            'LinkedIn image size must be a positive safe integer'
        )
    }
    return null
}

function validateImagePostInput(
    input: PublishLinkedInImagePostInput
): LinkedInPublishOutcome | null {
    const commonError = validateCommonInput(input.accessToken, input.destination)
    if (commonError !== null) {
        return permanentFailure(commonError.code, commonError.errorMessage)
    }
    if (input.commentary.trim().length === 0) {
        return permanentFailure('invalid_input', 'LinkedIn commentary must not be blank')
    }
    if (!isLinkedInImageId(input.imageId.trim())) {
        return permanentFailure('invalid_input', 'LinkedIn imageId must be an image URN')
    }
    return null
}

function validateCommonInput(
    accessToken: string,
    destination: PublishLinkedInImageUploadInput['destination']
): { readonly code: LinkedInPermanentFailureCode; readonly errorMessage: string } | null {
    if (accessToken.trim().length === 0) {
        return { code: 'invalid_input', errorMessage: 'LinkedIn accessToken must not be blank' }
    }
    return validateDestination(destination)
}

function validateDestination(
    destination: PublishLinkedInTextInput['destination']
): { readonly code: LinkedInPermanentFailureCode; readonly errorMessage: string } | null {
    if (destination.id.trim().length === 0 || /\s/.test(destination.id)) {
        return {
            code: 'invalid_input',
            errorMessage: 'LinkedIn destination id must be a non-whitespace value',
        }
    }
    if (destination.id.startsWith('urn:')) {
        return {
            code: 'invalid_input',
            errorMessage: 'LinkedIn destination id must be an identifier, not a URN',
        }
    }
    if (destination.type === 'organization' && !/^[1-9]\d*$/.test(destination.id)) {
        return {
            code: 'invalid_input',
            errorMessage: 'LinkedIn organization destination id must be a positive numeric value',
        }
    }
    if (destination.type !== 'member' && destination.type !== 'organization') {
        return {
            code: 'invalid_input',
            errorMessage: 'LinkedIn destination type is not supported',
        }
    }
    return null
}

function normalizeDestination(
    destination: PublishLinkedInTextInput['destination']
): PublishLinkedInTextInput['destination'] {
    return { ...destination, id: destination.id.trim() }
}

function linkedInJsonHeaders(accessToken: string, apiVersion: string): Record<string, string> {
    return {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        'linkedin-version': apiVersion,
        'x-restli-protocol-version': LINKEDIN_RESTLI_PROTOCOL_VERSION,
    }
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

function redactSecrets(value: string, secrets: readonly string[]): string {
    return secrets.reduce(
        (redacted, secret) =>
            secret.length === 0 ? redacted : redacted.replaceAll(secret, '[redacted]'),
        value
    )
}

function limitMessage(value: string): string {
    const normalized = value.trim().replace(/\s+/g, ' ')
    return normalized.length > 256 ? `${normalized.slice(0, 253)}...` : normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRecordFromJson(value: string): boolean {
    try {
        return isRecord(JSON.parse(value))
    } catch {
        return false
    }
}

function isLinkedInImageId(value: string): boolean {
    return /^urn:li:image:[^\s]+$/.test(value)
}

function normalizeUploadUrl(value: string): URL {
    const url = new URL(value)
    if (url.protocol !== 'https:') {
        throw new TypeError('LinkedIn image upload URL must use HTTPS')
    }
    if (url.username.length > 0 || url.password.length > 0) {
        throw new TypeError('LinkedIn image upload URL must not contain credentials')
    }
    return url
}
