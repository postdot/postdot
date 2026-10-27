import { describe, expect, it } from 'bun:test'

import type { MastodonFetcher } from './contract'
import { createMastodonPublisher, normalizeMastodonInstanceOrigin } from './publisher'

function jsonResponse(value: unknown, status = 200): Response {
    return Response.json(value, { status })
}

function createFetcher(responses: readonly Response[]) {
    const calls: Array<{ readonly input: string | URL | Request; readonly init?: RequestInit }> = []
    let index = 0
    const fetcher: MastodonFetcher = async (input, init) => {
        calls.push({ input, init })
        const response = responses[index]
        index += 1
        if (response === undefined) throw new Error('Unexpected Mastodon request')
        return response
    }
    return { calls, fetcher }
}

describe('Mastodon instance origins', () => {
    it('accepts HTTPS origins and loopback HTTP during local development', () => {
        expect(normalizeMastodonInstanceOrigin('https://mastodon.example/')).toBe(
            'https://mastodon.example'
        )
        expect(normalizeMastodonInstanceOrigin('http://localhost:8787')).toBe(
            'http://localhost:8787'
        )
    })

    it('rejects credentials, paths, and non-loopback HTTP origins', () => {
        expect(() =>
            normalizeMastodonInstanceOrigin('https://user:secret@mastodon.example')
        ).toThrow()
        expect(() => normalizeMastodonInstanceOrigin('https://mastodon.example/social')).toThrow()
        expect(() => normalizeMastodonInstanceOrigin('http://mastodon.example')).toThrow()
        expect(() => normalizeMastodonInstanceOrigin(' https://mastodon.example')).toThrow()
    })
})

describe('Mastodon publisher', () => {
    it('registers an application and verifies the connected account', async () => {
        const fixture = createFetcher([
            jsonResponse({ client_id: 'client-id', client_secret: 'client-secret' }),
            jsonResponse({
                id: 'account-1',
                acct: 'postdot@example.social',
                username: 'postdot',
                display_name: 'Postdot',
            }),
        ])
        const publisher = createMastodonPublisher({
            baseUrl: 'https://example.social',
            fetcher: fixture.fetcher,
        })

        await expect(
            publisher.registerApplication({
                clientName: 'Postdot',
                redirectUri: 'https://postdot.example/api/oauth/mastodon/callback',
                scopes: ['read:accounts', 'write:media'],
                website: 'https://postdot.example',
            })
        ).resolves.toEqual({
            kind: 'success',
            value: { clientId: 'client-id', clientSecret: 'client-secret' },
        })
        await expect(publisher.verifyCredentials('access-token')).resolves.toEqual({
            kind: 'success',
            value: {
                id: 'account-1',
                acct: 'postdot@example.social',
                username: 'postdot',
                displayName: 'Postdot',
            },
        })

        const registration = fixture.calls[0]
        if (registration === undefined) throw new Error('The registration request was not captured')
        expect(registration.input).toBe('https://example.social/api/v1/apps')
        expect(registration.init?.method).toBe('POST')
        expect(registration.init?.body).toBeInstanceOf(URLSearchParams)
        const registrationBody = registration.init?.body
        expect(registrationBody).toBeInstanceOf(URLSearchParams)
        expect((registrationBody as URLSearchParams).get('scopes')).toBe(
            'read:accounts write:media'
        )
        const verification = fixture.calls[1]
        if (verification === undefined) throw new Error('The verification request was not captured')
        expect(new Headers(verification.init?.headers).get('authorization')).toBe(
            'Bearer access-token'
        )
    })

    it('uploads media, observes asynchronous processing, and publishes an idempotent status', async () => {
        const fixture = createFetcher([
            jsonResponse({ id: 'media-1', type: 'image', url: null }, 202),
            jsonResponse({ id: 'media-1', type: 'image', url: 'https://cdn.example/media-1' }),
            jsonResponse({ id: 'status-1', url: 'https://example.social/@postdot/1' }),
        ])
        const publisher = createMastodonPublisher({
            baseUrl: 'https://example.social',
            fetcher: fixture.fetcher,
        })
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array([1, 2, 3]))
                controller.close()
            },
        })

        await expect(
            publisher.uploadMedia('access-token', {
                contentType: 'image/png',
                size: 3,
                filename: 'image.png',
                accessibilityText: 'A test image',
                stream,
            })
        ).resolves.toEqual({ type: 'uploaded', remoteMediaId: 'media-1', ready: false })
        await expect(publisher.getMedia('access-token', 'media-1')).resolves.toEqual({
            kind: 'success',
            value: { id: 'media-1', type: 'image', url: 'https://cdn.example/media-1' },
        })
        await expect(
            publisher.publishStatus({
                accessToken: 'access-token',
                text: 'A scheduled status',
                mediaIds: ['media-1'],
                visibility: 'unlisted',
                sensitive: true,
                spoilerText: 'Content warning',
                language: 'en',
                idempotencyKey: 'publication-1:revision-1',
            })
        ).resolves.toEqual({
            type: 'published',
            externalId: 'status-1',
            externalUrl: 'https://example.social/@postdot/1',
        })

        const upload = fixture.calls[0]
        if (upload === undefined) throw new Error('The upload request was not captured')
        expect(upload.input).toBe('https://example.social/api/v2/media')
        expect(upload.init?.body).toBeInstanceOf(FormData)
        const uploadBody = upload.init?.body
        expect(uploadBody).toBeInstanceOf(FormData)
        expect((uploadBody as FormData).get('description')).toBe('A test image')

        const status = fixture.calls[2]
        if (status === undefined) throw new Error('The status request was not captured')
        expect(status.input).toBe('https://example.social/api/v1/statuses')
        expect(new Headers(status.init?.headers).get('idempotency-key')).toBe(
            'publication-1:revision-1'
        )
        const body = status.init?.body as URLSearchParams
        expect(body.get('status')).toBe('A scheduled status')
        expect(body.getAll('media_ids[]')).toEqual(['media-1'])
        expect(body.get('visibility')).toBe('unlisted')
        expect(body.get('sensitive')).toBe('true')
    })

    it('classifies rate limits as retryable and status server failures as ambiguous', async () => {
        const retryableFixture = createFetcher([jsonResponse({ error: 'slow down' }, 429)])
        const retryable = createMastodonPublisher({
            baseUrl: 'https://example.social',
            fetcher: retryableFixture.fetcher,
        })
        await expect(
            retryable.publishStatus({
                accessToken: 'access-token',
                text: 'Retry me',
                mediaIds: [],
                idempotencyKey: 'publication-1:revision-1',
            })
        ).resolves.toMatchObject({ type: 'retryable_failure', code: 'rate_limited' })

        const ambiguousFixture = createFetcher([jsonResponse({ error: 'upstream failure' }, 500)])
        const ambiguous = createMastodonPublisher({
            baseUrl: 'https://example.social',
            fetcher: ambiguousFixture.fetcher,
        })
        await expect(
            ambiguous.publishStatus({
                accessToken: 'access-token',
                text: 'Unknown result',
                mediaIds: [],
                idempotencyKey: 'publication-1:revision-1',
            })
        ).resolves.toMatchObject({ type: 'ambiguous', code: 'provider_failure' })
    })

    it('classifies an operator network policy denial as permanent', async () => {
        const publisher = createMastodonPublisher({
            baseUrl: 'https://example.social',
            fetcher: async () => {
                const error = new Error('private address denied') as Error & { code: string }
                error.code = 'network_policy_denied'
                throw error
            },
        })

        await expect(
            publisher.publishStatus({
                accessToken: 'access-token',
                text: 'Blocked before dispatch',
                mediaIds: [],
                idempotencyKey: 'publication-1:revision-1',
            })
        ).resolves.toMatchObject({
            type: 'permanent_failure',
            code: 'network_policy_denied',
            effectOccurred: false,
        })
    })
})

