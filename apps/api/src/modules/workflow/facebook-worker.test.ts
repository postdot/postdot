import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ChannelProfileCompiler } from '@postbot/core'
import {
    createDatabase,
    closeDatabase,
    runMigrations,
    createManualStore,
    createMediaAssetStore,
    createPublisherCredentialCipher,
    createPublisherCredentialStore,
    createPublisherStore,
} from '@postbot/db'
import {
    createFacebookPublisher,
    facebookChannelProfile,
    facebookChannelProfileValidationAdapter,
} from '@postbot/facebook'
import { createLocalMediaStore } from '@postbot/media'

import { facebookPublisherConnectionPolicy } from '../publishers/providers/facebook'
import { createFacebookProviderAdapter } from './providers/facebook'
import { createBuiltInProviderRegistry } from './providers/registry'
import { createPublicationWorker } from './worker'

for (const photo of [false, true])
    for (const scenario of ['published', 'ambiguous', 'authentication', 'retry'] as const) {
        test(`Facebook worker persists ${photo ? 'photo' : 'text'} ${scenario} without replay`, async () => {
            const database = createDatabase(':memory:')
            runMigrations(database)
            const directory = await mkdtemp(join(tmpdir(), 'postbot-facebook-worker-'))
            const now = 1_800_000_000_000
            let clock = now
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
                profileCompiler: new ChannelProfileCompiler({
                    validationAdapters: [facebookChannelProfileValidationAdapter],
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
                connectionPolicies: { facebook: facebookPublisherConnectionPolicy },
                now: () => clock,
            })
            try {
                const project = store.createProject({
                    name: 'Facebook worker',
                    subjectId: 'operator',
                    displayName: 'Operator',
                })!
                const channel = store.createChannel({
                    projectId: project.project.id,
                    subjectId: 'operator',
                    name: 'Announcements',
                    profile: facebookChannelProfile,
                })!
                const credential = await credentials.createPublisherCredential({
                    projectId: project.project.id,
                    connectedByActorId: project.actor.id,
                    providerId: 'facebook',
                    externalAccountId: '123456',
                    accessToken: 'synthetic-page-token',
                    scopes: [],
                })
                if (credential.kind !== 'created') throw new Error('Expected credential')
                expect(
                    publishers.createPublisherConnection({
                        projectId: project.project.id,
                        channelId: channel.id,
                        subjectId: 'operator',
                        kind: 'facebook',
                        credentialId: credential.credential.id,
                        destination: { type: 'channel', id: '123456', name: 'Announcements' },
                    }).kind
                ).toBe('created')
                const bytes = new Uint8Array(
                    Buffer.from(
                        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
                        'base64'
                    )
                )
                let assetId: string | undefined
                if (photo) {
                    const reserved = media.reserveUpload({
                        projectId: project.project.id,
                        subjectId: 'operator',
                        originalFilename: 'photo.png',
                        contentType: 'image/png',
                        expectedSize: bytes.length,
                    })!
                    expect(
                        await media.upload({
                            projectId: project.project.id,
                            subjectId: 'operator',
                            intentId: reserved.intent.id,
                            source: new Blob([bytes]).stream(),
                        })
                    ).toMatchObject({ kind: 'uploaded' })
                    expect(
                        await media.finalizeUpload({
                            projectId: project.project.id,
                            subjectId: 'operator',
                            intentId: reserved.intent.id,
                        })
                    ).toMatchObject({ kind: 'ready' })
                    assetId = reserved.asset.id
                }
                const references = assetId
                    ? [{ assetId, accessibilityText: 'Product announcement' }]
                    : []
                const post = store.createPost({
                    projectId: project.project.id,
                    subjectId: 'operator',
                    sourceContent: {
                        body: { text: 'Hello Facebook', format: 'plain_text' },
                        media: references,
                    },
                    publications: [
                        {
                            channelId: channel.id,
                            deliveryMode: 'automatic',
                            scheduledAt: now,
                            targetContent: { text: 'Hello Facebook', media: references },
                        },
                    ],
                })
                expect(post?.publications).toHaveLength(1)
                const requests: { url: string; body: RequestInit['body']; headers: Headers }[] = []
                const worker = createPublicationWorker({
                    database,
                    publisherStore: publishers,
                    publisherCredentialStore: credentials,
                    now: () => clock,
                    media,
                    retryPolicy: { nextRunAt: ({ failedAt }) => failedAt + 1000 },
                    builtInProviderRegistry: createBuiltInProviderRegistry([
                        createFacebookProviderAdapter({
                            createPublisher: () =>
                                createFacebookPublisher({
                                    fetcher: async (url, init) => {
                                        requests.push({
                                            url: String(url),
                                            body: init?.body,
                                            headers: new Headers(init?.headers),
                                        })
                                        if (scenario === 'retry' && requests.length === 1)
                                            return Response.json(
                                                { error: { code: 4 } },
                                                { status: 429, headers: { 'retry-after': '1' } }
                                            )
                                        if (scenario === 'ambiguous')
                                            throw new Error('Synthetic transport loss')
                                        if (scenario === 'authentication')
                                            return Response.json(
                                                { error: { code: 190 } },
                                                { status: 400 }
                                            )
                                        return Response.json(
                                            photo
                                                ? { id: '987', post_id: '123456_42' }
                                                : { id: '123456_42' }
                                        )
                                    },
                                }),
                        }),
                    ]),
                })
                try {
                    await worker.processDueEvents(now)
                    if (scenario === 'retry') {
                        clock += 2000
                        await worker.processDueEvents(clock)
                    }
                    expect(
                        database.$client
                            .query('select state, external_id as externalId from publications')
                            .all()
                    ).toEqual([
                        {
                            state:
                                scenario === 'authentication'
                                    ? 'failed'
                                    : scenario === 'retry'
                                      ? 'published'
                                      : scenario,
                            externalId:
                                scenario === 'published' || scenario === 'retry'
                                    ? '123456_42'
                                    : null,
                        },
                    ])
                    if (photo)
                        expect(
                            database.$client
                                .query(
                                    'select state, remote_media_id as remoteId from provider_media_deliveries'
                                )
                                .all()
                        ).toEqual([
                            {
                                state:
                                    scenario === 'ambiguous'
                                        ? 'ambiguous'
                                        : scenario === 'authentication'
                                          ? 'failed'
                                          : 'uploaded',
                                remoteId:
                                    scenario === 'published' || scenario === 'retry' ? '987' : null,
                            },
                        ])
                    clock += 60_000
                    await worker.processDueEvents(clock)
                    expect(requests).toHaveLength(scenario === 'retry' ? 2 : 1)
                    for (const request of requests) {
                        expect(request.url).toBe(
                            `https://graph.facebook.com/v26.0/123456/${photo ? 'photos' : 'feed'}`
                        )
                        expect(request.headers.get('authorization')).toBe(
                            'Bearer synthetic-page-token'
                        )
                        expect(request.url).not.toContain('synthetic-page-token')
                        if (photo) {
                            expect(request.body).toBeInstanceOf(FormData)
                            const body = request.body as FormData
                            expect(body.get('caption')).toBe('Hello Facebook')
                            expect(body.get('alt_text_custom')).toBe('Product announcement')
                            const file = body.get('source') as File
                            expect(file.type).toBe('image/png')
                            expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
                        } else
                            expect(
                                new URLSearchParams(request.body as URLSearchParams).get('message')
                            ).toBe('Hello Facebook')
                    }
                    expect(
                        publishers.listPublisherConnections(project.project.id, 'operator')?.[0]
                            ?.state
                    ).toBe(scenario === 'authentication' ? 'reconnect_required' : 'active')
                } finally {
                    await worker.stop()
                }
            } finally {
                closeDatabase(database)
                await rm(directory, { recursive: true, force: true })
            }
        })
    }
