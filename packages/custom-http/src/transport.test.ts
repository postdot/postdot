import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'

import type {
    CustomHttpDeliveryInput,
    CustomHttpMediaDescriptor,
    CustomHttpRequest,
    CustomHttpRequester,
    CustomHttpResponse,
} from './contract'
import { createCustomHttpTransport } from './transport'

const endpointResolver = async () => [{ address: '8.8.8.8', family: 4 as const }]
const secret = 'a'.repeat(32)

const context = {
    deliveryId: 'delivery-1',
    jobId: 'job-1',
    projectId: 'project-1',
    publicationId: 'publication-1',
    channelId: 'channel-1',
    channelName: 'Announcements',
    scheduledAt: 1_756_000_000_000,
    attempt: 1,
    externalAccountId: 'account-1',
    deliveredAt: 1_756_000_001_000,
} as const

function createInput(
    execution: CustomHttpDeliveryInput['execution'],
    overrides: Partial<CustomHttpDeliveryInput> = {}
): CustomHttpDeliveryInput {
    return {
        execution,
        content: { body: 'Hello from Postbot', slug: 'hello', media: [] },
        context,
        media: [],
        connection: {
            endpointUrl: 'https://receiver.example.test',
            authentication: { kind: 'none' },
            secret,
        },
        ...overrides,
    }
}

async function readBody(request: CustomHttpRequest): Promise<string> {
    if (request.body === null) return ''
    const chunks: Uint8Array[] = []
    await request.body.write(async chunk => {
        chunks.push(new Uint8Array(chunk))
    })
    const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
    }
    return new TextDecoder().decode(bytes)
}

function createRequester(
    response: CustomHttpResponse = {
        status: 202,
        headers: {},
        body: '',
        bodyTruncated: false,
    }
): { readonly requester: CustomHttpRequester; readonly requests: CustomHttpRequest[] } {
    const requests: CustomHttpRequest[] = []
    return {
        requests,
        requester: {
            async request(request) {
                requests.push(request)
                return response
            },
        },
    }
}

