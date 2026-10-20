import { expect, test } from 'bun:test'

import { createMastodonAnalyticsReader } from './analytics'
import { resolveMastodonStatusReference } from './thread-reader'

const reference = resolveMastodonStatusReference('100', 'https://social.example/@owner/100')!

function status(overrides: Record<string, unknown> = {}) {
    return {
        id: '100',
        visibility: 'public',
        uri: 'https://social.example/api/v1/statuses/100',
        url: 'https://social.example/@owner/100',
        reblog: null,
        favourites_count: 0,
        reblogs_count: 0,
        replies_count: 0,
        ...overrides,
    }
}

function readerFor(body: unknown) {
    return createMastodonAnalyticsReader({ fetcher: async () => Response.json(body) })
}

test('reads the status-local counters of the original instance without credentials', async () => {
    const requests: string[] = []
    const reader = createMastodonAnalyticsReader({
        fetcher: async (input, init) => {
            requests.push(String(input))
            expect(init?.method).toBe('GET')
            expect(init?.credentials).toBe('omit')
            expect(init?.redirect).toBe('error')
            expect(new Headers(init?.headers).has('authorization')).toBe(false)
            return Response.json(
                status({ favourites_count: 0, reblogs_count: 12, replies_count: 3 })
            )
        },
    })
    const read = await reader.getStatusMetrics(reference)
    expect(requests).toEqual([reference.rootUri])
    expect(read.kind).toBe('available')
    if (read.kind !== 'available') throw new Error('Expected measured counters')
    expect(read.requestedUri).toBe(reference.rootUri)
    expect(read.metrics).toEqual({
        favourites_count: { value: 0, availability: 'measured' },
        reblogs_count: { value: 12, availability: 'measured' },
        replies_count: { value: 3, availability: 'measured' },
    })
})

test('keeps valid counters when another field is missing or malformed', async () => {
    const mixed = await readerFor(
        status({ favourites_count: null, reblogs_count: '12', replies_count: 0 })
    ).getStatusMetrics(reference)
    expect(mixed.kind === 'available' && mixed.metrics).toEqual({
        favourites_count: { value: null, availability: 'not_reported' },
        reblogs_count: { value: null, availability: 'invalid_response' },
        replies_count: { value: 0, availability: 'measured' },
    })
    const malformed = await readerFor(
        status({ favourites_count: -1, reblogs_count: 1.5, replies_count: 4 })
    ).getStatusMetrics(reference)
    expect(malformed.kind === 'available' && malformed.metrics).toEqual({
        favourites_count: { value: null, availability: 'invalid_response' },
        reblogs_count: { value: null, availability: 'invalid_response' },
        replies_count: { value: 4, availability: 'measured' },
    })
    const unsafe = await readerFor(
        status({ favourites_count: Number.MAX_SAFE_INTEGER + 2, reblogs_count: undefined })
    ).getStatusMetrics(reference)
    expect(unsafe.kind === 'available' && unsafe.metrics).toEqual({
        favourites_count: { value: null, availability: 'invalid_response' },
        reblogs_count: { value: null, availability: 'not_reported' },
        replies_count: { value: 0, availability: 'measured' },
    })
})

test('rejects a payload that is not the requested status on the original instance', async () => {
    for (const body of [
        status({ id: '101' }),
        status({ uri: 'https://other.example/api/v1/statuses/100' }),
        status({ url: 'https://other.example/@owner/100' }),
        status({ account: { url: 'https://other.example/@owner' } }),
        status({ reblog: { id: '99' } }),
        status({ uri: 'https://social.example/api/v1/statuses/101' }),
    ])
        expect(await readerFor(body).getStatusMetrics(reference)).toMatchObject({
            kind: 'unavailable',
            availability: 'invalid_response',
        })
    expect(
        await readerFor(status({ visibility: 'private' })).getStatusMetrics(reference)
    ).toMatchObject({ kind: 'unavailable', availability: 'not_found' })
    const unlisted = await readerFor(status({ visibility: 'unlisted' })).getStatusMetrics(reference)
    expect(unlisted.kind).toBe('available')
    // An instance may report the status URI and the author in either supported shape.
    const alternate = await readerFor(
        status({
            uri: 'https://social.example/users/owner/statuses/100',
            account: { url: 'https://social.example/@owner' },
        })
    ).getStatusMetrics(reference)
    expect(alternate.kind).toBe('available')
})

test('refuses a reference that does not address the original instance', async () => {
    let requested = 0
    const reader = createMastodonAnalyticsReader({
        fetcher: async () => {
            requested++
            return Response.json(status())
        },
    })
    for (const invalid of [
        { ...reference, rootUri: `${reference.rootUri}?token=secret` },
        { ...reference, rootUri: 'https://social.example/api/v1/statuses/100/activity' },
        { ...reference, rootUri: 'https://other.example/api/v1/statuses/100' },
        { ...reference, statusId: '10/../100' },
    ])
        expect(await reader.getStatusMetrics(invalid)).toMatchObject({
            kind: 'unavailable',
            availability: 'invalid_response',
        })
    expect(requested).toBe(0)
})

test('classifies provider failures without exposing provider payloads', async () => {
    for (const [http, availability] of [
        [401, 'not_authorized'],
        [403, 'not_authorized'],
        [404, 'not_found'],
        [410, 'not_found'],
        [429, 'rate_limited'],
        [503, 'temporarily_unavailable'],
    ] as const) {
        const reader = createMastodonAnalyticsReader({
            fetcher: async () =>
                new Response(JSON.stringify({ error: 'private diagnostic' }), { status: http }),
        })
        const read = await reader.getStatusMetrics(reference)
        expect(read).toMatchObject({ kind: 'unavailable', availability })
        expect(JSON.stringify(read)).not.toContain('private diagnostic')
    }
    const throwing = createMastodonAnalyticsReader({
        fetcher: async () => {
            throw new Error('private diagnostic with token=secret')
        },
    })
    const failed = await throwing.getStatusMetrics(reference)
    expect(failed).toMatchObject({ kind: 'unavailable', availability: 'temporarily_unavailable' })
    expect(JSON.stringify(failed)).not.toContain('secret')
    const notJson = createMastodonAnalyticsReader({
        fetcher: async () => new Response('<html>provider error</html>', { status: 200 }),
    })
    expect(await notJson.getStatusMetrics(reference)).toMatchObject({
        kind: 'unavailable',
        availability: 'invalid_response',
    })
})

test('terminates even when the transport ignores cancellation', async () => {
    const hanging = createMastodonAnalyticsReader({
        fetcher: async () => new Promise<Response>(() => {}),
        timeoutMs: 5,
    })
    expect(await hanging.getStatusMetrics(reference)).toMatchObject({
        kind: 'unavailable',
        availability: 'temporarily_unavailable',
    })
})
