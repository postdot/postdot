import { expect, test } from 'bun:test'

import {
    createInstagramPublisher,
    INSTAGRAM_GRAPH_ORIGIN,
    INSTAGRAM_GRAPH_VERSION,
    INSTAGRAM_MAX_ACCESSIBILITY_TEXT_LENGTH,
    INSTAGRAM_MAX_CAPTION_LENGTH,
    INSTAGRAM_PUBLISH_PERMISSIONS,
    type InstagramFetcher,
} from './publisher'

const token = 'synthetic-instagram-user-token'
const accountId = '17841400000000000'
const containerId = '17900000000000001'
const mediaId = '17900000000000002'
const signedImageUrl =
    'https://media.postdot.test/assets/photo.jpg?X-Signature=9f8e7d6c5b4a3f2e%3D%3D' +
    '&X-Expires=1758360000&X-Credential=media%2F20261020'

function fixture(reply: () => Response | Promise<Response>) {
    const requests: { url: URL; init: RequestInit | undefined }[] = []
    const fetcher: InstagramFetcher = async (input, init) => {
        requests.push({ url: new URL(String(input)), init })
        return reply()
    }
    return { publisher: createInstagramPublisher({ fetcher }), requests }
}

function rejected(status: number, code: number, headers?: Record<string, string>) {
    return Response.json({ error: { code, message: `Private ${token}` } }, { status, headers })
}

const create = {
    accountId,
    accessToken: token,
    imageUrl: signedImageUrl,
}

test('container creation posts one JPEG URL to the fixed Instagram host and version', async () => {
    const { publisher, requests } = fixture(() => Response.json({ id: containerId }))
    const result = await publisher.createContainer({
        ...create,
        caption: 'A clear announcement',
        accessibilityText: 'A mountain at sunrise',
    })
    expect(result).toEqual({ ok: true, value: { containerId } })
    expect(requests).toHaveLength(1)
    const request = requests[0]!
    expect(request.url.origin).toBe('https://graph.instagram.com')
    expect(INSTAGRAM_GRAPH_ORIGIN).toBe('https://graph.instagram.com')
    expect(request.url.pathname).toBe(`/${INSTAGRAM_GRAPH_VERSION}/${accountId}/media`)
    expect(request.url.search).toBe('')
    expect(request.init?.method).toBe('POST')
    expect(request.init?.redirect).toBe('error')
    expect(request.init?.credentials).toBe('omit')
    expect(request.init?.signal).toBeInstanceOf(AbortSignal)
    expect(request.init?.headers).toMatchObject({
        authorization: `Bearer ${token}`,
        accept: 'application/json',
    })
    expect(request.url.toString()).not.toContain(token)
    const body = request.init!.body as URLSearchParams
    expect(body.get('image_url')).toBe(signedImageUrl)
    expect(body.get('caption')).toBe('A clear announcement')
    expect(body.get('alt_text')).toBe('A mountain at sunrise')
    expect(body.get('access_token')).toBeNull()
    expect(body.get('creation_id')).toBeNull()
})

test('a signed image URL is sent verbatim and the protocol never fetches it', async () => {
    const { publisher, requests } = fixture(() => Response.json({ id: containerId }))
    await publisher.createContainer({ ...create, imageUrl: signedImageUrl })
    const body = requests[0]!.init!.body as URLSearchParams
    expect(body.get('image_url')).toBe(signedImageUrl)
    expect(body.get('image_url')).toContain('X-Signature=9f8e7d6c5b4a3f2e')
    expect(requests).toHaveLength(1)
})

test('an absent or empty caption and accessibility text are not sent', async () => {
    for (const input of [
        {},
        { caption: '' },
        { caption: '', accessibilityText: '' },
        { accessibilityText: 'A mountain at sunrise' },
    ]) {
        const { publisher, requests } = fixture(() => Response.json({ id: containerId }))
        expect(await publisher.createContainer({ ...create, ...input })).toMatchObject({
            ok: true,
            value: { containerId },
        })
        const body = requests[0]!.init!.body as URLSearchParams
        expect(body.get('image_url')).toBe(signedImageUrl)
        if (!('caption' in input) || input.caption === '') expect(body.get('caption')).toBeNull()
        if (!('accessibilityText' in input) || input.accessibilityText === '')
            expect(body.get('alt_text')).toBeNull()
    }
})

