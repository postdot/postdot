import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

import {
    closeDatabase,
    createDatabase,
    createManualStore,
    createMediaAssetStore,
    createProviderMediaDeliveryStore,
    createPublisherCredentialStore,
    createPublisherCredentialCipher,
    createWorkflowStore,
    mediaAssets,
    mediaRepresentations,
    publicationExecutionRevisionMedia,
    publishers,
    runMigrations,
    type PublisherExecutionMedia,
    type PublisherCredentialRefreshContext,
    type PublisherExecutionTarget,
    type ReplacePublisherCredentialTokensInput,
} from '@postdot/db'
import { seedTestWorkspace, workspaceOf } from '@postdot/db/testing'
import {
    createInstagramOAuth,
    createInstagramPublisher,
    instagramChannelProfile,
    INSTAGRAM_PUBLISH_PERMISSIONS,
    type InstagramFetcher,
} from '@postdot/instagram'
import { createLocalMediaStore } from '@postdot/media'

import { createInstagramProviderAdapter } from '../../../providers/instagram/worker'
import type { BuiltInProviderExecutionInput } from './registry'

const now = 1_800_000_000_000
const accountId = '17841400000000000'
const containerId = '17900000000000001'
const mediaId = '17900000000000002'
const signedImageUrl =
    'https://media.postdot.test/assets/photo.jpg?X-Signature=9f8e7d6c5b4a3f2e%3D%3D' +
    '&X-Expires=1758360000&X-Credential=media%2F20261020'
const dayMs = 24 * 60 * 60 * 1000

/** A complete PNG that Bun can decode, so the media pipeline builds real previews. */
function decodablePng(width: number, height: number): Uint8Array {
    function chunk(name: string, data: Uint8Array) {
        const type = Buffer.from(name)
        const body = Buffer.concat([type, data])
        let crc = 0xffffffff
        for (const byte of body) {
            crc ^= byte
            for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
        }
        const size = Buffer.alloc(4)
        size.writeUInt32BE(data.length, 0)
        const checksum = Buffer.alloc(4)
        checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0)
        return Buffer.concat([size, body, checksum])
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(width, 0)
    header.writeUInt32BE(height, 4)
    header[8] = 8
    header[9] = 2
    const pixels = Buffer.alloc((width * 3 + 1) * height)
    let seed = 19
    for (let y = 0; y < height; y++) {
        for (let x = 1; x <= width * 3; x++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
            pixels[y * (width * 3 + 1) + x] = seed >>> 24
        }
    }
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(pixels)),
        chunk('IEND', Buffer.alloc(0)),
    ])
}

async function decodableJpeg(width: number, height: number): Promise<Uint8Array> {
    const blob = await new Bun.Image(decodablePng(width, height)).jpeg({ quality: 85 }).blob()
    return new Uint8Array(await blob.arrayBuffer())
}

type Replies = (request: { url: URL; init: RequestInit | undefined }) => Response

interface FixtureOptions {
    readonly realCredentials?: boolean
    readonly replies?: Replies
    readonly scopes?: readonly string[]
    /** The credential record cannot be read through the shared port. */
    readonly scopesUnavailable?: boolean
    readonly credentialExpiresAt?: number | null
    readonly providerSession?: string | null
    readonly accessToken?: string
    readonly mediaUrl?: string | null
    readonly corruptMedia?: boolean
    readonly resolveOAuth?: (
        providerApplicationId: string | null
    ) => Promise<ReturnType<typeof createInstagramOAuth> | undefined>
}

interface Fixture {
    readonly credentialStore?: ReturnType<typeof createPublisherCredentialStore>
    readonly target: PublisherExecutionTarget
    readonly deliveries: ReturnType<typeof createProviderMediaDeliveryStore>
    readonly requests: { url: URL; init: RequestInit | undefined }[]
    readonly reconnects: string[]
    readonly replacements: ReplacePublisherCredentialTokensInput[]
    readonly execute: (overrides?: {
        readonly now?: number
        readonly target?: PublisherExecutionTarget
    }) => Promise<Awaited<ReturnType<ReturnType<typeof createInstagramProviderAdapter>['execute']>>>
    readonly cleanup: () => Promise<void>
}

