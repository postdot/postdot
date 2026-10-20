// cspell:words supergroup
import { expect, test } from 'bun:test'

import {
    createTelegramPublisher,
    TELEGRAM_MAX_PHOTO_BYTES,
    TELEGRAM_MAX_VIDEO_BYTES,
    type TelegramFetcher,
    type TelegramMedia,
} from './publisher'

const token = '123456:synthetic-test-token'
const chatId = '-1001234567890'
const bot = { id: 123456, is_bot: true, username: 'example_bot' }
const chat = {
    id: Number(chatId),
    type: 'channel',
    title: 'Example channel',
    username: 'example_channel',
}
const member = { user: bot, status: 'administrator', can_post_messages: true }
function success(result: unknown) {
    return Response.json({ ok: true, result })
}
function rejection(status: number, parameters?: unknown) {
    return Response.json(
        {
            ok: false,
            error_code: status,
            description: `Private ${token}`,
            ...(parameters ? { parameters } : {}),
        },
        { status }
    )
}
function fixture(responses: Array<Response | Error | ((init?: RequestInit) => Response)>) {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher: TelegramFetcher = async (input, init) => {
        calls.push({ url: String(input), init })
        const response = responses.shift()
        if (response instanceof Error) throw response
        if (typeof response === 'function') return response(init)
        if (!response) throw new Error('Unexpected fetch')
        return response
    }
    return { client: createTelegramPublisher({ fetcher }), calls }
}
function media(type = 'image/png', size = 3): TelegramMedia {
    return { blob: new Blob([new Uint8Array(size)], { type }), width: 640, height: 480 }
}

test('verifies bot identity, resolved channel and posting rights without sending or consuming updates', async () => {
    const { client, calls } = fixture([success(bot), success(chat), success(member)])
    expect(await client.verifyChannel(token, '@example_channel')).toEqual({
        ok: true,
        value: {
            botId: String(bot.id),
            botUsername: bot.username,
            chatId,
            title: chat.title,
            username: chat.username,
        },
    })
    expect(calls.map(call => call.url.split('/').at(-1))).toEqual([
        'getMe',
        'getChat',
        'getChatMember',
    ])
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ chat_id: chatId, user_id: bot.id })
    for (const call of calls) {
        expect(call.init?.redirect).toBe('error')
        expect(call.init?.signal).toBeInstanceOf(AbortSignal)
    }
})

test('rejects invalid references locally and incorrect channel identity or missing rights', async () => {
    for (const reference of ['https://t.me/example', '@x', '123', '-01', '-9007199254740993']) {
        const { client, calls } = fixture([])
        expect((await client.verifyChannel(token, reference)).ok).toBe(false)
        expect(calls).toHaveLength(0)
    }
    for (const badChat of [
        { ...chat, type: 'supergroup' },
        { ...chat, id: -5 },
        { ...chat, username: 'other_channel' },
    ]) {
        const { client, calls } = fixture([success(bot), success(badChat)])
        const reference = badChat.id === -5 ? chatId : '@example_channel'
        expect((await client.verifyChannel(token, reference)).ok).toBe(false)
        expect(calls).toHaveLength(2)
    }
    for (const badMember of [
        { ...member, status: 'left' },
        { ...member, can_post_messages: false },
        { ...member, user: { ...bot, id: 999 } },
    ]) {
        const { client } = fixture([success(bot), success(chat), success(badMember)])
        expect((await client.verifyChannel(token, chatId)).ok).toBe(false)
    }
    const privateFixture = fixture([
        success(bot),
        success({ ...chat, username: undefined }),
        success(member),
    ])
    expect(await privateFixture.client.verifyChannel(token, chatId)).toMatchObject({
        ok: true,
        value: { username: null },
    })
})

test('sends plain text once and preserves chat plus message identity with a verified public link', async () => {
    const { client, calls } = fixture([success({ message_id: 42, chat })])
    expect(await client.send({ token, chatId, text: '<b>literal & plain</b>' })).toEqual({
        type: 'published',
        externalId: `${chatId}:42`,
        externalUrl: 'https://t.me/example_channel/42',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url.endsWith('/sendMessage')).toBe(true)
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
        chat_id: chatId,
        text: '<b>literal & plain</b>',
    })
    const privateFixture = fixture([
        success({ message_id: 8, chat: { ...chat, username: undefined } }),
    ])
    expect(await privateFixture.client.send({ token, chatId, text: 'Private' })).toEqual({
        type: 'published',
        externalId: `${chatId}:8`,
    })
})

