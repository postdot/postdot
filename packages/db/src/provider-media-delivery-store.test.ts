import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ChannelProfileDefinition } from '@postdot/core'
import { createLocalMediaStore } from '@postdot/media'

import { previewFixturePng } from './image-preview-fixture'
import { createManualStore } from './manual-store'
import { createMediaAssetStore } from './media-asset-store'
import {
    createProviderMediaDeliveryStore,
    createProviderMediaGroupDeliveryStore,
} from './provider-media-delivery-store'
import {
    closeTestDatabase,
    openTestDatabase,
    seedTestWorkspace,
    type TestRow,
    workspaceOf,
} from './testing'
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

describe('provider media delivery store', () => {
    it('pins revision media before the effect boundary and persists delivery retries', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postdot-provider-media-'))
        const database = (await openTestDatabase()).database
        const mediaStore = createLocalMediaStore({
            storeId: 'local-default',
            rootDirectory: join(directory, 'media'),
            maxObjectBytes: 2_000_000,
        })

        try {
            const media = createMediaAssetStore(database, mediaStore, {
                now: () => now,
                createId: (() => {
                    let sequence = 0
                    return () => `media-${++sequence}`
                })(),
            })
            const manualStore = createManualStore(database, { now: () => now, media })
            const project = await manualStore.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Media publication project',
                subjectId: 'subject-1',
                displayName: 'Media operator',
            })
            const channel = await manualStore.createChannel({
                projectId: project.project.id,
                subjectId: 'subject-1',
                name: 'Media provider',
                profile,
            })
            if (channel === null) throw new Error('Channel was not created')
            await database.sql
                .statement(
                    'insert into "publishers" ("id", "workspace_id", "channel_id", "kind") values (?1, ?2, ?3, ?4)'
                )
                .run(
                    'publisher-1',
                    await workspaceOf(database, project.project.id),
                    channel.id,
                    'media-provider'
                )

            const bytes = previewFixturePng(4, 3)
            const reservation = await media.reserveUpload({
                projectId: project.project.id,
                subjectId: 'subject-1',
                originalFilename: 'cover.png',
                defaultAccessibilityText: 'Default cover description',
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

            const created = await manualStore.createPost({
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
            const targetMedia = await database.sql
                .statement<TestRow>(
                    'select "publication_revision_media"."id" as "id", "publication_revision_media"."project_id" as "projectId", "publication_revision_media"."target_revision_id" as "targetRevisionId", "publication_revision_media"."asset_id" as "assetId", "publication_revision_media"."representation_id" as "representationId", "publication_revision_media"."position" as "position", "publication_revision_media"."content_path" as "contentPath", "publication_revision_media"."role" as "role", "publication_revision_media"."accessibility_text" as "accessibilityText", "publication_revision_media"."created_at" as "createdAt" from "publication_revision_media"'
                )
                .all()
            expect(targetMedia).toHaveLength(1)
            expect(targetMedia[0]?.targetRevisionId ?? null).toBe(publication.targetRevisionId)
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "publication_execution_revision_media"."id" as "id", "publication_execution_revision_media"."project_id" as "projectId", "publication_execution_revision_media"."execution_revision_id" as "executionRevisionId", "publication_execution_revision_media"."target_revision_media_id" as "targetRevisionMediaId", "publication_execution_revision_media"."asset_id" as "assetId", "publication_execution_revision_media"."representation_id" as "representationId", "publication_execution_revision_media"."position" as "position", "publication_execution_revision_media"."content_path" as "contentPath", "publication_execution_revision_media"."role" as "role", "publication_execution_revision_media"."accessibility_text" as "accessibilityText", "publication_execution_revision_media"."created_at" as "createdAt" from "publication_execution_revision_media"'
                    )
                    .all()
            ).toEqual([])

            const workflow = createWorkflowStore(database)
            const systemActorId = await workflow.ensureSystemActor(project.project.id, now)
            if (systemActorId === null) throw new Error('System actor was not created')
            const claimed = await workflow.claimNextDueJob({
                actorId: systemActorId,
                claimToken: 'claim-1',
                now,
                leaseExpiresAt: now + 60_000,
            })
            if (claimed === null) throw new Error('Job was not claimed')
            expect(await workflow.startExternalEffect(claimed.id, 'claim-1', now + 1)).toBe(true)

            const executionMedia = await database.sql
                .statement<TestRow>(
                    'select "publication_execution_revision_media"."id" as "id", "publication_execution_revision_media"."project_id" as "projectId", "publication_execution_revision_media"."execution_revision_id" as "executionRevisionId", "publication_execution_revision_media"."target_revision_media_id" as "targetRevisionMediaId", "publication_execution_revision_media"."asset_id" as "assetId", "publication_execution_revision_media"."representation_id" as "representationId", "publication_execution_revision_media"."position" as "position", "publication_execution_revision_media"."content_path" as "contentPath", "publication_execution_revision_media"."role" as "role", "publication_execution_revision_media"."accessibility_text" as "accessibilityText", "publication_execution_revision_media"."created_at" as "createdAt" from "publication_execution_revision_media"'
                )
                .all()
            expect(executionMedia).toHaveLength(1)
            expect(executionMedia[0]?.assetId).toBe(reservation.asset.id)
            expect(executionMedia[0]?.representationId).toBe(reservation.representation.id)
            expect(
                (await media.getAsset(project.project.id, reservation.asset.id, 'subject-1'))
                    ?.representations
            ).toHaveLength(3)
            expect(executionMedia[0]?.accessibilityText).toBe('Default cover description')

            const deliveries = createProviderMediaDeliveryStore(database, { now: () => now })
            const delivery = await deliveries.reserve({
                projectId: project.project.id,
                executionMediaId: executionMedia[0]?.id ?? '',
                publisherId: 'publisher-1',
                providerId: 'media-provider',
            })
            const groups = createProviderMediaGroupDeliveryStore(database, { now: () => now })
            const groupInput = {
                projectId: project.project.id,
                executionMediaId: executionMedia[0]!.id,
                publisherId: 'publisher-1',
                providerId: 'media-provider',
            }
            const group = await groups.reserve(groupInput)
            expect(group.id).not.toBe(delivery.id)
            expect((await groups.reserve(groupInput)).id).toBe(group.id)
            await groups.start({ projectId: group.projectId, deliveryId: group.id })
            await groups.recordRemoteMediaId({
                projectId: group.projectId,
                deliveryId: group.id,
                remoteMediaId: 'parent-container',
            })
            expect(
                await groups.complete({
                    projectId: group.projectId,
                    deliveryId: group.id,
                    remoteMediaId: 'parent-container',
                })
            ).toMatchObject({ state: 'uploaded', remoteMediaId: 'parent-container' })
            expect((await deliveries.reserve(groupInput)).remoteMediaId).toBeNull()
            expect(delivery.state).toBe('pending')
            expect(
                (await deliveries.start({ projectId: project.project.id, deliveryId: delivery.id }))
                    ?.state
            ).toBe('uploading')
            const uploaded = await deliveries.complete({
                projectId: project.project.id,
                deliveryId: delivery.id,
                remoteMediaId: 'remote-media-1',
                remoteMediaUrl: 'https://provider.test/media/1',
                remoteMediaExpiresAt: now + 60_000,
            })
            expect(uploaded).toMatchObject({
                state: 'uploaded',
                attempts: 1,
                remoteMediaId: 'remote-media-1',
                remoteMediaExpiresAt: now + 60_000,
            })
            expect(
                (
                    await deliveries.complete({
                        projectId: project.project.id,
                        deliveryId: delivery.id,
                        remoteMediaId: 'remote-media-1',
                    })
                )?.state
            ).toBe('uploaded')

            const checkpointDelivery = await deliveries.reserve({
                projectId: project.project.id,
                executionMediaId: executionMedia[0]?.id ?? '',
                publisherId: 'publisher-1',
                providerId: 'checkpoint-provider',
            })
            expect(
                (
                    await deliveries.start({
                        projectId: project.project.id,
                        deliveryId: checkpointDelivery.id,
                    })
                )?.state
            ).toBe('uploading')
            expect(
                await deliveries.recordRemoteMediaId({
                    projectId: project.project.id,
                    deliveryId: checkpointDelivery.id,
                    remoteMediaId: 'checkpoint-media',
                })
            ).toMatchObject({ state: 'uploading', remoteMediaId: 'checkpoint-media' })
            expect(
                await deliveries.fail({
                    projectId: project.project.id,
                    deliveryId: checkpointDelivery.id,
                    errorCode: 'provider_timeout',
                    errorMessage: 'The upload response was lost after registration',
                    ambiguous: true,
                })
            ).toMatchObject({ state: 'ambiguous', remoteMediaId: 'checkpoint-media' })
            await expect(
                deliveries.complete({
                    projectId: project.project.id,
                    deliveryId: checkpointDelivery.id,
                    remoteMediaId: 'another-checkpoint-media',
                })
            ).rejects.toThrow('already has another remote media ID')
            expect(
                await deliveries.complete({
                    projectId: project.project.id,
                    deliveryId: checkpointDelivery.id,
                    remoteMediaId: 'checkpoint-media',
                })
            ).toMatchObject({ state: 'uploaded', remoteMediaId: 'checkpoint-media' })

            const failedDelivery = await deliveries.reserve({
                projectId: project.project.id,
                executionMediaId: executionMedia[0]?.id ?? '',
                publisherId: 'publisher-1',
                providerId: 'other-provider',
            })
            await deliveries.start({ projectId: project.project.id, deliveryId: failedDelivery.id })
            expect(
                (
                    await deliveries.fail({
                        projectId: project.project.id,
                        deliveryId: failedDelivery.id,
                        errorCode: 'rate_limited',
                        errorMessage: 'Provider rate limit',
                    })
                )?.state
            ).toBe('failed')
            expect(
                (
                    await deliveries.retry({
                        projectId: project.project.id,
                        deliveryId: failedDelivery.id,
                    })
                )?.state
            ).toBe('pending')

            const ambiguousDelivery = await deliveries.reserve({
                projectId: project.project.id,
                executionMediaId: executionMedia[0]?.id ?? '',
                publisherId: 'publisher-1',
                providerId: 'ambiguous-provider',
            })
            await deliveries.start({
                projectId: project.project.id,
                deliveryId: ambiguousDelivery.id,
            })
            expect(
                (
                    await deliveries.fail({
                        projectId: project.project.id,
                        deliveryId: ambiguousDelivery.id,
                        errorCode: 'connection_lost',
                        errorMessage: 'The provider response was lost',
                        ambiguous: true,
                    })
                )?.state
            ).toBe('ambiguous')
            expect(
                (
                    await deliveries.retry({
                        projectId: project.project.id,
                        deliveryId: ambiguousDelivery.id,
                    })
                )?.state
            ).toBe('ambiguous')
            expect(
                await deliveries.complete({
                    projectId: project.project.id,
                    deliveryId: ambiguousDelivery.id,
                    remoteMediaId: 'reconciled-media',
                })
            ).toMatchObject({
                state: 'uploaded',
                remoteMediaId: 'reconciled-media',
            })

            const rejectedAmbiguousDelivery = await deliveries.reserve({
                projectId: project.project.id,
                executionMediaId: executionMedia[0]?.id ?? '',
                publisherId: 'publisher-1',
                providerId: 'rejected-ambiguous-provider',
            })
            await deliveries.start({
                projectId: project.project.id,
                deliveryId: rejectedAmbiguousDelivery.id,
            })
            await deliveries.fail({
                projectId: project.project.id,
                deliveryId: rejectedAmbiguousDelivery.id,
                errorCode: 'connection_lost',
                errorMessage: 'The provider response was lost',
                ambiguous: true,
            })
            expect(
                (
                    await deliveries.fail({
                        projectId: project.project.id,
                        deliveryId: rejectedAmbiguousDelivery.id,
                        errorCode: 'confirmed_rejected',
                        errorMessage: 'The provider confirms that no media was created',
                    })
                )?.state
            ).toBe('failed')

            expect(
                await media.requestDeletion(project.project.id, reservation.asset.id, 'subject-1')
            ).toEqual({ kind: 'blocked', reason: 'referenced' })
        } finally {
            await closeTestDatabase(database)
            await rm(directory, { recursive: true, force: true })
        }
    })
})