async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
    const directory = await mkdtemp(join(tmpdir(), 'postdot-instagram-'))
    const database = createDatabase(':memory:')
    const mediaStore = createLocalMediaStore({
        storeId: 'local-default',
        rootDirectory: join(directory, 'media'),
        maxObjectBytes: 2_000_000,
    })
    const requests: { url: URL; init: RequestInit | undefined }[] = []
    const reconnects: string[] = []
    const replacements: ReplacePublisherCredentialTokensInput[] = []

    try {
        runMigrations(database)
        const media = createMediaAssetStore(database, mediaStore, {
            now: () => now,
            createId: (() => {
                let sequence = 0
                return () => `media-${++sequence}`
            })(),
        })
        const manualStore = createManualStore(database, {
            now: () => now,
            media,
            // The Instagram image contract requires public media delivery.
            publicMediaUrlAvailable: true,
        })
        const project = manualStore.createProject({
            workspaceId: seedTestWorkspace(database),
            name: 'Instagram publication project',
            subjectId: 'subject-1',
            displayName: 'Instagram operator',
        })
        const channel = manualStore.createChannel({
            projectId: project.project.id,
            subjectId: 'subject-1',
            name: 'Instagram channel',
            profile: instagramChannelProfile,
        })
        if (channel === null) throw new Error('Channel was not created')
        database
            .insert(publishers)
            .values({
                id: 'publisher-instagram',
                workspaceId: workspaceOf(database, project.project.id),
                channelId: channel.id,
                kind: 'instagram',
            })
            .run()

        const bytes = await decodableJpeg(120, 90)
        const reservation = media.reserveUpload({
            projectId: project.project.id,
            subjectId: 'subject-1',
            originalFilename: 'photo.jpg',
            defaultAccessibilityText: 'A mountain at sunrise',
            expectedSize: bytes.length,
        })
        if (reservation === null) throw new Error('Media reservation was not created')
        await media.upload({
            projectId: project.project.id,
            subjectId: 'subject-1',
            intentId: reservation.intent.id,
            source: new Blob([bytes]).stream(),
        })
        const finalized = await media.finalizeUpload({
            projectId: project.project.id,
            subjectId: 'subject-1',
            intentId: reservation.intent.id,
        })
        expect(finalized.kind).toBe('ready')

        const created = manualStore.createPost({
            projectId: project.project.id,
            subjectId: 'subject-1',
            sourceContent: {
                body: { text: 'A clear announcement', format: 'plain_text' },
                media: [{ assetId: reservation.asset.id }],
            },
            publications: [
                {
                    channelId: channel.id,
                    deliveryMode: 'automatic',
                    scheduledAt: now,
                },
            ],
        })
        if (created === null) throw new Error('Publication was not created')
        const publication = created.publications[0]
        if (publication === undefined) throw new Error('Publication was not created')

        const workflow = createWorkflowStore(database)
        const systemActorId = workflow.ensureSystemActor(project.project.id, now)
        if (systemActorId === null) throw new Error('System actor was not created')
        const claimed = workflow.claimNextDueJob({
            actorId: systemActorId,
            claimToken: 'claim-instagram',
            now,
            leaseExpiresAt: now + 60_000,
        })
        if (claimed === null) throw new Error('Job was not claimed')
        expect(workflow.startExternalEffect(claimed.id, 'claim-instagram', now + 1)).toBe(true)

        const executionMedia = database.select().from(publicationExecutionRevisionMedia).all()
        const executionRow = executionMedia[0]
        if (executionRow === undefined) throw new Error('Execution media was not created')
        const representation = database
            .select()
            .from(mediaRepresentations)
            .all()
            .find(row => row.id === executionRow.representationId)
        if (representation === undefined) throw new Error('Media representation was not created')
        const asset = database
            .select()
            .from(mediaAssets)
            .all()
            .find(row => row.id === executionRow.assetId)
        if (asset === undefined) throw new Error('Media asset was not created')
        const pinned: PublisherExecutionMedia = {
            id: executionRow.id,
            projectId: executionRow.projectId,
            executionRevisionId: executionRow.executionRevisionId,
            targetRevisionMediaId: executionRow.targetRevisionMediaId,
            assetId: executionRow.assetId,
            representationId: executionRow.representationId,
            position: executionRow.position,
            contentPath: executionRow.contentPath,
            role: executionRow.role,
            accessibilityText: executionRow.accessibilityText,
            originalFilename: asset.originalFilename,
            contentType: representation.detectedContentType ?? '',
            family: (representation.family ?? 'image') as PublisherExecutionMedia['family'],
            byteSize: representation.byteSize ?? 0,
            sha256: representation.sha256 ?? '',
            width: representation.width,
            height: representation.height,
            durationMs: representation.durationMs,
            storeId: representation.storeId,
            objectKey: representation.objectKey,
        }
        expect(pinned.contentType).toBe('image/jpeg')
        expect(pinned.width).toBe(120)
        expect(pinned.height).toBe(90)

        const deliveries = createProviderMediaDeliveryStore(database, { now: () => now })
        const fetcher: InstagramFetcher = async (input, init) => {
            const request = { url: new URL(String(input)), init }
            requests.push(request)
            return options.replies
                ? options.replies(request)
                : Response.json({ id: containerId, status_code: 'FINISHED' })
        }

        const target: PublisherExecutionTarget = {
            jobId: claimed.id,
            projectId: project.project.id,
            publicationId: publication.id,
            scheduledAt: now,
            executionRevisionId: pinned.executionRevisionId,
            profileVersionId: channel.profileVersionId,
            mediaReferenceCount: 1,
            profile: instagramChannelProfile,
            content: {
                caption: 'A clear announcement',
                media: [{ assetId: reservation.asset.id }],
            },
            publisherId: 'publisher-instagram',
            channelId: channel.id,
            channelName: channel.name,
            kind: 'instagram',
            credentialId: 'credential-instagram',
            externalAccountId: accountId,
            destination: { type: 'account', id: accountId, name: 'studio' },
            providerId: 'instagram',
            providerApplicationId: 'instagram-application-1',
            credentialState: 'active',
            credentialExpiresAt:
                options.credentialExpiresAt === undefined
                    ? now + 30 * dayMs
                    : options.credentialExpiresAt,
            endpointUrl: null,
            authentication: null,
            attempt: 1,
            media: [pinned],
        }

        const contentStore = media
        const mediaPort = {
            openRepresentationContent: async (
                projectId: string,
                assetId: string,
                representationId: string
            ) => {
                const opened = await contentStore.openRepresentationContent(
                    projectId,
                    assetId,
                    representationId
                )
                if (opened === null || !options.corruptMedia) return opened
                return {
                    ...opened,
                    stream: new Blob([new Uint8Array(opened.size)]).stream(),
                }
            },
        }

        const adapter = createInstagramProviderAdapter({
            createPublisher: () => createInstagramPublisher({ fetcher }),
            ...(options.resolveOAuth === undefined ? {} : { resolveOAuth: options.resolveOAuth }),
        })

        const credentialPort = {
            async withPublisherCredentialRefresh<T>(
                projectId: string,
                credentialId: string,
                operation: (context: PublisherCredentialRefreshContext | null) => Promise<T>
            ): Promise<T> {
                return operation({
                    credential: {
                        id: credentialId,
                        projectId,
                        providerId: 'instagram',
                        externalAccountId: accountId,
                        externalAccountName: null,
                        state: 'active',
                        scopes: options.scopes ?? INSTAGRAM_PUBLISH_PERMISSIONS,
                        expiresAt: target.credentialExpiresAt,
                        providerApplicationId: target.providerApplicationId,
                        connectedByActorId: 'fixture-actor',
                        createdAt: now,
                        updatedAt: now,
                    },
                    now: () => now,
                    secrets: await credentialPort.resolvePublisherCredentialSecrets(),
                    replaceTokens: value =>
                        credentialPort.replacePublisherCredentialTokens({
                            ...value,
                            projectId,
                            credentialId,
                        }),
                    markReconnectRequired: () =>
                        credentialPort.markPublisherCredentialReconnectRequired(projectId),
                })
            },
            resolvePublisherCredentialSecrets: async () => ({
                accessToken: options.accessToken ?? 'synthetic-instagram-token',
                refreshToken: null,
                providerSession: options.providerSession ?? null,
            }),
            replacePublisherCredentialTokens: async (
                input: ReplacePublisherCredentialTokensInput
            ) => {
                replacements.push(input)
                return { kind: 'updated' as const, credential: undefined as never }
            },
            markPublisherCredentialReconnectRequired: (projectId: string) => {
                reconnects.push(projectId)
            },
            // The shared credential port reads the granted permissions from the
            // credential record. A port that does not expose the record leaves
            // the grants unknown.
            ...(options.scopesUnavailable
                ? {}
                : {
                      getPublisherCredential: () => ({
                          scopes: options.scopes ?? INSTAGRAM_PUBLISH_PERMISSIONS,
                      }),
                  }),
        }

        let realCredentialStore: ReturnType<typeof createPublisherCredentialStore> | undefined
        if (options.realCredentials) {
            realCredentialStore = createPublisherCredentialStore(database, {
                cipher: createPublisherCredentialCipher({
                    keyId: 'test',
                    key: new Uint8Array(32).fill(1),
                }),
                now: () => now,
                createId: () => target.credentialId,
            })
            const created = await realCredentialStore.createPublisherCredential({
                projectId: project.project.id,
                connectedByActorId: project.actor.id,
                providerId: 'instagram',
                externalAccountId: accountId,
                scopes: options.scopes ?? INSTAGRAM_PUBLISH_PERMISSIONS,
                accessToken: options.accessToken ?? 'synthetic-instagram-token',
                providerSession: options.providerSession,
                expiresAt: target.credentialExpiresAt,
            })
            if (created.kind !== 'created') throw new Error('The real credential was not created')
        }

        const execute: Fixture['execute'] = async (overrides = {}) =>
            adapter.execute({
                target: overrides.target ?? target,
                now: overrides.now ?? now,
                // The shared credential port does not expose the granted scopes.
                // The adapter reads them from the credential record when the
                // port offers it, exactly like the production credential store.
                credentials: (realCredentialStore ??
                    credentialPort) as BuiltInProviderExecutionInput['credentials'],
                media: mediaPort as unknown as NonNullable<BuiltInProviderExecutionInput['media']>,
                resolveMediaUrl: async () =>
                    options.mediaUrl === undefined ? signedImageUrl : options.mediaUrl,
                providerMediaDeliveryStore: deliveries,
            })

        return {
            credentialStore: realCredentialStore,
            target,
            deliveries,
            requests,
            reconnects,
            replacements,
            execute,
            cleanup: async () => {
                closeDatabase(database)
                await rm(directory, { recursive: true, force: true })
            },
        }
    } catch (error) {
        closeDatabase(database)
        await rm(directory, { recursive: true, force: true })
        throw error
    }
}

