import { describe, expect, it } from 'bun:test'

import { createAuth } from '@postbot/auth'
import {
    closeDatabase,
    createAccessStore,
    createDatabase,
    createManualStore,
    runMigrations,
} from '@postbot/db'
import { devtoChannelProfile } from '@postbot/devto'

import { createApp } from '../../app'
import { createPublisherRuntime } from '../publishers/runtime'

const baseURL = 'http://localhost:3000'
const secret = 'postbot-test-secret-with-at-least-32-characters'
const now = 1_800_000_000_000
const did = 'did:plc:api-analytics'
const postUri = 'at://' + did + '/app.bsky.feed.post/3api'
const devtoApiKey = 'devto-analytics-api-key-that-must-not-leak'

async function signUp(app: ReturnType<typeof createApp>, email: string) {
    const response = await app.handle(
        new Request(baseURL + '/api/auth/sign-up/email', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                origin: baseURL,
            },
            body: JSON.stringify({
                email,
                name: 'Analytics operator',
                password: 'correct-horse-battery-staple',
            }),
        })
    )
    expect(response.status).toBe(200)
    return response.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
}

async function request(
    app: ReturnType<typeof createApp>,
    path: string,
    cookie: string,
    init: RequestInit = {}
) {
    const headers = new Headers(init.headers)
    headers.set('cookie', cookie)
    if (init.body !== undefined) headers.set('content-type', 'application/json')
    return app.handle(
        new Request(baseURL + path, {
            ...init,
            headers,
        })
    )
}

