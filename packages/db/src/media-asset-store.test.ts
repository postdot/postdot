import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLocalMediaStore } from '@herald/media'

import { closeDatabase, createDatabase } from './client'
import { previewFixturePng } from './image-preview-fixture'
import { createManualStore } from './manual-store'
import { createMediaAssetStore, type MediaAssetStoreOptions } from './media-asset-store'
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
    readonly videoPoster?: MediaAssetStoreOptions['videoPoster']
    readonly onVideoReady?: MediaAssetStoreOptions['onVideoReady']
    readonly now?: () => number
    readonly uploadIntentTtlMs?: number
    readonly deletionGracePeriodMs?: number
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
        videoPoster: options.videoPoster,
        onVideoReady: options.onVideoReady,
        now: options.now ?? (() => now),
        createId: (() => {
            let value = 0
            return () => `media-id-${++value}`
        })(),
        uploadIntentTtlMs: options.uploadIntentTtlMs,
        deletionGracePeriodMs: options.deletionGracePeriodMs ?? 0,
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
    it('moves deleted assets out of the library and restores them from the trash before expiry', async () => {
        let current = now
        await withFixture(
            async ({ media, projectId, subjectId }) => {
                const reservation = media.reserveUpload({
                    projectId,
                    subjectId,
                    originalFilename: 'recoverable.png',
                })
                expect(reservation).not.toBeNull()
                if (reservation === null) throw new Error('Reservation was not created')

                await media.upload({
                    projectId,
                    subjectId,
                    intentId: reservation.intent.id,
                    source: streamOf(createPng()),
                })
                const finalized = await media.finalizeUpload({
                    projectId,
                    subjectId,
                    intentId: reservation.intent.id,
                })
                expect(finalized.kind).toBe('ready')

                expect(media.requestDeletion(projectId, reservation.asset.id, subjectId).kind).toBe(
                    'requested'
                )
                expect(media.listAssetsPage({ projectId, subjectId })?.items).toEqual([])
                expect(media.listAssetsPage({ projectId, subjectId })?.trashCount).toBe(1)

                const trash = media.listAssetsPage({ projectId, subjectId, view: 'trash' })
                expect(trash).toMatchObject({ total: 1, trashCount: 1, retentionMs: 60_000 })
                expect(trash?.items[0]?.asset.state).toBe('deletion_requested')

                const restored = media.restoreDeletion(
                    projectId,
                    reservation.asset.id,
                    subjectId,
                    current + 59_999
                )
                expect(restored.kind).toBe('restored')
                expect(restored.kind === 'restored' ? restored.media.asset.state : null).toBe(
                    'ready'
                )
                expect(media.listAssetsPage({ projectId, subjectId })?.items).toHaveLength(1)
                expect(media.listAssetsPage({ projectId, subjectId, view: 'trash' })?.total).toBe(0)

                media.requestDeletion(projectId, reservation.asset.id, subjectId)
                current += 60_000
                expect(
                    media.restoreDeletion(projectId, reservation.asset.id, subjectId, current)
                ).toEqual({ kind: 'expired' })
                expect(media.listAssetsPage({ projectId, subjectId, view: 'trash' })).toMatchObject(
                    {
                        total: 0,
                        trashCount: 0,
                    }
                )
            },
            { now: () => current, deletionGracePeriodMs: 60_000 }
        )
    })

    it('stores two private previews under one asset and purges all bytes with the original', async () => {
        await withFixture(async ({ media, projectId, subjectId, store }) => {
            const bytes = previewFixturePng()
            const reservation = media.reserveUpload({
                projectId,
                subjectId,
                originalFilename: 'large.png',
                expectedSize: bytes.length,
                contentType: 'image/png',
            })!
            await media.upload({
                projectId,
                subjectId,
                intentId: reservation.intent.id,
                source: streamOf(bytes),
            })
            expect(
                (
                    await media.finalizeUpload({
                        projectId,
                        subjectId,
                        intentId: reservation.intent.id,
                    })
                ).kind
            ).toBe('ready')
            const asset = media.getAsset(projectId, reservation.asset.id, subjectId)!
            expect(media.listAssetsPage({ projectId, subjectId })?.total).toBe(1)
            expect(asset.representations).toHaveLength(3)
            const derived = asset.representations.filter(item => item.kind === 'derived')
            expect(derived.map(item => item.width).sort((a, b) => a! - b!)).toEqual([256, 768])
            for (const item of derived) {
                expect(item.sourceRepresentationId).toBe(reservation.representation.id)
                expect(item.state).toBe('ready')
                expect(item.byteSize!).toBeLessThan(bytes.length)
                expect(JSON.parse(item.recipeJson!).placeholder).toMatch(/^data:image\/png;base64,/)
            }
            const original = await media.openAssetContent(projectId, asset.asset.id, subjectId)
            expect(new Uint8Array(await new Response(original!.stream).arrayBuffer())).toEqual(
                new Uint8Array(bytes)
            )
            const thumbnail = await media.openAssetContent(
                projectId,
                asset.asset.id,
                subjectId,
                undefined,
                'thumbnail'
            )
            const thumbnailBytes = await new Response(thumbnail!.stream).blob()
            expect((await new Bun.Image(thumbnailBytes).metadata()).width).toBe(256)
            expect(
                await media.openAssetContent(
                    projectId,
                    asset.asset.id,
                    'stranger',
                    undefined,
                    'thumbnail'
                )
            ).toBeNull()
            // A missing optional preview does not take a usable original out of service.
            await store.delete(derived[0]!.objectKey)
            await media.reconcile()
            expect(media.getAsset(projectId, asset.asset.id, subjectId)?.asset.state).toBe('ready')
            expect(media.requestDeletion(projectId, asset.asset.id, subjectId).kind).toBe(
                'requested'
            )
            expect(
                (await media.permanentlyDeleteAsset(projectId, asset.asset.id, subjectId)).kind
            ).toBe('deleted')
            for (const item of asset.representations)
                expect(await store.stat(item.objectKey)).toBeNull()
            console.info(
                'Preview bytes:',
                bytes.length,
                derived.map(item => item.byteSize)
            )
        })
    })

    it('waits for a preview write before purging an import deleted during generation', async () => {
        await withFixture(async ({ media, projectId, subjectId, store }) => {
            const bytes = previewFixturePng(4, 3)
            const reservation = media.reserveUpload({
                projectId,
                subjectId,
                originalFilename: 'race.png',
                expectedSize: bytes.length,
                contentType: 'image/png',
            })!
            await media.upload({
                projectId,
                subjectId,
                intentId: reservation.intent.id,
                source: streamOf(bytes),
            })
            const put = store.put.bind(store)
            let release!: () => void
            let started!: () => void
            const held = new Promise<void>(resolve => {
                release = resolve
            })
            const reached = new Promise<void>(resolve => {
                started = resolve
            })
            store.put = async (key, source, options) => {
                if (key.startsWith('previews/')) {
                    started()
                    await held
                }
                return put(key, source, options)
            }
            const finalizing = media.finalizeUpload({
                projectId,
                subjectId,
                intentId: reservation.intent.id,
            })
            await reached
            const snapshot = media.getAsset(projectId, reservation.asset.id, subjectId)!
            expect(media.requestDeletion(projectId, reservation.asset.id, subjectId).kind).toBe(
                'requested'
            )
            const purging = media.permanentlyDeleteAsset(projectId, reservation.asset.id, subjectId)
            release()
            await finalizing
            expect((await purging).kind).toBe('deleted')
            for (const item of snapshot.representations)
                expect(await store.stat(item.objectKey)).toBeNull()
            expect(media.getAsset(projectId, reservation.asset.id, subjectId)).toBeNull()
        })
    })

    it('preserves the original and tracks cleanup when preview storage fails after writing bytes', async () => {
        await withFixture(async ({ media, projectId, subjectId, store }) => {
            const bytes = previewFixturePng(4, 3)
            const reservation = media.reserveUpload({
                projectId,
                subjectId,
                originalFilename: 'failure.png',
                expectedSize: bytes.length,
                contentType: 'image/png',
            })!
            await media.upload({
                projectId,
                subjectId,
                intentId: reservation.intent.id,
                source: streamOf(bytes),
            })
            const put = store.put.bind(store)
            store.put = async (key, source, options) => {
                const result = await put(key, source, options)
                if (key.startsWith('previews/')) throw new Error('Simulated storage failure')
                return result
            }
            expect(
                (
                    await media.finalizeUpload({
                        projectId,
                        subjectId,
                        intentId: reservation.intent.id,
                    })
                ).kind
            ).toBe('ready')
            const asset = media.getAsset(projectId, reservation.asset.id, subjectId)!
            expect(asset.representations.find(item => item.kind === 'derived')?.state).toBe(
                'failed'
            )
            const fallback = await media.openAssetContent(
                projectId,
                asset.asset.id,
                subjectId,
                undefined,
                'thumbnail'
            )
            expect(new Uint8Array(await new Response(fallback!.stream).arrayBuffer())).toEqual(
                new Uint8Array(bytes)
            )
            expect(media.requestDeletion(projectId, asset.asset.id, subjectId).kind).toBe(
                'requested'
            )
            expect(
                (await media.permanentlyDeleteAsset(projectId, asset.asset.id, subjectId)).kind
            ).toBe('deleted')
            for (const item of asset.representations)
                expect(await store.stat(item.objectKey)).toBeNull()
        })
    })

    it('backfills legacy images without duplicates and repairs only the missing stored variant', async () => {
        await withFixture(async ({ media, projectId, subjectId, store, database }) => {
            const bytes = previewFixturePng(40, 30)
            const reservation = media.reserveUpload({
                projectId,
                subjectId,
                originalFilename: 'legacy.png',
                expectedSize: bytes.length,
                contentType: 'image/png',
            })!
            await media.upload({
                projectId,
                subjectId,
                intentId: reservation.intent.id,
                source: streamOf(bytes),
            })
            await media.finalizeUpload({ projectId, subjectId, intentId: reservation.intent.id })
            const initial = media.getAsset(projectId, reservation.asset.id, subjectId)!
            for (const item of initial.representations.filter(item => item.kind === 'derived'))
                await store.delete(item.objectKey)
            database.$client.run(
                "delete from media_representations where asset_id = ? and kind = 'derived'",
                [reservation.asset.id]
            )
            expect(await media.generateMissingImagePreviews({ dryRun: true })).toEqual({
                eligible: 1,
                generated: 0,
                alreadyReady: 0,
                failed: 0,
            })
            expect(
                media.getAsset(projectId, reservation.asset.id, subjectId)?.representations
            ).toHaveLength(1)
            expect(
                await media.generateMissingImagePreviews({ projectId: 'other-project' })
            ).toEqual({ eligible: 0, generated: 0, alreadyReady: 0, failed: 0 })
            expect(await media.generateMissingImagePreviews()).toEqual({
                eligible: 1,
                generated: 1,
                alreadyReady: 0,
                failed: 0,
            })
            const filled = media.getAsset(projectId, reservation.asset.id, subjectId)!
            expect(filled.representations).toHaveLength(3)
            expect(await media.generateMissingImagePreviews()).toEqual({
                eligible: 1,
                generated: 0,
                alreadyReady: 1,
                failed: 0,
            })
            expect(
                media.getAsset(projectId, reservation.asset.id, subjectId)?.representations
            ).toEqual(filled.representations)
            const previews = filled.representations.filter(item => item.kind === 'derived')
            await store.delete(previews[0]!.objectKey)
            expect(await media.generateMissingImagePreviews()).toEqual({
                eligible: 1,
                generated: 1,
                alreadyReady: 0,
                failed: 0,
            })
            const repaired = media.getAsset(projectId, reservation.asset.id, subjectId)!
            expect(repaired.representations.find(item => item.id === previews[0]!.id)?.state).toBe(
                'failed'
            )
            expect(repaired.representations.find(item => item.id === previews[1]!.id)).toEqual(
                previews[1]
            )
            expect(
                repaired.representations.filter(
                    item => item.kind === 'derived' && item.state === 'ready'
                )
            ).toHaveLength(2)
            expect(repaired.representations.find(item => item.kind === 'original')).toEqual(
                initial.representations.find(item => item.kind === 'original')
            )
            const original = await media.openAssetContent(
                projectId,
                reservation.asset.id,
                subjectId
            )
            expect(new Uint8Array(await new Response(original!.stream).arrayBuffer())).toEqual(
                new Uint8Array(bytes)
            )
            media.requestDeletion(projectId, reservation.asset.id, subjectId)
            expect((await media.generateMissingImagePreviews()).eligible).toBe(0)
        })
    })

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
            expect(firstPage?.total).toBe(3)
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

    it('paginates a large media catalog without skipping or duplicating assets', async () => {
        await withFixture(async ({ database, media, projectId, actorId, subjectId }) => {
            const timestamp = now
            const checksum = 'a'.repeat(64)

            database.$client.run('begin')
            try {
                for (let index = 0; index < 1_000; index += 1) {
                    const assetId = `large-asset-${String(index).padStart(4, '0')}`
                    const createdAt = timestamp - index
                    database.$client.run(
                        `insert into media_assets (
                            id, project_id, original_filename, default_accessibility_text,
                            state, created_by_actor_id, created_at, updated_at
                        ) values (?, ?, ?, null, 'ready', ?, ?, ?)`,
                        [assetId, projectId, `${assetId}.png`, actorId, createdAt, createdAt]
                    )
                    database.$client.run(
                        `insert into media_representations (
                            id, project_id, asset_id, kind, state, store_id, object_key,
                            declared_content_type, detected_content_type, detected_format,
                            family, byte_size, sha256, width, height, is_animated,
                            created_at, updated_at
                        ) values (?, ?, ?, 'original', 'ready', ?, ?, 'image/png', 'image/png',
                                  'png', 'image', 128, ?, 16, 16, 0, ?, ?)`,
                        [
                            `large-representation-${String(index).padStart(4, '0')}`,
                            projectId,
                            assetId,
                            'local-default',
                            `large/${assetId}.png`,
                            checksum,
                            createdAt,
                            createdAt,
                        ]
                    )
                }
                database.$client.run('commit')
            } catch (error) {
                database.$client.run('rollback')
                throw error
            }

            const seenAssetIds = new Set<string>()
            let cursor: string | undefined
            let pageCount = 0
            while (pageCount < 100) {
                const page = media.listAssetsPage({
                    projectId,
                    subjectId,
                    cursor,
                    limit: 24,
                })
                expect(page).not.toBeNull()
                if (page === null) throw new Error('Media page was not returned')
                expect(page.total).toBe(1_000)
                pageCount += 1
                for (const item of page.items) {
                    expect(seenAssetIds.has(item.asset.id)).toBe(false)
                    seenAssetIds.add(item.asset.id)
                }
                if (page.nextCursor === null) break
                cursor = page.nextCursor
            }

            expect(pageCount).toBe(42)
            expect(seenAssetIds.size).toBe(1_000)
        })
    })

    it('applies media filters and sort orders before paginating', async () => {
        let currentTime = now
        await withFixture(
            async ({ media, projectId, subjectId }) => {
                async function createReady(filename: string, bytes = createPng()) {
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
                        source: streamOf(bytes),
                    })
                    expect(uploaded.kind).toBe('uploaded')

                    const finalized = await media.finalizeUpload({
                        projectId,
                        subjectId,
                        intentId: reservation.intent.id,
                    })
                    expect(finalized.kind).toBe('ready')
                    if (finalized.kind !== 'ready') throw new Error('Media was not finalized')
                }

                await createReady('zulu.png')
                currentTime -= 8 * 24 * 60 * 60 * 1_000
                await createReady('alpha.png', new Uint8Array([...createPng(), 1, 2, 3]))
                currentTime -= 32 * 24 * 60 * 60 * 1_000
                await createReady('middle.png')
                currentTime = now

                const byName = media.listAssetsPage({
                    projectId,
                    subjectId,
                    limit: 2,
                    sort: 'name_asc',
                })
                expect(byName?.items.map(item => item.asset.originalFilename)).toEqual([
                    'alpha.png',
                    'middle.png',
                ])
                expect(byName?.total).toBe(3)
                expect(byName?.nextCursor).not.toBeNull()
                const byNameSecondPage = media.listAssetsPage({
                    projectId,
                    subjectId,
                    cursor: byName?.nextCursor,
                    sort: 'name_asc',
                    limit: 2,
                })
                expect(byNameSecondPage?.items.map(item => item.asset.originalFilename)).toEqual([
                    'zulu.png',
                ])

                const largest = media.listAssetsPage({
                    projectId,
                    subjectId,
                    sort: 'largest',
                })
                expect(largest?.items.map(item => item.asset.originalFilename)).toEqual([
                    'alpha.png',
                    'middle.png',
                    'zulu.png',
                ])

                const recent = media.listAssetsPage({
                    projectId,
                    subjectId,
                    date: 'last_7_days',
                })
                expect(recent?.items.map(item => item.asset.originalFilename)).toEqual(['zulu.png'])
                expect(recent?.total).toBe(1)
                const month = media.listAssetsPage({
                    projectId,
                    subjectId,
                    date: 'last_30_days',
                })
                expect(month?.items.map(item => item.asset.originalFilename)).toEqual([
                    'zulu.png',
                    'alpha.png',
                ])
                const images = media.listAssetsPage({
                    projectId,
                    subjectId,
                    family: 'image',
                })
                expect(images?.items).toHaveLength(3)
                const documents = media.listAssetsPage({
                    projectId,
                    subjectId,
                    family: 'document',
                })
                expect(documents?.items).toEqual([])

                expect(() =>
                    media.listAssetsPage({
                        projectId,
                        subjectId,
                        cursor: byName?.nextCursor,
                        sort: 'oldest',
                    })
                ).toThrow()
            },
            { now: () => currentTime }
        )
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
                media.permanentlyDeleteAsset(projectId, reservation?.asset.id ?? '', subjectId, now)
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
            const blocked = await media.permanentlyDeleteAsset(
                projectId,
                reservation?.asset.id ?? '',
                subjectId,
                now
            )
            expect(blocked).toEqual({ kind: 'blocked', reason: 'referenced' })

            database.$client.run('delete from posts where id = ?', ['post-media-reference'])
            const deleted = await media.permanentlyDeleteAsset(
                projectId,
                reservation?.asset.id ?? '',
                subjectId,
                now
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
        await withFixture(
            async ({ media, projectId, subjectId }) => {
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
                expect(
                    media.restoreDeletion(projectId, reservation.asset.id, subjectId, now)
                ).toEqual({
                    kind: 'not_restorable',
                })

                await expect(
                    media.permanentlyDeleteAsset(projectId, reservation.asset.id, subjectId, now)
                ).resolves.toMatchObject({
                    kind: 'deleted',
                    media: { asset: { state: 'deleted' } },
                })
            },
            { deletionGracePeriodMs: 60_000 }
        )
    })
})

