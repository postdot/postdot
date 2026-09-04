import { describe, expect, it } from 'bun:test'

import { createApp, createPublisherRuntime } from '@herald/api'
import { createAuth } from '@herald/auth'
import { closeDatabase, createDatabase, runMigrations } from '@herald/db'

import { createHeraldClient } from './index'

describe('Herald client', () => {
    it('exposes the typed project route tree', () => {
        const client = createHeraldClient('http://localhost:3000', {
            cookie: 'herald_session=test',
        })

        expect(client.api.projects.get).toBeFunction()
        expect(client.api.projects.post).toBeFunction()
        expect(client.api.projects({ projectId: 'project-1' }).patch).toBeFunction()
        expect(client.api.projects({ projectId: 'project-1' }).publishers.get).toBeFunction()
        expect(client.api.projects({ projectId: 'project-1' }).channels.get).toBeFunction()
        expect(client.api.projects({ projectId: 'project-1' }).media.get).toBeFunction()
        expect(client.api.projects({ projectId: 'project-1' }).media.uploads.post).toBeFunction()
        expect(
            client.api.projects({ projectId: 'project-1' }).media.uploads({ intentId: 'intent-1' })
                .finalize.post
        ).toBeFunction()
        expect(
            client.api.projects({ projectId: 'project-1' }).channels({ channelId: 'channel-1' })
                .publisher.delete
        ).toBeFunction()
        expect(
            client.api.projects({ projectId: 'project-1' }).channels({ channelId: 'channel-1' })
                .publisher.linkedin.connect.post
        ).toBeFunction()
        expect(
            client.api
                .projects({ projectId: 'project-1' })
                .publications({ publicationId: 'publication-1' }).publish.post
        ).toBeFunction()
    })

    it('calls typed routes through a custom fetcher', async () => {
        const database = createDatabase(':memory:')
        runMigrations(database)
        const publisher = createPublisherRuntime(database, {
            apiOrigin: 'http://localhost:3000',
            webOrigin: 'http://localhost:5173',
            publisherEncryptionKey: new Uint8Array(32).fill(7),
            publisherEncryptionKeyId: 'test-v1',
        })
        const app = createApp({
            auth: createAuth(database, {
                baseURL: 'http://localhost:3000',
                secret: 'herald-test-secret-with-at-least-32-characters',
            }),
            database,
            publisher,
        })

        try {
            const signUpResponse = await app.handle(
                new Request('http://localhost:3000/api/auth/sign-up/email', {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        origin: 'http://localhost:3000',
                    },
                    body: JSON.stringify({
                        email: 'client@herald.local',
                        name: 'Herald Client',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )
            const cookie = signUpResponse.headers.get('set-cookie')?.split(';', 1)[0]
            expect(cookie).toBeDefined()

            const client = createHeraldClient('http://localhost:3000', {
                cookie,
                fetcher: (input, init) => {
                    const url =
                        typeof input === 'string'
                            ? input
                            : input instanceof URL
                              ? input.href
                              : input.url
                    return app.handle(new Request(url, init))
                },
            })
            const response = await client.api.projects.get()

            expect(response.error).toBeNull()
            expect(response.data).toEqual({ projects: [] })
        } finally {
            closeDatabase(database)
        }
    })
})
