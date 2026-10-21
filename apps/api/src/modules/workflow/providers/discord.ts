import type { ExternalEffectOutcome } from '@postdot/core'
import type { PublisherExecutionTarget } from '@postdot/db'
import {
    DISCORD_EXECUTION_CONTRACT_REVISION,
    DISCORD_IMAGE_EXECUTION_CONTRACT_REVISION,
    DISCORD_MAX_VIDEO_BYTES,
    DISCORD_MAX_ATTACHMENTS,
    DISCORD_MAX_IMAGE_BYTES,
    DISCORD_PROVIDER,
    createDiscordPublisher,
    isDiscordChannelId,
    readDiscordTextContent,
    type DiscordPublisher,
} from '@postdot/discord'

import { ambiguousFailure, permanentFailure, retryableFailure } from '../outcomes'
import { openVerifiedPinnedMedia } from './media-integrity'
import type {
    BuiltInProviderAdapter,
    BuiltInProviderExecutionInput,
    ProviderMediaDeliveryPort,
} from './registry'

export interface DiscordProviderAdapterOptions {
    readonly revision?:
        | typeof DISCORD_EXECUTION_CONTRACT_REVISION
        | typeof DISCORD_IMAGE_EXECUTION_CONTRACT_REVISION
    readonly createPublisher?: () => DiscordPublisher
}

export function createDiscordProviderAdapter(
    options: DiscordProviderAdapterOptions = {}
): BuiltInProviderAdapter {
    return {
        providerId: DISCORD_PROVIDER,
        contractId: DISCORD_PROVIDER,
        revision: options.revision ?? DISCORD_EXECUTION_CONTRACT_REVISION,
        execute: input =>
            executeDiscordPublication({
                input,
                allowVideo: options.revision !== DISCORD_IMAGE_EXECUTION_CONTRACT_REVISION,
                createPublisher: options.createPublisher ?? (() => createDiscordPublisher()),
            }),
    }
}

async function executeDiscordPublication(input: {
    readonly input: BuiltInProviderExecutionInput
    readonly allowVideo: boolean
    readonly createPublisher: () => DiscordPublisher
}): Promise<ExternalEffectOutcome> {
    const { input: execution, createPublisher } = input
    const target = execution.target

    const destination = toDiscordDestination(target.destination)
    if (destination === null) {
        return permanentFailure('The Discord publication destination is unavailable')
    }

    const secrets = await execution.credentials.resolvePublisherCredentialSecrets(
        target.projectId,
        target.credentialId
    )
    if (secrets === null) {
        return permanentFailure('The Discord publisher credential is unavailable')
    }
    const accessToken = secrets.accessToken
    if (accessToken.trim().length === 0) {
        return permanentFailure('The Discord publisher access token is unavailable')
    }

    const text = readDiscordTextContent(target.content)
    if (text === null) {
        return permanentFailure('The execution revision does not contain Discord message text')
    }

    const mediaResult = await prepareDiscordMedia({
        target,
        allowVideo: input.allowVideo,
        media: execution.media,
        providerMediaDeliveryStore: execution.providerMediaDeliveryStore,
        now: execution.now,
    })
    if (mediaResult.kind !== 'ready') return mediaResult.outcome

    const publisher = createPublisher()
    let outcome: Awaited<ReturnType<DiscordPublisher['createMessage']>>
    try {
        outcome = await publisher.createMessage({
            accessToken,
            channelId: destination.id,
            content: text,
            attachments: mediaResult.attachments.map(attachment => ({
                filename: attachment.target.originalFilename,
                contentType: attachment.target.contentType as
                    | 'image/jpeg'
                    | 'image/png'
                    | 'video/mp4',
                description: attachment.target.accessibilityText ?? '',
                stream: attachment.stream,
            })),
        })
    } catch {
        failDiscordDeliveries(
            execution.providerMediaDeliveryStore,
            target.projectId,
            mediaResult.attachments.map(attachment => attachment.delivery.id),
            'unknown_outcome',
            'The Discord message publication outcome is unknown',
            true,
            execution.now
        )
        return ambiguousFailure('The Discord message publication outcome is unknown')
    }

    if (outcome.type === 'published') {
        const attachmentIds = outcome.attachmentIds ?? []
        if (attachmentIds.length !== mediaResult.attachments.length) {
            failDiscordDeliveries(
                execution.providerMediaDeliveryStore,
                target.projectId,
                mediaResult.attachments.map(attachment => attachment.delivery.id),
                'missing_attachment_id',
                'Discord returned an incomplete attachment list',
                true,
                execution.now
            )
            return ambiguousFailure('Discord returned an incomplete attachment list')
        }
        for (const [index, attachment] of mediaResult.attachments.entries()) {
            const remoteMediaId = attachmentIds[index]
            if (remoteMediaId === undefined) continue
            const completed = execution.providerMediaDeliveryStore.complete({
                projectId: target.projectId,
                deliveryId: attachment.delivery.id,
                remoteMediaId,
                at: execution.now,
            })
            if (completed?.state !== 'uploaded') {
                return ambiguousFailure('The Discord media delivery could not be completed')
            }
        }
        return outcome
    }

    if (outcome.type === 'permanent_failure' && outcome.code === 'authentication_required') {
        execution.credentials.markPublisherCredentialReconnectRequired(
            target.projectId,
            target.credentialId
        )
    }
    // A 403 forbidden outcome (for example a missing Send Messages permission) stays
    // permanent without reconnect: the Bot token is valid, the channel grant is not.
    failDiscordDeliveries(
        execution.providerMediaDeliveryStore,
        target.projectId,
        mediaResult.attachments.map(attachment => attachment.delivery.id),
        outcome.code,
        outcome.errorMessage,
        outcome.type === 'ambiguous',
        execution.now
    )
    return outcome
}

