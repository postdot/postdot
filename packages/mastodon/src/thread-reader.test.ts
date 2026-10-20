import { expect, test } from 'bun:test'

import { createMastodonThreadReader, resolveMastodonStatusReference } from './thread-reader'

const reference = resolveMastodonStatusReference('100', 'https://social.example/@owner/100')!
function reply(
    id: string,
    parentId: string,
    content = '<p>Thanks &amp; welcome &#x1F600;</p><p>Next<br>line</p>'
) {
    return {
        id,
        in_reply_to_id: parentId,
        visibility: 'public',
        account: { acct: 'reader' },
        content,
        spoiler_text: '',
        created_at: '2026-10-20T10:00:00.000Z',
        url: 'javascript:untrusted',
    }
}

test('resolves the delivered instance only for an exact status permalink', () => {
    expect(reference).toEqual({
        origin: 'https://social.example',
        statusId: '100',
        rootUri: 'https://social.example/api/v1/statuses/100',
    })
    for (const value of [
        null,
        'https://social.example/@owner/101',
        'https://social.example/@owner/100?token=secret',
        'https://user:secret@social.example/@owner/100',
        'javascript:100',
        'https://social.example/anything/100',
    ])
        expect(resolveMastodonStatusReference('100', value)).toBeNull()
    expect(
        resolveMastodonStatusReference('10/../100', 'https://social.example/@owner/100')
    ).toBeNull()
})

test('reads anonymous descendants in parent order and converts HTML to plain text without trusting links', async () => {
    const requests: string[] = []
    const reader = createMastodonThreadReader({
        fetcher: async (input, init) => {
            requests.push(String(input))
            expect(init?.credentials).toBe('omit')
            expect(init?.redirect).toBe('error')
            expect(new Headers(init?.headers).has('authorization')).toBe(false)
            return Response.json(
                String(input).endsWith('/context')
                    ? {
                          ancestors: [reply('99', '98')],
                          descendants: [
                              reply('102', '101'),
                              { ...reply('101', '100'), spoiler_text: 'Content warning' },
                              reply(
                                  '103',
                                  '100',
                                  '<p>&lt;img src=x onerror=alert(1)&gt;</p><script>hidden</script><!-- hidden -->'
                              ),
                          ],
                      }
                    : { id: '100', visibility: 'public' }
            )
        },
    })
    const read = await reader.getPostThread(reference)
    expect(requests).toEqual([reference.rootUri, reference.rootUri + '/context'])
    expect(read.kind).toBe('available')
    if (read.kind !== 'available') throw new Error('Expected public context')
    expect(read.comments.map(comment => comment.depth)).toEqual([0, 1, 0])
    expect(read.comments[0]).toMatchObject({
        authorHandle: 'reader@social.example',
        text: 'Content warning\n\nThanks & welcome 😀\nNext\nline',
        externalUrl: 'https://social.example/web/statuses/101',
    })
    expect(read.comments[2]!.text).toBe('<img src=x onerror=alert(1)>')
    expect(read.truncated).toBe(false)
})

test('bounds public reads and rejects malformed context while classifying provider failures', async () => {
    let status = 200
    let restricted = false
    let descendants: unknown[] = [reply('101', '100')]
    const reader = createMastodonThreadReader({
        fetcher: async input =>
            Response.json(
                String(input).endsWith('/context')
                    ? { descendants }
                    : { id: '100', visibility: restricted ? 'private' : 'public' },
                { status }
            ),
    })
    for (const [http, availability] of [
        [429, 'rate_limited'],
        [404, 'not_found'],
        [403, 'not_authorized'],
        [503, 'temporarily_unavailable'],
    ] as const) {
        status = http
        expect(await reader.getPostThread(reference)).toMatchObject({
            kind: 'unavailable',
            availability,
        })
    }
    status = 200
    restricted = true
    expect(await reader.getPostThread(reference)).toMatchObject({
        kind: 'unavailable',
        availability: 'not_found',
    })
    restricted = false
    descendants = [reply('101', '100'), reply('101', '100')]
    expect(await reader.getPostThread(reference)).toMatchObject({
        kind: 'unavailable',
        availability: 'invalid_response',
    })
    descendants = Array.from({ length: 75 }, (_, index) => reply(String(101 + index), '100'))
    const bounded = await reader.getPostThread(reference)
    expect(bounded.kind === 'available' && bounded.comments.length).toBe(60)
    expect(bounded.kind === 'available' && bounded.truncated).toBe(true)
    descendants = Array.from({ length: 9 }, (_, index) =>
        reply(String(101 + index), String(100 + index))
    )
    const deep = await reader.getPostThread(reference)
    expect(deep.kind === 'available' && deep.comments.length).toBe(7)
    expect(deep.kind === 'available' && deep.truncated).toBe(true)
    descendants = [{ ...reply('101', '100'), visibility: 'private' }, reply('102', '101')]
    expect(await reader.getPostThread(reference)).toMatchObject({
        kind: 'available',
        comments: [],
        truncated: true,
    })
})

test('terminates even when the transport ignores cancellation and hides transport errors', async () => {
    const hanging = createMastodonThreadReader({
        fetcher: async () => new Promise<Response>(() => {}),
        timeoutMs: 5,
    })
    expect(await hanging.getPostThread(reference)).toMatchObject({
        kind: 'unavailable',
        availability: 'temporarily_unavailable',
    })
    const throwing = createMastodonThreadReader({
        fetcher: async () => {
            throw new Error('private diagnostic')
        },
    })
    expect(JSON.stringify(await throwing.getPostThread(reference))).not.toContain(
        'private diagnostic'
    )
})
