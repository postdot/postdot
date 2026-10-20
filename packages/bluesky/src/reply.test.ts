import { expect, test } from 'bun:test'

import {
    createBlueskyReplyPublisher,
    resolveBlueskyReplyContext,
    createBlueskyReplyRecordKey,
    blueskyReplyTextValid,
    type BlueskyReplyAgent,
} from './reply'

// cspell:disable-next-line
const cid = 'bafyreiecx6dujwoeqpdzl27w67z4h46hyklk3an4i4cvvmioaqb2qbyo5u'
const root = { uri: 'at://did:plc:owner/app.bsky.feed.post/root', cid }
const parent = { uri: 'at://did:plc:reader/app.bsky.feed.post/comment', cid }
const did = 'did:plc:owner'

test('creates a text reply using retained key, timestamp and strong references', async () => {
    let sent: unknown
    const key = createBlueskyReplyRecordKey()
    const writer = createBlueskyReplyPublisher({
        did,
        async createRecord(input) {
            sent = input
            return { data: { uri: `at://${did}/app.bsky.feed.post/${key}`, cid } }
        },
    })
    expect(
        await writer.publish({
            root,
            parent,
            recordKey: key,
            text: 'Thank you',
            createdAt: 1_800_000_000_000,
        })
    ).toMatchObject({ type: 'published', externalId: `at://${did}/app.bsky.feed.post/${key}` })
    expect(sent).toEqual({
        repo: did,
        collection: 'app.bsky.feed.post',
        rkey: key,
        validate: true,
        record: {
            $type: 'app.bsky.feed.post',
            text: 'Thank you',
            createdAt: '2027-01-15T08:00:00.000Z',
            reply: { root, parent },
        },
    })
})
test('rejects invalid text and references before dispatch and keeps uncertain writes ambiguous', async () => {
    let calls = 0
    let status: number | undefined
    const writer = createBlueskyReplyPublisher({
        did,
        async createRecord() {
            calls++
            throw { status, message: 'secret provider diagnostic' }
        },
    })
    const input = {
        root,
        parent,
        recordKey: createBlueskyReplyRecordKey(),
        text: 'Reply',
        createdAt: Date.now(),
    }
    for (const value of [
        { ...input, text: ' ' },
        { ...input, text: 'x'.repeat(301) },
        { ...input, parent: { ...parent, cid: 'invalid' } },
        { ...input, recordKey: '../bad' },
    ])
        expect(await writer.publish(value)).toMatchObject({
            type: 'permanent_failure',
            effectOccurred: false,
        })
    expect(calls).toBe(0)
    expect(blueskyReplyTextValid('😀'.repeat(300))).toBe(true)
    for (const value of [undefined, 409, 503]) {
        status = value
        expect(await writer.publish(input)).toMatchObject({ type: 'ambiguous' })
    }
    status = 429
    expect(await writer.publish(input)).toMatchObject({
        type: 'retryable_failure',
        effectOccurred: false,
    })
    status = 403
    expect(await writer.publish(input)).toMatchObject({
        type: 'permanent_failure',
        effectOccurred: false,
    })
    const wrong = createBlueskyReplyPublisher({
        did,
        async createRecord() {
            return { data: { uri: parent.uri, cid } }
        },
    } as BlueskyReplyAgent)
    expect(await wrong.publish(input)).toMatchObject({ type: 'ambiguous' })
    expect(JSON.stringify(await writer.publish(input))).not.toContain('secret provider diagnostic')
})
test('resolves live root and parent references from the fixed public API and rejects foreign threads', async () => {
    let foreign = false
    const fetcher = async (url: string | URL | Request, options?: RequestInit) => {
        expect(
            String(url).startsWith('https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?')
        ).toBe(true)
        expect(options?.credentials).toBe('omit')
        return Response.json({
            posts: [
                { ...root, record: { $type: 'app.bsky.feed.post', text: 'Source' } },
                {
                    ...parent,
                    record: { reply: { root: foreign ? { ...root, uri: parent.uri } : root } },
                },
            ],
        })
    }
    expect(
        await resolveBlueskyReplyContext({ rootUri: root.uri, parentUri: parent.uri, fetcher })
    ).toEqual({ root, parent })
    foreign = true
    expect(
        await resolveBlueskyReplyContext({ rootUri: root.uri, parentUri: parent.uri, fetcher })
    ).toBeNull()
})