describe('rogue-instance diagnostic echo (AUDIT-307)', () => {
    const fictitiousToken = 'audit-test-access-token-echo'
    const fictitiousSpecialToken = 'audit test/token echo'

    function echoPublisher(echo: string) {
        const fixture = createFetcher([jsonResponse({ error: echo }, 500)])
        return createMastodonPublisher({
            baseUrl: 'https://example.social',
            fetcher: fixture.fetcher,
        })
    }

    async function publishStatus(
        publisher: ReturnType<typeof createMastodonPublisher>,
        accessToken: string
    ) {
        return publisher.publishStatus({
            accessToken,
            text: 'Hello',
            mediaIds: [],
            idempotencyKey: 'audit-307',
        })
    }

    it('redacts a raw echoed access token while keeping the classification', async () => {
        const outcome = await publishStatus(
            echoPublisher(
                `upstream exploded; request carried Authorization: Bearer ${fictitiousToken}`
            ),
            fictitiousToken
        )

        expect(outcome).toEqual({
            type: 'ambiguous',
            code: 'provider_failure',
            errorMessage: 'upstream exploded; request carried Authorization: Bearer [redacted]',
        })
    })

    it('redacts a URL-encoded echoed access token', async () => {
        const outcome = await publishStatus(
            echoPublisher(
                `upstream exploded; request carried ${encodeURIComponent(fictitiousSpecialToken)}`
            ),
            fictitiousSpecialToken
        )

        expect(outcome.type).toBe('ambiguous')
        if (outcome.type !== 'ambiguous') return
        expect(outcome.errorMessage).not.toContain(fictitiousSpecialToken)
        expect(outcome.errorMessage).not.toContain(encodeURIComponent(fictitiousSpecialToken))
        expect(outcome.errorMessage).toContain('[redacted]')
    })

    it('redacts every occurrence of an echoed access token', async () => {
        const outcome = await publishStatus(
            echoPublisher(
                `first ${fictitiousSpecialToken} then ${encodeURIComponent(fictitiousSpecialToken)} again ${fictitiousSpecialToken}`
            ),
            fictitiousSpecialToken
        )

        expect(outcome.type).toBe('ambiguous')
        if (outcome.type !== 'ambiguous') return
        expect(outcome.errorMessage).not.toContain(fictitiousSpecialToken)
        expect(outcome.errorMessage).toBe('first [redacted] then [redacted] again [redacted]')
    })

    it('redacts a token straddling the message length limit instead of truncating it', async () => {
        const filler = `${'overflow '.repeat(54)}pad `
        const outcome = await publishStatus(
            echoPublisher(`${filler}${fictitiousToken} tail`),
            fictitiousToken
        )

        expect(filler.length + fictitiousToken.length).toBeGreaterThan(500)
        expect(outcome.type).toBe('ambiguous')
        if (outcome.type !== 'ambiguous') return
        expect(outcome.errorMessage).toContain('[redacted]')
        expect(outcome.errorMessage).not.toContain(fictitiousToken)
        expect(outcome.errorMessage).not.toContain(fictitiousToken.slice(0, 12))
    })

    it('keeps an ordinary remote diagnostic useful', async () => {
        const outcome = await publishStatus(echoPublisher('upstream exploded'), fictitiousToken)

        expect(outcome).toEqual({
            type: 'ambiguous',
            code: 'provider_failure',
            errorMessage: 'upstream exploded',
        })
    })
})