function body(request: { init: RequestInit | undefined }): URLSearchParams {
    return request.init?.body as URLSearchParams
}

test('publishes one JPEG and reports the provider media receipt', async () => {
    const item = await fixture({
        replies: request =>
            request.url.pathname.endsWith('/media_publish')
                ? Response.json({ id: mediaId })
                : Response.json({ id: containerId, status_code: 'FINISHED' }),
    })
    try {
        expect(await item.execute()).toEqual({ type: 'published', externalId: mediaId })
        expect(item.requests).toHaveLength(3)
        expect(item.requests[0]?.url.pathname).toBe(`/v26.0/${accountId}/media`)
        expect(item.requests[0]?.init?.method).toBe('POST')
        expect(body(item.requests[0]!).get('image_url')).toBe(signedImageUrl)
        expect(body(item.requests[0]!).get('caption')).toBe('A clear announcement')
        expect(body(item.requests[0]!).get('alt_text')).toBe('A mountain at sunrise')
        expect(item.requests[1]?.url.pathname).toBe(`/v26.0/${containerId}`)
        expect(item.requests[1]?.url.searchParams.get('fields')).toBe('status_code')
        expect(item.requests[2]?.url.pathname).toBe(`/v26.0/${accountId}/media_publish`)
        expect(body(item.requests[2]!).get('creation_id')).toBe(containerId)

        const delivery = item.deliveries.listByExecutionMedia(
            item.target.projectId,
            item.target.media[0]!.id
        )[0]
        expect(delivery).toMatchObject({
            state: 'uploaded',
            remoteMediaId: containerId,
            attempts: 1,
        })
    } finally {
        await item.cleanup()
    }
})

