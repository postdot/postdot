import { describe, expect, it } from 'bun:test'

import {
    createLinkedInImagePublisher,
    createLinkedInTextPublisher,
    type LinkedInFetcher,
    type LinkedInPublishOutcome,
} from './index'

const input = {
    accessToken: 'access-token-secret',
    destination: { type: 'member' as const, id: 'member-42' },
    commentary: 'Hello from Herald',
} as const

function createPublisher(fetcher: LinkedInFetcher, options: { readonly timeoutMs?: number } = {}) {
    return createLinkedInTextPublisher({
        baseUrl: 'https://linkedin.test',
        fetcher,
        ...options,
    })
}

const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

function createImagePublisher(fetcher: LinkedInFetcher) {
    return createLinkedInImagePublisher({
        baseUrl: 'https://linkedin.test',
        fetcher,
    })
}

async function readRequestBody(body: RequestInit['body']): Promise<Uint8Array> {
    return new Uint8Array(await new Response(body ?? null).arrayBuffer())
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

    it('uses an organization destination without changing the OAuth principal', async () => {
        let payload: Record<string, unknown> | undefined
        const publisher = createPublisher(async (_input, init) => {
            payload = JSON.parse(String(init?.body)) as Record<string, unknown>
            return new Response(null, {
                status: 201,
                headers: { 'x-restli-id': 'urn:li:share:organization-post-42' },
            })
        })

        await expect(
            publisher.publishText({
                accessToken: input.accessToken,
                destination: { type: 'organization', id: '12345' },
                commentary: input.commentary,
            })
        ).resolves.toMatchObject({
            type: 'published',
            externalId: 'urn:li:share:organization-post-42',
        })
        expect(payload?.author).toBe('urn:li:organization:12345')
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

    it('rejects malformed organization identifiers before dispatch', async () => {
        let calls = 0
        const publisher = createPublisher(async () => {
            calls += 1
            return new Response(null, { status: 201 })
        })

        const outcome = await publisher.publishText({
            ...input,
            destination: { type: 'organization', id: 'org-42' },
        })

        expect(outcome).toMatchObject({
            type: 'permanent_failure',
            code: 'invalid_input',
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
        const conflict = createPublisher(
            async () => new Response('write conflict', { status: 409 })
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
        await expect(conflict.publishText(input)).resolves.toEqual({
            type: 'retryable_failure',
            effectOccurred: false,
            code: 'conflict',
            errorMessage:
                'LinkedIn reported a write conflict for the post request (HTTP 409): write conflict',
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

describe('LinkedIn image publisher', () => {
    it('initializes, uploads, and publishes a single image with the pinned provider id', async () => {
        const uploadUrl = 'https://uploads.linkedin.test/image-42?signature=upload-secret'
        const imageId = 'urn:li:image:image-42'
        const requests: Array<{ readonly input: string; readonly init: RequestInit | undefined }> =
            []
        let uploadedBytes: Uint8Array | undefined
        const publisher = createImagePublisher(async (input, init) => {
            requests.push({ input: input.toString(), init })
            if (requests.length === 1) {
                return Response.json({ value: { uploadUrl, image: imageId } })
            }
            if (requests.length === 2) {
                uploadedBytes = await readRequestBody(init?.body)
                return new Response(null, { status: 201 })
            }
            return new Response(null, {
                status: 201,
                headers: { 'x-restli-id': 'urn:li:post:image-42' },
            })
        })

        const uploadOutcome = await publisher.uploadImage({
            accessToken: input.accessToken,
            destination: input.destination,
            media: {
                contentType: 'image/png',
                size: imageBytes.byteLength,
                stream: new Blob([imageBytes]).stream(),
            },
        })
        const publishOutcome = await publisher.publishImage({
            accessToken: input.accessToken,
            destination: input.destination,
            commentary: input.commentary,
            imageId,
            accessibilityText: '  Herald image  ',
        })

        expect(uploadOutcome).toEqual({ type: 'uploaded', remoteMediaId: imageId })
        expect(publishOutcome).toEqual({
            type: 'published',
            externalId: 'urn:li:post:image-42',
        })
        expect(uploadedBytes).toEqual(imageBytes)
        expect(requests).toHaveLength(3)

        const initializeRequest = requests[0]
        if (initializeRequest === undefined) throw new Error('Missing initialize request')
        expect(initializeRequest.input).toBe(
            'https://linkedin.test/rest/images?action=initializeUpload'
        )
        expect(initializeRequest.init?.method).toBe('POST')
        const initializeHeaders = new Headers(initializeRequest.init?.headers)
        expect(initializeHeaders.get('authorization')).toBe('Bearer access-token-secret')
        expect(initializeHeaders.get('content-type')).toBe('application/json')
        expect(initializeHeaders.get('linkedin-version')).toBe('202608')
        expect(initializeHeaders.get('x-restli-protocol-version')).toBe('2.0.0')
        expect(JSON.parse(String(initializeRequest.init?.body))).toEqual({
            initializeUploadRequest: { owner: 'urn:li:person:member-42' },
        })

        const uploadRequest = requests[1]
        if (uploadRequest === undefined) throw new Error('Missing upload request')
        expect(uploadRequest.input).toBe(uploadUrl)
        expect(uploadRequest.init?.method).toBe('PUT')
        const uploadHeaders = new Headers(uploadRequest.init?.headers)
        expect(uploadHeaders.get('authorization')).toBe('Bearer access-token-secret')
        expect(uploadHeaders.get('content-type')).toBe('image/png')
        expect(uploadHeaders.get('content-length')).toBe(String(imageBytes.byteLength))
        expect(uploadHeaders.get('linkedin-version')).toBeNull()

        const publishRequest = requests[2]
        if (publishRequest === undefined) throw new Error('Missing publish request')
        expect(publishRequest.input).toBe('https://linkedin.test/rest/posts')
        expect(JSON.parse(String(publishRequest.init?.body))).toMatchObject({
            author: 'urn:li:person:member-42',
            commentary: 'Hello from Herald',
            content: { media: { id: imageId, altText: 'Herald image' } },
            lifecycleState: 'PUBLISHED',
        })
    })

    it('rejects invalid media input without dispatching a provider request', async () => {
        let calls = 0
        const publisher = createImagePublisher(async () => {
            calls += 1
            return new Response(null, { status: 200 })
        })

        const outcome = await publisher.uploadImage({
            accessToken: input.accessToken,
            destination: input.destination,
            media: {
                contentType: 'image/png',
                size: 0,
                stream: new Blob([imageBytes]).stream(),
            },
        })

        expect(outcome).toEqual({
            type: 'permanent_failure',
            effectOccurred: false,
            code: 'invalid_input',
            errorMessage: 'LinkedIn image size must be a positive safe integer',
        })
        expect(calls).toBe(0)
    })

    it('redacts access tokens and signed upload URLs from ambiguous failures', async () => {
        const uploadUrl = 'https://uploads.linkedin.test/image-43?signature=upload-secret'
        let calls = 0
        const publisher = createImagePublisher(async () => {
            calls += 1
            if (calls === 1) {
                return Response.json({ value: { uploadUrl, image: 'urn:li:image:image-43' } })
            }
            throw new Error('socket closed for upload-secret using access-token-secret')
        })

        const outcome = await publisher.uploadImage({
            accessToken: input.accessToken,
            destination: input.destination,
            media: {
                contentType: 'image/png',
                size: imageBytes.byteLength,
                stream: new Blob([imageBytes]).stream(),
            },
        })

        expect(outcome).toMatchObject({ type: 'ambiguous', code: 'network_failure' })
        expect('errorMessage' in outcome ? outcome.errorMessage : '').not.toContain(
            input.accessToken
        )
        expect('errorMessage' in outcome ? outcome.errorMessage : '').not.toContain('upload-secret')
    })

    it('classifies image initialization and transfer provider statuses separately', async () => {
        const rateLimited = createImagePublisher(
            async () => new Response('slow down', { status: 429 })
        )
        await expect(
            rateLimited.uploadImage({
                accessToken: input.accessToken,
                destination: input.destination,
                media: {
                    contentType: 'image/png',
                    size: imageBytes.byteLength,
                    stream: new Blob([imageBytes]).stream(),
                },
            })
        ).resolves.toEqual({
            type: 'retryable_failure',
            effectOccurred: false,
            code: 'rate_limited',
            errorMessage:
                'LinkedIn rate limited the image initialization request (HTTP 429): slow down',
        })

        let calls = 0
        const providerFailure = createImagePublisher(async () => {
            calls += 1
            if (calls === 1) {
                return Response.json({
                    value: {
                        uploadUrl: 'https://uploads.linkedin.test/image-45?signature=secret',
                        image: 'urn:li:image:image-45',
                    },
                })
            }
            return new Response('gateway failure', { status: 503 })
        })
        await expect(
            providerFailure.uploadImage({
                accessToken: input.accessToken,
                destination: input.destination,
                media: {
                    contentType: 'image/png',
                    size: imageBytes.byteLength,
                    stream: new Blob([imageBytes]).stream(),
                },
            })
        ).resolves.toEqual({
            type: 'ambiguous',
            code: 'provider_failure',
            errorMessage:
                'LinkedIn returned a server error during image upload (HTTP 503); the media outcome is ambiguous: gateway failure',
            remoteMediaId: 'urn:li:image:image-45',
        })
    })

    it('preserves a provider image id when initialization omits the upload URL', async () => {
        const imageId = 'urn:li:image:image-44'
        const publisher = createImagePublisher(async () =>
            Response.json({ value: { image: imageId } })
        )

        await expect(
            publisher.uploadImage({
                accessToken: input.accessToken,
                destination: input.destination,
                media: {
                    contentType: 'image/png',
                    size: imageBytes.byteLength,
                    stream: new Blob([imageBytes]).stream(),
                },
            })
        ).resolves.toEqual({
            type: 'ambiguous',
            code: 'missing_upload_url',
            errorMessage: 'LinkedIn registered the image upload but did not return an upload URL',
            remoteMediaId: imageId,
        })
    })
})