describe('optional video posters', () => {
    it('finalizes before decoding, persists internal variants and preserves original delivery', async () => {
        let decoded = 0
        let signalled = 0
        await withFixture(
            async ({ media, database, projectId, subjectId, store }) => {
                const bytes = new Uint8Array(
                    await Bun.file(
                        new URL('./fixtures/video-h264.mp4', import.meta.url)
                    ).arrayBuffer()
                )
                const reservation = media.reserveUpload({
                    projectId,
                    subjectId,
                    originalFilename: 'video.mp4',
                    contentType: 'video/mp4',
                    expectedSize: bytes.length,
                })!
                await media.upload({
                    projectId,
                    subjectId,
                    intentId: reservation.intent.id,
                    source: streamOf(bytes),
                })
                const result = await media.finalizeUpload({
                    projectId,
                    subjectId,
                    intentId: reservation.intent.id,
                })
                expect(result.kind).toBe('ready')
                expect(signalled).toBe(1)
                expect(decoded).toBe(0)
                expect(media.listPendingVideoPreviews()).toEqual([
                    { projectId, id: reservation.asset.id },
                ])
                expect(await media.generateVideoPreviews(projectId, reservation.asset.id)).toBe(
                    true
                )
                expect(decoded).toBe(1)
                expect(media.listPendingVideoPreviews()).toEqual([])
                const asset = media.getAsset(projectId, reservation.asset.id, subjectId)!
                expect(
                    asset.representations.filter(
                        item => item.kind === 'derived' && item.state === 'ready'
                    )
                ).toHaveLength(2)
                const original = await media.openAssetContent(
                    projectId,
                    reservation.asset.id,
                    subjectId
                )
                expect(new Uint8Array(await new Response(original!.stream).arrayBuffer())).toEqual(
                    bytes
                )
                const preview = await media.openAssetContent(
                    projectId,
                    reservation.asset.id,
                    subjectId,
                    undefined,
                    'thumbnail'
                )
                expect(preview!.representation.detectedContentType).toBe('image/webp')
                expect(
                    database.$client
                        .query(
                            "select count(*) as count from audit_events where action = 'project.media_previews.updated'"
                        )
                        .get()
                ).toEqual({ count: 1 })
                expect(await media.generateVideoPreviews(projectId, reservation.asset.id)).toBe(
                    true
                )
                expect(decoded).toBe(1)
                expect(
                    await store.stat(
                        asset.representations.find(item => item.kind === 'original')!.objectKey
                    )
                ).not.toBeNull()
            },
            {
                videoPoster: async () => {
                    decoded++
                    return new Blob([previewFixturePng(40, 30)])
                },
                onVideoReady: () => {
                    signalled++
                },
            }
        )
    })
    it('records one failed attempt without changing original readiness', async () => {
        await withFixture(
            async ({ media, projectId, subjectId }) => {
                const bytes = new Uint8Array(
                    await Bun.file(
                        new URL('./fixtures/video-h264.mp4', import.meta.url)
                    ).arrayBuffer()
                )
                const reservation = media.reserveUpload({
                    projectId,
                    subjectId,
                    originalFilename: 'video.mp4',
                    contentType: 'video/mp4',
                    expectedSize: bytes.length,
                })!
                await media.upload({
                    projectId,
                    subjectId,
                    intentId: reservation.intent.id,
                    source: streamOf(bytes),
                })
                expect(
                    (
                        await media.finalizeUpload({
                            projectId,
                            subjectId,
                            intentId: reservation.intent.id,
                        })
                    ).kind
                ).toBe('ready')
                expect(await media.generateVideoPreviews(projectId, reservation.asset.id)).toBe(
                    false
                )
                expect(media.listPendingVideoPreviews()).toEqual([])
                expect(
                    media.getAsset(projectId, reservation.asset.id, subjectId)!.asset.state
                ).toBe('ready')
                expect(
                    await media.openAssetContent(projectId, reservation.asset.id, subjectId)
                ).not.toBeNull()
            },
            {
                videoPoster: async () => {
                    throw new Error('Private decoder detail')
                },
            }
        )
    })
})
