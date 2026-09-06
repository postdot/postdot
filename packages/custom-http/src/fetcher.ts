import {
    customHttpLimits,
    type CustomHttpFetcher,
    type CustomHttpRequestBody,
    type NetworkControlledFetcherOptions,
} from './contract'
import { createCustomHttpEndpointAuthorizer } from './egress'
import { createNodeHttpRequester } from './node-requester'

/**
 * Adapt the shared, pinned-address requester to the Fetch API used by
 * provider packages. The policy is resolved once per request and redirects
 * are intentionally not followed by the Node requester.
 */
export function createNetworkControlledFetcher(
    options: NetworkControlledFetcherOptions = {}
): CustomHttpFetcher {
    const authorizer = createCustomHttpEndpointAuthorizer({
        privateDestinations: options.privateDestinations,
        resolveHostname: options.resolveHostname,
    })
    const requester = options.requester ?? createNodeHttpRequester()
    const maxRequestBytes = normalizePositiveLimit(
        options.maxRequestBytes ?? customHttpLimits.maximumRequestBytes,
        'maximum request bytes'
    )
    const maxResponseBytes = normalizePositiveLimit(
        options.maxResponseBytes ?? customHttpLimits.maximumResponseBytes,
        'maximum response bytes'
    )

    return async (input, init) => {
        const request =
            typeof input === 'string' || input instanceof URL
                ? new Request(input.toString(), init)
                : new Request(input, init)
        const url = new URL(request.url)
        if (url.username.length > 0 || url.password.length > 0) {
            throw new TypeError('Outbound provider requests must not contain URL credentials')
        }
        const endpoint = await authorizer.authorize(url.origin)
        const body = createRequestBody(request, maxRequestBytes)
        const response = await requester.request(
            {
                method: request.method,
                url,
                address: endpoint.selectedAddress,
                headers: Object.fromEntries(request.headers.entries()),
                body,
                maxResponseBytes,
            },
            request.signal
        )

        if (response.bodyTruncated) {
            throw new Error('The outbound provider response exceeded the configured limit')
        }

        return new Response(response.body, {
            status: normalizeResponseStatus(response.status),
            headers: response.headers,
        })
    }
}

function createRequestBody(request: Request, maximumBytes: number): CustomHttpRequestBody | null {
    const stream = request.body
    if (stream === null) return null

    const declaredLength = readContentLength(request.headers.get('content-length'))
    if (declaredLength !== null && declaredLength > maximumBytes) {
        throw new RangeError('The outbound provider request exceeds the configured limit')
    }

    return {
        contentType: request.headers.get('content-type') ?? 'application/octet-stream',
        contentLength: declaredLength,
        async write(writeChunk) {
            const reader = stream.getReader()
            let written = 0
            try {
                while (true) {
                    const next = await reader.read()
                    if (next.done) break
                    written += next.value.byteLength
                    if (written > maximumBytes) {
                        throw new RangeError(
                            'The outbound provider request exceeds the configured limit'
                        )
                    }
                    await writeChunk(next.value)
                }
            } finally {
                reader.releaseLock()
            }
        },
    }
}

function readContentLength(value: string | null): number | null {
    if (value === null) return null
    const length = Number(value)
    return Number.isSafeInteger(length) && length >= 0 ? length : null
}

function normalizePositiveLimit(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`The ${label} must be a positive safe integer`)
    }
    return value
}

function normalizeResponseStatus(value: number): number {
    return value >= 200 && value <= 599 ? value : 502
}
