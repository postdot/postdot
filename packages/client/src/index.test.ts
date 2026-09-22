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
        expect(client.api['api-keys'].get).toBeFunction()
        expect(client.api['api-keys'].post).toBeFunction()
        expect(client.api.projects({ projectId: 'project-1' }).publishers.get).toBeFunction()
        expect(client.api.projects({ projectId: 'project-1' }).channels.get).toBeFunction()
        expect(client.api.projects({ projectId: 'project-1' }).notifications.get).toBeFunction()
        expect(
            client.api.projects({ projectId: 'project-1' }).analytics.provider.bluesky.get
        ).toBeFunction()
        expect(
            client.api.projects({ projectId: 'project-1' }).analytics.provider.bluesky.collect.post
        ).toBeFunction()
        expect(
            client.api.projects({ projectId: 'project-1' }).notifications({
                notificationId: 'notification-1',
            }).read.post
        ).toBeFunction()
        expect(
            client.api.projects({ projectId: 'project-1' }).notifications({
                notificationId: 'notification-1',
            }).archive.post
        ).toBeFunction()
        expect(
            client.api.projects({ projectId: 'project-1' })['notification-preferences'].get
        ).toBeFunction()
        expect(
            client.api.projects({ projectId: 'project-1' })['notification-preferences']({
                kind: 'publication_failed',
            }).patch
        ).toBeFunction()
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

            const createdProject = await client.api.projects.post({ name: 'Machine access' })
            expect(createdProject.error).toBeNull()
            const projectId = (createdProject.data as { project: { id: string } }).project.id
            const createdToken = await client.api['api-keys'].post({
                name: 'Client test key',
                projectIds: [projectId],
            })
            expect(createdToken.error).toBeNull()
            const token = (createdToken.data as { token: string }).token

            const machineClient = createHeraldClient('http://localhost:3000', {
                token,
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
            const machineProjects = await machineClient.api.projects.get()
            expect(machineProjects.error).toBeNull()
            expect(machineProjects.data).toEqual({
                projects: [expect.objectContaining({ id: projectId })],
            })

            const filteredPublications = await machineClient.api
                .projects({ projectId })
                .publications.get({ query: { tagIds: 'missing-a,missing-b' } })
            expect(filteredPublications.error).toBeNull()
            expect(filteredPublications.data).toEqual({
                publications: [],
                nextCursor: null,
                summary: { total: 0, manual: 0, automatic: 0, scheduled: 0, draft: 0 },
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('sends a user API key through the typed client', async () => {
        let authorization: string | null = null
        const client = createHeraldClient('http://localhost:3000', {
            token: 'herald_pat_test-token',
            fetcher: async (input, init) => {
                const request =
                    typeof input === 'string'
                        ? new Request(input, init)
                        : input instanceof URL
                          ? new Request(input.href, init)
                          : new Request(input.url, init)
                authorization = request.headers.get('authorization')
                return Response.json({ projects: [] })
            },
        })

        const response = await client.api.projects.get()

        expect(response.error).toBeNull()
        expect(authorization === 'Bearer herald_pat_test-token').toBe(true)
    })
})
