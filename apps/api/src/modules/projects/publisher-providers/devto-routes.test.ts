import { describe, expect, it } from 'bun:test'

import { createAuth } from '@herald/auth'
import { closeDatabase, createDatabase, createNotificationStore, runMigrations } from '@herald/db'
import type { DevtoFetcher } from '@herald/devto'

import { createApp } from '../../../app'
import { createPublisherRuntime } from '../../publishers/runtime'

const baseURL = 'http://localhost:3000'
const secret = 'herald-test-secret-with-at-least-32-characters'
const now = 1_800_000_000_000
const publisherEncryptionKey = new Uint8Array(32).fill(7)
const apiKey = 'devto-test-api-key-that-must-not-leak'

function jsonResponse(value: unknown, status = 200): Response {
    return Response.json(value, { status })
}

function createDevtoFetcher(responses: readonly Response[]): {
    readonly fetcher: DevtoFetcher
    readonly calls: Array<{ readonly input: string | URL | Request; readonly init?: RequestInit }>
} {
    const calls: Array<{ readonly input: string | URL | Request; readonly init?: RequestInit }> = []
    let index = 0
    const fetcher: DevtoFetcher = async (input, init) => {
        calls.push({ input, init })
        const response = responses[index]
        index += 1
        if (response === undefined) throw new Error('Unexpected DEV.to request')
        return response
    }
    return { fetcher, calls }
}

function createFixture(devtoFetcher?: DevtoFetcher) {
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
        ...(devtoFetcher === undefined ? {} : { devtoFetcher }),
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

async function createDevtoChannel(app: ReturnType<typeof createApp>, cookie: string) {
    const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
        method: 'POST',
        body: JSON.stringify({ name: 'DEV.to project' }),
    })
    expect(projectResponse.status).toBe(201)
    const projectBody = (await projectResponse.json()) as { project: { id: string } }
    const channelResponse = await jsonRequest(
        app,
        `/api/projects/${projectBody.project.id}/channels`,
        cookie,
        {
            method: 'POST',
            body: JSON.stringify({ name: 'Articles', profile: 'devto' }),
        }
    )
    expect(channelResponse.status).toBe(201)
    const channelBody = (await channelResponse.json()) as {
        channel: { id: string; profileId: string }
    }
    expect(channelBody.channel.profileId).toBe('devto')
    return { projectId: projectBody.project.id, channelId: channelBody.channel.id }
}

describe('DEV.to publisher connection routes', () => {
    it('verifies and stores a project-owned API key without exposing it', async () => {
        const devto = createDevtoFetcher([
            jsonResponse({ id: 42, username: 'herald', name: 'Herald' }),
        ])
        const { app, database } = createFixture(devto.fetcher)

        try {
            const cookie = await signUp(app, 'devto-operator@herald.local')
            const { projectId, channelId } = await createDevtoChannel(app, cookie)
            const response = await jsonRequest(
                app,
                `/api/projects/${projectId}/channels/${channelId}/publisher/devto/connect`,
                cookie,
                { method: 'POST', body: JSON.stringify({ apiKey }) }
            )

            expect(response.status).toBe(200)
            const body = (await response.json()) as { connection: Record<string, unknown> }
            expect(body.connection).toMatchObject({
                kind: 'devto',
                providerId: 'devto',
                externalAccountId: '42',
                destination: { type: 'account', id: '42', name: 'Herald' },
            })
            expect(JSON.stringify(body)).not.toContain(apiKey)

            const headers = new Headers(devto.calls[0]?.init?.headers)
            expect(headers.get('api-key')).toBe(apiKey)
        } finally {
            closeDatabase(database)
        }
    })

    it('rejects an invalid API key without creating a credential', async () => {
        const devto = createDevtoFetcher([jsonResponse({ error: 'unauthorized' }, 401)])
        const { app, database } = createFixture(devto.fetcher)

        try {
            const cookie = await signUp(app, 'devto-invalid@herald.local')
            const { projectId, channelId } = await createDevtoChannel(app, cookie)
            const response = await jsonRequest(
                app,
                `/api/projects/${projectId}/channels/${channelId}/publisher/devto/connect`,
                cookie,
                { method: 'POST', body: JSON.stringify({ apiKey }) }
            )

            expect(response.status).toBe(400)
            expect(await response.json()).toMatchObject({ error: { code: 'invalid_api_key' } })
        } finally {
            closeDatabase(database)
        }
    })

    it('requires a human session to connect DEV.to', async () => {
        const { app, database } = createFixture()

        try {
            const response = await jsonRequest(
                app,
                '/api/projects/project/channels/channel/publisher/devto/connect',
                '',
                { method: 'POST', body: JSON.stringify({ apiKey }) }
            )
            expect(response.status).toBe(401)
        } finally {
            closeDatabase(database)
        }
    })
})
