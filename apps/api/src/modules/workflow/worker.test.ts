import { describe, expect, it } from 'bun:test'

import { createAuth } from '@herald/auth'
import {
    closeDatabase,
    createDatabase,
    createManualStore,
    createPublisherStore,
    runMigrations,
} from '@herald/db'
import { account, publications, user as authUser } from '@herald/db/schema'
import { createLinkedInTextPublisher } from '@herald/linkedin'
import { eq } from 'drizzle-orm'

import { createPublicationWorker } from './worker'

const baseURL = 'http://localhost:3000'
const secret = 'herald-test-secret-with-at-least-32-characters'
const now = 1_800_000_000_000

describe('publication worker', () => {
    it('executes scheduled LinkedIn publications through Better Auth and persists outcomes', async () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            database
                .insert(authUser)
                .values({
                    id: 'user-1',
                    name: 'Herald Operator',
                    email: 'operator@herald.local',
                    updatedAt: new Date(now),
                })
                .run()
            database
                .insert(account)
                .values({
                    id: 'account-1',
                    issuer: 'https://www.linkedin.com',
                    accountId: 'member-42',
                    providerId: 'linkedin',
                    userId: 'user-1',
                    accessToken: 'linkedin-access-token',
                    scope: 'openid,profile,w_member_social',
                    updatedAt: new Date(now),
                })
                .run()

            const manualStore = createManualStore(database, { now: () => now })
            const publisherStore = createPublisherStore(database, { now: () => now })
            const project = manualStore.createProject({
                name: 'LinkedIn Worker Project',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            const channel = manualStore.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'LinkedIn Member',
            })
            expect(channel).not.toBeNull()
            if (channel === null) throw new Error('The test channel was not created')

            expect(
                publisherStore.createPublisherConnection({
                    projectId: project.project.id,
                    channelId: channel.id,
                    subjectId: 'user-1',
                    kind: 'linkedin',
                    accountId: 'account-1',
                    requiredScopes: ['w_member_social'],
                }).kind
            ).toBe('created')

            const first = manualStore.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                content: 'First LinkedIn publication',
                publications: [{ channelId: channel.id, scheduledAt: now }],
            })
            const second = createPostAt(manualStore, project.project.id, channel.id, now + 1)
            const third = createPostAt(manualStore, project.project.id, channel.id, now + 2)
            expect(first).not.toBeNull()
            expect(second).not.toBeNull()
            expect(third).not.toBeNull()

            const responses = [
                new Response(null, {
                    status: 201,
                    headers: { 'x-restli-id': 'urn:li:post:published' },
                }),
                new Response(JSON.stringify({ message: 'slow down' }), {
                    status: 429,
                    headers: { 'content-type': 'application/json' },
                }),
                new Response(JSON.stringify({ message: 'upstream failure' }), {
                    status: 503,
                    headers: { 'content-type': 'application/json' },
                }),
            ]
            const requests: Array<{ readonly headers: Headers; readonly body: string }> = []
            const publisher = createLinkedInTextPublisher({
                baseUrl: 'https://linkedin.test',
                fetcher: async (input, init) => {
                    requests.push({
                        headers: new Headers(init?.headers),
                        body: typeof init?.body === 'string' ? init.body : '',
                    })
                    const response = responses.shift()
                    if (response === undefined) throw new Error('The test response queue is empty')
                    return response
                },
            })
            const auth = createAuth(database, {
                baseURL,
                secret,
                linkedin: {
                    clientId: 'linkedin-client-id',
                    clientSecret: 'linkedin-client-secret',
                },
            })
            const worker = createPublicationWorker({
                auth,
                database,
                now: () => now + 2,
                linkedInPublisher: publisher,
                createClaimToken: (() => {
                    let sequence = 0
                    return () => `worker-claim-${++sequence}`
                })(),
                retryPolicy: {
                    nextRunAt: ({ attempts, failedAt }) =>
                        attempts === 1 ? failedAt + 60_000 : null,
                },
            })

            await worker.processDueEvents(now + 2)

            expect(requests).toHaveLength(3)
            expect(
                requests.every(
                    request =>
                        request.headers.get('authorization') === 'Bearer linkedin-access-token'
                )
            ).toBe(true)
            expect(JSON.parse(requests[0]?.body ?? '{}')).toMatchObject({
                author: 'urn:li:person:member-42',
                commentary: 'First LinkedIn publication',
            })

            const publicationRows = database
                .select({
                    state: publications.state,
                    externalId: publications.externalId,
                    errorMessage: publications.errorMessage,
                })
                .from(publications)
                .where(eq(publications.projectId, project.project.id))
                .all()
            expect(publicationRows).toContainEqual({
                state: 'published',
                externalId: 'urn:li:post:published',
                errorMessage: null,
            })
            expect(publicationRows.filter(row => row.state === 'ready')).toHaveLength(1)
            expect(publicationRows.filter(row => row.state === 'ambiguous')).toHaveLength(1)
            expect(
                publicationRows
                    .flatMap(row => row.errorMessage ?? [])
                    .join(' ')
                    .includes('linkedin-access-token')
            ).toBe(false)

            const jobRows = database.$client
                .query<{ state: string; runAt: number; errorMessage: string | null }, []>(`
                    select state, run_at as runAt, error_message as errorMessage
                    from jobs
                    order by run_at, id
                `)
                .all()
            expect(jobRows).toContainEqual({
                state: 'pending',
                runAt: now + 2 + 60_000,
                errorMessage: null,
            })
            expect(jobRows.filter(row => row.state === 'succeeded')).toHaveLength(1)
            expect(jobRows.filter(row => row.state === 'failed')).toHaveLength(1)
        } finally {
            closeDatabase(database)
        }
    })
})

function createPostAt(
    store: ReturnType<typeof createManualStore>,
    projectId: string,
    channelId: string,
    scheduledAt: number
) {
    return store.createPost({
        projectId,
        subjectId: 'user-1',
        content: `LinkedIn publication at ${scheduledAt}`,
        publications: [{ channelId, scheduledAt }],
    })
}
