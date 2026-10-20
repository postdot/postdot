import { expect, test } from 'bun:test'

import { createMastodonPublisher } from './publisher'
import { resolveMastodonReplyContext, mastodonReplyTextValid } from './reply'

const origin = 'https://social.example'
const input = {
    origin,
    rootUri: `${origin}/api/v1/statuses/100`,
    parentUri: `${origin}/api/v1/statuses/200`,
    accountId: '10',
    accessToken: 'synthetic-token',
    signal: new AbortController().signal,
}
test('checks the original account and public ancestry and preserves unlisted visibility', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const context = await resolveMastodonReplyContext({
        ...input,
        fetcher: async (url, init) => {
            calls.push({ url: String(url), init })
            const path = new URL(String(url)).pathname
            return Response.json(
                path.endsWith('verify_credentials')
                    ? { id: '10' }
                    : path.endsWith('/100')
                      ? { id: '100', visibility: 'unlisted', account: { id: '10' } }
                      : path.endsWith('/200')
                        ? { id: '200', visibility: 'public' }
                        : { ancestors: [{ id: '100' }] }
            )
        },
    })
    expect(context).toEqual({ parentId: '200', visibility: 'unlisted' })
    expect(calls).toHaveLength(4)
    expect(new Headers(calls[0]!.init?.headers).get('authorization')).toBe('Bearer synthetic-token')
    for (const call of calls.slice(1)) {
        expect(new Headers(call.init?.headers).has('authorization')).toBe(false)
        expect(call.init?.redirect).toBe('error')
    }
    expect(mastodonReplyTextValid('x'.repeat(500))).toBe(true)
    expect(mastodonReplyTextValid('x'.repeat(501))).toBe(false)
    expect(mastodonReplyTextValid(' \n ')).toBe(false)
})
test('refuses foreign-instance identifiers, wrong owners, restricted posts and unrelated ancestry', async () => {
    let calls = 0
    for (const mode of [
        'foreign',
        'wrong-account',
        'wrong-owner',
        'private',
        'unrelated',
    ] as const) {
        const result = await resolveMastodonReplyContext({
            ...input,
            ...(mode === 'foreign'
                ? { parentUri: 'https://other.example/api/v1/statuses/200' }
                : {}),
            fetcher: async url => {
                calls++
                const path = new URL(String(url)).pathname
                return Response.json(
                    path.endsWith('verify_credentials')
                        ? { id: mode === 'wrong-account' ? '99' : '10' }
                        : path.endsWith('/100')
                          ? {
                                id: '100',
                                visibility: 'public',
                                account: { id: mode === 'wrong-owner' ? '99' : '10' },
                            }
                          : path.endsWith('/200')
                            ? { id: '200', visibility: mode === 'private' ? 'private' : 'public' }
                            : { ancestors: [{ id: '999' }] }
                )
            },
        })
        expect(result).toBeNull()
        if (mode === 'foreign') expect(calls).toBe(0)
    }
})
test('encodes a text reply with its retained key and requires exact acknowledgement', async () => {
    let acknowledgement = true
    let aborted = false
    const publisher = createMastodonPublisher({
        baseUrl: origin,
        fetcher: async (_url, init) => {
            const form = init!.body as URLSearchParams
            expect(form.get('in_reply_to_id')).toBe('200')
            expect(form.get('visibility')).toBe('unlisted')
            expect(form.has('media_ids[]')).toBe(false)
            expect(new Headers(init?.headers).get('idempotency-key')).toBe('reply:retained')
            if (aborted)
                return new Promise((_resolve, reject) => {
                    init!.signal!.addEventListener(
                        'abort',
                        () => reject(new DOMException('Aborted', 'AbortError')),
                        { once: true }
                    )
                })
            return Response.json({
                id: '300',
                url: `${origin}/@owner/300`,
                in_reply_to_id: acknowledgement ? '200' : '999',
                account: { id: '10' },
                visibility: 'unlisted',
            })
        },
    })
    const request = {
        accessToken: 'synthetic',
        text: 'Thank you',
        mediaIds: [],
        reply: { parentId: '200', accountId: '10' },
        visibility: 'unlisted' as const,
        idempotencyKey: 'reply:retained',
    }
    expect(await publisher.publishStatus(request)).toMatchObject({
        type: 'published',
        externalId: '300',
    })
    acknowledgement = false
    expect(await publisher.publishStatus(request)).toMatchObject({ type: 'ambiguous' })
    aborted = true
    const controller = new AbortController()
    const result = publisher.publishStatus({ ...request, signal: controller.signal })
    controller.abort()
    expect(await result).toMatchObject({ type: 'ambiguous' })
    expect(await publisher.publishStatus({ ...request, signal: controller.signal })).toMatchObject({
        type: 'permanent_failure',
        effectOccurred: false,
    })
})