test('uploads exactly one photo or video with a caption and never enables paid broadcasts or parsing', async () => {
    for (const [type, method, field] of [
        ['image/png', 'sendPhoto', 'photo'],
        ['image/jpeg', 'sendPhoto', 'photo'],
        ['video/mp4', 'sendVideo', 'video'],
    ] as const) {
        const { client, calls } = fixture([
            success({
                message_id: 2,
                chat,
                photo: [{ file_id: 'photo-file' }],
                video: { file_id: 'video-file' },
            }),
        ])
        expect(
            (await client.send({ token, chatId, text: 'Caption', media: media(type) })).type
        ).toBe('published')
        expect(calls).toHaveLength(1)
        expect(calls[0]?.url.endsWith(`/${method}`)).toBe(true)
        const form = calls[0]?.init?.body as FormData
        expect(form.get('chat_id')).toBe(chatId)
        expect(form.get('caption')).toBe('Caption')
        expect((form.get(field!) as Blob).type).toBe(type)
        expect([...form.keys()].sort()).toEqual(['caption', 'chat_id', field!].sort())
    }
})

test('rejects invalid content and media before any external request', async () => {
    const invalid = [
        { text: '' },
        { text: ' '.repeat(3) },
        { text: 'x'.repeat(4097) },
        { text: '😀'.repeat(2049) },
        { text: 'x'.repeat(1025), media: media() },
        { text: '', media: media('image/gif') },
        { text: '', media: media('image/png', 0) },
        { text: '', media: { ...media(), width: 10000 } },
        { text: '', media: { ...media(), width: 1000, height: 1 } },
        { text: '', media: { ...media(), height: 0 } },
        { text: '', media: media('image/png', TELEGRAM_MAX_PHOTO_BYTES + 1) },
        { text: '', media: media('video/mp4', TELEGRAM_MAX_VIDEO_BYTES + 1) },
    ]
    for (const input of invalid) {
        const { client, calls } = fixture([])
        expect((await client.send({ token, chatId, ...input })).type).toBe('permanent_failure')
        expect(calls).toHaveLength(0)
    }
    for (const input of [
        { token: 'bad/token', chatId },
        { token, chatId: '@example_channel' },
        { token, chatId: '-01' },
    ]) {
        const { client, calls } = fixture([])
        expect((await client.send({ ...input, text: 'Test' })).type).toBe('permanent_failure')
        expect(calls).toHaveLength(0)
    }
})

test('accepts exact text, caption, photo dimension and byte boundaries', async () => {
    for (const input of [
        { text: 'x'.repeat(4096) },
        { text: '😀'.repeat(2048) },
        { text: 'x'.repeat(1024), media: media() },
        {
            text: '',
            media: { ...media('image/jpeg', TELEGRAM_MAX_PHOTO_BYTES), width: 5000, height: 5000 },
        },
        { text: '', media: media('video/mp4', TELEGRAM_MAX_VIDEO_BYTES) },
    ]) {
        const { client, calls } = fixture([
            success({
                message_id: 1,
                chat,
                photo: [{ file_id: 'photo-file' }],
                video: { file_id: 'video-file' },
            }),
        ])
        expect((await client.send({ token, chatId, ...input })).type).toBe('published')
        expect(calls).toHaveLength(1)
    }
})

test('valid rate limits defer without sending again; invalid delays never become an early retry', async () => {
    const { client, calls } = fixture([rejection(429, { retry_after: 120 })])
    expect(await client.send({ token, chatId, text: 'Test' })).toMatchObject({
        type: 'deferred',
        effectOccurred: false,
        resumeAfterMs: 120000,
    })
    expect(calls).toHaveLength(1)
    for (const retry_after of [0, -1, '10', 1.5, 31_536_001]) {
        const item = fixture([rejection(429, { retry_after })])
        expect((await item.client.send({ token, chatId, text: 'Test' })).type).toBe(
            'permanent_failure'
        )
        expect(item.calls).toHaveLength(1)
    }
    const missing = fixture([rejection(429)])
    expect((await missing.client.send({ token, chatId, text: 'Test' })).type).toBe(
        'retryable_failure'
    )
})

