import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ChannelProfileDefinition } from '@herald/core'
import { createLocalMediaStore } from '@herald/media'

import { closeDatabase, createDatabase } from './client'
import { createManualStore } from './manual-store'
import { createMediaAssetStore } from './media-asset-store'
import { runMigrations } from './migrations'
import { createProviderMediaDeliveryStore } from './provider-media-delivery-store'
import { publishers, publicationExecutionRevisionMedia, publicationRevisionMedia } from './schema'
import { createWorkflowStore } from './workflow-store'

const now = 1_800_000_000_000

const profile: ChannelProfileDefinition = {
    id: 'media-provider',
    version: 1,
    profileHash: 'sha256:media-provider-profile-v1',
    schemaHash: 'sha256:media-provider-schema-v1',
    origin: 'built_in',
    contentSchema: {
        type: 'object',
        properties: {
            body: { type: 'string', minLength: 1 },
            media: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        assetId: { type: 'string', minLength: 1 },
                        accessibilityText: { type: 'string', minLength: 1 },
                    },
                    required: ['assetId'],
                    additionalProperties: false,
                },
                maxItems: 2,
            },
        },
        required: ['body', 'media'],
        additionalProperties: false,
    },
    fieldBindings: [
        { id: 'body', semantic: 'primary_text', path: '/body' },
        {
            id: 'media',
            semantic: 'ordered_media',
            path: '/media',
            item: { assetIdPath: '/assetId', accessibilityTextPath: '/accessibilityText' },
        },
    ],
    capabilities: {
        revision: 'media-provider-v1',
        textFields: [
            {
                bindingId: 'body',
                acceptedSourceFormats: ['plain_text'],
                maxLength: 10_000,
            },
        ],
        mediaFields: [
            {
                bindingId: 'media',
                families: ['image'],
                mimeTypes: ['image/*'],
                maxItems: 2,
                accessibilityTextRequired: true,
            },
        ],
        relations: [],
    },
    execution: { kind: 'built_in', contractId: 'media-provider', revision: 'v1' },
}

function pngBytes(): Uint8Array {
    const bytes = new Uint8Array(33)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    bytes.set([0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52], 8)
    bytes.set([0, 0, 0, 4, 0, 0, 0, 3], 16)
    return bytes
}