describe('native video transport', () => {
    it('reads instance limits, streams exact multipart bytes and treats 206 as processing', async () => {
        const bytes = new Uint8Array([0, 1, 2, 255])
        let uploaded = false
        let ready = false
        const publisher = createMastodonPublisher({
            baseUrl: 'https://mastodon.example',
            fetcher: async (url, init) => {
                if (String(url).endsWith('/v2/instance'))
                    return Response.json({
                        configuration: {
                            media_attachments: {
                                supported_mime_types: ['video/mp4'],
                                video_size_limit: 100_000_000,
                                video_matrix_limit: 8_294_400,
                            },
                        },
                    })
                if (init?.method === 'POST') {
                    const body = await new Response(init.body).arrayBuffer()
                    const headers = new Headers(init.headers)
                    expect(body.byteLength).toBe(Number(headers.get('content-length')))
                    const form = await new Response(body, { headers }).formData()
                    const file = form.get('file') as File
                    expect(file.type).toBe('video/mp4')
                    expect(file.name).toBe('clip.mp4')
                    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
                    expect(form.get('description')).toBe('A moving scene')
                    uploaded = true
                    return Response.json(
                        { id: 'video-one', type: 'video', url: null },
                        { status: 202 }
                    )
                }
                expect(uploaded).toBe(true)
                return ready
                    ? Response.json({
                          id: 'video-one',
                          type: 'video',
                          url: 'https://mastodon.example/video.mp4',
                      })
                    : new Response(null, { status: 206 })
            },
        })
        expect(await publisher.getVideoLimits()).toEqual({
            kind: 'success',
            value: {
                supportedMimeTypes: ['video/mp4'],
                maxBytes: 100_000_000,
                maxPixels: 8_294_400,
            },
        })
        expect(
            await publisher.uploadMedia('secret', {
                contentType: 'video/mp4',
                filename: 'clip.mp4',
                size: bytes.length,
                accessibilityText: 'A moving scene',
                stream: new Blob([bytes]).stream(),
            })
        ).toEqual({ type: 'uploaded', remoteMediaId: 'video-one', ready: false })
        expect(await publisher.getMedia('secret', 'video-one')).toEqual({
            kind: 'success',
            value: { id: 'video-one', type: 'unknown', url: null },
        })
        ready = true
        expect(await publisher.getMedia('secret', 'video-one')).toMatchObject({
            kind: 'success',
            value: { type: 'video', url: 'https://mastodon.example/video.mp4' },
        })
    })

    it('rejects unavailable limits and wrong identifiers and never exposes echoed video tokens', async () => {
        let response = Response.json({ configuration: {} })
        const publisher = createMastodonPublisher({
            baseUrl: 'https://mastodon.example',
            fetcher: async () => response,
        })
        expect(await publisher.getVideoLimits()).toMatchObject({
            kind: 'failure',
            outcome: { type: 'permanent_failure' },
        })
        response = Response.json({
            id: 'wrong',
            type: 'video',
            url: 'https://mastodon.example/video.mp4',
        })
        expect(await publisher.getMedia('video-secret', 'expected')).toMatchObject({
            kind: 'failure',
            outcome: { type: 'permanent_failure' },
        })
        response = Response.json({ error: 'Bearer video-secret failed' }, { status: 500 })
        const result = await publisher.uploadMedia('video-secret', {
            contentType: 'video/mp4',
            filename: 'clip.mp4',
            size: 1,
            accessibilityText: 'Scene',
            stream: new Blob(['x']).stream(),
        })
        expect(result).toMatchObject({
            type: 'ambiguous',
            errorMessage: 'Bearer [redacted] failed',
        })
    })
})