test('defers a preparing container and resumes the same container', async () => {
    let status = 'IN_PROGRESS'
    const item = await fixture({
        replies: request => {
            if (request.url.pathname.endsWith('/media_publish'))
                return Response.json({ id: mediaId })
            if (request.url.pathname.includes('/media')) return Response.json({ id: containerId })
            return Response.json({ id: containerId, status_code: status })
        },
    })
    try {
        expect(await item.execute()).toEqual({
            type: 'deferred',
            effectOccurred: false,
            errorMessage: 'The Instagram container is still preparing',
            resumeAfterMs: 60_000,
        })
        expect(item.requests).toHaveLength(2)
        status = 'FINISHED'
        expect(await item.execute()).toEqual({ type: 'published', externalId: mediaId })
        const creates = item.requests.filter(request => request.url.pathname.endsWith('/media'))
        expect(creates).toHaveLength(1)
        expect(body(item.requests.at(-1)!).get('creation_id')).toBe(containerId)
    } finally {
        await item.cleanup()
    }
})

test('bounds the container preparation to the documented polling window', async () => {
    const item = await fixture({
        replies: request =>
            request.url.pathname.endsWith('/media')
                ? Response.json({ id: containerId })
                : Response.json({ id: containerId, status_code: 'IN_PROGRESS' }),
    })
    const statusReads = () =>
        item.requests.filter(request => request.url.pathname === `/v26.0/${containerId}`)
    try {
        // The provider documents one status query per minute, for no more than
        // five minutes. Each minute of that window is queried exactly once.
        for (const minute of [0, 1, 2, 3, 4]) {
            expect(await item.execute({ now: now + minute * 60_000 })).toMatchObject({
                type: 'deferred',
                effectOccurred: false,
                errorMessage: 'The Instagram container is still preparing',
                resumeAfterMs: 60_000,
            })
        }
        expect(statusReads()).toHaveLength(5)

        // The window is closed: the query that would land in the sixth minute
        // is never sent and nothing is published.
        expect(await item.execute({ now: now + 5 * 60_000 })).toMatchObject({
            type: 'permanent_failure',
            effectOccurred: false,
        })
        expect(statusReads()).toHaveLength(5)
        expect(
            item.requests.filter(request => request.url.pathname.endsWith('/media_publish'))
        ).toHaveLength(0)
        expect(item.requests).toHaveLength(6)

        // The container identity stays durable for reconciliation.
        const delivery = item.deliveries.listByExecutionMedia(
            item.target.projectId,
            item.target.media[0]!.id
        )[0]
        expect(delivery).toMatchObject({
            state: 'uploaded',
            remoteMediaId: containerId,
            remoteMediaUrl: null,
        })
    } finally {
        await item.cleanup()
    }
})

