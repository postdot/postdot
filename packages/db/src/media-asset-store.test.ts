import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLocalMediaStore } from '@herald/media'

import { closeDatabase, createDatabase } from './client'
import { createManualStore } from './manual-store'
import { createMediaAssetStore } from './media-asset-store'
import { runMigrations } from './migrations'
import { actors, posts, projects } from './schema'

const now = 1_800_000_000_000

function createPng(width = 4, height = 3): Uint8Array {
    const bytes = new Uint8Array(33)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8)
    bytes[16] = (width >>> 24) & 0xff
    bytes[17] = (width >>> 16) & 0xff
    bytes[18] = (width >>> 8) & 0xff
    bytes[19] = width & 0xff
    bytes[20] = (height >>> 24) & 0xff
    bytes[21] = (height >>> 16) & 0xff
    bytes[22] = (height >>> 8) & 0xff
    bytes[23] = height & 0xff
    return bytes
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
    return new Blob([bytes]).stream()
}

function seedProject(database: ReturnType<typeof createDatabase>, suffix: string) {
    const projectId = `project-${suffix}`
    const actorId = `actor-${suffix}`
    database
        .insert(projects)
        .values({ id: projectId, name: `Project ${suffix}` })
        .run()
    database
        .insert(actors)
        .values({
            id: actorId,
            projectId,
            kind: 'human',
            subjectId: `subject-${suffix}`,
            displayName: `Editor ${suffix}`,
        })
        .run()
    return { projectId, subjectId: `subject-${suffix}`, actorId }
}

interface MediaFixtureOptions {
    readonly now?: () => number
    readonly uploadIntentTtlMs?: number
}

async function withFixture<T>(
    callback: (fixture: {
        database: ReturnType<typeof createDatabase>
        media: ReturnType<typeof createMediaAssetStore>
        rootDirectory: string
        store: ReturnType<typeof createLocalMediaStore>
        projectId: string
        subjectId: string
        actorId: string
    }) => Promise<T>,
    options: MediaFixtureOptions = {}
): Promise<T> {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'herald-media-assets-'))
    const database = createDatabase(':memory:')
    runMigrations(database)
    const project = seedProject(database, 'media')
    const store = createLocalMediaStore({
        storeId: 'local-default',
        rootDirectory,
        maxObjectBytes: 2_000_000,
    })
    const media = createMediaAssetStore(database, store, {
        now: options.now ?? (() => now),
        createId: (() => {
            let value = 0
            return () => `media-id-${++value}`
        })(),
        uploadIntentTtlMs: options.uploadIntentTtlMs,
        deletionGracePeriodMs: 0,
    })

    try {
        return await callback({
            database,
            media,
            rootDirectory,
            store,
            ...project,
        })
    } finally {
        closeDatabase(database)
        await rm(rootDirectory, { recursive: true, force: true })
    }
}

