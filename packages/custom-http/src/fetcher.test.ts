import { describe, expect, test } from 'bun:test'

import type { CustomHttpRequest, CustomHttpRequester } from './contract'
import { createNetworkControlledBinaryFetcher, createNetworkControlledFetcher } from './fetcher'

async function readBody(request: CustomHttpRequest): Promise<Uint8Array> {
    if (request.body === null) return new Uint8Array()
    const chunks: Uint8Array[] = []
    await request.body.write(async chunk => {
        chunks.push(new Uint8Array(chunk))
    })
    const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
    const result = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.byteLength
    }
    return result
}

function createRequester(
    response: {
        readonly status: number
        readonly headers?: Record<string, string>
        readonly body?: string
        readonly bodyBytes?: Uint8Array
        readonly bodyTruncated?: boolean
    } = { status: 202 }
): { readonly requester: CustomHttpRequester; readonly requests: CustomHttpRequest[] } {
    const requests: CustomHttpRequest[] = []
    return {
        requests,
        requester: {
            async request(request) {
                requests.push(request)
                return {
                    status: response.status,
                    headers: response.headers ?? { 'content-type': 'application/json' },
                    body: response.body ?? '{}',
                    bodyBytes: response.bodyBytes,
                    bodyTruncated: response.bodyTruncated ?? false,
                }
            },
        },
    }
}

describe('network-controlled fetcher', () => {
    test('pins the authorized address and preserves provider request semantics', async () => {
        const fixture = createRequester({
            status: 201,
            body: JSON.stringify({ id: 'status-1' }),
        })
        const fetcher = createNetworkControlledFetcher({
            resolveHostname: async () => [{ address: '8.8.8.8', family: 4 }],
            requester: fixture.requester,
        })

        const response = await fetcher('https://example.social/api/v1/statuses', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ status: 'Hello from Herald' }),
        })

        expect(response.status).toBe(201)
        await expect(response.json()).resolves.toEqual({ id: 'status-1' })
        const request = fixture.requests[0]
        expect(request).toBeDefined()
        expect(request?.method).toBe('POST')
        expect(request?.url.toString()).toBe('https://example.social/api/v1/statuses')
        expect(request?.address).toEqual({ address: '8.8.8.8', family: 4 })
        expect(new TextDecoder().decode(await readBody(request!))).toContain(
            'status=Hello+from+Herald'
        )
    })

    test('fails closed for private destinations unless the operator allows the exact rule', async () => {
        const denied = createNetworkControlledFetcher({
            resolveHostname: async () => [{ address: '127.0.0.1', family: 4 }],
            requester: createRequester().requester,
        })
        await expect(denied('http://localhost:8787/api/v1/apps')).rejects.toMatchObject({
            code: 'network_policy_denied',
        })

        const allowed = createNetworkControlledFetcher({
            resolveHostname: async () => [{ address: '127.0.0.1', family: 4 }],
            privateDestinations: [
                { kind: 'cidr', cidr: '127.0.0.0/8', port: 8787, schemes: ['http'] },
            ],
            requester: createRequester({ status: 204, body: '' }).requester,
        })
        await expect(allowed('http://localhost:8787/api/v1/apps')).resolves.toHaveProperty(
            'status',
            204
        )
    })

    test('does not turn a truncated provider response into a successful response', async () => {
        const fetcher = createNetworkControlledFetcher({
            resolveHostname: async () => [{ address: '8.8.8.8', family: 4 }],
            requester: createRequester({ status: 200, bodyTruncated: true }).requester,
        })

        await expect(
            fetcher('https://example.social/api/v1/accounts/verify_credentials')
        ).rejects.toThrow('exceeded the configured limit')
    })

    test('preserves binary response bytes for server-side media imports', async () => {
        const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
        const fetcher = createNetworkControlledBinaryFetcher({
            resolveHostname: async () => [{ address: '8.8.8.8', family: 4 }],
            requester: createRequester({
                status: 200,
                headers: { 'content-type': 'image/png' },
                body: 'not the binary payload',
                bodyBytes: bytes,
            }).requester,
        })

        const response = await fetcher('https://images.example/media.png')

        expect(response.status).toBe(200)
        expect(response.body).toEqual(bytes)
        expect(response.bodyTruncated).toBe(false)
    })

    test('rejects URL credentials before DNS resolution', async () => {
        let resolved = false
        const fetcher = createNetworkControlledFetcher({
            resolveHostname: async () => {
                resolved = true
                return [{ address: '8.8.8.8', family: 4 }]
            },
            requester: createRequester().requester,
        })

        await expect(fetcher('https://user:secret@example.social/api')).rejects.toThrow(
            'URL credentials'
        )
        expect(resolved).toBe(false)
    })

    test('uses the pinned Node requester without following redirects', async () => {
        let targetReached = false
        const server = Bun.serve({
            port: 0,
            fetch(request) {
                if (new URL(request.url).pathname === '/target') targetReached = true
                return new Response(null, {
                    status: 302,
                    headers: { location: '/target' },
                })
            },
        })
        const port = server.port
        if (port === undefined) throw new Error('The local test server did not expose a port')

        try {
            const fetcher = createNetworkControlledFetcher({
                privateDestinations: [
                    {
                        kind: 'cidr',
                        cidr: '127.0.0.0/8',
                        port,
                        schemes: ['http'],
                    },
                ],
            })
            const response = await fetcher(`http://127.0.0.1:${port}/start`)

            expect(response.status).toBe(302)
            expect(targetReached).toBe(false)
        } finally {
            server.stop()
        }
    })
})
