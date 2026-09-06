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
                acct: 'herald@example.social',
                username: 'herald',
                display_name: 'Herald',
            }),
        ])
        const publisher = createMastodonPublisher({
            baseUrl: 'https://example.social',
            fetcher: fixture.fetcher,
        })

        await expect(
            publisher.registerApplication({
                clientName: 'Herald',
                redirectUri: 'https://herald.example/api/oauth/mastodon/callback',
                scopes: ['read:accounts', 'write:media'],
                website: 'https://herald.example',
            })
        ).resolves.toEqual({
            kind: 'success',
            value: { clientId: 'client-id', clientSecret: 'client-secret' },
        })
        await expect(publisher.verifyCredentials('access-token')).resolves.toEqual({
            kind: 'success',
            value: {
                id: 'account-1',
                acct: 'herald@example.social',
                username: 'herald',
                displayName: 'Herald',
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
            jsonResponse({ id: 'status-1', url: 'https://example.social/@herald/1' }),
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
            externalUrl: 'https://example.social/@herald/1',
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
})
