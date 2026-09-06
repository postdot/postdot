import { describe, expect, it } from 'bun:test'

import { createAuth } from '@herald/auth'
import {
    closeDatabase,
    createDatabase,
    createNotificationStore,
    createProjectAccessTokenStore,
    runMigrations,
} from '@herald/db'
import type { DiscordFetcher } from '@herald/discord'

import { createApp } from '../../../app'
import { createPublisherRuntime } from '../../publishers/runtime'

const baseURL = 'http://localhost:3000'
const secret = 'herald-test-secret-with-at-least-32-characters'
const now = 1_800_000_000_000
const publisherEncryptionKey = new Uint8Array(32).fill(7)
const botToken = 'discord-test-bot-token-with-at-least-32-characters'
const channelId = '123456789012345678'

function jsonResponse(value: unknown, status = 200): Response {
    return Response.json(value, { status })
}

function createDiscordFetcher(responses: readonly Response[]): {
    readonly fetcher: DiscordFetcher
    readonly calls: number
} {
    let calls = 0
    let index = 0
    const fetcher: DiscordFetcher = async () => {
        calls += 1
        const response = responses[index]
        index += 1
        if (response === undefined) throw new Error('Unexpected Discord request')
        return response
    }
    return {
        fetcher,
        get calls() {
            return calls
        },
    }
}

function botUserResponse(): Response {
    return jsonResponse({ id: '987654321098765432', username: 'Herald' })
}

function channelResponse(type = 0): Response {
    return jsonResponse({ id: channelId, name: 'announcements', type })
}

function createFixture(discordFetcher?: DiscordFetcher) {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const publisher = createPublisherRuntime(database, {
        apiOrigin: baseURL,
        webOrigin: 'http://localhost:5173',
        publisherEncryptionKey,
        publisherEncryptionKeyId: 'test-v1',
    })
    const auth = createAuth(database, { baseURL, secret })
    const accessTokens = createProjectAccessTokenStore(database, { now: () => now })
    const notifications = createNotificationStore(database, { now: () => now + 1_000 })
    const app = createApp({
        auth,
        database,
        publisher,
        manualStore: { now: () => now },
        accessTokens,
        notifications,
        ...(discordFetcher === undefined ? {} : { discordFetcher }),
    })
    return { app, database }
}

