import { describe, expect, it } from 'bun:test'

import type { XFetcher } from './contract'
import { createXPublisher } from './publisher'

function jsonResponse(value: unknown, status = 200): Response {
    return Response.json(value, { status })
}

function createFetcher(responses: readonly Response[]) {
    const calls: Array<{ readonly input: string | URL | Request; readonly init?: RequestInit }> = []
    let index = 0
    const fetcher: XFetcher = async (input, init) => {
        calls.push({ input, init })
        const response = responses[index]
        index += 1
        if (response === undefined) throw new Error('Unexpected X request')
        return response
    }
    return { calls, fetcher }
}

describe('X publisher', () => {
    describe('getMe', () => {
        it('retrieves the authenticated user profile', async () => {
            const fixture = createFetcher([
                jsonResponse({
                    data: {
                        id: '2244994945',
                        name: 'Twitter Dev',
                        username: 'TwitterDev',
                    },
                }),
            ])
            const publisher = createXPublisher({ fetcher: fixture.fetcher })

            const result = await publisher.getMe('test-token')
            expect(result).toEqual({
                kind: 'success',
                value: {
                    id: '2244994945',
                    name: 'Twitter Dev',
                    username: 'TwitterDev',
                },
            })

            const call = fixture.calls[0]
            expect(call?.input).toBe('https://api.x.com/2/users/me')
            expect(new Headers(call?.init?.headers).get('authorization')).toBe('Bearer test-token')
        })

        it('classifies 401 as permanent authentication failure', async () => {
            const fixture = createFetcher([
                jsonResponse({ title: 'Unauthorized', detail: 'Invalid token' }, 401),
            ])
            const publisher = createXPublisher({ fetcher: fixture.fetcher })

            const result = await publisher.getMe('bad-token')
            expect(result).toEqual({
                kind: 'failure',
                outcome: {
                    type: 'permanent_failure',
                    effectOccurred: false,
                    code: 'authentication_required',
                    errorMessage: 'Invalid token',
                },
            })
        })

        it('classifies 429 as retryable rate limited failure', async () => {
            const fixture = createFetcher([
                jsonResponse({ title: 'Too Many Requests', detail: 'Rate limit exceeded' }, 429),
            ])
            const publisher = createXPublisher({ fetcher: fixture.fetcher })

            const result = await publisher.getMe('test-token')
            expect(result).toEqual({
                kind: 'failure',
                outcome: {
                    type: 'retryable_failure',
                    effectOccurred: false,
                    code: 'rate_limited',
                    errorMessage: 'Rate limit exceeded',
                },
            })
        })
    })

    describe('uploadMedia', () => {
        function pngStream(bytes: readonly number[] = [137, 80, 78, 71]) {
            return new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new Uint8Array(bytes))
                    controller.close()
                },
            })
        }

        it('uploads an image through the documented v2 multipart flow with alt text', async () => {
            const fixture = createFetcher([
                jsonResponse({
                    data: {
                        id: '1146631093949677568',
                        media_key: '3_1146631093949677568',
                        size: 4,
                        expires_after_secs: 86398,
                    },
                }),
                jsonResponse({ data: { id: '1146631093949677568' } }),
            ])
            const publisher = createXPublisher({ fetcher: fixture.fetcher })

            const outcome = await publisher.uploadMedia('test-token', {
                contentType: 'image/png',
                size: 4,
                filename: 'test.png',
                accessibilityText: 'A test image of a chart',
                stream: pngStream(),
            })

            expect(outcome).toEqual({
                type: 'uploaded',
                remoteMediaId: '1146631093949677568',
                ready: true,
                expiresAfterSecs: 86398,
            })

            expect(fixture.calls).toHaveLength(2)
            const uploadCall = fixture.calls[0]
            expect(uploadCall?.input).toBe('https://api.x.com/2/media/upload')
            expect(uploadCall?.init?.method).toBe('POST')
            const uploadForm = uploadCall?.init?.body as FormData
            const uploadedFile = uploadForm.get('media')
            expect(uploadedFile).toBeInstanceOf(Blob)
            expect((uploadedFile as Blob).size).toBe(4)
            expect((uploadedFile as Blob).type).toBe('image/png')
            expect(uploadForm.get('media_category')).toBe('tweet_image')

            const metadataCall = fixture.calls[1]
            expect(metadataCall?.input).toBe('https://api.x.com/2/media/metadata')
            expect(metadataCall?.init?.method).toBe('POST')
            expect(JSON.parse(metadataCall?.init?.body as string)).toEqual({
                id: '1146631093949677568',
                metadata: { alt_text: { text: 'A test image of a chart' } },
            })
        })

        it('skips the metadata call without accessibility text', async () => {
            const fixture = createFetcher([jsonResponse({ data: { id: '1146631093949677569' } })])
            const publisher = createXPublisher({ fetcher: fixture.fetcher })

            const outcome = await publisher.uploadMedia('test-token', {
                contentType: 'image/jpeg',
                size: 3,
                filename: 'test.jpg',
                stream: pngStream([1, 2, 3]),
            })

            expect(outcome).toEqual({
                type: 'uploaded',
                remoteMediaId: '1146631093949677569',
                ready: true,
                expiresAfterSecs: null,
            })
            expect(fixture.calls).toHaveLength(1)
        })

        it('classifies a simple upload server error as ambiguous', async () => {
            const fixture = createFetcher([jsonResponse({ error: 'Internal server error' }, 500)])
            const publisher = createXPublisher({ fetcher: fixture.fetcher })

            const outcome = await publisher.uploadMedia('test-token', {
                contentType: 'image/jpeg',
                size: 3,
                filename: 'test.jpg',
                stream: pngStream([1, 2, 3]),
            })

            expect(outcome).toEqual({
                type: 'ambiguous',
                code: 'provider_failure',
                errorMessage: 'Internal server error',
            })
        })

        it('classifies a missing upload media id as ambiguous', async () => {
            const fixture = createFetcher([jsonResponse({ data: {} })])
            const publisher = createXPublisher({ fetcher: fixture.fetcher })

            const outcome = await publisher.uploadMedia('test-token', {
                contentType: 'image/png',
                size: 4,
                filename: 'test.png',
                stream: pngStream(),
            })

            expect(outcome).toEqual({
                type: 'ambiguous',
                code: 'missing_media_id',
                errorMessage: 'X returned no media attachment identifier',
            })
        })

        it('classifies failed media processing as permanent', async () => {
            const fixture = createFetcher([
                jsonResponse({
                    data: {
                        id: '1146631093949677571',
                        processing_info: {
                            state: 'failed',
                            error: { message: 'Unsupported image format' },
                        },
                    },
                }),
            ])
            const publisher = createXPublisher({ fetcher: fixture.fetcher })

            const outcome = await publisher.uploadMedia('test-token', {
                contentType: 'image/png',
                size: 4,
                filename: 'test.png',
                stream: pngStream(),
            })

            expect(outcome).toEqual({
                type: 'permanent_failure',
                effectOccurred: false,
                code: 'invalid_request',
                errorMessage: 'Unsupported image format',
            })
        })

        it('classifies pending media processing as ambiguous with the media id', async () => {
            const fixture = createFetcher([
                jsonResponse({
                    data: {
                        id: '1146631093949677572',
                        processing_info: { state: 'in_progress', check_after_secs: 5 },
                    },
                }),
            ])
            const publisher = createXPublisher({ fetcher: fixture.fetcher })

            const outcome = await publisher.uploadMedia('test-token', {
                contentType: 'image/png',
                size: 4,
                filename: 'test.png',
                stream: pngStream(),
            })

            expect(outcome).toEqual({
                type: 'ambiguous',
                code: 'provider_failure',
                errorMessage: 'The X media processing outcome is unknown',
                remoteMediaId: '1146631093949677572',
            })
        })

        it('reads the provider expiry from the simple upload response', async () => {
            const fixture = createFetcher([
                jsonResponse({ data: { id: '222', expires_after_secs: 200 } }),
            ])
            const publisher = createXPublisher({ fetcher: fixture.fetcher })

            const outcome = await publisher.uploadMedia('test-token', {
                contentType: 'image/png',
                size: 4,
                filename: 'test.png',
                stream: pngStream(),
            })

            expect(outcome).toEqual({
                type: 'uploaded',
                remoteMediaId: '222',
                ready: true,
                expiresAfterSecs: 200,
            })
        })
    })

    describe('publishTweet', () => {
        it('publishes a text tweet and returns published outcome with URL', async () => {
            const fixture = createFetcher([
                jsonResponse(
                    {
                        data: {
                            id: '1445880548472328192',
                            text: 'Hello world from Herald!',
                        },
                    },
                    201
                ),
            ])
            const publisher = createXPublisher({ fetcher: fixture.fetcher })

            const outcome = await publisher.publishTweet({
                accessToken: 'test-token',
                text: 'Hello world from Herald!',
            })

            expect(outcome).toEqual({
                type: 'published',
                externalId: '1445880548472328192',
                externalUrl: 'https://x.com/i/web/status/1445880548472328192',
            })

            const call = fixture.calls[0]
            expect(call?.input).toBe('https://api.x.com/2/tweets')
            expect(call?.init?.method).toBe('POST')
            expect(JSON.parse(call?.init?.body as string)).toEqual({
                text: 'Hello world from Herald!',
            })
        })

        it('publishes a tweet with media attachment', async () => {
            const fixture = createFetcher([
                jsonResponse(
                    {
                        data: {
                            id: '1445880548472328193',
                            text: 'Look at this photo',
                        },
                    },
                    201
                ),
            ])
            const publisher = createXPublisher({ fetcher: fixture.fetcher })

            const outcome = await publisher.publishTweet({
                accessToken: 'test-token',
                text: 'Look at this photo',
                mediaIds: ['1146631093949677568'],
            })

            expect(outcome).toEqual({
                type: 'published',
                externalId: '1445880548472328193',
                externalUrl: 'https://x.com/i/web/status/1445880548472328193',
            })

            const call = fixture.calls[0]
            expect(JSON.parse(call?.init?.body as string)).toEqual({
                text: 'Look at this photo',
                media: {
                    media_ids: ['1146631093949677568'],
                },
            })
        })

        it('classifies 403 forbidden as permanent failure', async () => {
            const fixture = createFetcher([
                jsonResponse(
                    {
                        errors: [{ message: 'Duplicate tweet content' }],
                        title: 'Forbidden',
                    },
                    403
                ),
            ])
            const publisher = createXPublisher({ fetcher: fixture.fetcher })

            const outcome = await publisher.publishTweet({
                accessToken: 'test-token',
                text: 'Duplicate tweet',
            })

            expect(outcome).toEqual({
                type: 'permanent_failure',
                effectOccurred: false,
                code: 'forbidden',
                errorMessage: 'Duplicate tweet content',
            })
        })

        it('classifies 500 server error as ambiguous outcome', async () => {
            const fixture = createFetcher([
                jsonResponse({ title: 'Service Unavailable', detail: 'Internal failure' }, 503),
            ])
            const publisher = createXPublisher({ fetcher: fixture.fetcher })

            const outcome = await publisher.publishTweet({
                accessToken: 'test-token',
                text: 'Testing 503',
            })

            expect(outcome).toEqual({
                type: 'ambiguous',
                code: 'provider_failure',
                errorMessage: 'Internal failure',
            })
        })

        it('classifies rejected media identifiers as permanent failure', async () => {
            const fixture = createFetcher([
                jsonResponse(
                    {
                        errors: [{ message: 'The specified media ids are invalid or expired' }],
                        title: 'Invalid Request',
                    },
                    400
                ),
            ])
            const publisher = createXPublisher({ fetcher: fixture.fetcher })

            const outcome = await publisher.publishTweet({
                accessToken: 'test-token',
                text: 'Look at this photo',
                mediaIds: ['0000000000000000001'],
            })

            expect(outcome).toEqual({
                type: 'permanent_failure',
                effectOccurred: false,
                code: 'invalid_request',
                errorMessage: 'The specified media ids are invalid or expired',
            })
        })

        it('classifies network abort/timeout as provider_timeout ambiguous outcome', async () => {
            const publisher = createXPublisher({
                fetcher: async () => {
                    throw new DOMException('The operation was aborted', 'AbortError')
                },
            })

            const outcome = await publisher.publishTweet({
                accessToken: 'secret-token',
                text: 'Testing abort',
            })

            expect(outcome).toEqual({
                type: 'ambiguous',
                code: 'provider_timeout',
                errorMessage: 'The X request timed out',
            })
            expect(JSON.stringify(outcome)).not.toContain('secret-token')
        })
    })
})