describe('provider media delivery store', () => {
    it('pins revision media before the effect boundary and persists delivery retries', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'herald-provider-media-'))
        const database = createDatabase(':memory:')
        const mediaStore = createLocalMediaStore({
            storeId: 'local-default',
            rootDirectory: join(directory, 'media'),
            maxObjectBytes: 2_000_000,
        })

        try {
            runMigrations(database)
            const media = createMediaAssetStore(database, mediaStore, {
                now: () => now,
                createId: (() => {
                    let sequence = 0
                    return () => `media-${++sequence}`
                })(),
            })
            const manualStore = createManualStore(database, { now: () => now, media })
            const project = manualStore.createProject({
                name: 'Media publication project',
                subjectId: 'subject-1',
                displayName: 'Media operator',
            })
            const channel = manualStore.createChannel({
                projectId: project.project.id,
                subjectId: 'subject-1',
                name: 'Media provider',
                profile,
            })
            if (channel === null) throw new Error('Channel was not created')
            database
                .insert(publishers)
                .values({
                    id: 'publisher-1',
                    projectId: project.project.id,
                    channelId: channel.id,
                    kind: 'media-provider',
                })
                .run()

            const reservation = media.reserveUpload({
                projectId: project.project.id,
                subjectId: 'subject-1',
                originalFilename: 'cover.png',
                defaultAccessibilityText: 'Default cover description',
                expectedSize: 33,
            })
            if (reservation === null) throw new Error('Media reservation was not created')
            await media.upload({
                projectId: project.project.id,
                subjectId: 'subject-1',
                intentId: reservation.intent.id,
                source: new Blob([pngBytes()]).stream(),
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
                    body: { text: 'A publication with media', format: 'plain_text' },
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
            const targetMedia = database.select().from(publicationRevisionMedia).all()
            expect(targetMedia).toHaveLength(1)
            expect(targetMedia[0]?.targetRevisionId ?? null).toBe(publication.targetRevisionId)
            expect(database.select().from(publicationExecutionRevisionMedia).all()).toEqual([])

            const workflow = createWorkflowStore(database)
            const systemActorId = workflow.ensureSystemActor(project.project.id, now)
            if (systemActorId === null) throw new Error('System actor was not created')
            const claimed = workflow.claimNextDueJob({
                actorId: systemActorId,
                claimToken: 'claim-1',
                now,
                leaseExpiresAt: now + 60_000,
            })
            if (claimed === null) throw new Error('Job was not claimed')
            expect(workflow.startExternalEffect(claimed.id, 'claim-1', now + 1)).toBe(true)

            const executionMedia = database.select().from(publicationExecutionRevisionMedia).all()
            expect(executionMedia).toHaveLength(1)
            expect(executionMedia[0]?.assetId).toBe(reservation.asset.id)
            expect(executionMedia[0]?.accessibilityText).toBe('Default cover description')

            const deliveries = createProviderMediaDeliveryStore(database, { now: () => now })
            const delivery = deliveries.reserve({
                projectId: project.project.id,
                executionMediaId: executionMedia[0]?.id ?? '',
                publisherId: 'publisher-1',
                providerId: 'media-provider',
            })
            expect(delivery.state).toBe('pending')
            expect(
                deliveries.start({ projectId: project.project.id, deliveryId: delivery.id })?.state
            ).toBe('uploading')
            const uploaded = deliveries.complete({
                projectId: project.project.id,
                deliveryId: delivery.id,
                remoteMediaId: 'remote-media-1',
                remoteMediaUrl: 'https://provider.test/media/1',
            })
            expect(uploaded).toMatchObject({
                state: 'uploaded',
                attempts: 1,
                remoteMediaId: 'remote-media-1',
            })
            expect(
                deliveries.complete({
                    projectId: project.project.id,
                    deliveryId: delivery.id,
                    remoteMediaId: 'remote-media-1',
                })?.state
            ).toBe('uploaded')

            const checkpointDelivery = deliveries.reserve({
                projectId: project.project.id,
                executionMediaId: executionMedia[0]?.id ?? '',
                publisherId: 'publisher-1',
                providerId: 'checkpoint-provider',
            })
            expect(
                deliveries.start({
                    projectId: project.project.id,
                    deliveryId: checkpointDelivery.id,
                })?.state
            ).toBe('uploading')
            expect(
                deliveries.recordRemoteMediaId({
                    projectId: project.project.id,
                    deliveryId: checkpointDelivery.id,
                    remoteMediaId: 'checkpoint-media',
                })
            ).toMatchObject({ state: 'uploading', remoteMediaId: 'checkpoint-media' })
            expect(
                deliveries.fail({
                    projectId: project.project.id,
                    deliveryId: checkpointDelivery.id,
                    errorCode: 'provider_timeout',
                    errorMessage: 'The upload response was lost after registration',
                    ambiguous: true,
                })
            ).toMatchObject({ state: 'ambiguous', remoteMediaId: 'checkpoint-media' })
            expect(() =>
                deliveries.complete({
                    projectId: project.project.id,
                    deliveryId: checkpointDelivery.id,
                    remoteMediaId: 'another-checkpoint-media',
                })
            ).toThrow('already has another remote media ID')
            expect(
                deliveries.complete({
                    projectId: project.project.id,
                    deliveryId: checkpointDelivery.id,
                    remoteMediaId: 'checkpoint-media',
                })
            ).toMatchObject({ state: 'uploaded', remoteMediaId: 'checkpoint-media' })

            const failedDelivery = deliveries.reserve({
                projectId: project.project.id,
                executionMediaId: executionMedia[0]?.id ?? '',
                publisherId: 'publisher-1',
                providerId: 'other-provider',
            })
            deliveries.start({ projectId: project.project.id, deliveryId: failedDelivery.id })
            expect(
                deliveries.fail({
                    projectId: project.project.id,
                    deliveryId: failedDelivery.id,
                    errorCode: 'rate_limited',
                    errorMessage: 'Provider rate limit',
                })?.state
            ).toBe('failed')
            expect(
                deliveries.retry({ projectId: project.project.id, deliveryId: failedDelivery.id })
                    ?.state
            ).toBe('pending')

            const ambiguousDelivery = deliveries.reserve({
                projectId: project.project.id,
                executionMediaId: executionMedia[0]?.id ?? '',
                publisherId: 'publisher-1',
                providerId: 'ambiguous-provider',
            })
            deliveries.start({ projectId: project.project.id, deliveryId: ambiguousDelivery.id })
            expect(
                deliveries.fail({
                    projectId: project.project.id,
                    deliveryId: ambiguousDelivery.id,
                    errorCode: 'connection_lost',
                    errorMessage: 'The provider response was lost',
                    ambiguous: true,
                })?.state
            ).toBe('ambiguous')
            expect(
                deliveries.retry({
                    projectId: project.project.id,
                    deliveryId: ambiguousDelivery.id,
                })?.state
            ).toBe('ambiguous')
            expect(
                deliveries.complete({
                    projectId: project.project.id,
                    deliveryId: ambiguousDelivery.id,
                    remoteMediaId: 'reconciled-media',
                })
            ).toMatchObject({
                state: 'uploaded',
                remoteMediaId: 'reconciled-media',
            })

            const rejectedAmbiguousDelivery = deliveries.reserve({
                projectId: project.project.id,
                executionMediaId: executionMedia[0]?.id ?? '',
                publisherId: 'publisher-1',
                providerId: 'rejected-ambiguous-provider',
            })
            deliveries.start({
                projectId: project.project.id,
                deliveryId: rejectedAmbiguousDelivery.id,
            })
            deliveries.fail({
                projectId: project.project.id,
                deliveryId: rejectedAmbiguousDelivery.id,
                errorCode: 'connection_lost',
                errorMessage: 'The provider response was lost',
                ambiguous: true,
            })
            expect(
                deliveries.fail({
                    projectId: project.project.id,
                    deliveryId: rejectedAmbiguousDelivery.id,
                    errorCode: 'confirmed_rejected',
                    errorMessage: 'The provider confirms that no media was created',
                })?.state
            ).toBe('failed')

            expect(
                media.requestDeletion(project.project.id, reservation.asset.id, 'subject-1').kind
            ).toBe('requested')
            await expect(
                media.purgeAsset(project.project.id, reservation.asset.id, 'subject-1', now, 0)
            ).resolves.toEqual({ kind: 'blocked', reason: 'referenced' })
        } finally {
            closeDatabase(database)
            await rm(directory, { recursive: true, force: true })
        }
    })
})