interface PreparedDiscordAttachment {
    readonly target: PublisherExecutionTarget['media'][number]
    readonly delivery: ReturnType<ProviderMediaDeliveryPort['reserve']>
    readonly stream: ReadableStream<Uint8Array>
}

async function prepareDiscordMedia(input: {
    readonly target: PublisherExecutionTarget
    readonly allowVideo: boolean
    readonly media: BuiltInProviderExecutionInput['media']
    readonly providerMediaDeliveryStore: ProviderMediaDeliveryPort
    readonly now: number
}): Promise<
    | { readonly kind: 'ready'; readonly attachments: readonly PreparedDiscordAttachment[] }
    | { readonly kind: 'failed'; readonly outcome: ExternalEffectOutcome }
> {
    if (input.target.media.length === 0) return { kind: 'ready', attachments: [] }
    const videos = input.target.media.filter(item => item.family === 'video')
    if (
        videos.length > 0 &&
        (!input.allowVideo ||
            input.target.media.length !== 1 ||
            videos[0]!.contentType !== 'video/mp4' ||
            videos[0]!.durationMs === null ||
            videos[0]!.durationMs < 3000 ||
            videos[0]!.durationMs > 1_800_000)
    )
        return {
            kind: 'failed',
            outcome: permanentFailure(
                'This Discord execution requires one ready MP4 without images'
            ),
        }
    if (input.target.media.length > DISCORD_MAX_ATTACHMENTS) {
        return {
            kind: 'failed',
            outcome: permanentFailure(
                `Discord messages support up to ${DISCORD_MAX_ATTACHMENTS} attachments`
            ),
        }
    }
    if (input.media === undefined) {
        return {
            kind: 'failed',
            outcome: permanentFailure(
                'Media lifecycle service is required for Discord attachments'
            ),
        }
    }

    const prepared: PreparedDiscordAttachment[] = []
    for (const targetMedia of input.target.media) {
        if (
            !(
                (targetMedia.family === 'image' &&
                    (targetMedia.contentType === 'image/jpeg' ||
                        targetMedia.contentType === 'image/png')) ||
                (input.allowVideo &&
                    targetMedia.family === 'video' &&
                    targetMedia.contentType === 'video/mp4')
            )
        ) {
            await abortPreparedMedia({
                store: input.providerMediaDeliveryStore,
                projectId: input.target.projectId,
                prepared,
                errorCode: 'unsupported_media',
                errorMessage: 'Discord attachments support JPEG, PNG and an exclusive MP4 video',
                now: input.now,
            })
            return {
                kind: 'failed',
                outcome: permanentFailure(
                    'Discord attachments support JPEG, PNG and an exclusive MP4 video'
                ),
            }
        }
        if (
            targetMedia.byteSize >
            (targetMedia.family === 'video' ? DISCORD_MAX_VIDEO_BYTES : DISCORD_MAX_IMAGE_BYTES)
        ) {
            await abortPreparedMedia({
                store: input.providerMediaDeliveryStore,
                projectId: input.target.projectId,
                prepared,
                errorCode: 'media_too_large',
                errorMessage: 'The Discord attachment exceeds the 10 MiB limit',
                now: input.now,
            })
            return {
                kind: 'failed',
                outcome: permanentFailure('The Discord attachment exceeds the 10 MiB limit'),
            }
        }
        if (targetMedia.accessibilityText === null) {
            await abortPreparedMedia({
                store: input.providerMediaDeliveryStore,
                projectId: input.target.projectId,
                prepared,
                errorCode: 'missing_accessibility_text',
                errorMessage: 'Discord attachments require accessibility text',
                now: input.now,
            })
            return {
                kind: 'failed',
                outcome: permanentFailure('Discord attachments require accessibility text'),
            }
        }

        const delivery = input.providerMediaDeliveryStore.reserve({
            projectId: input.target.projectId,
            executionMediaId: targetMedia.id,
            publisherId: input.target.publisherId,
            providerId: DISCORD_PROVIDER,
            at: input.now,
        })
        if (delivery.state === 'ambiguous') {
            const errorMessage =
                delivery.errorMessage ?? 'The Discord media delivery requires reconciliation'
            await abortPreparedMedia({
                store: input.providerMediaDeliveryStore,
                projectId: input.target.projectId,
                prepared,
                errorCode: 'delivery_ambiguous',
                errorMessage,
                now: input.now,
            })
            return {
                kind: 'failed',
                outcome: ambiguousFailure(errorMessage),
            }
        }

        let current = delivery
        if (current.state === 'failed') {
            const retried = input.providerMediaDeliveryStore.retry({
                projectId: input.target.projectId,
                deliveryId: current.id,
                at: input.now,
            })
            if (retried === null) {
                await abortPreparedMedia({
                    store: input.providerMediaDeliveryStore,
                    projectId: input.target.projectId,
                    prepared,
                    errorCode: 'delivery_missing',
                    errorMessage: 'The Discord media delivery disappeared',
                    now: input.now,
                })
                return {
                    kind: 'failed',
                    outcome: permanentFailure('The Discord media delivery disappeared'),
                }
            }
            current = retried
        }

        if (current.state === 'uploaded' || current.remoteMediaId !== null) {
            const errorMessage =
                current.state === 'uploaded'
                    ? 'The Discord media delivery requires reconciliation'
                    : 'The Discord image upload has no durable provider identifier'
            await abortPreparedMedia({
                store: input.providerMediaDeliveryStore,
                projectId: input.target.projectId,
                prepared,
                errorCode: 'delivery_ambiguous',
                errorMessage,
                now: input.now,
            })
            return {
                kind: 'failed',
                outcome: ambiguousFailure(errorMessage),
            }
        }

        if (current.state === 'uploading') {
            await abortPreparedMedia({
                store: input.providerMediaDeliveryStore,
                projectId: input.target.projectId,
                prepared,
                errorCode: 'upload_in_progress',
                errorMessage: 'The Discord image upload has no durable provider identifier',
                now: input.now,
            })
            failDiscordDeliveries(
                input.providerMediaDeliveryStore,
                input.target.projectId,
                [current.id],
                'upload_in_progress',
                'The Discord image upload has no durable provider identifier',
                true,
                input.now
            )
            return {
                kind: 'failed',
                outcome: ambiguousFailure(
                    'The Discord image upload has no durable provider identifier'
                ),
            }
        }

        const started = input.providerMediaDeliveryStore.start({
            projectId: input.target.projectId,
            deliveryId: current.id,
            at: input.now,
        })
        if (started === null || started.state !== 'uploading') {
            await abortPreparedMedia({
                store: input.providerMediaDeliveryStore,
                projectId: input.target.projectId,
                prepared,
                errorCode: 'delivery_start_failure',
                errorMessage: 'The Discord media delivery could not be started',
                now: input.now,
            })
            return {
                kind: 'failed',
                outcome: permanentFailure('The Discord media delivery could not be started'),
            }
        }

        let opened: Awaited<
            ReturnType<NonNullable<typeof input.media>['openRepresentationContent']>
        >
        try {
            opened = await openVerifiedPinnedMedia(input.media, input.target.projectId, targetMedia)
        } catch {
            await abortPreparedMedia({
                store: input.providerMediaDeliveryStore,
                projectId: input.target.projectId,
                prepared,
                errorCode: 'media_read_failure',
                errorMessage: 'The pinned Discord image could not be read; retry is safe',
                now: input.now,
            })
            failDiscordDeliveries(
                input.providerMediaDeliveryStore,
                input.target.projectId,
                [started.id],
                'media_read_failure',
                'The pinned Discord image could not be read; retry is safe',
                false,
                input.now
            )
            return {
                kind: 'failed',
                outcome: retryableFailure(
                    'The pinned Discord image could not be read; retry is safe'
                ),
            }
        }
        if (opened === null) {
            await abortPreparedMedia({
                store: input.providerMediaDeliveryStore,
                projectId: input.target.projectId,
                prepared,
                errorCode: 'media_unavailable',
                errorMessage: 'The pinned Discord image representation is unavailable or changed',
                now: input.now,
            })
            failDiscordDeliveries(
                input.providerMediaDeliveryStore,
                input.target.projectId,
                [started.id],
                'media_unavailable',
                'The pinned Discord image representation is unavailable or changed',
                false,
                input.now
            )
            return {
                kind: 'failed',
                outcome: permanentFailure(
                    'The pinned Discord image representation is unavailable or changed'
                ),
            }
        }

        prepared.push({ target: targetMedia, delivery: started, stream: opened.stream })
    }

    return { kind: 'ready', attachments: prepared }
}

