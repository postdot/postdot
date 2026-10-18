import { expect, test } from 'bun:test'

import {
    createFacebookPublisher,
    FACEBOOK_GRAPH_VERSION,
    FACEBOOK_MAX_PHOTO_BYTES,
    FACEBOOK_PUBLISH_PERMISSIONS,
    type FacebookFetcher,
} from './publisher'

const token = 'synthetic-facebook-page-token'
const pageId = '123456789012345'
const postId = `${pageId}_987654321098765`
const photoId = '456789012345678'
const page = {
    id: pageId,
    name: 'Announcements',
    access_token: 'synthetic-page-token',
    tasks: ['CREATE_CONTENT'],
}
function fixture(reply: () => Response | Promise<Response>) {
    const requests: { url: URL; init: RequestInit | undefined }[] = []
    const fetcher: FacebookFetcher = async (input, init) => {
        requests.push({ url: new URL(String(input)), init })
        return reply()
    }
    return { publisher: createFacebookPublisher({ fetcher }), requests }
}
function rejected(
    status: number,
    code: number,
    extra: Record<string, unknown> = {},
    headers?: Record<string, string>
) {
    return Response.json(
        { error: { code, message: `Private ${token}`, ...extra } },
        { status, headers }
    )
}
const send = { pageToken: token, pageId, text: 'A clear announcement' }
const photo = {
    blob: new Blob(['inspected-by-application'], { type: 'image/png' }),
    accessibilityText: 'A mountain at sunrise',
}

test('Page discovery returns selectable Pages and a cursor without following paging URLs', async () => {
    const { publisher, requests } = fixture(() =>
        Response.json({
            data: [page, { ...page, id: '99', tasks: ['ANALYZE'] }],
            paging: {
                next: `https://attacker.test/?access_token=${token}`,
                cursors: { after: 'next+cursor==' },
            },
        })
    )
    const result = await publisher.listPages({ userToken: token })
    expect(result).toEqual({
        ok: true,
        value: {
            pages: [
                {
                    id: pageId,
                    name: 'Announcements',
                    accessToken: page.access_token,
                    tasks: ['CREATE_CONTENT'],
                    hasPublishTask: true,
                },
                {
                    id: '99',
                    name: 'Announcements',
                    accessToken: page.access_token,
                    tasks: ['ANALYZE'],
                    hasPublishTask: false,
                },
            ],
            nextCursor: 'next+cursor==',
        },
    })
    expect(requests).toHaveLength(1)
    const first = requests[0]!
    expect(first.url.origin).toBe('https://graph.facebook.com')
    expect(first.url.pathname).toBe(`/${FACEBOOK_GRAPH_VERSION}/me/accounts`)
    expect(first.url.searchParams.get('fields')).toBe('id,name,access_token,tasks')
    expect(first.url.searchParams.get('limit')).toBe('100')
    expect(first.url.toString()).not.toContain(token)
    expect(first.init?.headers).toMatchObject({ authorization: `Bearer ${token}` })
    expect(first.init?.method).toBe('GET')
    expect(first.init?.redirect).toBe('error')
    expect(first.init?.signal).toBeInstanceOf(AbortSignal)
    expect(FACEBOOK_PUBLISH_PERMISSIONS).toEqual([
        'pages_show_list',
        'pages_read_engagement',
        'pages_manage_posts',
    ])
    await publisher.listPages({ userToken: token, after: 'next+cursor==' })
    expect(requests[1]!.url.origin).toBe(first.url.origin)
    expect(requests[1]!.url.searchParams.get('after')).toBe('next+cursor==')
})

test('empty discovery and the current Page task spelling are handled without inventing rights', async () => {
    const empty = fixture(() => Response.json({ data: [] }))
    expect(await empty.publisher.listPages({ userToken: token })).toEqual({
        ok: true,
        value: { pages: [], nextCursor: null },
    })
    const modern = fixture(() =>
        Response.json({ data: [{ ...page, tasks: ['PROFILE_PLUS_CREATE_CONTENT'] }] })
    )
    expect(await modern.publisher.listPages({ userToken: token })).toMatchObject({
        ok: true,
        value: { pages: [{ hasPublishTask: true }] },
    })
})

test('invalid and duplicate Page discovery data is rejected without returning partial credentials', async () => {
    for (const value of [
        { data: [{ ...page, access_token: '' }] },
        { data: [{ ...page, tasks: ['ANALYZE', 42] }] },
        { data: [{ ...page, id: 42 }] },
        { data: [{ ...page, name: token }] },
        { data: [page, page] },
        { data: [page], paging: { next: 'https://attacker.test' } },
        { data: [page], paging: { next: 'https://attacker.test', cursors: { after: token } } },
        { unexpected: true },
    ]) {
        const { publisher } = fixture(() => Response.json(value))
        const result = await publisher.listPages({ userToken: token })
        expect(result).toMatchObject({ ok: false, outcome: { type: 'retryable_failure' } })
        expect(JSON.stringify(result)).not.toContain(page.access_token)
        expect(JSON.stringify(result)).not.toContain(token)
    }
})