test('rejects definite negative responses without leaking provider descriptions or migration targets', async () => {
    for (const response of [
        rejection(401),
        rejection(403),
        rejection(400),
        rejection(413),
        rejection(400, { migrate_to_chat_id: -999 }),
    ]) {
        const { client, calls } = fixture([response])
        const outcome = await client.send({ token, chatId, text: 'Test' })
        expect(outcome.type).toBe('permanent_failure')
        if (response.status === 401)
            expect(outcome).toMatchObject({ code: 'authentication_required' })
        if (response.status === 403) expect(outcome).toMatchObject({ code: 'forbidden' })
        expect(JSON.stringify(outcome)).not.toContain(token)
        expect(JSON.stringify(outcome)).not.toContain('-999')
        expect(calls).toHaveLength(1)
    }
})

test('uncertain sends remain ambiguous and never replay, including conflicting status and envelope', async () => {
    for (const response of [
        new Error(`Fetch failed at /bot${token}`),
        rejection(500),
        new Response('bad', { status: 502 }),
        new Response(null, { status: 302, headers: { location: 'https://other.example' } }),
        Response.json({ ok: false, error_code: 400 }, { status: 500 }),
        success({ message_id: 0, chat }),
        success({ message_id: 1, chat: { ...chat, id: -9 } }),
        success(null),
        Response.json({ ok: true }),
        Response.json({ ok: true, result: { message_id: 1, chat } }, { status: 400 }),
    ]) {
        const { client, calls } = fixture([response])
        const outcome = await client.send({ token, chatId, text: 'Test' })
        expect(outcome.type).toBe('ambiguous')
        expect(JSON.stringify(outcome)).not.toContain(token)
        expect(calls).toHaveLength(1)
    }
})

test('timeouts are ambiguous for sends and safe to retry for metadata without exposing exceptions', async () => {
    const fetcher: TelegramFetcher = async (_input, init) =>
        new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error(`Timeout ${token}`)), {
                once: true,
            })
        })
    const client = createTelegramPublisher({ fetcher, timeoutMs: 5 })
    expect((await client.send({ token, chatId, text: 'Test' })).type).toBe('ambiguous')
    expect(await client.verifyChannel(token, chatId)).toMatchObject({
        ok: false,
        outcome: { type: 'retryable_failure', effectOccurred: false },
    })
})

test('verification errors and channel titles cannot return raw or encoded bot tokens', async () => {
    const rejected = fixture([rejection(401)])
    expect(JSON.stringify(await rejected.client.verifyChannel(token, chatId))).not.toContain(token)
    expect(rejected.calls).toHaveLength(1)
    const named = fixture([
        success(bot),
        success({ ...chat, title: `Channel ${token} ${encodeURIComponent(token)}` }),
        success(member),
    ])
    const result = await named.client.verifyChannel(token, chatId)
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toContain(token)
    expect(JSON.stringify(result)).not.toContain(encodeURIComponent(token))
})

function pollAcknowledgement(overrides: Record<string, unknown> = {}) {
    return {
        id: 'poll-1',
        question: 'Choose',
        options: [
            { text: 'First', voter_count: 0 },
            { text: 'Second', voter_count: 0 },
        ],
        total_voter_count: 0,
        is_closed: false,
        is_anonymous: true,
        type: 'regular',
        allows_multiple_answers: false,
        ...overrides,
    }
}

test('sends one anonymous regular poll and publishes only a confirmed acknowledgement', async () => {
    const { client, calls } = fixture([
        success({ message_id: 42, chat, poll: pollAcknowledgement() }),
    ])
    expect(
        await client.send({
            token,
            chatId,
            text: 'Choose',
            poll: { options: ['First', 'Second'] },
        })
    ).toEqual({
        type: 'published',
        externalId: `${chatId}:42`,
        externalUrl: 'https://t.me/example_channel/42',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url.endsWith('/sendPoll')).toBe(true)
    expect(calls[0]?.init?.redirect).toBe('error')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
        chat_id: chatId,
        question: 'Choose',
        options: [{ text: 'First' }, { text: 'Second' }],
        is_anonymous: true,
        type: 'regular',
        allows_multiple_answers: false,
    })
})