function failDiscordDeliveries(
    store: ProviderMediaDeliveryPort,
    projectId: string,
    deliveryIds: readonly string[],
    errorCode: string,
    errorMessage: string,
    ambiguous: boolean,
    at: number
): void {
    for (const deliveryId of deliveryIds) {
        try {
            store.fail({ projectId, deliveryId, errorCode, errorMessage, ambiguous, at })
        } catch {
            // The caller already classifies the outcome as ambiguous when persistence fails.
        }
    }
}

async function cancelPreparedStreams(
    prepared: readonly PreparedDiscordAttachment[]
): Promise<void> {
    for (const attachment of prepared) {
        try {
            await attachment.stream.cancel()
        } catch {
            // Preserve the validation failure that caused the cancellation.
        }
    }
}

async function abortPreparedMedia(input: {
    readonly store: ProviderMediaDeliveryPort
    readonly projectId: string
    readonly prepared: readonly PreparedDiscordAttachment[]
    readonly errorCode: string
    readonly errorMessage: string
    readonly now: number
}): Promise<void> {
    await cancelPreparedStreams(input.prepared)
    failDiscordDeliveries(
        input.store,
        input.projectId,
        input.prepared.map(attachment => attachment.delivery.id),
        input.errorCode,
        input.errorMessage,
        false,
        input.now
    )
}

function toDiscordDestination(
    value: PublisherExecutionTarget['destination']
): { readonly type: 'channel'; readonly id: string } | null {
    if (value === null || value.type !== 'channel') return null
    const id = value.id.trim()
    return isDiscordChannelId(id) ? { type: 'channel', id } : null
}