test('publishes an existing container that finishes inside the preparation window', async () => {
    const item = await fixture({
        replies: request =>
            request.url.pathname.endsWith('/media_publish')
                ? Response.json({ id: mediaId })
                : Response.json({ id: containerId, status_code: 'FINISHED' }),
    })
    try {
        // The container identity was acknowledged by an earlier execution.
        const reserved = item.deliveries.reserve({
            projectId: item.target.projectId,
            executionMediaId: item.target.media[0]!.id,
            publisherId: item.target.publisherId,
            providerId: 'instagram',
            at: now,
        })
        item.deliveries.start({
            projectId: item.target.projectId,
            deliveryId: reserved.id,
            at: now,
        })
        item.deliveries.recordRemoteMediaId({
            projectId: item.target.projectId,
            deliveryId: reserved.id,
            remoteMediaId: containerId,
            at: now,
        })

        // The status is read in the last minute of the window and published.
        expect(await item.execute({ now: now + 4 * 60_000 })).toEqual({
            type: 'published',
            externalId: mediaId,
        })
        expect(item.requests.map(request => request.url.pathname)).toEqual([
            `/v26.0/${containerId}`,
            `/v26.0/${accountId}/media_publish`,
        ])
    } finally {
        await item.cleanup()
    }
})

test('refuses unusable pinned media before any provider write', async () => {
    const cases: {
        readonly name: string
        readonly options: FixtureOptions
        readonly target?: PublisherExecutionTarget
    }[] = [
        { name: 'corrupted bytes', options: { corruptMedia: true } },
        { name: 'no public media URL', options: { mediaUrl: null } },
        {
            name: 'an insecure media URL',
            options: { mediaUrl: 'http://media.postdot.test/photo.jpg' },
        },
        {
            name: 'a private media URL',
            options: { mediaUrl: 'https://127.0.0.1/photo.jpg' },
        },
    ]
    for (const testCase of cases) {
        const item = await fixture(testCase.options)
        try {
            expect(await item.execute()).toMatchObject({
                type: 'permanent_failure',
                effectOccurred: false,
            })
            expect(item.requests).toHaveLength(0)
        } finally {
            await item.cleanup()
        }
    }
})

test('refuses an image outside the accepted format and ratio', async () => {
    const item = await fixture()
    try {
        const pinned = item.target.media[0]!
        const tooWide = {
            ...item.target,
            media: [{ ...pinned, width: 1000, height: 200 }],
        }
        expect((await item.execute({ target: tooWide })).type).toBe('permanent_failure')
        const tooNarrow = {
            ...item.target,
            media: [{ ...pinned, width: 100, height: 200 }],
        }
        expect((await item.execute({ target: tooNarrow })).type).toBe('permanent_failure')
        const wrongType = {
            ...item.target,
            media: [{ ...pinned, contentType: 'image/png' }],
        }
        expect((await item.execute({ target: wrongType })).type).toBe('permanent_failure')
        expect(item.requests).toHaveLength(0)
    } finally {
        await item.cleanup()
    }
})

