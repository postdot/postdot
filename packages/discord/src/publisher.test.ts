import { describe, expect, it } from 'bun:test'

import type { DiscordFetcher } from './contract'
import { createDiscordPublisher } from './publisher'

const BOT_TOKEN = 'discord-bot-token-that-must-not-become-domain-data'
const CHANNEL_ID = '123456789012345678'

function jsonResponse(value: unknown, status = 200): Response {
    return Response.json(value, { status })
}

function createFetcher(responses: readonly Response[]) {
    const calls: Array<{ readonly input: string | URL | Request; readonly init?: RequestInit }> = []
    let index = 0
    const fetcher: DiscordFetcher = async (input, init) => {
        calls.push({ input, init })
        const response = responses[index]
        index += 1
        if (response === undefined) throw new Error('Unexpected Discord request')
        return response
    }
    return { calls, fetcher }
}

function attachmentStream(bytes: readonly number[] = [1, 2, 3]): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new Uint8Array(bytes))
            controller.close()
        },
    })
}

describe('Discord channel identifiers', () => {
    it('verifies the bot profile and the target channel', async () => {
        const fixture = createFetcher([
            jsonResponse({ id: '987654321098765432', username: 'Postdot' }),
            jsonResponse({ id: CHANNEL_ID, name: 'announcements', type: 0 }),
        ])
        const publisher = createDiscordPublisher({
            baseUrl: 'https://discord.test',
            fetcher: fixture.fetcher,
        })

        await expect(publisher.getBotUser(BOT_TOKEN)).resolves.toEqual({
            kind: 'success',
            value: { id: '987654321098765432', username: 'Postdot' },
        })
        await expect(publisher.getChannel(BOT_TOKEN, CHANNEL_ID)).resolves.toEqual({
            kind: 'success',
            value: { id: CHANNEL_ID, name: 'announcements', type: 0 },
        })

        expect(fixture.calls[0]?.input).toBe('https://discord.test/api/v10/users/@me')
        expect(fixture.calls[1]?.input).toBe(`https://discord.test/api/v10/channels/${CHANNEL_ID}`)
        for (const call of fixture.calls) {
            expect(new Headers(call.init?.headers).get('authorization')).toBe(`Bot ${BOT_TOKEN}`)
        }
    })
})

