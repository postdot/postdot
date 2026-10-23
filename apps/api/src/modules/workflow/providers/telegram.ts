import { createHash } from 'node:crypto'

import type { ExternalEffectOutcome } from '@postdot/core'
import {
    createTelegramPublisher,
    isTelegramChannelId,
    TELEGRAM_EXECUTION_REVISION,
    type TELEGRAM_POLL_EXECUTION_REVISION,
    TELEGRAM_ALBUM_EXECUTION_REVISION,
    readTelegramPoll,
    telegramChannelProfileValidationAdapter,
    TELEGRAM_MAX_PHOTO_BYTES,
    TELEGRAM_MAX_VIDEO_BYTES,
    type TelegramMedia,
} from '@postdot/telegram'

import { ambiguousFailure, permanentFailure, retryableFailure } from '../outcomes'
import { effectFetcher } from './effect-fetcher'
import { openVerifiedPinnedMedia } from './media-integrity'
import type { BuiltInProviderAdapter, BuiltInProviderExecutionInput } from './registry'

type TelegramRevision =
    | typeof TELEGRAM_EXECUTION_REVISION
    | typeof TELEGRAM_POLL_EXECUTION_REVISION
    | typeof TELEGRAM_ALBUM_EXECUTION_REVISION

export function createTelegramProviderAdapter(
    options: {
        readonly revision?: TelegramRevision
        readonly createPublisher?: () => ReturnType<typeof createTelegramPublisher>
    } = {}
): BuiltInProviderAdapter {
    const revision = options.revision ?? TELEGRAM_ALBUM_EXECUTION_REVISION
    return {
        providerId: 'telegram',
        contractId: 'telegram',
        revision,
        execute: input =>
            execute(
                input,
                revision,
                options.createPublisher ??
                    (() =>
                        createTelegramPublisher({
                            fetcher: effectFetcher(input.signal, undefined, input.assertActive),
                        }))
            ),
    }
}