test('refuses a destination that does not match the connected account', async () => {
    const item = await fixture()
    try {
        expect(
            (
                await item.execute({
                    target: {
                        ...item.target,
                        externalAccountId: '17841400000000099',
                    },
                })
            ).type
        ).toBe('permanent_failure')
        expect(item.requests).toHaveLength(0)
    } finally {
        await item.cleanup()
    }
})

test('refuses an expired credential and never refreshes it', async () => {
    let refreshes = 0
    const item = await fixture({
        credentialExpiresAt: now - 1,
        providerSession: JSON.stringify({
            version: 1,
            issuedAt: now - 30 * dayMs,
            appScopedId: '17841400000000000',
            accountType: 'BUSINESS',
        }),
        resolveOAuth: async () => {
            refreshes++
            return undefined
        },
    })
    try {
        expect(await item.execute()).toMatchObject({
            type: 'permanent_failure',
            effectOccurred: false,
        })
        expect(item.reconnects).toEqual([item.target.projectId])
        expect(refreshes).toBe(0)
        expect(item.requests).toHaveLength(0)
    } finally {
        await item.cleanup()
    }
})

test('refuses a credential without a known expiration', async () => {
    const item = await fixture({ credentialExpiresAt: null })
    try {
        expect((await item.execute()).type).toBe('permanent_failure')
        expect(item.reconnects).toEqual([item.target.projectId])
        expect(item.requests).toHaveLength(0)
    } finally {
        await item.cleanup()
    }
})

test('marks the credential for reconnection when the stored grants lost publishing access', async () => {
    const item = await fixture({ scopes: ['instagram_business_basic'] })
    try {
        expect(await item.execute()).toMatchObject({
            type: 'permanent_failure',
            effectOccurred: false,
        })
        // The grants are known and no longer carry the publishing permissions,
        // so Studio can reconnect the account.
        expect(item.reconnects).toEqual([item.target.projectId])
        expect(item.requests).toHaveLength(0)
    } finally {
        await item.cleanup()
    }
})

test('fails closed without marking the credential when the grants cannot be read', async () => {
    const item = await fixture({ scopesUnavailable: true })
    try {
        expect(await item.execute()).toMatchObject({
            type: 'permanent_failure',
            effectOccurred: false,
        })
        // An unreadable grant set is a static access failure, not a lost grant.
        expect(item.reconnects).toEqual([])
        expect(item.requests).toHaveLength(0)
    } finally {
        await item.cleanup()
    }
})

test('turns an unreadable application configuration into a retryable outcome', async () => {
    const item = await fixture({
        credentialExpiresAt: now + 2 * 60 * 60 * 1000,
        providerSession: JSON.stringify({
            version: 1,
            issuedAt: now - 30 * dayMs,
            appScopedId: '17841400000000000',
            accountType: 'BUSINESS',
        }),
        resolveOAuth: async () => {
            throw new Error('the encrypted application settings could not be decrypted')
        },
    })
    try {
        const outcome = await item.execute()
        expect(outcome).toMatchObject({
            type: 'retryable_failure',
            effectOccurred: false,
        })
        // The failure is sanitized and no provider write was attempted.
        expect(JSON.stringify(outcome)).not.toContain('decrypted')
        expect(item.requests).toHaveLength(0)
        expect(item.replacements).toHaveLength(0)
        expect(item.reconnects).toEqual([])
    } finally {
        await item.cleanup()
    }
})