describe('project media lifecycle', () => {
    it('reserves, streams, verifies, and finalizes an immutable representation', async () => {
        await withFixture(async ({ media, projectId, subjectId }) => {
            const bytes = createPng()
            const reservation = media.reserveUpload({
                projectId,
                subjectId,
                originalFilename: 'cover.png',
                defaultAccessibilityText: 'Herald cover',
                expectedSize: bytes.byteLength,
                contentType: 'text/plain',
            })
            expect(reservation).not.toBeNull()
            expect(reservation?.asset.state).toBe('reserved')
            expect(reservation?.representation.state).toBe('reserved')
            expect(reservation?.intent.state).toBe('pending')

            const uploaded = await media.upload({
                projectId,
                subjectId,
                intentId: reservation?.intent.id ?? '',
                source: streamOf(bytes),
            })
            expect(uploaded.kind).toBe('uploaded')
            if (uploaded.kind !== 'uploaded') return
            expect(uploaded.reservation.asset.state).toBe('stored')

            const finalized = await media.finalizeUpload({
                projectId,
                subjectId,
                intentId: uploaded.reservation.intent.id,
            })
            expect(finalized.kind).toBe('ready')
            if (finalized.kind !== 'ready') return
            expect(finalized.reservation.asset.state).toBe('ready')
            expect(finalized.reservation.representation).toMatchObject({
                state: 'ready',
                detectedContentType: 'image/png',
                detectedFormat: 'png',
                family: 'image',
                byteSize: bytes.byteLength,
                width: 4,
                height: 3,
                isAnimated: false,
            })
            expect(finalized.reservation.representation.sha256).toMatch(/^[a-f0-9]{64}$/)
            expect(finalized.reservation.intent.state).toBe('consumed')
        })
    })

    it('does not trust a declared MIME type and records invalid bytes as failed', async () => {
        await withFixture(async ({ media, projectId, subjectId }) => {
            const reservation = media.reserveUpload({
                projectId,
                subjectId,
                originalFilename: 'not-really-an-image.png',
                contentType: 'image/png',
            })
            expect(reservation).not.toBeNull()
            const uploaded = await media.upload({
                projectId,
                subjectId,
                intentId: reservation?.intent.id ?? '',
                source: streamOf(new TextEncoder().encode('not an image')),
            })
            expect(uploaded.kind).toBe('uploaded')

            const finalized = await media.finalizeUpload({
                projectId,
                subjectId,
                intentId: reservation?.intent.id ?? '',
            })
            expect(finalized.kind).toBe('failed')
            if (finalized.kind !== 'failed') return
            expect(finalized.reservation.asset).toMatchObject({
                state: 'failed',
                failureCode: 'unsupported_format',
            })
            expect(finalized.reservation.representation.declaredContentType).toBe('image/png')
            expect(finalized.reservation.representation.detectedContentType).toBeNull()
        })
    })

    it('supports a separately uploaded object through the same finalizer', async () => {
        await withFixture(async ({ media, store, projectId, subjectId }) => {
            const bytes = createPng(8, 5)
            const reservation = media.reserveUpload({
                projectId,
                subjectId,
                originalFilename: 'direct.png',
                expectedSize: bytes.byteLength,
            })
            expect(reservation).not.toBeNull()
            if (reservation === null) throw new Error('Reservation was not created')
            await store.put(reservation.representation.objectKey, streamOf(bytes), {
                expectedSize: bytes.byteLength,
            })

            const finalized = await media.finalizeUpload({
                projectId,
                subjectId,
                intentId: reservation.intent.id,
            })
            expect(finalized.kind).toBe('ready')
            if (finalized.kind === 'ready') {
                expect(finalized.reservation.representation.width).toBe(8)
                expect(finalized.reservation.representation.height).toBe(5)
            }
        })
    })

    it('lists media with a stable cursor and literal filename search', async () => {
        await withFixture(async ({ media, projectId, subjectId }) => {
            async function createReady(filename: string) {
                const reservation = media.reserveUpload({
                    projectId,
                    subjectId,
                    originalFilename: filename,
                })
                expect(reservation).not.toBeNull()
                if (reservation === null) throw new Error('Reservation was not created')

                const uploaded = await media.upload({
                    projectId,
                    subjectId,
                    intentId: reservation.intent.id,
                    source: streamOf(createPng()),
                })
                expect(uploaded.kind).toBe('uploaded')

                const finalized = await media.finalizeUpload({
                    projectId,
                    subjectId,
                    intentId: reservation.intent.id,
                })
                expect(finalized.kind).toBe('ready')
                if (finalized.kind !== 'ready') throw new Error('Media was not finalized')
                return finalized.reservation
            }

            await createReady('alpha.png')
            await createReady('Beta cover.png')
            await createReady('gamma.png')

            const firstPage = media.listAssetsPage({ projectId, subjectId, limit: 2 })
            expect(firstPage).not.toBeNull()
            expect(firstPage?.items.map(item => item.asset.originalFilename)).toEqual([
                'gamma.png',
                'Beta cover.png',
            ])
            expect(firstPage?.nextCursor).not.toBeNull()

            const secondPage = media.listAssetsPage({
                projectId,
                subjectId,
                cursor: firstPage?.nextCursor,
                limit: 2,
            })
            expect(secondPage?.items.map(item => item.asset.originalFilename)).toEqual([
                'alpha.png',
            ])
            expect(secondPage?.nextCursor).toBeNull()

            const searched = media.listAssetsPage({
                projectId,
                subjectId,
                search: 'BETA',
            })
            expect(searched?.items.map(item => item.asset.originalFilename)).toEqual([
                'Beta cover.png',
            ])

            const wildcardSearch = media.listAssetsPage({
                projectId,
                subjectId,
                search: '%',
            })
            expect(wildcardSearch?.items).toEqual([])

            expect(() =>
                media.listAssetsPage({ projectId, subjectId, cursor: 'invalid-cursor' })
            ).toThrow()
        })
    })

    it('summarizes source, active, and historical media usage', async () => {
        await withFixture(async ({ database, media, projectId, subjectId }) => {
            async function createReady(filename: string) {
                const reservation = media.reserveUpload({
                    projectId,
                    subjectId,
                    originalFilename: filename,
                })
                expect(reservation).not.toBeNull()
                if (reservation === null) throw new Error('Reservation was not created')

                const uploaded = await media.upload({
                    projectId,
                    subjectId,
                    intentId: reservation.intent.id,
                    source: streamOf(createPng()),
                })
                expect(uploaded.kind).toBe('uploaded')

                const finalized = await media.finalizeUpload({
                    projectId,
                    subjectId,
                    intentId: reservation.intent.id,
                })
                expect(finalized.kind).toBe('ready')
                if (finalized.kind !== 'ready') throw new Error('Media was not finalized')
                return finalized.reservation
            }

            const activeAsset = await createReady('active.png')
            const historyAsset = await createReady('history.png')
            const manual = createManualStore(database, { now: () => now, media })
            const channel = manual.createChannel({
                projectId,
                subjectId,
                name: 'Usage destination',
            })
            if (channel === null) throw new Error('The usage channel was not created')

            const activePost = manual.createPost({
                projectId,
                subjectId,
                title: 'Active launch',
                sourceContent: {
                    body: { text: 'Active source', format: 'plain_text' },
                    media: [{ assetId: activeAsset.asset.id }],
                },
                publications: [
                    {
                        channelId: channel.id,
                        scheduledAt: now + 60_000,
                        targetContent: {
                            body: 'Active target',
                            media: [{ assetId: activeAsset.asset.id }],
                        },
                    },
                ],
            })
            const activePublication = activePost?.publications[0]
            if (activePost === null || activePublication === undefined) {
                throw new Error('The active publication was not created')
            }

            const historyPost = manual.createPost({
                projectId,
                subjectId,
                title: 'Historical launch',
                sourceContent: {
                    body: { text: 'Historical source', format: 'plain_text' },
                    media: [],
                },
                publications: [
                    {
                        channelId: channel.id,
                        scheduledAt: now,
                        targetContent: {
                            body: 'Historical target',
                            media: [{ assetId: historyAsset.asset.id }],
                        },
                    },
                ],
            })
            const historyPublication = historyPost?.publications[0]
            if (historyPost === null || historyPublication === undefined) {
                throw new Error('The historical publication was not created')
            }
            expect(
                manual.publishManualPublication({
                    projectId,
                    publicationId: historyPublication.id,
                    subjectId,
                    externalId: 'history-1',
                })
            ).toMatchObject({ state: 'published' })

            const activeUsage = media.getAssetUsage(projectId, activeAsset.asset.id, subjectId)
            expect(activeUsage).toMatchObject({
                assetId: activeAsset.asset.id,
                history: [],
                auditEventCount: 0,
                active: [
                    {
                        kind: 'post',
                        id: activePost.post.id,
                        postId: activePost.post.id,
                        publicationId: null,
                        title: 'Active launch',
                        publicationState: null,
                        scheduledAt: null,
                        channelName: null,
                        locations: ['source'],
                    },
                    {
                        kind: 'publication',
                        id: activePublication.id,
                        postId: activePost.post.id,
                        publicationId: activePublication.id,
                        title: 'Active launch',
                        publicationState: 'scheduled',
                        scheduledAt: now + 60_000,
                        channelName: 'Usage destination',
                        locations: ['draft', 'target'],
                    },
                ],
            })

            const historyUsage = media.getAssetUsage(projectId, historyAsset.asset.id, subjectId)
            expect(historyUsage).toMatchObject({
                assetId: historyAsset.asset.id,
                active: [],
                history: [
                    {
                        kind: 'publication',
                        id: historyPublication.id,
                        postId: historyPost.post.id,
                        publicationId: historyPublication.id,
                        title: 'Historical launch',
                        publicationState: 'published',
                        scheduledAt: now,
                        channelName: 'Usage destination',
                        locations: ['draft', 'target'],
                    },
                ],
                auditEventCount: 0,
            })
        })
    })

    it('keeps project access and deletion references fail-closed', async () => {
        await withFixture(async ({ database, media, projectId, subjectId, actorId }) => {
            const bytes = createPng()
            const reservation = media.reserveUpload({
                projectId,
                subjectId,
                originalFilename: 'referenced.png',
            })
            expect(reservation).not.toBeNull()
            await media.upload({
                projectId,
                subjectId,
                intentId: reservation?.intent.id ?? '',
                source: streamOf(bytes),
            })
            await media.finalizeUpload({
                projectId,
                subjectId,
                intentId: reservation?.intent.id ?? '',
            })

            expect(
                media.getAsset(projectId, reservation?.asset.id ?? '', 'another-subject')
            ).toBeNull()
            database
                .insert(posts)
                .values({
                    id: 'post-media-request-reference',
                    projectId,
                    sourceContent: {
                        body: { text: 'Referenced before deletion', format: 'plain_text' },
                        media: [{ assetId: reservation?.asset.id ?? '' }],
                    },
                    createdByActorId: actorId,
                })
                .run()
            expect(
                media.requestDeletion(projectId, reservation?.asset.id ?? '', subjectId)
            ).toEqual({ kind: 'blocked', reason: 'referenced' })
            database.$client.run('delete from posts where id = ?', ['post-media-request-reference'])

            const requested = media.requestDeletion(
                projectId,
                reservation?.asset.id ?? '',
                subjectId
            )
            expect(requested.kind).toBe('requested')
            expect(requested.kind === 'requested' ? requested.media.asset.archivedAt : null).toBe(
                now
            )

            database.$client.run(
                `insert into media_backup_fences (id, owner_id, expires_at, created_at, updated_at)
                 values (1, 'backup-test', ?, ?, ?)`,
                [now + 1_000, now, now]
            )
            await expect(
                media.purgeAsset(projectId, reservation?.asset.id ?? '', subjectId, now, 0)
            ).resolves.toEqual({ kind: 'blocked', reason: 'backup_in_progress' })
            database.$client.run('delete from media_backup_fences where id = 1')

            database
                .insert(posts)
                .values({
                    id: 'post-media-reference',
                    projectId,
                    sourceContent: {
                        body: { text: 'Referenced media', format: 'plain_text' },
                        media: [{ assetId: reservation?.asset.id ?? '' }],
                    },
                    createdByActorId: actorId,
                })
                .run()
            const blocked = await media.purgeAsset(
                projectId,
                reservation?.asset.id ?? '',
                subjectId,
                now,
                0
            )
            expect(blocked).toEqual({ kind: 'blocked', reason: 'referenced' })

            database.$client.run('delete from posts where id = ?', ['post-media-reference'])
            const deleted = await media.purgeAsset(
                projectId,
                reservation?.asset.id ?? '',
                subjectId,
                now,
                0
            )
            expect(deleted.kind).toBe('deleted')
            expect(media.getAsset(projectId, reservation?.asset.id ?? '', subjectId)).toBeNull()
        })
    })

    it('marks a ready asset failed when reconciliation finds its object missing', async () => {
        await withFixture(async ({ media, store, projectId, subjectId }) => {
            const bytes = createPng()
            const reservation = media.reserveUpload({
                projectId,
                subjectId,
                originalFilename: 'missing.png',
            })
            expect(reservation).not.toBeNull()
            if (reservation === null) throw new Error('Reservation was not created')

            await media.upload({
                projectId,
                subjectId,
                intentId: reservation.intent.id,
                source: streamOf(bytes),
            })
            const finalized = await media.finalizeUpload({
                projectId,
                subjectId,
                intentId: reservation.intent.id,
            })
            expect(finalized.kind).toBe('ready')

            await store.delete(reservation.representation.objectKey)
            await expect(media.reconcile(now)).resolves.toEqual({
                expiredUploads: 0,
                missingObjects: 1,
                deletedAssets: 0,
            })
            expect(media.getAsset(projectId, reservation.asset.id, subjectId)).toMatchObject({
                asset: { state: 'failed', failureCode: 'storage_missing' },
                representations: [{ state: 'failed', failureCode: 'storage_missing' }],
            })
        })
    })

    it('expires uploaded objects and their intents after the upload deadline', async () => {
        let current = now
        await withFixture(
            async ({ media, store, projectId, subjectId }) => {
                const reservation = media.reserveUpload({
                    projectId,
                    subjectId,
                    originalFilename: 'expired.png',
                })
                expect(reservation).not.toBeNull()
                if (reservation === null) throw new Error('Reservation was not created')

                await media.upload({
                    projectId,
                    subjectId,
                    intentId: reservation.intent.id,
                    source: streamOf(createPng()),
                })
                current += 2

                await expect(media.reconcile(current)).resolves.toEqual({
                    expiredUploads: 1,
                    missingObjects: 0,
                    deletedAssets: 0,
                })
                expect(await store.stat(reservation.representation.objectKey)).toBeNull()
                expect(media.getAsset(projectId, reservation.asset.id, subjectId)).toMatchObject({
                    asset: { state: 'failed', failureCode: 'upload_expired' },
                    representations: [{ state: 'failed', failureCode: 'upload_expired' }],
                })
            },
            { now: () => current, uploadIntentTtlMs: 1 }
        )
    })

    it('can delete an incomplete or failed asset without inventing inspection facts', async () => {
        await withFixture(async ({ media, projectId, subjectId }) => {
            const reservation = media.reserveUpload({
                projectId,
                subjectId,
                originalFilename: 'incomplete.png',
            })
            expect(reservation).not.toBeNull()
            if (reservation === null) throw new Error('Reservation was not created')

            const requested = media.requestDeletion(projectId, reservation.asset.id, subjectId)
            expect(requested.kind).toBe('requested')
            if (requested.kind !== 'requested') return
            expect(requested.media.asset.archivedAt).toBe(now)
            expect(requested.media.representations[0]?.state).toBe('deletion_requested')

            await expect(
                media.purgeAsset(projectId, reservation.asset.id, subjectId, now, 0)
            ).resolves.toMatchObject({
                kind: 'deleted',
                media: { asset: { state: 'deleted' } },
            })
        })
    })
})