describe('provider analytics routes', () => {
    it('collects known Bluesky publications, persists them, and never calls the provider on read', async () => {
        const database = createDatabase(':memory:')
        let providerCalls = 0
        let devtoCalls = 0
        runMigrations(database)
        const auth = createAuth(database, { baseURL, secret })
        const publisher = createPublisherRuntime(database, {
            apiOrigin: baseURL,
            webOrigin: 'http://localhost:5173',
            publisherEncryptionKey: new Uint8Array(32).fill(4),
            publisherEncryptionKeyId: 'test-v1',
            bluesky: {
                clientMetadataUrl:
                    'https://postbot.example.test/oauth/bluesky/client-metadata.json',
                handleResolver: 'https://bsky.social',
            },
        })
        const app = createApp({
            auth,
            database,
            publisher,
            manualStore: { now: () => now },
            devtoFetcher: async (input, init) => {
                devtoCalls += 1
                expect(input.toString()).toBe(
                    'https://dev.to/api/analytics/totals?article_id=12345'
                )
                expect(new Headers(init?.headers).get('api-key')).toBe(devtoApiKey)
                return Response.json({
                    comments: { total: 0 },
                    reactions: { total: 7 },
                    page_views: { total: 125 },
                })
            },
            blueskyAnalyticsNow: () => now + 1_000,
            blueskyAnalyticsFetcher: async input => {
                providerCalls += 1
                const url = new URL(
                    typeof input === 'string'
                        ? input
                        : input instanceof URL
                          ? input.href
                          : input.url
                )
                if (url.pathname.endsWith('actor.getProfile')) {
                    return Response.json({
                        did,
                        handle: 'api.analytics.test',
                        indexedAt: '2026-09-08T10:00:00.000Z',
                        followersCount: 3,
                        followsCount: 2,
                        postsCount: 1,
                    })
                }
                return Response.json({
                    posts: [
                        {
                            uri: postUri,
                            cid: 'bafy-api-cid',
                            author: { did, handle: 'api.analytics.test' },
                            record: { text: 'fixture' },
                            indexedAt: '2026-09-08T10:01:00.000Z',
                            likeCount: 1,
                            replyCount: 0,
                            repostCount: 2,
                            quoteCount: 0,
                            bookmarkCount: 4,
                        },
                    ],
                })
            },
        })

        try {
            const cookie = await signUp(app, 'provider-analytics@postbot.local')
            const user = database.$client
                .query<{ id: string }, [string]>('select id from user where email = ?1')
                .get('provider-analytics@postbot.local')
            if (user === null || user === undefined) throw new Error('The auth user is missing')

            const manual = createManualStore(database, { now: () => now })
            const access = createAccessStore(database, { now: () => now })
            const workspace = access.getDefaultWorkspaceForUser(user.id)
            if (workspace === null) throw new Error('The analytics workspace is missing')
            const project = manual.createProject({
                name: 'Provider analytics',
                subjectId: user.id,
                displayName: 'Analytics operator',
                workspaceId: workspace.id,
            })
            access.ensureProjectOwnerMembership({
                projectId: project.project.id,
                userId: user.id,
            })
            const channel = manual.createChannel({
                projectId: project.project.id,
                subjectId: user.id,
                name: 'Bluesky channel',
            })
            if (channel === null) throw new Error('The analytics channel is missing')
            const created = manual.createPost({
                projectId: project.project.id,
                subjectId: user.id,
                sourceContent: {
                    body: { text: 'Already published to Bluesky', format: 'plain_text' },
                    media: [],
                },
                publications: [{ channelId: channel.id }],
            })
            if (created === null) throw new Error('The analytics publication is missing')
            const publicationId = created.publications[0]?.id
            if (publicationId === undefined) throw new Error('The publication ID is missing')
            const actor = database.$client
                .query<{ id: string }, [string, string]>(
                    'select id from actors where project_id = ?1 and subject_id = ?2 limit 1'
                )
                .get(project.project.id, user.id)
            if (actor === null || actor === undefined)
                throw new Error('The project actor is missing')

            database.$client
                .query(
                    'insert into publisher_credentials ' +
                        '(id, project_id, provider_id, external_account_id, external_account_name, scopes, state, connected_by_actor_id, revision, created_at, updated_at) ' +
                        "values (?1, ?2, 'bluesky', ?3, ?4, ?5, 'revoked', ?6, 1, ?7, ?7)"
                )
                .run(
                    'credential-1',
                    project.project.id,
                    did,
                    'api.analytics.test',
                    JSON.stringify(['atproto']),
                    actor.id,
                    now
                )
            database.$client
                .query(
                    'insert into publishers (id, project_id, channel_id, kind, created_at, updated_at) ' +
                        "values (?1, ?2, ?3, 'bluesky', ?4, ?4)"
                )
                .run('publisher-1', project.project.id, channel.id, now)
            database.$client
                .query(
                    'insert into publisher_connections ' +
                        '(id, project_id, publisher_id, credential_id, destination_type, destination_id, destination_name, connected_by_actor_id, created_at, updated_at) ' +
                        "values (?1, ?2, ?3, ?4, 'account', ?5, ?6, ?7, ?8, ?8)"
                )
                .run(
                    'connection-1',
                    project.project.id,
                    'publisher-1',
                    'credential-1',
                    did,
                    'api.analytics.test',
                    actor.id,
                    now
                )
            database.$client
                .query('update publications set external_id = ?1 where id = ?2')
                .run(postUri, publicationId)

            const collectResponse = await request(
                app,
                '/api/projects/' + project.project.id + '/analytics/provider/bluesky/collect',
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ channelId: channel.id }),
                }
            )
            expect(collectResponse.status).toBe(200)
            const collection = (await collectResponse.json()) as {
                inserted: number
                duplicates: number
                coverage: Record<string, unknown>
                observations: Array<Record<string, unknown>>
            }
            expect(collection).toMatchObject({ inserted: 8, duplicates: 0 })
            expect(collection.coverage).toEqual({
                state: 'complete',
                complete: true,
                requestedAccountMetricCount: 3,
                measuredAccountMetricCount: 3,
                requestedContentCount: 1,
                returnedContentCount: 1,
                requestedContentMetricCount: 5,
                measuredContentMetricCount: 5,
                notReportedMetricCount: 0,
                unavailableMetricCount: 0,
                gaps: [],
            })
            expect(collection.observations).toHaveLength(8)
            expect(collection.observations).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        metricName: 'followersCount',
                        observedAt: Date.parse('2026-09-08T10:00:00.000Z'),
                    }),
                    expect.objectContaining({
                        metricName: 'likeCount',
                        observedAt: Date.parse('2026-09-08T10:01:00.000Z'),
                    }),
                ])
            )
            expect(providerCalls).toBe(2)
            expect(JSON.stringify(collection)).not.toContain('credential')
            expect(
                database.$client
                    .query<{ access_token_ciphertext: Uint8Array | null }, [string]>(
                        'select access_token_ciphertext from publisher_credentials where id = ?1'
                    )
                    .get('credential-1')?.access_token_ciphertext
            ).toBeNull()

            const readResponse = await request(
                app,
                '/api/projects/' + project.project.id + '/analytics/provider/bluesky',
                cookie
            )
            expect(readResponse.status).toBe(200)
            const read = (await readResponse.json()) as {
                observations: Array<Record<string, unknown>>
            }
            expect(read.observations).toHaveLength(8)
            expect(providerCalls).toBe(2)

            const repeatResponse = await request(
                app,
                '/api/projects/' + project.project.id + '/analytics/provider/bluesky/collect',
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ channelId: channel.id }),
                }
            )
            expect(repeatResponse.status).toBe(200)
            expect(await repeatResponse.json()).toMatchObject({
                inserted: 0,
                duplicates: 8,
            })
            expect(providerCalls).toBe(4)

            const devtoChannel = manual.createChannel({
                projectId: project.project.id,
                subjectId: user.id,
                name: 'DEV.to channel',
                profile: devtoChannelProfile,
            })
            if (devtoChannel === null) throw new Error('The DEV.to channel is missing')
            const devtoPublication = manual.createPost({
                projectId: project.project.id,
                subjectId: user.id,
                title: 'Already published to DEV.to',
                sourceContent: {
                    body: { text: 'Already published', format: 'markdown' },
                    media: [],
                },
                publications: [
                    {
                        channelId: devtoChannel.id,
                        targetContent: {
                            title: 'Already published to DEV.to',
                            body_markdown: 'Already published',
                            media: [],
                        },
                    },
                ],
            })
            if (devtoPublication === null) throw new Error('The DEV.to publication is missing')
            const devtoPublicationId = devtoPublication.publications[0]?.id
            if (devtoPublicationId === undefined)
                throw new Error('The DEV.to publication ID is missing')
            const savedCredential = await publisher.credentialStore.createPublisherCredential({
                projectId: project.project.id,
                connectedByActorId: actor.id,
                providerId: 'devto',
                externalAccountId: 'devto-account-123',
                externalAccountName: 'Analytics operator',
                scopes: [],
                accessToken: devtoApiKey,
                expiresAt: null,
            })
            expect(savedCredential.kind).toBe('created')
            if (savedCredential.kind !== 'created')
                throw new Error('The DEV.to credential was not saved')
            const devtoConnection = publisher.publisherStore.createPublisherConnection({
                projectId: project.project.id,
                channelId: devtoChannel.id,
                subjectId: user.id,
                kind: 'devto',
                credentialId: savedCredential.credential.id,
                destination: {
                    type: 'account',
                    id: 'devto-account-123',
                    name: 'Analytics operator',
                },
            })
            expect(devtoConnection.kind).toBe('created')
            if (devtoConnection.kind !== 'created')
                throw new Error('The DEV.to connection was not saved')
            database.$client
                .query('update publications set external_id = ?1 where id = ?2')
                .run('12345', devtoPublicationId)

            const devtoCollectResponse = await request(
                app,
                '/api/projects/' + project.project.id + '/analytics/provider/devto/collect',
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        channelId: devtoChannel.id,
                        publicationId: devtoPublicationId,
                    }),
                }
            )
            expect(devtoCollectResponse.status).toBe(200)
            const devtoCollection = (await devtoCollectResponse.json()) as {
                inserted: number
                observations: Array<Record<string, unknown>>
            }
            expect(devtoCollection.inserted).toBe(3)
            expect(devtoCollection.observations).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        metricName: 'comments',
                        value: 0,
                        availability: 'measured',
                        freshness: 'unknown',
                    }),
                    expect.objectContaining({ metricName: 'reactions', value: 7 }),
                    expect.objectContaining({ metricName: 'page_views', value: 125 }),
                ])
            )
            expect(JSON.stringify(devtoCollection)).not.toContain(devtoApiKey)
            expect(devtoCalls).toBe(1)

            const devtoReadResponse = await request(
                app,
                '/api/projects/' +
                    project.project.id +
                    '/analytics/provider/devto?postbotEntityId=' +
                    devtoPublicationId,
                cookie
            )
            expect(devtoReadResponse.status).toBe(200)
            expect(
                ((await devtoReadResponse.json()) as { observations: unknown[] }).observations
            ).toHaveLength(3)
            expect(devtoCalls).toBe(1)

            const operationalResponse = await request(
                app,
                '/api/projects/' + project.project.id + '/analytics',
                cookie
            )
            expect(operationalResponse.status).toBe(200)
            expect(JSON.stringify(await operationalResponse.json())).not.toContain('followersCount')
        } finally {
            closeDatabase(database)
        }
    })
})