test('refreshes an expiring credential and publishes with the new token', async () => {
    const refreshRequests: string[] = []
    const oauth = createInstagramOAuth({
        clientId: '1234567890',
        clientSecret: 'synthetic-instagram-secret',
        callbackUri: 'https://postdot.test/api/oauth/instagram/callback',
        fetcher: async input => {
            refreshRequests.push(String(input))
            return Response.json({
                access_token: 'refreshed-instagram-token',
                token_type: 'bearer',
                expires_in: 5_184_000,
            })
        },
        now: () => now,
    })
    const item = await fixture({
        credentialExpiresAt: now + 2 * 60 * 60 * 1000,
        providerSession: JSON.stringify({
            version: 1,
            issuedAt: now - 30 * dayMs,
            appScopedId: '17841400000000000',
            accountType: 'BUSINESS',
        }),
        resolveOAuth: async () => oauth,
        replies: request =>
            request.url.pathname.endsWith('/media_publish')
                ? Response.json({ id: mediaId })
                : Response.json({ id: containerId, status_code: 'FINISHED' }),
    })
    try {
        expect(await item.execute()).toEqual({ type: 'published', externalId: mediaId })
        expect(refreshRequests).toHaveLength(1)
        expect(refreshRequests[0]).toContain('https://graph.instagram.com/refresh_access_token')
        expect(item.replacements).toHaveLength(1)
        const replacement = item.replacements[0]!
        expect(replacement.accessToken).toBe('refreshed-instagram-token')
        expect(replacement.refreshToken).toBeNull()
        expect(replacement.expiresAt).toBe(now + 5_184_000 * 1000)
        expect(JSON.parse(replacement.providerSession!)).toEqual({
            version: 1,
            issuedAt: now,
            appScopedId: '17841400000000000',
            accountType: 'BUSINESS',
        })
        // The stored permissions and the issuing application are preserved.
        expect(replacement.scopes).toBeUndefined()
        expect(replacement.providerApplicationId).toBeUndefined()
        expect(item.requests[0]?.init?.headers).toMatchObject({
            authorization: 'Bearer refreshed-instagram-token',
        })
    } finally {
        await item.cleanup()
    }
})

test('keeps an interrupted container preparation ambiguous instead of recreating it', async () => {
    const item = await fixture()
    try {
        const reserved = item.deliveries.reserve({
            projectId: item.target.projectId,
            executionMediaId: item.target.media[0]!.id,
            publisherId: item.target.publisherId,
            providerId: 'instagram',
            at: now,
        })
        item.deliveries.start({
            projectId: item.target.projectId,
            deliveryId: reserved.id,
            at: now,
        })
        expect((await item.execute()).type).toBe('ambiguous')
        expect(item.requests).toHaveLength(0)
    } finally {
        await item.cleanup()
    }
})

test('reuses an acknowledged container identity instead of recreating it', async () => {
    const item = await fixture({
        replies: request =>
            request.url.pathname.endsWith('/media_publish')
                ? Response.json({ id: mediaId })
                : Response.json({ id: containerId, status_code: 'FINISHED' }),
    })
    try {
        const reserved = item.deliveries.reserve({
            projectId: item.target.projectId,
            executionMediaId: item.target.media[0]!.id,
            publisherId: item.target.publisherId,
            providerId: 'instagram',
            at: now,
        })
        item.deliveries.start({
            projectId: item.target.projectId,
            deliveryId: reserved.id,
            at: now,
        })
        item.deliveries.recordRemoteMediaId({
            projectId: item.target.projectId,
            deliveryId: reserved.id,
            remoteMediaId: containerId,
            at: now,
        })
        expect(await item.execute()).toEqual({ type: 'published', externalId: mediaId })
        expect(item.requests.map(request => request.url.pathname)).toEqual([
            `/v26.0/${containerId}`,
            `/v26.0/${accountId}/media_publish`,
        ])
    } finally {
        await item.cleanup()
    }
})

test('treats a lost container acknowledgement as ambiguous and never recreates it', async () => {
    const item = await fixture({
        replies: () => new Response('gateway error', { status: 500 }),
    })
    try {
        expect(await item.execute()).toMatchObject({ type: 'ambiguous' })
        expect(item.requests).toHaveLength(1)
        const delivery = item.deliveries.listByExecutionMedia(
            item.target.projectId,
            item.target.media[0]!.id
        )[0]
        expect(delivery).toMatchObject({ state: 'ambiguous', remoteMediaId: null })
        expect(await item.execute()).toMatchObject({ type: 'ambiguous' })
        expect(item.requests).toHaveLength(1)
    } finally {
        await item.cleanup()
    }
})

test('treats a lost publication acknowledgement as ambiguous and never republishes', async () => {
    let publishAttempted = false
    const item = await fixture({
        replies: request => {
            if (request.url.pathname.endsWith('/media_publish')) {
                publishAttempted = true
                return new Response('gateway error', { status: 500 })
            }
            if (request.url.pathname.endsWith('/media')) return Response.json({ id: containerId })
            return Response.json({
                id: containerId,
                status_code: publishAttempted ? 'PUBLISHED' : 'FINISHED',
            })
        },
    })
    try {
        expect(await item.execute()).toMatchObject({ type: 'ambiguous' })
        expect(item.requests).toHaveLength(3)
        expect(await item.execute()).toMatchObject({ type: 'ambiguous' })
        const publishes = item.requests.filter(request =>
            request.url.pathname.endsWith('/media_publish')
        )
        expect(publishes).toHaveLength(1)
    } finally {
        await item.cleanup()
    }
})

