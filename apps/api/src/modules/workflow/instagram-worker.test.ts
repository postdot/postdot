import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ChannelProfileCompiler } from '@postdot/core'
import {
    closeDatabase,
    createDatabase,
    runMigrations,
    createManualStore,
    createMediaAssetStore,
    createPublisherCredentialCipher,
    createPublisherCredentialStore,
    createPublisherStore,
} from '@postdot/db'
import {
    createInstagramPublisher,
    instagramChannelProfile,
    instagramChannelProfileValidationAdapter,
    INSTAGRAM_PUBLISH_PERMISSIONS,
} from '@postdot/instagram'
import { createLocalMediaStore } from '@postdot/media'

import { instagramPublisherConnectionPolicy } from '../../providers/instagram/connection-policy'
import { createInstagramProviderAdapter } from '../../providers/instagram/worker'
import { createBuiltInProviderRegistry } from './providers/registry'
import { createPublicationWorker } from './worker'

for (const scenario of [
    'published',
    'deferred',
    'ambiguous_create',
    'ambiguous_publish',
] as const) {
    test(`Instagram worker persists ${scenario} without recreating a container or replaying a publication`, async () => {
        const database = createDatabase(':memory:')
        runMigrations(database)
        const directory = await mkdtemp(join(tmpdir(), 'postbot-instagram-worker-'))
        let clock = 1_800_000_000_000
        const media = createMediaAssetStore(
            database,
            createLocalMediaStore({
                storeId: 'test',
                rootDirectory: directory,
                maxObjectBytes: 2_000_000,
            }),
            { now: () => clock }
        )
        const store = createManualStore(database, {
            now: () => clock,
            media,
            publicMediaUrlAvailable: true,
            profileCompiler: new ChannelProfileCompiler({
                validationAdapters: [instagramChannelProfileValidationAdapter],
            }),
        })
        const credentials = createPublisherCredentialStore(database, {
            cipher: createPublisherCredentialCipher({
                keyId: 'test',
                key: new Uint8Array(32).fill(7),
            }),
            now: () => clock,
        })
        const publishers = createPublisherStore(database, {
            credentialRevoker: credentials,
            connectionPolicies: { instagram: instagramPublisherConnectionPolicy },
            now: () => clock,
        })
        try {
            const project = store.createProject({
                name: 'Instagram worker',
                subjectId: 'operator',
                displayName: 'Operator',
            })!
            const channel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'operator',
                name: 'Images',
                profile: instagramChannelProfile,
            })!
            const credential = await credentials.createPublisherCredential({
                projectId: project.project.id,
                connectedByActorId: project.actor.id,
                providerId: 'instagram',
                externalAccountId: '123456',
                accessToken: 'synthetic-instagram-token',
                expiresAt: clock + 60 * 24 * 60 * 60_000,
                scopes: INSTAGRAM_PUBLISH_PERMISSIONS,
                providerSession: JSON.stringify({
                    version: 1,
                    issuedAt: clock,
                    appScopedId: '654321',
                    accountType: 'BUSINESS',
                }),
            })
            if (credential.kind !== 'created') throw new Error('Expected credential')
            expect(
                publishers.createPublisherConnection({
                    projectId: project.project.id,
                    channelId: channel.id,
                    subjectId: 'operator',
                    kind: 'instagram',
                    credentialId: credential.credential.id,
                    destination: { type: 'account', id: '123456', name: 'studio_test' },
                }).kind
            ).toBe('created')
            const bytes = new Uint8Array(
                await Bun.file(
                    new URL('../../../../../e2e/fixtures/instagram-square.jpg', import.meta.url)
                ).arrayBuffer()
            )
            const upload = media.reserveUpload({
                projectId: project.project.id,
                subjectId: 'operator',
                originalFilename: 'square.jpg',
                contentType: 'image/jpeg',
                expectedSize: bytes.length,
            })!
            expect(
                await media.upload({
                    projectId: project.project.id,
                    subjectId: 'operator',
                    intentId: upload.intent.id,
                    source: new Blob([bytes]).stream(),
                })
            ).toMatchObject({ kind: 'uploaded' })
            expect(
                await media.finalizeUpload({
                    projectId: project.project.id,
                    subjectId: 'operator',
                    intentId: upload.intent.id,
                })
            ).toMatchObject({ kind: 'ready' })
            const references = [{ assetId: upload.asset.id, accessibilityText: 'A blue square' }]
            const post = store.createPost({
                projectId: project.project.id,
                subjectId: 'operator',
                sourceContent: {
                    body: { text: 'Hello Instagram', format: 'plain_text' },
                    media: references,
                },
                publications: [
                    {
                        channelId: channel.id,
                        deliveryMode: 'automatic',
                        scheduledAt: clock,
                        targetContent: { caption: 'Hello Instagram', media: references },
                    },
                ],
            })
            expect(post?.publications).toHaveLength(1)
            const requests: {
                path: string
                method: string
                body: URLSearchParams
                authorization: string | null
            }[] = []
            let statusReads = 0
            const registry = createBuiltInProviderRegistry([
                createInstagramProviderAdapter({
                    createPublisher: () =>
                        createInstagramPublisher({
                            fetcher: async (input, init) => {
                                const url = new URL(String(input))
                                requests.push({
                                    path: url.pathname,
                                    method: init?.method ?? 'GET',
                                    body: new URLSearchParams(init?.body as URLSearchParams),
                                    authorization: new Headers(init?.headers).get('authorization'),
                                })
                                if (url.pathname.endsWith('/media')) {
                                    if (scenario === 'ambiguous_create')
                                        throw new Error('Synthetic lost create acknowledgment')
                                    return Response.json({ id: '777' })
                                }
                                if (url.pathname.endsWith('/media_publish')) {
                                    if (scenario === 'ambiguous_publish')
                                        throw new Error('Synthetic lost publish acknowledgment')
                                    return Response.json({ id: '999' })
                                }
                                statusReads++
                                return Response.json({
                                    id: '777',
                                    status_code:
                                        scenario === 'deferred' && statusReads === 1
                                            ? 'IN_PROGRESS'
                                            : 'FINISHED',
                                })
                            },
                        }),
                }),
            ])
            const makeWorker = () =>
                createPublicationWorker({
                    database,
                    publisherStore: publishers,
                    publisherCredentialStore: credentials,
                    now: () => clock,
                    media,
                    builtInProviderRegistry: registry,
                    resolveBuiltInMediaUrl: () =>
                        'https://media.postbot.test/signed-square.jpg?signature=synthetic',
                })
            let worker = makeWorker()
            try {
                await worker.processDueEvents(clock)
                if (scenario === 'deferred') {
                    expect(database.$client.query('select state from publications').get()).toEqual({
                        state: 'ready',
                    })
                    expect(
                        requests.filter(request => request.path.endsWith('/media'))
                    ).toHaveLength(1)
                    expect(
                        requests.filter(request => request.path.endsWith('/media_publish'))
                    ).toHaveLength(0)
                    // A new worker must resume the stored container after deferred processing.
                    await worker.stop()
                    worker = makeWorker()
                    clock += 60_001
                    await worker.processDueEvents(clock)
                }
                const ambiguous = scenario.startsWith('ambiguous')
                expect(
                    database.$client
                        .query('select state, external_id as externalId from publications')
                        .get()
                ).toEqual({
                    state: ambiguous ? 'ambiguous' : 'published',
                    externalId: ambiguous ? null : '999',
                })
                expect(requests.filter(request => request.path.endsWith('/media'))).toHaveLength(1)
                expect(
                    requests.filter(request => request.path.endsWith('/media_publish'))
                ).toHaveLength(scenario === 'ambiguous_create' ? 0 : 1)
                if (!ambiguous) {
                    expect(
                        database.$client
                            .query('select remote_media_id as id from provider_media_deliveries')
                            .get()
                    ).toEqual({ id: '777' })
                    expect(
                        requests
                            .find(request => request.path.endsWith('/media'))!
                            .body.get('caption')
                    ).toBe('Hello Instagram')
                    expect(
                        requests
                            .find(request => request.path.endsWith('/media'))!
                            .body.get('alt_text')
                    ).toBe('A blue square')
                }
                const before = requests.length
                await worker.stop()
                worker = makeWorker()
                clock += 600_000
                await worker.processDueEvents(clock)
                expect(requests).toHaveLength(before)
                for (const request of requests) {
                    expect(request.authorization).toBe('Bearer synthetic-instagram-token')
                    expect(request.path).not.toContain('synthetic-instagram-token')
                }
            } finally {
                await worker.stop()
            }
        } finally {
            closeDatabase(database)
            await rm(directory, { recursive: true, force: true })
        }
    })
}