describe('Discord publisher', () => {
    it('posts text with mentions disabled and extracts the message id', async () => {
        let request: { input: string; init: RequestInit | undefined } | undefined
        const publisher = createDiscordPublisher({
            baseUrl: 'https://discord.test',
            fetcher: async (input, init) => {
                request = { input: input.toString(), init }
                return jsonResponse({
                    id: '111111111111111111',
                    channel_id: CHANNEL_ID,
                    guild_id: '222222222222222222',
                    attachments: [],
                })
            },
        })

        const outcome = await publisher.createMessage({
            accessToken: BOT_TOKEN,
            channelId: CHANNEL_ID,
            content: 'Hello from Postdot',
            attachments: [],
        })

        expect(outcome).toEqual({
            type: 'published',
            externalId: '111111111111111111',
            externalUrl: `https://discord.com/channels/222222222222222222/${CHANNEL_ID}/111111111111111111`,
        })
        expect(request?.input).toBe(`https://discord.test/api/v10/channels/${CHANNEL_ID}/messages`)
        expect(request?.init?.method).toBe('POST')
        const headers = new Headers(request?.init?.headers)
        expect(headers.get('authorization')).toBe(`Bot ${BOT_TOKEN}`)
        expect(JSON.parse(String(request?.init?.body))).toEqual({
            content: 'Hello from Postdot',
            allowed_mentions: { parse: [] },
        })
    })

    it('uploads attachments with multipart payload and descriptions', async () => {
        let body: FormData | undefined
        const publisher = createDiscordPublisher({
            baseUrl: 'https://discord.test',
            fetcher: async (_input, init) => {
                body = init?.body as FormData
                return jsonResponse({
                    id: '333333333333333333',
                    channel_id: CHANNEL_ID,
                    attachments: [{ id: '444444444444444444' }],
                })
            },
        })

        const outcome = await publisher.createMessage({
            accessToken: BOT_TOKEN,
            channelId: CHANNEL_ID,
            content: 'Release notes',
            attachments: [
                {
                    filename: 'notes.png',
                    contentType: 'image/png',
                    description: 'Release notes screenshot',
                    stream: attachmentStream(),
                },
            ],
        })

        expect(outcome).toEqual({
            type: 'published',
            externalId: '333333333333333333',
            attachmentIds: ['444444444444444444'],
        })
        expect(body).toBeInstanceOf(FormData)
        expect(JSON.parse(String(body?.get('payload_json')))).toEqual({
            content: 'Release notes',
            allowed_mentions: { parse: [] },
            attachments: [
                { id: 0, filename: 'notes.png', description: 'Release notes screenshot' },
            ],
        })
    })

    it('classifies rate limits as retryable without the Bot token', async () => {
        const publisher = createDiscordPublisher({
            baseUrl: 'https://discord.test',
            fetcher: async () => jsonResponse({ message: 'Slow down', retry_after: 2.5 }, 429),
        })

        const outcome = await publisher.createMessage({
            accessToken: BOT_TOKEN,
            channelId: CHANNEL_ID,
            content: 'Hello',
            attachments: [],
        })

        expect(outcome).toMatchObject({ type: 'retryable_failure', code: 'rate_limited' })
        expect(JSON.stringify(outcome)).not.toContain(BOT_TOKEN)
    })

    it('classifies authentication and validation failures as permanent', async () => {
        const unauthorized = createDiscordPublisher({
            baseUrl: 'https://discord.test',
            fetcher: async () => jsonResponse({ message: 'Unauthorized', code: 0 }, 401),
        })
        await expect(
            unauthorized.createMessage({
                accessToken: BOT_TOKEN,
                channelId: CHANNEL_ID,
                content: 'Hello',
                attachments: [],
            })
        ).resolves.toMatchObject({ type: 'permanent_failure', code: 'authentication_required' })

        const invalidChannel = createDiscordPublisher({
            baseUrl: 'https://discord.test',
            fetcher: async () => jsonResponse({ message: 'Unknown Channel', code: 10003 }, 404),
        })
        await expect(
            invalidChannel.createMessage({
                accessToken: BOT_TOKEN,
                channelId: CHANNEL_ID,
                content: 'Hello',
                attachments: [],
            })
        ).resolves.toMatchObject({ type: 'permanent_failure', code: 'invalid_request' })
    })

    it('classifies post-effect transport failures as ambiguous', async () => {
        const failing = createDiscordPublisher({
            baseUrl: 'https://discord.test',
            fetcher: async () => jsonResponse({ message: 'Server error' }, 500),
        })
        await expect(
            failing.createMessage({
                accessToken: BOT_TOKEN,
                channelId: CHANNEL_ID,
                content: 'Hello',
                attachments: [],
            })
        ).resolves.toMatchObject({ type: 'ambiguous' })

        const throwing = createDiscordPublisher({
            baseUrl: 'https://discord.test',
            fetcher: async () => {
                throw new TypeError('network down')
            },
        })
        await expect(
            throwing.createMessage({
                accessToken: BOT_TOKEN,
                channelId: CHANNEL_ID,
                content: 'Hello',
                attachments: [],
            })
        ).resolves.toMatchObject({ type: 'ambiguous', code: 'network_failure' })
    })

    it('rejects invalid input before dispatch and never exposes the token', async () => {
        let dispatched = false
        const publisher = createDiscordPublisher({
            baseUrl: 'https://discord.test',
            fetcher: async () => {
                dispatched = true
                return jsonResponse({ id: '555555555555555555', channel_id: CHANNEL_ID })
            },
        })

        await expect(
            publisher.createMessage({
                accessToken: BOT_TOKEN,
                channelId: 'not-a-snowflake',
                content: 'Hello',
                attachments: [],
            })
        ).resolves.toMatchObject({ type: 'permanent_failure', code: 'invalid_input' })
        expect(dispatched).toBe(false)
    })
})

describe('rogue-instance diagnostic echo (AUDIT-307)', () => {
    const fictitiousSpecialToken = 'audit test/token echo'

    function echoPublisher(echo: string) {
        const fixture = createFetcher([jsonResponse({ message: echo }, 500)])
        return createDiscordPublisher({
            baseUrl: 'https://discord.test',
            fetcher: fixture.fetcher,
        })
    }

    async function createMessage(
        publisher: ReturnType<typeof createDiscordPublisher>,
        accessToken: string
    ) {
        return publisher.createMessage({
            accessToken,
            channelId: CHANNEL_ID,
            content: 'Hello',
            attachments: [],
        })
    }

    it('redacts a raw echoed Bot token while keeping the classification', async () => {
        const outcome = await createMessage(
            echoPublisher(`upstream exploded; request carried Authorization: Bot ${BOT_TOKEN}`),
            BOT_TOKEN
        )

        expect(outcome).toEqual({
            type: 'ambiguous',
            code: 'provider_failure',
            errorMessage: 'upstream exploded; request carried Authorization: Bot [redacted]',
        })
        expect(JSON.stringify(outcome)).not.toContain(BOT_TOKEN)
    })

    it('redacts a URL-encoded echoed access token', async () => {
        const outcome = await createMessage(
            echoPublisher(
                `upstream exploded; request carried ${encodeURIComponent(fictitiousSpecialToken)}`
            ),
            fictitiousSpecialToken
        )

        expect(outcome.type).toBe('ambiguous')
        if (outcome.type !== 'ambiguous') return
        expect(outcome.errorMessage).not.toContain(fictitiousSpecialToken)
        expect(outcome.errorMessage).not.toContain(encodeURIComponent(fictitiousSpecialToken))
        expect(outcome.errorMessage).toContain('[redacted]')
    })

    it('redacts every occurrence of an echoed access token', async () => {
        const outcome = await createMessage(
            echoPublisher(
                `first ${fictitiousSpecialToken} then ${encodeURIComponent(fictitiousSpecialToken)} again ${fictitiousSpecialToken}`
            ),
            fictitiousSpecialToken
        )

        expect(outcome.type).toBe('ambiguous')
        if (outcome.type !== 'ambiguous') return
        expect(outcome.errorMessage).not.toContain(fictitiousSpecialToken)
        expect(outcome.errorMessage).toBe('first [redacted] then [redacted] again [redacted]')
    })

    it('redacts a token straddling the message length limit instead of truncating it', async () => {
        const filler = `${'overflow '.repeat(54)}pad `
        const outcome = await createMessage(echoPublisher(`${filler}${BOT_TOKEN} tail`), BOT_TOKEN)

        expect(filler.length + BOT_TOKEN.length).toBeGreaterThan(500)
        expect(outcome.type).toBe('ambiguous')
        if (outcome.type !== 'ambiguous') return
        expect(outcome.errorMessage).toContain('[redacted]')
        expect(outcome.errorMessage).not.toContain(BOT_TOKEN)
        expect(outcome.errorMessage).not.toContain(BOT_TOKEN.slice(0, 12))
        expect(JSON.stringify(outcome)).not.toContain(BOT_TOKEN)
    })

    it('keeps an ordinary remote diagnostic useful', async () => {
        const outcome = await createMessage(echoPublisher('Server error'), BOT_TOKEN)

        expect(outcome).toEqual({
            type: 'ambiguous',
            code: 'provider_failure',
            errorMessage: 'Server error',
        })
    })
})

