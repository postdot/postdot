import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAuth } from '@herald/auth'
import { closeDatabase, createDatabase, createMediaAssetStore, runMigrations } from '@herald/db'
import { createLocalMediaStore, type MediaStore } from '@herald/media'

import { previewFixturePng } from '../../../../../packages/db/src/image-preview-fixture'
import { createApp } from '../../app'
import { createPublisherRuntime } from '../publishers/runtime'
import { createMediaPublicDelivery } from './public-delivery'

const baseURL = 'http://localhost:3000'
const secret = 'herald-test-secret-with-at-least-32-characters'
const mediaPublicUrlSecret = 'herald-media-public-url-secret-with-at-least-32-characters'
const now = 1_800_000_000_000
const publisherEncryptionKey = new Uint8Array(32).fill(9)

async function signUp(app: ReturnType<typeof createApp>): Promise<string> {
    const response = await app.handle(
        new Request(`${baseURL}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                origin: baseURL,
            },
            body: JSON.stringify({
                email: 'media-operator@herald.local',
                name: 'Media Operator',
                password: 'correct-horse-battery-staple',
            }),
        })
    )
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
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
    headers.set('cookie', cookie)
    if (init.body !== undefined) headers.set('content-type', 'application/json')

    return app.handle(
        new Request(`${baseURL}${path}`, {
            ...init,
            headers,
        })
    )
}

describe('media HTTP routes', () => {
    it('executes the authenticated upload, inspection, listing, and deletion flow', async () => {
        const rootDirectory = await mkdtemp(join(tmpdir(), 'herald-api-media-'))
        const database = createDatabase(':memory:')
        runMigrations(database)
        const publisher = createPublisherRuntime(database, {
            apiOrigin: baseURL,
            webOrigin: 'http://localhost:5173',
            publisherEncryptionKey,
            publisherEncryptionKeyId: 'test-v1',
        })
        const auth = createAuth(database, { baseURL, secret })
        let failNextMediaObjectDelete = false
        const localMediaStore = createLocalMediaStore({
            storeId: 'local-test',
            rootDirectory,
            maxObjectBytes: 2_000_000,
        })
        const mediaStore: MediaStore = {
            storeId: localMediaStore.storeId,
            maxObjectBytes: localMediaStore.maxObjectBytes,
            put: (key, source, options) => localMediaStore.put(key, source, options),
            stat: key => localMediaStore.stat(key),
            open: (key, options) => localMediaStore.open(key, options),
            async delete(key) {
                if (failNextMediaObjectDelete) {
                    failNextMediaObjectDelete = false
                    throw new Error('Temporary object-store failure')
                }
                await localMediaStore.delete(key)
            },
        }
        const media = createMediaAssetStore(database, mediaStore, {
            now: () => now,
            createId: (() => {
                let value = 0
                return () => `media-id-${++value}`
            })(),
            deletionGracePeriodMs: 60_000,
        })
        const app = createApp({
            auth,
            database,
            publisher,
            media,
            mediaPublicDelivery: createMediaPublicDelivery({
                baseURL,
                signingSecret: mediaPublicUrlSecret,
                now: () => now,
            }),
            manualStore: { now: () => now },
        })

        try {
            const unauthorizedResponse = await app.handle(
                new Request(`${baseURL}/api/projects/project-id/media`)
            )
            expect(unauthorizedResponse.status).toBe(401)

            const cookie = await signUp(app)
            const projectResponse = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Media Project' }),
            })
            expect(projectResponse.status).toBe(201)
            const projectBody = (await projectResponse.json()) as { project: { id: string } }

            const uploadPolicyResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/upload-policy`,
                cookie
            )
            expect(uploadPolicyResponse.status).toBe(200)
            expect(await uploadPolicyResponse.json()).toEqual({
                allowedContentTypes: ['image/png', 'image/jpeg', 'image/webp', 'video/mp4'],
                maxFileSize: 2_000_000,
            })

            const mediaSourcesResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/sources`,
                cookie
            )
            expect(mediaSourcesResponse.status).toBe(200)
            expect(await mediaSourcesResponse.json()).toEqual({
                sources: [
                    {
                        id: 'device',
                        transfer: 'browser',
                        requiresAuthentication: false,
                    },
                    {
                        id: 'webcam',
                        transfer: 'browser',
                        requiresAuthentication: false,
                    },
                ],
            })

            const disabledUrlImportResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/imports/url`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ url: 'https://images.example/cover.png' }),
                }
            )
            expect(disabledUrlImportResponse.status).toBe(404)

            const bytes = previewFixturePng(4, 3)
            const reserveResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/uploads`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        originalFilename: 'cover.png',
                        defaultAccessibilityText: 'Herald cover',
                        expectedSize: bytes.byteLength,
                        contentType: 'text/plain',
                    }),
                }
            )
            expect(reserveResponse.status).toBe(201)
            const reservationBody = (await reserveResponse.json()) as {
                asset: { id: string; state: string }
                representation: { id: string; state: string }
                intent: { id: string; state: string }
                upload: {
                    intentId: string
                    storeId: string
                    maxBytes: number
                    expectedSize: number
                    contentType: string
                }
            }
            expect(reservationBody.asset.state).toBe('reserved')
            expect(reservationBody.representation.state).toBe('reserved')
            expect(reservationBody.intent.state).toBe('pending')
            expect(reservationBody.upload).toEqual({
                intentId: reservationBody.intent.id,
                storeId: 'local-test',
                maxBytes: 2_000_000,
                expectedSize: bytes.byteLength,
                contentType: 'text/plain',
            })
            expect(reservationBody.representation).not.toHaveProperty('objectKey')

            const uploadResponse = await app.handle(
                new Request(
                    `${baseURL}/api/projects/${projectBody.project.id}/media/uploads/${reservationBody.intent.id}`,
                    {
                        method: 'PUT',
                        headers: { cookie, 'content-type': 'image/png' },
                        body: new Blob([bytes], { type: 'image/png' }),
                    }
                )
            )
            expect(uploadResponse.status).toBe(200)
            const uploadBody = (await uploadResponse.json()) as {
                status: string
                media: { representation: { state: string } }
            }
            expect(uploadBody.status).toBe('uploaded')
            expect(uploadBody.media.representation.state).toBe('stored')

            const finalizeResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/uploads/${reservationBody.intent.id}/finalize`,
                cookie,
                { method: 'POST' }
            )
            expect(finalizeResponse.status).toBe(200)
            const finalizedBody = (await finalizeResponse.json()) as {
                status: string
                media: {
                    asset: { id: string; state: string }
                    representations: Array<{
                        id: string
                        kind: string
                        state: string
                        detectedFormat: string | null
                        detectedContentType: string | null
                        family: string | null
                        sha256: string | null
                        width: number | null
                        height: number | null
                    }>
                }
            }
            expect(finalizedBody.status).toBe('ready')
            expect(finalizedBody.media.asset).toMatchObject({
                id: reservationBody.asset.id,
                state: 'ready',
            })
            expect(finalizedBody.media.representations).toHaveLength(1)
            const originalRepresentation = finalizedBody.media.representations.find(
                item => item.kind === 'original'
            )!
            expect(originalRepresentation).toMatchObject({
                state: 'ready',
                detectedFormat: 'png',
                detectedContentType: 'image/png',
                family: 'image',
                width: 4,
                height: 3,
            })
            expect(finalizedBody.media.representations[0]).not.toHaveProperty('objectKey')

            const contentResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/${reservationBody.asset.id}/content`,
                cookie
            )
            expect(contentResponse.status).toBe(200)
            expect(contentResponse.headers.get('content-type')).toBe('image/png')
            expect(contentResponse.headers.get('content-length')).toBe(String(bytes.byteLength))
            expect(contentResponse.headers.get('cache-control')).toBe('private, no-store')
            expect(contentResponse.headers.get('etag')).toBe(`"${originalRepresentation.sha256}"`)
            expect(Array.from(new Uint8Array(await contentResponse.arrayBuffer()))).toEqual(
                Array.from(bytes)
            )

            const previewResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/${reservationBody.asset.id}/content?variant=thumbnail`,
                cookie
            )
            expect(previewResponse.status).toBe(200)
            expect(previewResponse.headers.get('content-type')).toBe('image/webp')
            const previewBytes = new Uint8Array(await previewResponse.arrayBuffer())
            expect((await new Bun.Image(previewBytes).metadata()).width).toBe(4)
            const previewRange = await app.handle(
                new Request(
                    `${baseURL}/api/projects/${projectBody.project.id}/media/${reservationBody.asset.id}/content?variant=thumbnail`,
                    { headers: { cookie, range: 'bytes=2-5' } }
                )
            )
            expect(previewRange.status).toBe(206)
            expect(new Uint8Array(await previewRange.arrayBuffer())).toEqual(
                previewBytes.slice(2, 6)
            )
            expect(
                (
                    await app.handle(
                        new Request(
                            `${baseURL}/api/projects/${projectBody.project.id}/media/${reservationBody.asset.id}/content?variant=thumbnail`
                        )
                    )
                ).status
            ).toBe(401)

            for (const [range, expectedStatus, expectedBytes] of [
                ['bytes=2-5', 206, bytes.slice(2, 6)],
                ['bytes=-4', 206, bytes.slice(-4)],
                ['bytes=99999-', 416, new Uint8Array(0)],
            ] as const) {
                const response = await app.handle(
                    new Request(
                        `${baseURL}/api/projects/${projectBody.project.id}/media/${reservationBody.asset.id}/content`,
                        { headers: { cookie, range } }
                    )
                )
                expect(response.status).toBe(expectedStatus)
                expect(new Uint8Array(await response.arrayBuffer())).toEqual(expectedBytes)
                expect(response.headers.get('content-range')).not.toBeNull()
            }

            const publicMediaDelivery = createMediaPublicDelivery({
                baseURL,
                signingSecret: mediaPublicUrlSecret,
                now: () => now,
            })
            const publicUrl = publicMediaDelivery.createUrl({
                projectId: projectBody.project.id,
                assetId: reservationBody.asset.id,
                representationId: finalizedBody.media.representations[0]!.id,
            })
            const publicResponse = await app.handle(new Request(publicUrl))
            expect(publicResponse.status).toBe(200)
            expect(publicResponse.headers.get('cache-control')).toBe('private, no-store')
            expect(publicResponse.headers.get('referrer-policy')).toBe('no-referrer')
            expect(publicResponse.headers.get('x-content-type-options')).toBe('nosniff')
            expect(Array.from(new Uint8Array(await publicResponse.arrayBuffer()))).toEqual(
                Array.from(bytes)
            )

            const tamperedPublicUrl = publicUrl.replace(/.$/, publicUrl.endsWith('a') ? 'b' : 'a')
            expect((await app.handle(new Request(tamperedPublicUrl))).status).toBe(404)

            const listResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media?limit=1&search=cover&sort=name_asc&family=image&date=all`,
                cookie
            )
            expect(listResponse.status).toBe(200)
            expect(await listResponse.json()).toMatchObject({
                media: [
                    {
                        asset: { id: reservationBody.asset.id, state: 'ready' },
                        representations: expect.any(Array),
                    },
                ],
                nextCursor: null,
                total: 1,
            })

            const getResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/${reservationBody.asset.id}`,
                cookie
            )
            expect(getResponse.status).toBe(200)
            expect(await getResponse.json()).toMatchObject({
                asset: { id: reservationBody.asset.id, state: 'ready' },
            })

            const batchReserveResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/uploads`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ originalFilename: 'batch.png' }),
                }
            )
            expect(batchReserveResponse.status).toBe(201)
            const batchReservationBody = (await batchReserveResponse.json()) as {
                asset: { id: string }
            }
            const batchDeleteResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/deletion-requests`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        assetIds: [
                            batchReservationBody.asset.id,
                            batchReservationBody.asset.id,
                            'missing-media',
                        ],
                    }),
                }
            )
            expect(batchDeleteResponse.status).toBe(200)
            expect(await batchDeleteResponse.json()).toEqual({
                deletions: [
                    { assetId: batchReservationBody.asset.id, status: 'deletion_requested' },
                    { assetId: 'missing-media', status: 'not_found' },
                ],
            })

            const usageResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/${reservationBody.asset.id}/usage`,
                cookie
            )
            expect(usageResponse.status).toBe(200)
            expect(await usageResponse.json()).toEqual({
                assetId: reservationBody.asset.id,
                active: [],
                history: [],
                auditEventCount: 0,
            })

            const deleteResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/${reservationBody.asset.id}`,
                cookie,
                { method: 'DELETE' }
            )
            expect(deleteResponse.status).toBe(202)
            expect(await deleteResponse.json()).toMatchObject({
                status: 'deletion_requested',
                media: { asset: { state: 'deletion_requested' } },
            })

            const deferredContentResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/${reservationBody.asset.id}/content`,
                cookie
            )
            expect(deferredContentResponse.status).toBe(200)
            expect(Array.from(new Uint8Array(await deferredContentResponse.arrayBuffer()))).toEqual(
                Array.from(bytes)
            )
            const deferredPublicResponse = await app.handle(new Request(publicUrl))
            expect(deferredPublicResponse.status).toBe(200)
            expect(Array.from(new Uint8Array(await deferredPublicResponse.arrayBuffer()))).toEqual(
                Array.from(bytes)
            )

            const deletedMetadataResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/${reservationBody.asset.id}`,
                cookie
            )
            expect(deletedMetadataResponse.status).toBe(404)

            const repeatedDeleteResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/${reservationBody.asset.id}`,
                cookie,
                { method: 'DELETE' }
            )
            expect(repeatedDeleteResponse.status).toBe(200)

            const trashListResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media?view=trash&search=cover`,
                cookie
            )
            expect(trashListResponse.status).toBe(200)
            expect(await trashListResponse.json()).toMatchObject({
                media: [
                    {
                        asset: { id: reservationBody.asset.id, state: 'deletion_requested' },
                    },
                ],
                restorableAssetIds: [reservationBody.asset.id],
                total: 1,
                trashCount: 2,
                retentionMs: 60_000,
            })

            const restoreResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/${reservationBody.asset.id}/restore`,
                cookie,
                { method: 'POST' }
            )
            expect(restoreResponse.status).toBe(200)
            expect(await restoreResponse.json()).toMatchObject({
                status: 'restored',
                media: { asset: { id: reservationBody.asset.id, state: 'ready' } },
            })

            const restoredLibraryResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media?search=cover`,
                cookie
            )
            expect(restoredLibraryResponse.status).toBe(200)
            expect(await restoredLibraryResponse.json()).toMatchObject({
                media: [{ asset: { id: reservationBody.asset.id, state: 'ready' } }],
                total: 1,
            })

            const deleteAgainResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/${reservationBody.asset.id}`,
                cookie,
                { method: 'DELETE' }
            )
            expect(deleteAgainResponse.status).toBe(202)

            failNextMediaObjectDelete = true
            const permanentDeleteResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/${reservationBody.asset.id}/permanent`,
                cookie,
                { method: 'POST' }
            )
            expect(permanentDeleteResponse.status).toBe(202)
            expect(await permanentDeleteResponse.json()).toEqual({ status: 'cleanup_pending' })

            const completedPermanentDeleteResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/${reservationBody.asset.id}/permanent`,
                cookie,
                { method: 'POST' }
            )
            expect(completedPermanentDeleteResponse.status).toBe(200)
            expect(await completedPermanentDeleteResponse.json()).toEqual({ status: 'deleted' })

            const permanentlyDeletedContentResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/${reservationBody.asset.id}/content`,
                cookie
            )
            expect(permanentlyDeletedContentResponse.status).toBe(404)

            const permanentlyDeletedTrashResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media?view=trash&search=cover`,
                cookie
            )
            expect(permanentlyDeletedTrashResponse.status).toBe(200)
            expect(await permanentlyDeletedTrashResponse.json()).toMatchObject({
                media: [],
                total: 0,
            })

            const mismatchReserveResponse = await jsonRequest(
                app,
                `/api/projects/${projectBody.project.id}/media/uploads`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        originalFilename: 'mismatch.png',
                        expectedSize: bytes.byteLength + 1,
                    }),
                }
            )
            expect(mismatchReserveResponse.status).toBe(201)
            const mismatchReservation = (await mismatchReserveResponse.json()) as {
                intent: { id: string }
            }
            const mismatchUploadResponse = await app.handle(
                new Request(
                    `${baseURL}/api/projects/${projectBody.project.id}/media/uploads/${mismatchReservation.intent.id}`,
                    {
                        method: 'PUT',
                        headers: { cookie, 'content-type': 'image/png' },
                        body: new Blob([bytes], { type: 'image/png' }),
                    }
                )
            )
            expect(mismatchUploadResponse.status).toBe(400)
            expect(await mismatchUploadResponse.json()).toEqual({
                error: {
                    code: 'size_mismatch',
                    message: 'The media upload does not satisfy the storage constraints',
                },
            })
        } finally {
            closeDatabase(database)
            await rm(rootDirectory, { recursive: true, force: true })
        }
    })

    it('publishes media routes in the OpenAPI inventory when the media service is enabled', async () => {
        const rootDirectory = await mkdtemp(join(tmpdir(), 'herald-api-media-openapi-'))
        const database = createDatabase(':memory:')
        runMigrations(database)
        const publisher = createPublisherRuntime(database, {
            apiOrigin: baseURL,
            webOrigin: 'http://localhost:5173',
            publisherEncryptionKey,
            publisherEncryptionKeyId: 'test-v1',
        })
        const auth = createAuth(database, { baseURL, secret })
        const media = createMediaAssetStore(
            database,
            createLocalMediaStore({
                storeId: 'local-test',
                rootDirectory,
                maxObjectBytes: 2_000_000,
            }),
            { now: () => now, deletionGracePeriodMs: 0 }
        )
        const app = createApp({
            auth,
            database,
            publisher,
            media,
            mediaPublicDelivery: createMediaPublicDelivery({
                baseURL,
                signingSecret: mediaPublicUrlSecret,
                now: () => now,
            }),
        })

        try {
            const response = await app.handle(new Request(`${baseURL}/openapi/json`))
            expect(response.status).toBe(200)
            const specification = (await response.json()) as {
                paths: Record<
                    string,
                    { readonly get?: { readonly responses?: Record<string, unknown> } }
                >
            }
            expect(Object.keys(specification.paths)).toEqual(
                expect.arrayContaining([
                    '/api/projects/{projectId}/media',
                    '/api/projects/{projectId}/media/{assetId}',
                    '/api/projects/{projectId}/media/{assetId}/restore',
                    '/api/projects/{projectId}/media/{assetId}/permanent',
                    '/api/projects/{projectId}/media/{assetId}/usage',
                    '/api/projects/{projectId}/media/{assetId}/content',
                    '/api/projects/{projectId}/media/deletion-requests',
                    '/api/projects/{projectId}/media/uploads',
                    '/api/projects/{projectId}/media/uploads/{intentId}',
                    '/api/projects/{projectId}/media/uploads/{intentId}/finalize',
                    '/api/media/public/{token}',
                ])
            )
            expect(
                specification.paths['/api/projects/{projectId}/media/{assetId}/content']?.get
                    ?.responses
            ).toHaveProperty('200')
        } finally {
            closeDatabase(database)
            await rm(rootDirectory, { recursive: true, force: true })
        }
    })
})