test('text and optional link are published once without remote scheduling or preview overrides', async () => {
    for (const link of [undefined, 'https://example.com/announcement?lang=en']) {
        const { publisher, requests } = fixture(() => Response.json({ id: postId }))
        expect(await publisher.send({ ...send, link })).toEqual({
            type: 'published',
            externalId: postId,
            externalUrl: `https://www.facebook.com/${postId}`,
        })
        expect(requests).toHaveLength(1)
        const request = requests[0]!
        expect(request.url.pathname).toBe(`/${FACEBOOK_GRAPH_VERSION}/${pageId}/feed`)
        expect(request.url.search).toBe('')
        expect(request.init?.headers).toMatchObject({ authorization: `Bearer ${token}` })
        expect(request.init?.redirect).toBe('error')
        expect(request.init?.body).toBeInstanceOf(URLSearchParams)
        expect(Object.fromEntries(request.init!.body as URLSearchParams)).toEqual({
            message: send.text,
            published: 'true',
            ...(link ? { link } : {}),
        })
    }
})

test('link-only posts preserve the exact URL without requiring invented message text', async () => {
    const { publisher, requests } = fixture(() => Response.json({ id: postId }))
    expect(await publisher.send({ ...send, text: '', link: 'https://example.com' })).toMatchObject({
        type: 'published',
    })
    expect((requests[0]!.init!.body as URLSearchParams).get('message')).toBe('')
})

test('an empty optional link is absent from text and photo requests', async () => {
    for (const image of [undefined, photo]) {
        const { publisher, requests } = fixture(() =>
            Response.json(image ? { id: photoId, post_id: postId } : { id: postId })
        )
        expect(await publisher.send({ ...send, link: '', photo: image })).toMatchObject({
            type: 'published',
        })
        expect((requests[0]!.init!.body as URLSearchParams | FormData).get('link')).toBeNull()
    }
})

test('a photo is a single multipart write with distinct post and media identities', async () => {
    for (const mime of ['image/png', 'image/jpeg']) {
        const blob = new Blob(['actual-image-bytes'], { type: mime })
        const { publisher, requests } = fixture(() =>
            Response.json({ id: photoId, post_id: postId })
        )
        expect(await publisher.send({ ...send, photo: { ...photo, blob } })).toEqual({
            type: 'published',
            externalId: postId,
            mediaId: photoId,
            externalUrl: `https://www.facebook.com/${postId}`,
        })
        expect(requests).toHaveLength(1)
        const request = requests[0]!
        expect(request.url.pathname).toBe(`/${FACEBOOK_GRAPH_VERSION}/${pageId}/photos`)
        const body = request.init!.body as FormData
        expect(body).toBeInstanceOf(FormData)
        expect(body.get('published')).toBe('true')
        expect(body.get('caption')).toBe(send.text)
        expect(body.get('alt_text_custom')).toBe(photo.accessibilityText)
        expect(body.get('access_token')).toBeNull()
        expect(body.get('url')).toBeNull()
        expect(body.get('message')).toBeNull()
        const file = body.get('source') as File
        expect(file.type).toBe(mime)
        expect(await file.text()).toBe('actual-image-bytes')
        expect(file.name).toBe(mime === 'image/png' ? 'photo.png' : 'photo.jpg')
    }
})

test('a photo-only post accepts the exact byte ceiling without adding a caption or accessibility text', async () => {
    const { publisher, requests } = fixture(() => Response.json({ id: photoId, post_id: postId }))
    expect(
        await publisher.send({
            ...send,
            text: '',
            photo: {
                blob: new Blob([new Uint8Array(FACEBOOK_MAX_PHOTO_BYTES)], { type: 'image/jpeg' }),
            },
        })
    ).toMatchObject({ type: 'published', externalId: postId })
    const body = requests[0]!.init!.body as FormData
    expect(body.get('caption')).toBe('')
    expect(body.get('alt_text_custom')).toBeNull()
    expect((body.get('source') as File).size).toBe(FACEBOOK_MAX_PHOTO_BYTES)
})