describe('native MP4 messages', () => {
    it('uploads exact video bytes, description and safe mentions in the existing multipart message', async () => {
        const fixture = createFetcher([
            jsonResponse({
                id: '333333333333333333',
                channel_id: CHANNEL_ID,
                attachments: [{ id: '444444444444444444' }],
            }),
        ])
        const publisher = createDiscordPublisher({
            baseUrl: 'https://discord.test',
            fetcher: fixture.fetcher,
        })
        const outcome = await publisher.createMessage({
            accessToken: BOT_TOKEN,
            channelId: CHANNEL_ID,
            content: 'Video',
            attachments: [
                {
                    filename: 'scene.mp4',
                    contentType: 'video/mp4',
                    description: 'Moving scene',
                    stream: attachmentStream([4, 5, 6]),
                },
            ],
        })
        expect(outcome).toMatchObject({ type: 'published', attachmentIds: ['444444444444444444'] })
        const form = fixture.calls[0]!.init!.body as FormData
        const file = form.get('files[0]') as File
        expect(file.type).toBe('video/mp4')
        expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([4, 5, 6]))
        expect(JSON.parse(String(form.get('payload_json')))).toEqual({
            content: 'Video',
            allowed_mentions: { parse: [] },
            attachments: [{ id: 0, filename: 'scene.mp4', description: 'Moving scene' }],
        })
    })
    it('rejects oversized and mixed video input before sending a message', async () => {
        const fixture = createFetcher([])
        const publisher = createDiscordPublisher({
            baseUrl: 'https://discord.test',
            fetcher: fixture.fetcher,
        })
        const attachment = {
            filename: 'scene.mp4',
            contentType: 'video/mp4' as const,
            description: 'Moving scene',
            stream: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]).stream(),
        }
        expect(
            await publisher.createMessage({
                accessToken: BOT_TOKEN,
                channelId: CHANNEL_ID,
                content: 'Video',
                attachments: [attachment],
            })
        ).toMatchObject({ type: 'permanent_failure', code: 'invalid_input' })
        expect(
            await publisher.createMessage({
                accessToken: BOT_TOKEN,
                channelId: CHANNEL_ID,
                content: 'Video',
                attachments: [
                    { ...attachment, stream: attachmentStream() },
                    {
                        filename: 'image.png',
                        contentType: 'image/png',
                        description: 'Image',
                        stream: attachmentStream(),
                    },
                ],
            })
        ).toMatchObject({ type: 'permanent_failure', code: 'invalid_input' })
        expect(fixture.calls).toHaveLength(0)
    })
})

it('reports an oversized request rejection as permanent without echoing the Bot token', async () => {
    const publisher = createDiscordPublisher({
        baseUrl: 'https://discord.test',
        fetcher: async () =>
            Response.json(
                { message: `Payload too large ${BOT_TOKEN}`, code: 40005 },
                { status: 413 }
            ),
    })
    const outcome = await publisher.createMessage({
        accessToken: BOT_TOKEN,
        channelId: CHANNEL_ID,
        content: 'Video',
        attachments: [
            {
                filename: 'scene.mp4',
                contentType: 'video/mp4',
                description: 'Scene',
                stream: attachmentStream(),
            },
        ],
    })
    expect(outcome).toMatchObject({
        type: 'permanent_failure',
        code: 'invalid_request',
        effectOccurred: false,
    })
    expect(JSON.stringify(outcome)).not.toContain(BOT_TOKEN)
})