test('never turns a published container status into a media receipt', async () => {
    const item = await fixture({
        replies: request =>
            request.url.pathname.includes('/media')
                ? Response.json({ id: containerId })
                : Response.json({ id: containerId, status_code: 'PUBLISHED' }),
    })
    try {
        const outcome = await item.execute()
        expect(outcome).toMatchObject({ type: 'ambiguous' })
        expect(JSON.stringify(outcome)).not.toContain(mediaId)
        const publishes = item.requests.filter(request =>
            request.url.pathname.endsWith('/media_publish')
        )
        expect(publishes).toHaveLength(0)
    } finally {
        await item.cleanup()
    }
})

test('marks the credential for reconnection when the provider rejects the token', async () => {
    const item = await fixture({
        replies: request => {
            if (request.url.pathname.endsWith('/media_publish'))
                return Response.json({ error: { code: 190 } }, { status: 400 })
            return Response.json({ id: containerId, status_code: 'FINISHED' })
        },
    })
    try {
        expect(await item.execute()).toMatchObject({
            type: 'permanent_failure',
            effectOccurred: false,
            code: 'authentication_required',
        })
        expect(item.reconnects).toEqual([item.target.projectId])
    } finally {
        await item.cleanup()
    }
})

test('a rejected container creation can be retried through the store lifecycle', async () => {
    let attempt = 0
    const item = await fixture({
        replies: request => {
            if (request.url.pathname.endsWith('/media')) {
                attempt++
                if (attempt === 1) return Response.json({ error: { code: 100 } }, { status: 400 })
                return Response.json({ id: containerId })
            }
            if (request.url.pathname.endsWith('/media_publish'))
                return Response.json({ id: mediaId })
            return Response.json({ id: containerId, status_code: 'FINISHED' })
        },
    })
    try {
        expect(await item.execute()).toMatchObject({
            type: 'permanent_failure',
            effectOccurred: false,
            code: 'request_rejected',
        })
        const delivery = item.deliveries.listByExecutionMedia(
            item.target.projectId,
            item.target.media[0]!.id
        )[0]
        expect(delivery).toMatchObject({ state: 'failed', remoteMediaId: null })
        expect(await item.execute()).toEqual({ type: 'published', externalId: mediaId })
        expect(attempt).toBe(2)
    } finally {
        await item.cleanup()
    }
})

test('coordinates real Instagram renewal across concurrent preparation with stale execution metadata', async () => {
    let renewals = 0
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const oauth = createInstagramOAuth({
        clientId: '1234567890',
        clientSecret: 'synthetic-secret',
        callbackUri: 'https://postdot.test/api/oauth/instagram/callback',
        now: () => now,
        fetcher: async () => {
            renewals++
            entered.resolve()
            await release.promise
            return Response.json({
                access_token: 'renewed-once',
                token_type: 'bearer',
                expires_in: 5184000,
            })
        },
    })
    const item = await fixture({
        realCredentials: true,
        credentialExpiresAt: now + 7200000,
        providerSession: JSON.stringify({
            version: 1,
            issuedAt: now - 30 * dayMs,
            appScopedId: accountId,
            accountType: 'BUSINESS',
        }),
        resolveOAuth: async () => oauth,
        replies: request =>
            request.url.pathname.endsWith('/media_publish')
                ? Response.json({ id: mediaId })
                : Response.json({ id: containerId, status_code: 'FINISHED' }),
    })
    try {
        const first = item.execute()
        await Promise.race([
            entered.promise,
            first.then(() => {
                throw new Error('The expiring credential did not renew')
            }),
        ])
        const second = item.execute()
        release.resolve()
        const outcomes = await Promise.all([first, second])
        expect(renewals).toBe(1)
        expect(outcomes.some(outcome => outcome.type === 'published')).toBe(true)
        expect(
            (
                await item.credentialStore!.resolvePublisherCredentialSecrets(
                    item.target.projectId,
                    item.target.credentialId
                )
            )?.accessToken
        ).toBe('renewed-once')
        expect(
            item.credentialStore!.getPublisherCredential(
                item.target.projectId,
                item.target.credentialId
            )?.expiresAt
        ).toBe(now + 5184000 * 1000)
        for (const request of item.requests)
            expect(new Headers(request.init?.headers).get('authorization')).toBe(
                'Bearer renewed-once'
            )
    } finally {
        await item.cleanup()
    }
})