test('insecure, credentialed and private image URLs never reach the transport', async () => {
    const { publisher, requests } = fixture(() => {
        throw new Error('Unexpected request')
    })
    for (const imageUrl of [
        'http://media.postdot.test/photo.jpg',
        'https://user:secret@media.postdot.test/photo.jpg',
        'https://media.postdot.test/photo.jpg#fragment',
        'https://media.postdot.test/photo.jpg ',
        'https://localhost/photo.jpg',
        'https://api.localhost/photo.jpg',
        'https://127.0.0.1/photo.jpg',
        'https://127.1/photo.jpg',
        'https://10.0.0.5/photo.jpg',
        'https://172.16.0.9/photo.jpg',
        'https://192.168.1.10/photo.jpg',
        'https://169.254.1.1/photo.jpg',
        'https://[::1]/photo.jpg',
        'https://[fd00::1]/photo.jpg',
        'https://media.postdot.test/photo jpg',
        'not-a-url',
        '',
    ]) {
        expect(await publisher.createContainer({ ...create, imageUrl })).toMatchObject({
            ok: false,
            outcome: { type: 'permanent_failure', effectOccurred: false, code: 'invalid_input' },
        })
    }
    expect(requests).toHaveLength(0)
})

test('caption and accessibility text ceilings reject before the transport', async () => {
    const { publisher, requests } = fixture(() => {
        throw new Error('Unexpected request')
    })
    for (const input of [
        { caption: 'a'.repeat(INSTAGRAM_MAX_CAPTION_LENGTH + 1) },
        { accessibilityText: 'b'.repeat(INSTAGRAM_MAX_ACCESSIBILITY_TEXT_LENGTH + 1) },
    ]) {
        expect(await publisher.createContainer({ ...create, ...input })).toMatchObject({
            ok: false,
            outcome: { type: 'permanent_failure', effectOccurred: false, code: 'invalid_input' },
        })
    }
    expect(requests).toHaveLength(0)
})

test('a caption at the documented ceiling is accepted and counted in code points', async () => {
    const { publisher, requests } = fixture(() => Response.json({ id: containerId }))
    const caption = '\u{1F600}'.repeat(INSTAGRAM_MAX_CAPTION_LENGTH)
    expect(await publisher.createContainer({ ...create, caption })).toMatchObject({ ok: true })
    expect((requests[0]!.init!.body as URLSearchParams).get('caption')).toBe(caption)
})

test('invalid identities and tokens never reach the transport', async () => {
    const { publisher, requests } = fixture(() => {
        throw new Error('Unexpected request')
    })
    for (const input of [
        { accountId: '../me' },
        { accountId: '0' },
        { accountId: 'ig account' },
        { accessToken: '' },
        { accessToken: 'Bearer bad\r\nheader' },
    ]) {
        expect(await publisher.createContainer({ ...create, ...input })).toMatchObject({
            ok: false,
            outcome: { type: 'permanent_failure', code: 'invalid_input' },
        })
    }
    expect(
        await publisher.readContainerStatus({ accessToken: token, containerId: 'abc' })
    ).toMatchObject({ ok: false, outcome: { code: 'invalid_input' } })
    expect(
        await publisher.publishContainer({ accountId, accessToken: token, containerId: 'abc' })
    ).toMatchObject({ type: 'permanent_failure', code: 'invalid_input' })
    expect(requests).toHaveLength(0)
})

test('container status is read separately and never publishes', async () => {
    for (const [statusCode, status] of [
        ['IN_PROGRESS', 'in_progress'],
        ['FINISHED', 'finished'],
        ['ERROR', 'error'],
        ['EXPIRED', 'expired'],
        ['PUBLISHED', 'published'],
    ] as const) {
        const { publisher, requests } = fixture(() =>
            Response.json({ id: containerId, status_code: statusCode })
        )
        expect(await publisher.readContainerStatus({ accessToken: token, containerId })).toEqual({
            ok: true,
            value: { containerId, status },
        })
        expect(requests).toHaveLength(1)
        const request = requests[0]!
        expect(request.url.origin).toBe('https://graph.instagram.com')
        expect(request.url.pathname).toBe(`/${INSTAGRAM_GRAPH_VERSION}/${containerId}`)
        expect(request.url.searchParams.get('fields')).toBe('status_code')
        expect(request.init?.method).toBe('GET')
        expect(request.init?.body).toBeUndefined()
    }
})

test('a PUBLISHED container status is a status, never a media receipt', async () => {
    const { publisher } = fixture(() =>
        Response.json({ id: containerId, status_code: 'PUBLISHED' })
    )
    const result = await publisher.readContainerStatus({ accessToken: token, containerId })
    expect(result).toEqual({ ok: true, value: { containerId, status: 'published' } })
    expect(JSON.stringify(result)).not.toContain(mediaId)
})

