import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAuth } from '@herald/auth'
import { closeDatabase, createDatabase, createMediaAssetStore, runMigrations } from '@herald/db'
import { createLocalMediaStore } from '@herald/media'

import { createApp } from '../../app'
import { createPublisherRuntime } from '../publishers/runtime'
import { createMediaPublicDelivery } from './public-delivery'

const baseURL = 'http://localhost:3000'
const secret = 'herald-test-secret-with-at-least-32-characters'
const mediaPublicUrlSecret = 'herald-media-public-url-secret-with-at-least-32-characters'
const now = 1_800_000_000_000
const publisherEncryptionKey = new Uint8Array(32).fill(9)

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
        const media = createMediaAssetStore(
            database,
            createLocalMediaStore({
                storeId: 'local-test',
                rootDirectory,
                maxObjectBytes: 2_000_000,
            }),
            {
                now: () => now,
                createId: (() => {
                    let value = 0
                    return () => `media-id-${++value}`
                })(),
                deletionGracePeriodMs: 0,
            }
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

            const bytes = createPng()
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
            expect(finalizedBody).toMatchObject({
                status: 'ready',
                media: {
                    asset: { id: reservationBody.asset.id, state: 'ready' },
                    representations: [
                        {
                            state: 'ready',
                            detectedFormat: 'png',
                            detectedContentType: 'image/png',
                            family: 'image',
                            width: 4,
                            height: 3,
                        },
                    ],
                },
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
            expect(contentResponse.headers.get('etag')).toBe(
                `"${finalizedBody.media.representations[0]?.sha256}"`
            )
            expect(Array.from(new Uint8Array(await contentResponse.arrayBuffer()))).toEqual(
                Array.from(bytes)
            )

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
                `/api/projects/${projectBody.project.id}/media?limit=1&search=cover`,
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
                    '/api/projects/{projectId}/media/{assetId}/usage',
                    '/api/projects/{projectId}/media/{assetId}/content',
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
