import { expect, it } from 'bun:test'

import { createLinkedInVideoPublisher } from './video'

it('uploads exact ordered parts, checkpoints before transfer and finalizes with ordered ETags', async () => {
    const bytes = new Uint8Array(75_003).map((_, index) => index % 251)
    const requests: string[] = []
    const parts: Uint8Array[] = []
    let checkpoint = false
    let finalize: unknown
    const publisher = createLinkedInVideoPublisher({
        fetcher: async (url, init) => {
            const path = String(url)
            requests.push(path)
            if (path.includes('initializeUpload'))
                return Response.json({
                    value: {
                        video: 'urn:li:video:one',
                        uploadToken: 'private-upload-token',
                        uploadInstructions: [
                            {
                                firstByte: 0,
                                lastByte: 40_000,
                                uploadUrl: 'https://www.linkedin.com/part-1',
                            },
                            {
                                firstByte: 40_001,
                                lastByte: bytes.length - 1,
                                uploadUrl: 'https://www.linkedin.com/part-2',
                            },
                        ],
                    },
                })
            if (init?.method === 'PUT') {
                expect(checkpoint).toBe(true)
                parts.push(new Uint8Array(await new Response(init.body).arrayBuffer()))
                return new Response(null, {
                    status: 201,
                    headers: { etag: `"part-${parts.length}"` },
                })
            }
            finalize = JSON.parse(String(init?.body))
            return new Response(null, { status: 200 })
        },
    })
    expect(
        await publisher.uploadVideo({
            accessToken: 'secret',
            destination: { type: 'organization', id: '42' },
            media: { size: bytes.length, stream: new Blob([bytes]).stream() },
            onInitialized: () => {
                checkpoint = true
                return true
            },
        })
    ).toEqual({ type: 'uploaded', remoteMediaId: 'urn:li:video:one' })
    expect(parts[0]).toEqual(bytes.slice(0, 40_001))
    expect(parts[1]).toEqual(bytes.slice(40_001))
    expect(finalize).toEqual({
        finalizeUploadRequest: {
            video: 'urn:li:video:one',
            uploadToken: 'private-upload-token',
            uploadedPartIds: ['part-1', 'part-2'],
        },
    })
    expect(requests).toHaveLength(4)
})

it('does not send bytes without a durable identifier and never blindly retries an unknown transfer', async () => {
    let transfers = 0
    let permitCheckpoint = false
    const publisher = createLinkedInVideoPublisher({
        fetcher: async (_url, init) => {
            if (init?.method === 'PUT') {
                transfers++
                throw new Error('secret private-upload-token')
            }
            return Response.json({
                value: {
                    video: 'urn:li:video:one',
                    uploadToken: 'private-upload-token',
                    uploadInstructions: [
                        {
                            firstByte: 0,
                            lastByte: 74_999,
                            uploadUrl: 'https://www.linkedin.com/part',
                        },
                    ],
                },
            })
        },
    })
    const input = () => ({
        accessToken: 'secret',
        destination: { type: 'member' as const, id: 'me' },
        media: { size: 75_000, stream: new Blob([new Uint8Array(75_000)]).stream() },
        onInitialized: () => permitCheckpoint,
    })
    expect((await publisher.uploadVideo(input())).type).toBe('ambiguous')
    expect(transfers).toBe(0)
    permitCheckpoint = true
    const result = await publisher.uploadVideo(input())
    expect(result.type).toBe('ambiguous')
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(JSON.stringify(result)).not.toContain('private-upload-token')
    expect(transfers).toBe(1)
})

it('distinguishes processing from availability and maps video posts without leaking provider secrets', async () => {
    let status = 'PROCESSING'
    let post: unknown
    const publisher = createLinkedInVideoPublisher({
        fetcher: async (url, init) => {
            if (String(url).endsWith('/rest/posts')) {
                post = JSON.parse(String(init?.body))
                return new Response(null, {
                    status: 201,
                    headers: { 'x-restli-id': 'urn:li:share:42' },
                })
            }
            return Response.json({ id: 'urn:li:video:one', status })
        },
    })
    const input = { accessToken: 'secret', videoId: 'urn:li:video:one' }
    expect(await publisher.getVideo(input)).toEqual({ type: 'processing' })
    status = 'AVAILABLE'
    expect(await publisher.getVideo(input)).toEqual({ type: 'available' })
    expect(
        await publisher.publishVideo({
            ...input,
            destination: { type: 'member', id: 'me' },
            commentary: 'A native video',
        })
    ).toEqual({ type: 'published', externalId: 'urn:li:share:42' })
    expect(post).toMatchObject({
        author: 'urn:li:person:me',
        content: { media: { id: 'urn:li:video:one' } },
    })
    status = 'PROCESSING_FAILED'
    expect((await publisher.getVideo(input)).type).toBe('permanent_failure')
})
