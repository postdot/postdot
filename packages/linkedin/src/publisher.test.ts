import { describe, expect, it } from 'bun:test'

import {
    createLinkedInTextPublisher,
    type LinkedInFetcher,
    type LinkedInPublishOutcome,
} from './index'

const input = {
    accessToken: 'access-token-secret',
    memberId: 'member-42',
    commentary: 'Hello from Herald',
} as const

function createPublisher(fetcher: LinkedInFetcher, options: { readonly timeoutMs?: number } = {}) {
    return createLinkedInTextPublisher({
        baseUrl: 'https://linkedin.test',
        fetcher,
        ...options,
    })
}

describe('LinkedIn text publisher', () => {
    it('sends a versioned member text post and extracts the provider id', async () => {
        let request: { input: string; init: RequestInit | undefined } | undefined
        const publisher = createPublisher(async (input, init) => {
            request = { input: input.toString(), init }
            return new Response(null, {
                status: 201,
                headers: { 'x-restli-id': 'urn:li:share:post-42' },
            })
        })

        const outcome = await publisher.publishText(input)

        expect(outcome).toEqual({
            type: 'published',
            externalId: 'urn:li:share:post-42',
        })
        expect(request?.input).toBe('https://linkedin.test/rest/posts')
        expect(request?.init?.method).toBe('POST')
        const headers = new Headers(request?.init?.headers)
        expect(headers.get('authorization')).toBe('Bearer access-token-secret')
        expect(headers.get('content-type')).toBe('application/json')
        expect(headers.get('linkedin-version')).toBe('202608')
        expect(headers.get('x-restli-protocol-version')).toBe('2.0.0')
        expect(JSON.parse(String(request?.init?.body))).toEqual({
            author: 'urn:li:person:member-42',
            commentary: 'Hello from Herald',
            visibility: 'PUBLIC',
            distribution: {
                feedDistribution: 'MAIN_FEED',
                targetEntities: [],
                thirdPartyDistributionChannels: [],
            },
            lifecycleState: 'PUBLISHED',
            isReshareDisabledByAuthor: false,
        })
    })

    it('allows an explicit pinned API version and rejects malformed versions', async () => {
        let version = ''
        const publisher = createLinkedInTextPublisher({
            apiVersion: '202507',
            baseUrl: 'https://linkedin.test',
            fetcher: async (_input, init) => {
                version = new Headers(init?.headers).get('linkedin-version') ?? ''
                return new Response(null, {
                    status: 201,
                    headers: { 'x-restli-id': 'urn:li:share:post-43' },
                })
            },
        })

        await publisher.publishText(input)

        expect(version).toBe('202507')
        expect(() => createLinkedInTextPublisher({ apiVersion: 'latest' })).toThrow('YYYYMM format')
    })

    it('returns a permanent input failure without dispatching a request', async () => {
        let calls = 0
        const publisher = createPublisher(async () => {
            calls += 1
            return new Response(null, { status: 201 })
        })

        const outcome = await publisher.publishText({ ...input, commentary: '  ' })

        expect(outcome).toEqual({
            type: 'permanent_failure',
            effectOccurred: false,
            code: 'invalid_input',
            errorMessage: 'LinkedIn commentary must not be blank',
        })
        expect(calls).toBe(0)
    })

    it('classifies credential and permission rejections without leaking the token', async () => {
        const outcomes: LinkedInPublishOutcome[] = []
        const publisher = createPublisher(async (_input, init) => {
            expect(new Headers(init?.headers).get('authorization')).toBe(
                'Bearer access-token-secret'
            )
            return new Response(
                JSON.stringify({ message: 'token access-token-secret is expired' }),
                { status: 401, headers: { 'content-type': 'application/json' } }
            )
        })

        outcomes.push(await publisher.publishText(input))

        expect(outcomes[0]).toEqual({
            type: 'permanent_failure',
            effectOccurred: false,
            code: 'authentication_required',
            errorMessage:
                'LinkedIn rejected the access token (HTTP 401): token [redacted] is expired',
        })
        const firstOutcome = outcomes[0]
        expect(
            firstOutcome !== undefined && 'errorMessage' in firstOutcome
                ? firstOutcome.errorMessage
                : ''
        ).not.toContain(input.accessToken)
    })

    it('classifies rate limits as safe retries and server failures as ambiguous', async () => {
        const rateLimited = createPublisher(async () => new Response('slow down', { status: 429 }))
        const providerFailure = createPublisher(
            async () => new Response('gateway failure', { status: 503 })
        )

        await expect(rateLimited.publishText(input)).resolves.toEqual({
            type: 'retryable_failure',
            effectOccurred: false,
            code: 'rate_limited',
            errorMessage: 'LinkedIn rate limited the post request (HTTP 429): slow down',
        })
        await expect(providerFailure.publishText(input)).resolves.toEqual({
            type: 'ambiguous',
            code: 'provider_failure',
            errorMessage:
                'LinkedIn returned a server error (HTTP 503); the publication outcome is ambiguous: gateway failure',
        })
    })

    it('treats transport failures and missing provider ids as ambiguous', async () => {
        const networkFailure = createPublisher(async () => {
            throw new Error('socket closed while using access-token-secret')
        })
        const missingId = createPublisher(async () => new Response(null, { status: 201 }))

        const networkOutcome = await networkFailure.publishText(input)
        const missingIdOutcome = await missingId.publishText(input)

        expect(networkOutcome).toMatchObject({
            type: 'ambiguous',
            code: 'network_failure',
        })
        expect('errorMessage' in networkOutcome ? networkOutcome.errorMessage : '').not.toContain(
            input.accessToken
        )
        expect(missingIdOutcome).toEqual({
            type: 'ambiguous',
            code: 'missing_post_id',
            errorMessage:
                'LinkedIn accepted the post but did not return x-restli-id; the publication outcome is ambiguous',
        })
    })

    it('classifies an aborted request as an ambiguous provider timeout', async () => {
        const publisher = createPublisher(
            async (_input, init) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener(
                        'abort',
                        () => reject(new Error('request aborted')),
                        { once: true }
                    )
                }),
            { timeoutMs: 1 }
        )

        await expect(publisher.publishText(input)).resolves.toEqual({
            type: 'ambiguous',
            code: 'provider_timeout',
            errorMessage:
                'LinkedIn request timed out after dispatch; the publication outcome is ambiguous',
        })
    })
})
