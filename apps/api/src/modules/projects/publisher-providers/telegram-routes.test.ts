import { describe, expect, it } from 'bun:test'

import { createAuth } from '@postdot/auth'
import { closeDatabase, createDatabase, createNotificationStore, runMigrations } from '@postdot/db'
import type { TelegramFetcher } from '@postdot/telegram'

import { createApp } from '../../../app'
import { createPublisherRuntime } from '../../publishers/runtime'

const baseURL = 'http://localhost:3000'
const secret = 'postbot-test-secret-with-at-least-32-characters'
const now = 1_800_000_000_000
const publisherEncryptionKey = new Uint8Array(32).fill(7)
const botToken = '123456:synthetic-test-token'
const channelId = '-1001234567890'

function jsonResponse(value: unknown, status = 200): Response {
    return Response.json(value, { status })
}

function createTelegramFetcher(responses: readonly Response[]): {
    readonly fetcher: TelegramFetcher
    readonly calls: number
} {
    let calls = 0
    let index = 0
    const fetcher: TelegramFetcher = async () => {
        calls += 1
        const response = responses[index]
        index += 1
        if (response === undefined) throw new Error('Unexpected Telegram request')
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
    return jsonResponse({ ok: true, result: { id: 123456, is_bot: true, username: 'example_bot' } })
}
function channelResponse(): Response {
    return jsonResponse({
        ok: true,
        result: { id: Number(channelId), type: 'channel', title: 'Announcements' },
    })
}
function membershipResponse(): Response {
    return jsonResponse({
        ok: true,
        result: {
            user: { id: 123456, is_bot: true },
            status: 'administrator',
            can_post_messages: true,
        },
    })
}

function createFixture(telegramFetcher?: TelegramFetcher) {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const publisher = createPublisherRuntime(database, {
        apiOrigin: baseURL,
        webOrigin: 'http://localhost:5173',
        publisherEncryptionKey,
        publisherEncryptionKeyId: 'test-v1',
    })
    const auth = createAuth(database, { baseURL, secret })
    const notifications = createNotificationStore(database, { now: () => now + 1_000 })
    const app = createApp({
        auth,
        database,
        publisher,
        manualStore: { now: () => now },
        notifications,
        ...(telegramFetcher === undefined ? {} : { telegramFetcher }),
    })
    return { app, database, publisher }
}

async function signUp(app: ReturnType<typeof createApp>, email: string) {
    const response = await app.handle(
        new Request(`${baseURL}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: baseURL },
            body: JSON.stringify({
                email,
                name: 'Postdot Operator',
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

async function createTelegramChannel(
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
            body: JSON.stringify({ name: 'Announcements', profile: 'telegram' }),
        }
    )
    expect(channelResponse.status).toBe(201)
    const channelBody = (await channelResponse.json()) as {
        channel: { id: string; profileId: string }
    }
    expect(channelBody.channel.profileId).toBe('telegram')
    return { projectId: projectBody.project.id, channelId: channelBody.channel.id }
}

async function connectTelegram(
    app: ReturnType<typeof createApp>,
    cookie: string,
    projectId: string,
    postbotChannelId: string,
    body: unknown
) {
    return jsonRequest(
        app,
        `/api/projects/${projectId}/channels/${postbotChannelId}/publisher/telegram/connect`,
        cookie,
        { method: 'POST', body: JSON.stringify(body) }
    )
}

describe('Telegram publisher connection routes', () => {
    it('verifies and stores a project-owned encrypted token without publishing', async () => {
        const transport = createTelegramFetcher([
            botUserResponse(),
            channelResponse(),
            membershipResponse(),
        ])
        const { app, database, publisher } = createFixture(transport.fetcher)
        try {
            const cookie = await signUp(app, 'telegram@postbot.local')
            const { projectId, channelId: localId } = await createTelegramChannel(
                app,
                cookie,
                'Telegram project'
            )
            const response = await connectTelegram(app, cookie, projectId, localId, {
                botToken,
                chatReference: channelId,
            })
            expect(response.status, await response.clone().text()).toBe(200)
            const body = (await response.json()) as { connection: { credentialId: string } }
            expect(body.connection).toMatchObject({
                providerId: 'telegram',
                externalAccountId: '123456',
                destination: { type: 'channel', id: channelId, name: 'Announcements' },
            })
            expect(JSON.stringify(body)).not.toContain(botToken)
            expect(transport.calls).toBe(3)
            expect(
                await publisher.credentialStore.resolvePublisherCredentialSecrets(
                    projectId,
                    body.connection.credentialId
                )
            ).toMatchObject({ accessToken: botToken })
            const stored = database.$client.query('SELECT * FROM publisher_credentials').all()
            expect(stored).toHaveLength(1)
            expect(JSON.stringify(stored)).not.toContain(botToken)
            const list = await jsonRequest(app, `/api/projects/${projectId}/publishers`, cookie)
            expect(list.status).toBe(200)
            expect(JSON.stringify(await list.json())).not.toContain(botToken)
            const duplicate = await connectTelegram(app, cookie, projectId, localId, {
                botToken,
                chatReference: channelId,
            })
            expect(duplicate.status).toBe(409)
            expect(transport.calls).toBe(3)
        } finally {
            closeDatabase(database)
        }
    })
    it('reconnects a credential requiring attention only after a fresh verification', async () => {
        const transport = createTelegramFetcher([
            botUserResponse(),
            channelResponse(),
            membershipResponse(),
            botUserResponse(),
            channelResponse(),
            membershipResponse(),
        ])
        const { app, database, publisher } = createFixture(transport.fetcher)
        try {
            const cookie = await signUp(app, 'telegram-reconnect@postbot.local')
            const local = await createTelegramChannel(app, cookie, 'Reconnect')
            const first = await connectTelegram(app, cookie, local.projectId, local.channelId, {
                botToken,
                chatReference: channelId,
            })
            expect(first.status).toBe(200)
            const { connection } = (await first.json()) as { connection: { credentialId: string } }
            publisher.credentialStore.markPublisherCredentialReconnectRequired(
                local.projectId,
                connection.credentialId
            )
            const second = await connectTelegram(app, cookie, local.projectId, local.channelId, {
                botToken,
                chatReference: channelId,
            })
            expect(second.status).toBe(200)
            expect(await second.json()).toMatchObject({
                connection: { state: 'active', credentialId: connection.credentialId },
            })
            expect(transport.calls).toBe(6)
        } finally {
            closeDatabase(database)
        }
    })
    it('requires authentication and masks a channel from a different project before provider access', async () => {
        const transport = createTelegramFetcher([])
        const { app, database } = createFixture(transport.fetcher)
        try {
            const cookie = await signUp(app, 'telegram-access@postbot.local')
            const first = await createTelegramChannel(app, cookie, 'First')
            const second = await createTelegramChannel(app, cookie, 'Second')
            expect(
                (
                    await connectTelegram(app, '', first.projectId, first.channelId, {
                        botToken,
                        chatReference: channelId,
                    })
                ).status
            ).toBe(401)
            expect(
                (
                    await connectTelegram(app, cookie, first.projectId, second.channelId, {
                        botToken,
                        chatReference: channelId,
                    })
                ).status
            ).toBe(404)
            expect(transport.calls).toBe(0)
        } finally {
            closeDatabase(database)
        }
    })
    it('persists nothing after rejected permissions or provider unavailability', async () => {
        for (const [index, responses] of [
            [jsonResponse({ ok: false, error_code: 401, description: botToken }, 401)],
            [
                botUserResponse(),
                channelResponse(),
                jsonResponse({
                    ok: true,
                    result: { user: { id: 123456, is_bot: true }, status: 'left' },
                }),
            ],
            [jsonResponse({ ok: false, error_code: 500, description: botToken }, 500)],
        ].entries()) {
            const transport = createTelegramFetcher(responses)
            const { app, database } = createFixture(transport.fetcher)
            try {
                const cookie = await signUp(app, 'telegram-failure@postbot.local')
                const local = await createTelegramChannel(app, cookie, 'Failure')
                const response = await connectTelegram(
                    app,
                    cookie,
                    local.projectId,
                    local.channelId,
                    { botToken, chatReference: channelId }
                )
                expect(response.status).toBe(index === 0 ? 400 : index === 1 ? 403 : 503)
                expect(await response.text()).not.toContain(botToken)
                expect(
                    database.$client.query('SELECT * FROM publisher_credentials').all()
                ).toHaveLength(0)
                expect(database.$client.query('SELECT * FROM publishers').all()).toHaveLength(0)
            } finally {
                closeDatabase(database)
            }
        }
    })
})