async function execute(
    input: BuiltInProviderExecutionInput,
    revision: TelegramRevision,
    createPublisher: () => ReturnType<typeof createTelegramPublisher>
): Promise<ExternalEffectOutcome> {
    const { target } = input
    const destination = target.destination
    if (destination?.type !== 'channel' || !isTelegramChannelId(destination.id))
        return permanentFailure('The Telegram channel destination is unavailable')
    if (
        target.profile.execution.kind !== 'built_in' ||
        target.profile.execution.contractId !== 'telegram' ||
        target.profile.execution.revision !== revision ||
        (revision === TELEGRAM_EXECUTION_REVISION && target.content.poll !== undefined) ||
        typeof target.content.text !== 'string' ||
        !Array.isArray(target.content.media) ||
        target.media.length > (revision === TELEGRAM_ALBUM_EXECUTION_REVISION ? 10 : 1) ||
        new Set(target.media.map(item => item.id)).size !== target.media.length ||
        target.mediaReferenceCount !== target.media.length ||
        target.content.media.length !== target.media.length ||
        target.media.some(
            (item, index) =>
                item.position !== index ||
                item.contentPath !== `/media/${index}` ||
                (target.content.media as { assetId?: unknown }[])[index]?.assetId !== item.assetId
        ) ||
        telegramChannelProfileValidationAdapter.validate(target.profile, target.content).length > 0
    )
        return permanentFailure('The Telegram execution content is invalid')
    const poll =
        target.content.poll === undefined ? undefined : readTelegramPoll(target.content.poll)
    if (poll === null || (poll !== undefined && target.media.length > 0))
        return permanentFailure('The Telegram poll content is invalid')
    const secrets = await input.credentials.resolvePublisherCredentialSecrets(
        target.projectId,
        target.credentialId
    )
    if (!secrets) return permanentFailure('The Telegram credential is unavailable')
    const media: TelegramMedia[] = []
    const deliveries: { id: string }[] = []
    // Preflight every ledger entry before claiming any member of the album.
    for (const pinned of target.media) {
        const photo =
            pinned.family === 'image' && ['image/png', 'image/jpeg'].includes(pinned.contentType)
        if (
            !input.media ||
            !(photo || (pinned.family === 'video' && pinned.contentType === 'video/mp4')) ||
            pinned.byteSize <= 0 ||
            pinned.byteSize > (photo ? TELEGRAM_MAX_PHOTO_BYTES : TELEGRAM_MAX_VIDEO_BYTES) ||
            !pinned.width ||
            !pinned.height ||
            (photo &&
                (pinned.width + pinned.height > 10000 ||
                    Math.max(pinned.width / pinned.height, pinned.height / pinned.width) > 20))
        )
            return permanentFailure('The pinned Telegram media is invalid or unavailable')
        let delivery = input.providerMediaDeliveryStore.reserve({
            projectId: target.projectId,
            executionMediaId: pinned.id,
            publisherId: target.publisherId,
            providerId: 'telegram',
            at: input.now,
        })
        if (
            ['uploading', 'uploaded', 'ambiguous'].includes(delivery.state) ||
            delivery.remoteMediaId !== null
        )
            return ambiguousFailure(
                'The Telegram media delivery requires reconciliation before retrying'
            )
        if (delivery.state === 'failed') {
            const retried = input.providerMediaDeliveryStore.retry({
                projectId: target.projectId,
                deliveryId: delivery.id,
                at: input.now,
            })
            if (!retried) return permanentFailure('The Telegram media delivery cannot be retried')
            delivery = retried
        }
        deliveries.push({ id: delivery.id })
    }
    const startedIds: string[] = []
    const failAll = (ambiguous: boolean, code: string) => {
        for (const id of startedIds) failDelivery(input, id, ambiguous, code)
    }
    for (const delivery of deliveries) {
        const started = input.providerMediaDeliveryStore.start({
            projectId: target.projectId,
            deliveryId: delivery.id,
            at: input.now,
        })
        if (!started || started.state !== 'uploading') {
            // No request has been issued; other members can safely be retried.
            failAll(false, 'claim_failed')
            return ambiguousFailure('The Telegram media delivery could not be claimed')
        }
        startedIds.push(delivery.id)
    }
    // Read and hash all members before issuing the single provider request.
    for (const pinned of target.media) {
        try {
            const opened = await openVerifiedPinnedMedia(input.media!, target.projectId, pinned)
            if (!opened) {
                failAll(false, 'media_unavailable')
                return permanentFailure('The pinned Telegram media changed or is unavailable')
            }
            const blob = new Blob([await new Response(opened.stream).arrayBuffer()], {
                type: pinned.contentType,
            })
            const hash = createHash('sha256')
            for await (const bytes of blob.stream()) hash.update(bytes)
            if (blob.size !== pinned.byteSize || hash.digest('hex') !== pinned.sha256) {
                failAll(false, 'media_changed')
                return permanentFailure('The pinned Telegram media changed while reading')
            }
            media.push({ blob, width: pinned.width!, height: pinned.height! })
        } catch {
            failAll(false, 'media_read_failed')
            return retryableFailure('The pinned Telegram media could not be read; retry is safe')
        }
    }
    let outcome: Awaited<ReturnType<ReturnType<typeof createTelegramPublisher>['send']>>
    try {
        outcome = await createPublisher().send({
            token: secrets.accessToken,
            chatId: destination.id,
            text: target.content.text,
            ...(media.length > 1 ? { album: media } : { media: media[0] }),
            ...(poll === undefined ? {} : { poll }),
        })
    } catch {
        failAll(true, 'unknown_result')
        return ambiguousFailure('The Telegram publication outcome is unknown')
    }
    if (outcome.type === 'published') {
        const mediaIds =
            media.length > 1 ? outcome.mediaIds : outcome.mediaId ? [outcome.mediaId] : []
        if (!mediaIds || mediaIds.length !== deliveries.length || mediaIds.some(id => !id.trim())) {
            failAll(true, 'missing_media_id')
            return ambiguousFailure('Telegram returned no durable media identity')
        }
        for (const [index, delivery] of deliveries.entries()) {
            const completed = input.providerMediaDeliveryStore.complete({
                projectId: target.projectId,
                deliveryId: delivery.id,
                remoteMediaId: mediaIds[index]!,
                at: input.now,
            })
            if (completed?.state !== 'uploaded')
                return ambiguousFailure('The Telegram media delivery could not be completed')
        }
        // Only common publication identity crosses into the executor outcome.
        return {
            type: 'published',
            externalId: outcome.externalId,
            ...(outcome.externalUrl ? { externalUrl: outcome.externalUrl } : {}),
        }
    }
    if (outcome.code === 'authentication_required')
        input.credentials.markPublisherCredentialReconnectRequired(
            target.projectId,
            target.credentialId
        )
    failAll(outcome.type === 'ambiguous', outcome.code)
    return outcome
}
function failDelivery(
    input: BuiltInProviderExecutionInput,
    deliveryId: string,
    ambiguous: boolean,
    errorCode: string
) {
    input.providerMediaDeliveryStore.fail({
        projectId: input.target.projectId,
        deliveryId,
        ambiguous,
        errorCode,
        errorMessage: ambiguous
            ? 'The Telegram delivery result requires inspection'
            : 'The Telegram media delivery did not complete',
        at: input.now,
    })
}