test('invalid content never reaches the transport or silently drops a link/photo', async () => {
    const { publisher, requests } = fixture(() => {
        throw new Error('Unexpected request')
    })
    for (const input of [
        { ...send, pageId: '../me' },
        { ...send, pageToken: 'Bearer bad\r\nheader' },
        { ...send, text: ' ' },
        { ...send, link: 'javascript:alert(1)' },
        { ...send, link: 'https://user:password@example.com' },
        { ...send, link: ' https://example.com' },
        { ...send, link: 'https://example.com', photo },
        { ...send, photo: { blob: new Blob([], { type: 'image/jpeg' }) } },
        { ...send, photo: { blob: new Blob(['video'], { type: 'video/mp4' }) } },
        { ...send, photo: { blob: new Blob(['svg'], { type: 'image/svg+xml' }) } },
        {
            ...send,
            photo: {
                blob: new Blob([new Uint8Array(FACEBOOK_MAX_PHOTO_BYTES + 1)], {
                    type: 'image/png',
                }),
            },
        },
    ])
        expect(await publisher.send(input)).toMatchObject({
            type: 'permanent_failure',
            effectOccurred: false,
            code: 'invalid_input',
        })
    expect(await publisher.listPages({ userToken: token, after: '\n' })).toMatchObject({
        ok: false,
    })
    expect(await publisher.listPages({ userToken: '' })).toMatchObject({ ok: false })
    expect(requests).toHaveLength(0)
})

test('structured authentication and permission failures are distinct and redact provider text', async () => {
    for (const [code, expected] of [
        [190, 'authentication_required'],
        [200, 'permission_denied'],
        [10, 'permission_denied'],
        [283, 'permission_denied'],
        [100, 'request_rejected'],
        [324, 'request_rejected'],
        [368, 'request_rejected'],
    ] as const) {
        const { publisher, requests } = fixture(() => rejected(400, code))
        const outcome = await publisher.send(send)
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

test('explicit throttling defers only within a bounded delay and never retries internally', async () => {
    for (const delay of ['12', null, '-1', '999999999999', 'bad']) {
        const { publisher, requests } = fixture(() =>
            rejected(429, 4, {}, delay ? { 'retry-after': delay } : undefined)
        )
        expect(await publisher.send(send)).toMatchObject(
            delay === '12'
                ? { type: 'deferred', resumeAfterMs: 12_000, effectOccurred: false }
                : {
                      type: delay === null ? 'retryable_failure' : 'permanent_failure',
                      effectOccurred: false,
                  }
        )
        expect(requests).toHaveLength(1)
    }
    const transient = fixture(() => rejected(400, 2, { is_transient: true }))
    expect(await transient.publisher.send(send)).toMatchObject({
        type: 'retryable_failure',
        effectOccurred: false,
    })
})

test('uncertain HTTP responses remain ambiguous even when an error body suggests retry', async () => {
    for (const reply of [
        () => rejected(500, 2, { is_transient: true }),
        () => new Response('gateway error', { status: 429 }),
        () => new Response('', { status: 302, headers: { location: 'https://attacker.test' } }),
        () => Response.json({ error: { code: 190 } }),
        () => Response.json({ error: { code: '200' } }, { status: 400 }),
        () => new Response('invalid JSON'),
        () => {
            throw new Error(`Private ${token}`)
        },
    ]) {
        const { publisher, requests } = fixture(reply)
        const outcome = await publisher.send(send)
        expect(outcome).toMatchObject({ type: 'ambiguous', code: 'unknown_result' })
        expect(JSON.stringify(outcome)).not.toContain(token)
        expect(requests).toHaveLength(1)
    }
})

test('missing or wrong destination identity never reports a successful publication', async () => {
    for (const value of [
        {},
        { id: true },
        { id: 'https://attacker.test' },
        { id: '999_123' },
        { id: token },
    ]) {
        const { publisher } = fixture(() => Response.json(value))
        expect(await publisher.send(send)).toMatchObject({ type: 'ambiguous' })
    }
    for (const value of [
        { id: photoId },
        { post_id: postId },
        { id: token, post_id: postId },
        { id: photoId, post_id: '999_123' },
    ]) {
        const { publisher } = fixture(() => Response.json(value))
        expect(await publisher.send({ ...send, photo })).toMatchObject({ type: 'ambiguous' })
    }
})

test('metadata transport failures can be retried without inventing a publication effect', async () => {
    const { publisher, requests } = fixture(() => {
        throw new Error(`Private ${token}`)
    })
    const result = await publisher.listPages({ userToken: token })
    expect(result).toMatchObject({
        ok: false,
        outcome: { type: 'retryable_failure', effectOccurred: false },
    })
    expect(JSON.stringify(result)).not.toContain(token)
    expect(requests).toHaveLength(1)
})

test('timeout configuration is bounded before creating a transport', () => {
    for (const timeoutMs of [0, -1, 0.5, Number.NaN, 300_001])
        expect(() => createFacebookPublisher({ timeoutMs })).toThrow()
})
