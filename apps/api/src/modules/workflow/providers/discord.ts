import type { ExternalEffectOutcome } from '@herald/core'
import type { PublisherExecutionTarget } from '@herald/db'
import {
    DISCORD_EXECUTION_CONTRACT_REVISION,
    DISCORD_MAX_ATTACHMENTS,
    DISCORD_MAX_IMAGE_BYTES,
    DISCORD_PROVIDER,
    createDiscordPublisher,
    isDiscordChannelId,
    readDiscordTextContent,
    type DiscordPublisher,
} from '@herald/discord'

import { ambiguousFailure, permanentFailure, retryableFailure } from '../outcomes'
import { openVerifiedPinnedMedia } from './media-integrity'
import type {
    BuiltInProviderAdapter,
    BuiltInProviderExecutionInput,
    ProviderMediaDeliveryPort,
} from './registry'

export interface DiscordProviderAdapterOptions {
    readonly createPublisher?: () => DiscordPublisher
}

export function createDiscordProviderAdapter(
    options: DiscordProviderAdapterOptions = {}
): BuiltInProviderAdapter {
    return {
        providerId: DISCORD_PROVIDER,
        contractId: DISCORD_PROVIDER,
        revision: DISCORD_EXECUTION_CONTRACT_REVISION,
        execute: input =>
            executeDiscordPublication({
                input,
                createPublisher: options.createPublisher ?? (() => createDiscordPublisher()),
            }),
    }
}

async function executeDiscordPublication(input: {
    readonly input: BuiltInProviderExecutionInput
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
                contentType: attachment.target.contentType as 'image/jpeg' | 'image/png',
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
    readonly media: BuiltInProviderExecutionInput['media']
    readonly providerMediaDeliveryStore: ProviderMediaDeliveryPort
    readonly now: number
}): Promise<
    | { readonly kind: 'ready'; readonly attachments: readonly PreparedDiscordAttachment[] }
    | { readonly kind: 'failed'; readonly outcome: ExternalEffectOutcome }
> {
    if (input.target.media.length === 0) return { kind: 'ready', attachments: [] }
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
                'Media lifecycle service is required for Discord image posts'
            ),
        }
    }

    const prepared: PreparedDiscordAttachment[] = []
    for (const targetMedia of input.target.media) {
        if (
            targetMedia.family !== 'image' ||
            (targetMedia.contentType !== 'image/jpeg' && targetMedia.contentType !== 'image/png')
        ) {
            await cancelPreparedStreams(prepared)
            return {
                kind: 'failed',
                outcome: permanentFailure('Discord image posts support JPEG and PNG images only'),
            }
        }
        if (targetMedia.byteSize > DISCORD_MAX_IMAGE_BYTES) {
            await cancelPreparedStreams(prepared)
            return {
                kind: 'failed',
                outcome: permanentFailure('The Discord image exceeds the 10 MiB attachment limit'),
            }
        }
        if (targetMedia.accessibilityText === null) {
            await cancelPreparedStreams(prepared)
            return {
                kind: 'failed',
                outcome: permanentFailure('Discord images require accessibility text'),
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
            await cancelPreparedStreams(prepared)
            return {
                kind: 'failed',
                outcome: ambiguousFailure(
                    delivery.errorMessage ?? 'The Discord media delivery requires reconciliation'
                ),
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
                await cancelPreparedStreams(prepared)
                return {
                    kind: 'failed',
                    outcome: permanentFailure('The Discord media delivery disappeared'),
                }
            }
            current = retried
        }

        if (current.state === 'uploaded' || current.remoteMediaId !== null) {
            await cancelPreparedStreams(prepared)
            return {
                kind: 'failed',
                outcome: ambiguousFailure(
                    current.state === 'uploaded'
                        ? 'The Discord media delivery requires reconciliation'
                        : 'The Discord image upload has no durable provider identifier'
                ),
            }
        }

        if (current.state === 'uploading') {
            await cancelPreparedStreams(prepared)
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
            await cancelPreparedStreams(prepared)
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
            await cancelPreparedStreams(prepared)
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
            await cancelPreparedStreams(prepared)
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

function toDiscordDestination(
    value: PublisherExecutionTarget['destination']
): { readonly type: 'channel'; readonly id: string } | null {
    if (value === null || value.type !== 'channel') return null
    const id = value.id.trim()
    return isDiscordChannelId(id) ? { type: 'channel', id } : null
}
