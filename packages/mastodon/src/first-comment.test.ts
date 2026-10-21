import { expect, test } from 'bun:test'

import { resolveMastodonFirstCommentContext } from './first-comment'

const origin = 'https://social.example'
const input = {
    origin,
    rootUri: `${origin}/api/v1/statuses/100`,
    accountId: '10',
    accessToken: 'synthetic-token',
    signal: new AbortController().signal,
}
test('resolves the root status as the first-comment target with an anonymous root read', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const context = await resolveMastodonFirstCommentContext({
        ...input,
        fetcher: async (url, init) => {
            calls.push({ url: String(url), init })
            const path = new URL(String(url)).pathname
            return Response.json(
                path.endsWith('verify_credentials')
                    ? { id: '10' }
                    : { id: '100', visibility: 'public', account: { id: '10' } }
            )
        },
    })
    expect(context).toEqual({ parentId: '100', visibility: 'public' })
    expect(calls).toHaveLength(2)
    expect(calls[0]!.url).toBe(`${origin}/api/v1/accounts/verify_credentials`)
    expect(calls[1]!.url).toBe(`${origin}/api/v1/statuses/100`)
    expect(new Headers(calls[0]!.init?.headers).get('authorization')).toBe('Bearer synthetic-token')
    expect(new Headers(calls[1]!.init?.headers).has('authorization')).toBe(false)
    for (const call of calls) {
        expect(call.init?.credentials).toBe('omit')
        expect(call.init?.redirect).toBe('error')
        expect(call.init?.signal).toBe(input.signal)
    }
})
test('preserves an unlisted root visibility instead of promoting the comment', async () => {
    const context = await resolveMastodonFirstCommentContext({
        ...input,
        fetcher: async url => {
            const path = new URL(String(url)).pathname
            return Response.json(
                path.endsWith('verify_credentials')
                    ? { id: '10' }
                    : { id: '100', visibility: 'unlisted', account: { id: '10' } }
            )
        },
    })
    expect(context).toEqual({ parentId: '100', visibility: 'unlisted' })
})
test('refuses a foreign account, a foreign root owner, another status and a foreign origin', async () => {
    for (const mode of [
        'wrong-account',
        'wrong-owner',
        'wrong-status',
        'foreign-origin',
    ] as const) {
        let calls = 0
        const result = await resolveMastodonFirstCommentContext({
            ...input,
            ...(mode === 'foreign-origin'
                ? { rootUri: 'https://other.example/api/v1/statuses/100' }
                : {}),
            fetcher: async url => {
                calls++
                const path = new URL(String(url)).pathname
                return Response.json(
                    path.endsWith('verify_credentials')
                        ? { id: mode === 'wrong-account' ? '99' : '10' }
                        : {
                              id: mode === 'wrong-status' ? '999' : '100',
                              visibility: 'public',
                              account: { id: mode === 'wrong-owner' ? '99' : '10' },
                          }
                )
            },
        })
        expect(result).toBeNull()
        if (mode === 'foreign-origin') expect(calls).toBe(0)
    }
})
test('refuses a missing, private or direct root status', async () => {
    for (const mode of ['missing', 'private', 'direct'] as const) {
        const result = await resolveMastodonFirstCommentContext({
            ...input,
            fetcher: async url => {
                const path = new URL(String(url)).pathname
                if (path.endsWith('verify_credentials')) return Response.json({ id: '10' })
                if (mode === 'missing') return new Response('not found', { status: 404 })
                return Response.json({
                    id: '100',
                    visibility: mode === 'private' ? 'private' : 'direct',
                    account: { id: '10' },
                })
            },
        })
        expect(result).toBeNull()
    }
})
test('refuses a non-normalized origin and a non-numeric account before any request', async () => {
    let calls = 0
    const fetcher = async () => {
        calls++
        return Response.json({})
    }
    expect(
        await resolveMastodonFirstCommentContext({ ...input, origin: `${origin}/`, fetcher })
    ).toBeNull()
    expect(
        await resolveMastodonFirstCommentContext({
            ...input,
            rootUri: `${origin}/api/v1/statuses/not-a-status`,
            fetcher,
        })
    ).toBeNull()
    expect(
        await resolveMastodonFirstCommentContext({ ...input, accountId: 'account-10', fetcher })
    ).toBeNull()
    expect(calls).toBe(0)
})
test('stops on an aborted signal without reaching the instance', async () => {
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    const aborted = await resolveMastodonFirstCommentContext({
        ...input,
        signal: controller.signal,
        fetcher: async () => {
            calls++
            return Response.json({})
        },
    })
    expect(aborted).toBeNull()
    expect(calls).toBe(0)
    const inFlight = new AbortController()
    const interrupted = await resolveMastodonFirstCommentContext({
        ...input,
        signal: inFlight.signal,
        fetcher: async (_url, init) =>
            await new Promise<Response>((_resolve, reject) => {
                init!.signal!.addEventListener(
                    'abort',
                    () => reject(new DOMException('Aborted', 'AbortError')),
                    { once: true }
                )
                inFlight.abort()
            }),
    })
    expect(interrupted).toBeNull()
})
