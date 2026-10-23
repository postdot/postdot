import { expect, test } from 'bun:test'

import { effectFetcher } from './effect-fetcher'

test('combines request and effect cancellation and refuses dispatch after ownership loss', async () => {
    const effect = new AbortController()
    const request = new AbortController()
    let received: AbortSignal | null | undefined
    let calls = 0
    let owned = true
    const fetcher = effectFetcher(
        effect.signal,
        async (_url, init) => {
            calls++
            received = init?.signal
            return new Response(null, { status: 200 })
        },
        () => {
            if (!owned) throw new Error('Claim lost')
        }
    )
    await fetcher('https://provider.test', { signal: request.signal })
    expect(received?.aborted).toBe(false)
    request.abort()
    expect(received?.aborted).toBe(true)
    owned = false
    expect(() => fetcher('https://provider.test')).toThrow('Claim lost')
    expect(calls).toBe(1)
    owned = true
    effect.abort()
    expect(() => fetcher('https://provider.test')).toThrow()
    expect(calls).toBe(1)
})