test('unknown, missing and malformed container statuses stay retryable reads', async () => {
    for (const reply of [
        () => Response.json({ id: containerId, status_code: 'SOMETHING_ELSE' }),
        () => Response.json({ id: containerId }),
        () => Response.json({ id: containerId, status_code: 42 }),
        () => Response.json({ id: 'other-container', status_code: 'FINISHED' }),
        () => Response.json('not-an-object'),
        () => new Response('invalid JSON', { status: 200 }),
    ]) {
        const { publisher, requests } = fixture(reply)
        expect(
            await publisher.readContainerStatus({ accessToken: token, containerId })
        ).toMatchObject({
            ok: false,
            outcome: { type: 'retryable_failure', effectOccurred: false },
        })
        expect(requests).toHaveLength(1)
    }
})

test('publication returns only the provider media identity', async () => {
    const { publisher, requests } = fixture(() => Response.json({ id: mediaId }))
    expect(
        await publisher.publishContainer({ accountId, accessToken: token, containerId })
    ).toEqual({ type: 'published', externalId: mediaId })
    expect(requests).toHaveLength(1)
    const request = requests[0]!
    expect(request.url.origin).toBe('https://graph.instagram.com')
    expect(request.url.pathname).toBe(`/${INSTAGRAM_GRAPH_VERSION}/${accountId}/media_publish`)
    expect(request.init?.method).toBe('POST')
    expect(request.init?.headers).toMatchObject({ authorization: `Bearer ${token}` })
    expect(request.url.toString()).not.toContain(token)
    const body = request.init!.body as URLSearchParams
    expect(body.get('creation_id')).toBe(containerId)
    expect(body.get('image_url')).toBeNull()
})

test('a container identity never becomes a published media identity', async () => {
    for (const reply of [
        () => Response.json({ id: containerId }),
        () => Response.json({ id: 'not-numeric' }),
        () => Response.json({ id: '' }),
        () => Response.json({}),
    ]) {
        const { publisher, requests } = fixture(reply)
        const outcome = await publisher.publishContainer({
            accountId,
            accessToken: token,
            containerId,
        })
        expect(outcome).toMatchObject({ type: 'ambiguous' })
        expect(JSON.stringify(outcome)).not.toContain('published')
        expect(requests).toHaveLength(1)
    }
})

test('structured rejections prove that no write occurred', async () => {
    for (const [code, expected] of [
        [190, 'authentication_required'],
        [10, 'permission_denied'],
        [200, 'permission_denied'],
        [283, 'permission_denied'],
        [100, 'request_rejected'],
        [324, 'request_rejected'],
    ] as const) {
        const { publisher, requests } = fixture(() => rejected(400, code))
        const outcome = await publisher.publishContainer({
            accountId,
            accessToken: token,
            containerId,
        })
        expect(outcome).toMatchObject({
            type: 'permanent_failure',
            effectOccurred: false,
            code: expected,
        })
        expect(JSON.stringify(outcome)).not.toContain(token)
        expect(JSON.stringify(outcome)).not.toContain('Private')
        expect(requests).toHaveLength(1)
    }
})

test('explicit throttling defers a write within a bounded delay', async () => {
    const deferred = fixture(() => rejected(429, 4, { 'retry-after': '12' }))
    expect(
        await deferred.publisher.publishContainer({
            accountId,
            accessToken: token,
            containerId,
        })
    ).toMatchObject({ type: 'deferred', effectOccurred: false, resumeAfterMs: 12_000 })
    for (const delay of [null, '-1', '999999999999', 'bad']) {
        const { publisher } = fixture(() =>
            rejected(429, 4, delay === null ? undefined : { 'retry-after': delay })
        )
        expect(
            await publisher.publishContainer({ accountId, accessToken: token, containerId })
        ).toMatchObject({
            type: delay === null ? 'retryable_failure' : 'permanent_failure',
            effectOccurred: false,
            code: 'rate_limited',
        })
    }
})

test('an uncertain write stays ambiguous and is never replayed internally', async () => {
    for (const reply of [
        () => rejected(500, 2, { 'retry-after': '12' }),
        () => new Response('gateway error', { status: 500 }),
        () => new Response('invalid JSON', { status: 200 }),
        () => new Response('', { status: 302, headers: { location: 'https://attacker.test' } }),
        () => Response.json({ error: { code: '200' } }, { status: 400 }),
        () => Response.json({ error: { message: 'no code' } }, { status: 400 }),
        () => Response.json({ error: { code: 190 } }),
        () => {
            throw new Error(`Private ${token}`)
        },
    ]) {
        const { publisher, requests } = fixture(reply)
        const outcome = await publisher.publishContainer({
            accountId,
            accessToken: token,
            containerId,
        })
        expect(outcome).toMatchObject({ type: 'ambiguous', code: 'unknown_result' })
        expect(JSON.stringify(outcome)).not.toContain(token)
        expect(requests).toHaveLength(1)
    }
})