test('sends multiple answers and an auto-closing period only when they are requested', async () => {
    const multiple = fixture([
        success({
            message_id: 7,
            chat,
            poll: pollAcknowledgement({ allows_multiple_answers: true }),
        }),
    ])
    expect(
        (
            await multiple.client.send({
                token,
                chatId,
                text: 'Choose',
                poll: { options: ['First', 'Second'], multiple: true },
            })
        ).type
    ).toBe('published')
    expect(JSON.parse(String(multiple.calls[0]?.init?.body))).toEqual({
        chat_id: chatId,
        question: 'Choose',
        options: [{ text: 'First' }, { text: 'Second' }],
        is_anonymous: true,
        type: 'regular',
        allows_multiple_answers: true,
    })
    const closing = fixture([
        success({
            message_id: 8,
            chat,
            poll: pollAcknowledgement({ open_period: 60 }),
        }),
    ])
    expect(
        (
            await closing.client.send({
                token,
                chatId,
                text: 'Choose',
                poll: { options: ['First', 'Second'], openPeriod: 60 },
            })
        ).type
    ).toBe('published')
    expect(JSON.parse(String(closing.calls[0]?.init?.body))).toEqual({
        chat_id: chatId,
        question: 'Choose',
        options: [{ text: 'First' }, { text: 'Second' }],
        is_anonymous: true,
        type: 'regular',
        allows_multiple_answers: false,
        open_period: 60,
    })
})

test('refuses invalid polls and polls with media before any external request', async () => {
    const invalid = [
        { text: '', poll: { options: ['First'] } },
        { text: '   ', poll: { options: ['First'] } },
        { text: 'x'.repeat(301), poll: { options: ['First'] } },
        { text: 'Choose', poll: { options: ['', 'Second'] } },
        { text: 'Choose', poll: { options: ['x'.repeat(101)] } },
        { text: 'Choose', poll: { options: [] } },
        { text: 'Choose', poll: { options: Array.from({ length: 13 }, (_, i) => `O${i}`) } },
        { text: 'Choose', poll: { options: ['First'], multiple: 'true' } },
        { text: 'Choose', poll: { options: ['First'], openPeriod: 4 } },
        { text: 'Choose', poll: { options: ['First'], openPeriod: 5.5 } },
        { text: 'Choose', poll: { options: ['First'], openPeriod: 2628001 } },
    ]
    for (const input of invalid) {
        const { client, calls } = fixture([])
        expect((await client.send({ token, chatId, ...(input as { text: string }) })).type).toBe(
            'permanent_failure'
        )
        expect(calls).toHaveLength(0)
    }
    const withMedia = fixture([])
    expect(
        (
            await withMedia.client.send({
                token,
                chatId,
                text: 'Choose',
                media: media(),
                poll: { options: ['First'] },
            })
        ).type
    ).toBe('permanent_failure')
    expect(withMedia.calls).toHaveLength(0)
})

test('treats a lost or different poll acknowledgement as ambiguous and never replays', async () => {
    for (const response of [
        success({ message_id: 42, chat }),
        success({ message_id: 42, chat, poll: pollAcknowledgement({ id: '' }) }),
        success({ message_id: 42, chat, poll: pollAcknowledgement({ question: 'Other' }) }),
        success({ message_id: 42, chat, poll: pollAcknowledgement({ is_anonymous: false }) }),
        success({ message_id: 42, chat, poll: pollAcknowledgement({ type: 'quiz' }) }),
        success({
            message_id: 42,
            chat,
            poll: pollAcknowledgement({ allows_multiple_answers: true }),
        }),
        success({
            message_id: 42,
            chat,
            poll: pollAcknowledgement({ options: [{ text: 'First' }] }),
        }),
        success({ message_id: 42, chat, poll: pollAcknowledgement({ id: token }) }),
        success({ message_id: 42, chat: { ...chat, id: -9 }, poll: pollAcknowledgement() }),
        new Error(`Fetch failed at /bot${token}`),
        rejection(500),
    ]) {
        const { client, calls } = fixture([response])
        const outcome = await client.send({
            token,
            chatId,
            text: 'Choose',
            poll: { options: ['First', 'Second'] },
        })
        expect(outcome.type).toBe('ambiguous')
        expect(JSON.stringify(outcome)).not.toContain(token)
        expect(calls).toHaveLength(1)
    }
})

test('classifies a rejected poll without leaking provider descriptions or tokens', async () => {
    for (const response of [rejection(400), rejection(401), rejection(403)]) {
        const { client, calls } = fixture([response])
        const outcome = await client.send({
            token,
            chatId,
            text: 'Choose',
            poll: { options: ['First', 'Second'] },
        })
        expect(outcome.type).toBe('permanent_failure')
        if (response.status === 401)
            expect(outcome).toMatchObject({ code: 'authentication_required' })
        if (response.status === 403) expect(outcome).toMatchObject({ code: 'forbidden' })
        expect(JSON.stringify(outcome)).not.toContain(token)
        expect(calls).toHaveLength(1)
    }
})