describe('custom HTTP transport', () => {
    test('delivers a versioned signed Postbot webhook without internal storage details', async () => {
        const { requester, requests } = createRequester()
        const deliveredAt = 1_756_000_001_234
        const transport = createCustomHttpTransport({
            requester,
            resolveHostname: endpointResolver,
            now: () => deliveredAt,
        })

        const result = await transport.deliver(
            createInput(
                {
                    kind: 'declarative_http',
                    contractId: 'custom-webhook',
                    revision: '1',
                    mode: 'postbot_webhook',
                },
                {
                    content: { body: 'Hello', media: [] },
                    media: [
                        {
                            assetId: 'asset-1',
                            representationId: 'representation-1',
                            contentPath: '/media/0',
                            position: 0,
                            role: null,
                            accessibilityText: 'A diagram',
                            originalFilename: 'diagram.png',
                            contentType: 'image/png',
                            family: 'image',
                            byteSize: 12,
                            sha256: 'sha256:asset',
                            width: 100,
                            height: 80,
                            durationMs: null,
                            storeId: 'local',
                            objectKey: 'private/project/asset',
                        },
                    ],
                }
            )
        )

        expect(result).toEqual({ type: 'published' })
        expect(requests).toHaveLength(1)
        const request = requests[0]!
        const body = await readBody(request)
        const timestamp = Math.floor(deliveredAt / 1000).toString()
        const expectedSignature = createHmac('sha256', secret)
            .update(`${timestamp}.${body}`)
            .digest('hex')
        expect(request.method).toBe('POST')
        expect(request.headers['x-postbot-signature']).toBe(`sha256=${expectedSignature}`)
        expect(request.headers['x-postbot-timestamp']).toBe(timestamp)
        expect(JSON.parse(body)).toEqual(
            expect.objectContaining({
                event: 'publication.delivery',
                webhookVersion: '1',
                deliveryId: 'delivery-1',
                media: [
                    expect.objectContaining({
                        assetId: 'asset-1',
                        originalFilename: 'diagram.png',
                    }),
                ],
            })
        )
        expect(body).not.toContain('objectKey')
        expect(body).not.toContain(secret)
    })

    test('maps content, context and media URLs into one JSON request', async () => {
        const { requester, requests } = createRequester({
            status: 201,
            headers: {},
            body: JSON.stringify({ id: 'remote-1', url: 'https://receiver.example.test/1' }),
            bodyTruncated: false,
        })
        const transport = createCustomHttpTransport({
            requester,
            resolveHostname: endpointResolver,
            now: () => context.deliveredAt,
        })
        const media = createMedia()

        const result = await transport.deliver(
            createInput(
                {
                    kind: 'declarative_http',
                    contractId: 'custom-json',
                    revision: '1',
                    mode: 'mapped_http',
                    request: {
                        method: 'POST',
                        path: ['publish', { kind: 'content', pointer: '/slug' }],
                        query: {
                            delivery: { kind: 'context', pointer: '/deliveryId' },
                        },
                        headers: {
                            'x-client': { kind: 'literal', value: 'postbot-test' },
                        },
                        body: {
                            kind: 'json',
                            value: {
                                kind: 'object',
                                properties: {
                                    text: { kind: 'content', pointer: '/body' },
                                    publication: { kind: 'context', pointer: '/publicationId' },
                                    mediaUrls: { kind: 'media_urls', pointer: '/media' },
                                },
                            },
                        },
                        idempotencyHeader: 'x-idempotency-key',
                        response: {
                            successStatuses: [201],
                            retryableStatuses: [429],
                            rejectedStatuses: [400],
                            ambiguousStatuses: [500],
                            externalIdPointer: '/id',
                            externalUrlPointer: '/url',
                        },
                    },
                },
                {
                    media: [media],
                    resolveMediaUrl: current =>
                        current.assetId === media.assetId
                            ? 'https://cdn.example.test/media-1'
                            : null,
                }
            )
        )

        expect(result).toEqual({
            type: 'published',
            externalId: 'remote-1',
            externalUrl: 'https://receiver.example.test/1',
        })
        const request = requests[0]!
        expect(request.url.toString()).toBe(
            'https://receiver.example.test/publish/hello?delivery=delivery-1'
        )
        expect(request.headers['x-idempotency-key']).toBe('delivery-1')
        expect(JSON.parse(await readBody(request))).toEqual({
            text: 'Hello from Postbot',
            publication: 'publication-1',
            mediaUrls: ['https://cdn.example.test/media-1'],
        })
    })

    test('places a path-authenticated secret in one encoded URL segment', async () => {
        const { requester, requests } = createRequester()
        const pathSecret = 'path-secret/with?reserved-characters-123456789'
        const transport = createCustomHttpTransport({
            requester,
            resolveHostname: endpointResolver,
            now: () => context.deliveredAt,
        })

        const result = await transport.deliver(
            createInput(
                {
                    kind: 'declarative_http',
                    contractId: 'custom-path',
                    revision: '1',
                    mode: 'mapped_http',
                    request: {
                        method: 'POST',
                        path: ['hooks', { kind: 'secret' }, 'publish'],
                        response: {
                            successStatuses: [202],
                            retryableStatuses: [429],
                            rejectedStatuses: [400],
                            ambiguousStatuses: [500],
                        },
                    },
                },
                {
                    connection: {
                        endpointUrl: 'https://receiver.example.test',
                        authentication: { kind: 'path' },
                        secret: pathSecret,
                    },
                }
            )
        )

        expect(result).toEqual({ type: 'published' })
        const request = requests[0]!
        expect(request.url.pathname).toBe(
            '/hooks/path-secret%2Fwith%3Freserved-characters-123456789/publish'
        )
        expect(request.headers.authorization).toBeUndefined()
        expect(request.headers['content-type']).toBeUndefined()
    })

    test('fails closed before dispatch when path authentication has no secret segment', async () => {
        const { requester, requests } = createRequester()
        const transport = createCustomHttpTransport({
            requester,
            resolveHostname: endpointResolver,
            now: () => context.deliveredAt,
        })

        const result = await transport.deliver(
            createInput(
                {
                    kind: 'declarative_http',
                    contractId: 'custom-path',
                    revision: '1',
                    mode: 'mapped_http',
                    request: {
                        method: 'POST',
                        path: ['hooks'],
                        response: {
                            successStatuses: [202],
                            retryableStatuses: [429],
                            rejectedStatuses: [400],
                            ambiguousStatuses: [500],
                        },
                    },
                },
                {
                    connection: {
                        endpointUrl: 'https://receiver.example.test',
                        authentication: { kind: 'path' },
                        secret,
                    },
                }
            )
        )

        expect(result).toMatchObject({ type: 'permanent_failure' })
        expect(requests).toHaveLength(0)
    })

    test('does not persist an encoded path secret echoed by the receiver', async () => {
        const pathSecret = 'path-secret/with?reserved-characters-123456789'
        const { requester, requests } = createRequester({
            status: 201,
            headers: {},
            body: JSON.stringify({
                url: `https://receiver.example.test/posts/${encodeURIComponent(pathSecret)}`,
            }),
            bodyTruncated: false,
        })
        const transport = createCustomHttpTransport({
            requester,
            resolveHostname: endpointResolver,
            now: () => context.deliveredAt,
        })

        const result = await transport.deliver(
            createInput(
                {
                    kind: 'declarative_http',
                    contractId: 'custom-path',
                    revision: '1',
                    mode: 'mapped_http',
                    request: {
                        method: 'POST',
                        path: ['hooks', { kind: 'secret' }, 'publish'],
                        response: {
                            successStatuses: [201],
                            retryableStatuses: [429],
                            rejectedStatuses: [400],
                            ambiguousStatuses: [500],
                            externalUrlPointer: '/url',
                        },
                    },
                },
                {
                    connection: {
                        endpointUrl: 'https://receiver.example.test',
                        authentication: { kind: 'path' },
                        secret: pathSecret,
                    },
                }
            )
        )

        expect(result).toMatchObject({ type: 'ambiguous' })
        expect(JSON.stringify(result)).not.toContain(pathSecret)
        expect(JSON.stringify(result)).not.toContain(encodeURIComponent(pathSecret))
        expect(requests).toHaveLength(1)
    })

    test('streams mapped multipart media and classifies retryable responses', async () => {
        const { requester, requests } = createRequester({
            status: 429,
            headers: {},
            body: 'slow down',
            bodyTruncated: false,
        })
        const transport = createCustomHttpTransport({
            requester,
            resolveHostname: endpointResolver,
            now: () => context.deliveredAt,
        })
        const media = createMedia()

        const result = await transport.deliver(
            createInput(
                {
                    kind: 'declarative_http',
                    contractId: 'custom-multipart',
                    revision: '1',
                    mode: 'mapped_http',
                    request: {
                        method: 'POST',
                        path: ['upload'],
                        body: {
                            kind: 'multipart',
                            fields: { caption: { kind: 'content', pointer: '/body' } },
                            media: [{ fieldName: 'file', pointer: '/media' }],
                        },
                        response: {
                            successStatuses: [200],
                            retryableStatuses: [429],
                            rejectedStatuses: [400],
                            ambiguousStatuses: [500],
                        },
                    },
                },
                {
                    media: [media],
                    mediaReader: {
                        async open() {
                            return {
                                size: media.byteSize,
                                contentType: media.contentType,
                                sha256: media.sha256,
                                stream: new ReadableStream({
                                    start(controller) {
                                        controller.enqueue(new TextEncoder().encode('image-bytes'))
                                        controller.close()
                                    },
                                }),
                            }
                        },
                    },
                }
            )
        )

        expect(result.type).toBe('retryable_failure')
        const body = await readBody(requests[0]!)
        expect(body).toContain('name="caption"')
        expect(body).toContain('name="file"')
        expect(body).toContain('image-bytes')
    })
})

function createMedia(): CustomHttpMediaDescriptor {
    return {
        assetId: 'asset-1',
        representationId: 'representation-1',
        contentPath: '/media/0',
        position: 0,
        role: null,
        accessibilityText: null,
        originalFilename: 'image.png',
        contentType: 'image/png',
        family: 'image',
        byteSize: 11,
        sha256: 'sha256:asset',
        width: 100,
        height: 80,
        durationMs: null,
        storeId: 'local',
        objectKey: 'private/project/asset',
    }
}