test('an uncertain read stays retryable and is never replayed internally', async () => {
    for (const reply of [
        () => new Response('gateway error', { status: 500 }),
        () => new Response('invalid JSON', { status: 200 }),
        () => {
            throw new Error(`Private ${token}`)
        },
    ]) {
        const { publisher, requests } = fixture(reply)
        const outcome = await publisher.readContainerStatus({
            accessToken: token,
            containerId,
        })
        expect(outcome).toMatchObject({
            ok: false,
            outcome: { type: 'retryable_failure', effectOccurred: false },
        })
        expect(JSON.stringify(outcome)).not.toContain(token)
        expect(requests).toHaveLength(1)
    }
})

test('a lost container acknowledgement stays unknown and claims no publication', async () => {
    for (const reply of [
        () => new Response('gateway error', { status: 500 }),
        () => new Response('invalid JSON', { status: 200 }),
        () => {
            throw new Error(`Private ${token}`)
        },
    ]) {
        const { publisher, requests } = fixture(reply)
        const result = await publisher.createContainer({ ...create })
        expect(result).toMatchObject({
            ok: false,
            outcome: { type: 'ambiguous', code: 'unknown_result' },
        })
        expect(JSON.stringify(result)).not.toContain('published')
        expect(JSON.stringify(result)).not.toContain(token)
        expect(requests).toHaveLength(1)
    }
})

test('a container response without a usable identity stays unknown', async () => {
    for (const reply of [
        () => Response.json({ id: 'not-numeric' }),
        () => Response.json({ id: '' }),
        () => Response.json({}),
        () => Response.json({ id: containerId, error: { code: 100 } }),
    ]) {
        const { publisher, requests } = fixture(reply)
        expect(await publisher.createContainer({ ...create })).toMatchObject({
            ok: false,
            outcome: { type: 'ambiguous' },
        })
        expect(requests).toHaveLength(1)
    }
})

test('a request cancelled before dispatch is reported as cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const requests: { url: URL; init: RequestInit | undefined }[] = []
    const publisher = createInstagramPublisher({
        fetcher: async (input, init) => {
            requests.push({ url: new URL(String(input)), init })
            throw new Error('Unexpected request')
        },
        signal: controller.signal,
    })
    expect(
        await publisher.publishContainer({ accountId, accessToken: token, containerId })
    ).toMatchObject({
        type: 'permanent_failure',
        effectOccurred: false,
        code: 'cancelled',
    })
    expect(await publisher.createContainer({ ...create })).toMatchObject({
        ok: false,
        outcome: { type: 'permanent_failure', effectOccurred: false, code: 'cancelled' },
    })
    expect(requests).toHaveLength(0)
})

test('a cancellation during a write keeps the outcome unknown', async () => {
    const controller = new AbortController()
    const fetcher: InstagramFetcher = async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
                once: true,
            })
        })
    const publisher = createInstagramPublisher({ fetcher, signal: controller.signal })
    const pending = publisher.publishContainer({ accountId, accessToken: token, containerId })
    controller.abort()
    expect(await pending).toMatchObject({ type: 'ambiguous', code: 'cancelled' })
})

test('a cancellation during a read stays retryable and effect free', async () => {
    const controller = new AbortController()
    const fetcher: InstagramFetcher = async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
                once: true,
            })
        })
    const publisher = createInstagramPublisher({ fetcher, signal: controller.signal })
    const pending = publisher.readContainerStatus({ accessToken: token, containerId })
    controller.abort()
    expect(await pending).toMatchObject({
        ok: false,
        outcome: { type: 'retryable_failure', effectOccurred: false, code: 'cancelled' },
    })
})

test('a bounded timeout aborts the request without publishing', async () => {
    const fetcher: InstagramFetcher = async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
                once: true,
            })
        })
    const publisher = createInstagramPublisher({ fetcher, timeoutMs: 5 })
    expect(
        await publisher.publishContainer({ accountId, accessToken: token, containerId })
    ).toMatchObject({ type: 'ambiguous', code: 'unknown_result' })
    expect(await publisher.readContainerStatus({ accessToken: token, containerId })).toMatchObject({
        ok: false,
        outcome: { type: 'retryable_failure', effectOccurred: false },
    })
})

test('timeout configuration is bounded before creating a transport', () => {
    for (const timeoutMs of [0, -1, 0.5, Number.NaN, 300_001])
        expect(() => createInstagramPublisher({ timeoutMs })).toThrow()
})

test('the documented direct-login permissions are exposed without a connection flow', () => {
    expect(INSTAGRAM_PUBLISH_PERMISSIONS).toEqual([
        'instagram_business_basic',
        'instagram_business_content_publish',
    ])
})