async function signUp(app: ReturnType<typeof createApp>, email: string) {
    const response = await app.handle(
        new Request(`${baseURL}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: baseURL },
            body: JSON.stringify({
                email,
                name: 'Herald Operator',
                password: 'correct-horse-battery-staple',
            }),
        })
    )
    const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
    expect(response.status).toBe(200)
    expect(cookie).toBeDefined()
    return cookie ?? ''
}

async function jsonRequest(
    app: ReturnType<typeof createApp>,
    path: string,
    cookie: string,
    init: RequestInit = {}
) {
    const headers = new Headers(init.headers)
    if (cookie.length > 0) headers.set('cookie', cookie)
    if (init.body !== undefined) headers.set('content-type', 'application/json')
    return app.handle(new Request(`${baseURL}${path}`, { ...init, headers }))
}

async function createDiscordChannel(
    app: ReturnType<typeof createApp>,
    cookie: string,
    projectName: string
): Promise<{ readonly projectId: string; readonly channelId: string }> {
    const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
        method: 'POST',
        body: JSON.stringify({ name: projectName }),
    })
    expect(projectResponse.status).toBe(201)
    const projectBody = (await projectResponse.json()) as { project: { id: string } }
    const channelResponse = await jsonRequest(
        app,
        `/api/projects/${projectBody.project.id}/channels`,
        cookie,
        {
            method: 'POST',
            body: JSON.stringify({ name: 'Announcements', profile: 'discord' }),
        }
    )
    expect(channelResponse.status).toBe(201)
    const channelBody = (await channelResponse.json()) as {
        channel: { id: string; profileId: string }
    }
    expect(channelBody.channel.profileId).toBe('discord')
    return { projectId: projectBody.project.id, channelId: channelBody.channel.id }
}

async function connectDiscord(
    app: ReturnType<typeof createApp>,
    cookie: string,
    projectId: string,
    heraldChannelId: string,
    body: unknown
) {
    return jsonRequest(
        app,
        `/api/projects/${projectId}/channels/${heraldChannelId}/publisher/discord/connect`,
        cookie,
        { method: 'POST', body: JSON.stringify(body) }
    )
}

describe('Discord publisher connection routes', () => {
    it('creates a connection and never exposes the Bot token', async () => {
        const discord = createDiscordFetcher([botUserResponse(), channelResponse()])
        const { app, database } = createFixture(discord.fetcher)

        try {
            const cookie = await signUp(app, 'discord-operator@herald.local')
            const { projectId, channelId: heraldChannelId } = await createDiscordChannel(
                app,
                cookie,
                'Discord project'
            )
            const response = await connectDiscord(app, cookie, projectId, heraldChannelId, {
                botToken,
                channelId,
            })

            expect(response.status).toBe(200)
            const body = (await response.json()) as {
                connection: Record<string, unknown>
            }
            expect(body.connection).toMatchObject({
                kind: 'discord',
                providerId: 'discord',
                externalAccountId: '987654321098765432',
                destination: { type: 'channel', id: channelId, name: 'announcements' },
            })
            expect(JSON.stringify(body)).not.toContain(botToken)

            const listed = await jsonRequest(app, `/api/projects/${projectId}/publishers`, cookie)
            expect(listed.status).toBe(200)
            expect(JSON.stringify(await listed.json())).not.toContain(botToken)

            const duplicate = await connectDiscord(app, cookie, projectId, heraldChannelId, {
                botToken,
                channelId,
            })
            expect(duplicate.status).toBe(409)
            expect(discord.calls).toBe(2)
        } finally {
            closeDatabase(database)
        }
    })

    it('rejects an unverifiable Bot token', async () => {
        const discord = createDiscordFetcher([
            jsonResponse({ message: 'Unauthorized', code: 0 }, 401),
        ])
        const { app, database } = createFixture(discord.fetcher)

        try {
            const cookie = await signUp(app, 'discord-invalid-token@herald.local')
            const { projectId, channelId: heraldChannelId } = await createDiscordChannel(
                app,
                cookie,
                'Discord invalid token project'
            )
            const response = await connectDiscord(app, cookie, projectId, heraldChannelId, {
                botToken,
                channelId,
            })

            expect(response.status).toBe(400)
            expect(await response.json()).toMatchObject({
                error: { code: 'invalid_token' },
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('rejects unknown Discord channels', async () => {
        const discord = createDiscordFetcher([
            botUserResponse(),
            jsonResponse({ message: 'Unknown Channel', code: 10003 }, 404),
        ])
        const { app, database } = createFixture(discord.fetcher)

        try {
            const cookie = await signUp(app, 'discord-unknown-channel@herald.local')
            const { projectId, channelId: heraldChannelId } = await createDiscordChannel(
                app,
                cookie,
                'Discord unknown channel project'
            )
            const response = await connectDiscord(app, cookie, projectId, heraldChannelId, {
                botToken,
                channelId,
            })

            expect(response.status).toBe(400)
            expect(await response.json()).toMatchObject({
                error: { code: 'unknown_channel' },
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('rejects unsupported channel types', async () => {
        const discord = createDiscordFetcher([botUserResponse(), channelResponse(2)])
        const { app, database } = createFixture(discord.fetcher)

        try {
            const cookie = await signUp(app, 'discord-voice-channel@herald.local')
            const { projectId, channelId: heraldChannelId } = await createDiscordChannel(
                app,
                cookie,
                'Discord voice channel project'
            )
            const response = await connectDiscord(app, cookie, projectId, heraldChannelId, {
                botToken,
                channelId,
            })

            expect(response.status).toBe(400)
            expect(await response.json()).toMatchObject({
                error: { code: 'unsupported_channel' },
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('rejects malformed channel IDs without calling Discord', async () => {
        const discord = createDiscordFetcher([])
        const { app, database } = createFixture(discord.fetcher)

        try {
            const cookie = await signUp(app, 'discord-malformed-channel@herald.local')
            const { projectId, channelId: heraldChannelId } = await createDiscordChannel(
                app,
                cookie,
                'Discord malformed channel project'
            )
            const response = await connectDiscord(app, cookie, projectId, heraldChannelId, {
                botToken,
                channelId: 'not-a-snowflake',
            })

            expect(response.status).toBe(422)
            expect(discord.calls).toBe(0)
        } finally {
            closeDatabase(database)
        }
    })

    it('requires human session authentication', async () => {
        const discord = createDiscordFetcher([])
        const { app, database } = createFixture(discord.fetcher)

        try {
            const cookie = await signUp(app, 'discord-auth-required@herald.local')
            const { projectId, channelId: heraldChannelId } = await createDiscordChannel(
                app,
                cookie,
                'Discord auth project'
            )
            const response = await connectDiscord(app, '', projectId, heraldChannelId, {
                botToken,
                channelId,
            })

            expect(response.status).toBe(401)
            expect(discord.calls).toBe(0)
        } finally {
            closeDatabase(database)
        }
    })
})
