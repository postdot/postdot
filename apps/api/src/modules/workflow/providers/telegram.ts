import { createHash } from 'node:crypto'

import type { ExternalEffectOutcome } from '@postbot/core'
import {
    createTelegramPublisher,
    isTelegramChannelId,
    TELEGRAM_EXECUTION_REVISION,
    telegramChannelProfileValidationAdapter,
    TELEGRAM_MAX_PHOTO_BYTES,
    TELEGRAM_MAX_VIDEO_BYTES,
    type TelegramMedia,
} from '@postbot/telegram'

import { ambiguousFailure, permanentFailure, retryableFailure } from '../outcomes'
import { openVerifiedPinnedMedia } from './media-integrity'
import type { BuiltInProviderAdapter, BuiltInProviderExecutionInput } from './registry'

export function createTelegramProviderAdapter(
    options: { readonly createPublisher?: () => ReturnType<typeof createTelegramPublisher> } = {}
): BuiltInProviderAdapter {
    return {
        providerId: 'telegram',
        contractId: 'telegram',
        revision: TELEGRAM_EXECUTION_REVISION,
        execute: input => execute(input, options.createPublisher ?? createTelegramPublisher),
    }
}

async function execute(
    input: BuiltInProviderExecutionInput,
    createPublisher: () => ReturnType<typeof createTelegramPublisher>
): Promise<ExternalEffectOutcome> {
    const { target } = input
    const destination = target.destination
    if (destination?.type !== 'channel' || !isTelegramChannelId(destination.id))
        return permanentFailure('The Telegram channel destination is unavailable')
    if (
        typeof target.content.text !== 'string' ||
        !Array.isArray(target.content.media) ||
        target.media.length > 1 ||
        target.mediaReferenceCount !== target.media.length ||
        target.content.media.length !== target.media.length ||
        telegramChannelProfileValidationAdapter.validate(target.profile, target.content).length > 0
    )
        return permanentFailure('The Telegram execution content is invalid')
    const secrets = await input.credentials.resolvePublisherCredentialSecrets(
        target.projectId,
        target.credentialId
    )
    if (!secrets) return permanentFailure('The Telegram credential is unavailable')
    let media: TelegramMedia | undefined
    let deliveryId: string | undefined
    const pinned = target.media[0]
    if (pinned) {
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
        deliveryId = delivery.id
        const started = input.providerMediaDeliveryStore.start({
            projectId: target.projectId,
            deliveryId,
            at: input.now,
        })
        if (!started || started.state !== 'uploading')
            return ambiguousFailure('The Telegram media delivery could not be claimed')
        try {
            const opened = await openVerifiedPinnedMedia(input.media, target.projectId, pinned)
            if (!opened) {
                failDelivery(input, deliveryId, false, 'media_unavailable')
                return permanentFailure('The pinned Telegram media changed or is unavailable')
            }
            const blob = await new Response(opened.stream, {
                headers: { 'content-type': pinned.contentType },
            }).blob()
            const hash = createHash('sha256')
            for await (const bytes of blob.stream()) hash.update(bytes)
            if (blob.size !== pinned.byteSize || hash.digest('hex') !== pinned.sha256) {
                failDelivery(input, deliveryId, false, 'media_changed')
                return permanentFailure('The pinned Telegram media changed while reading')
            }
            media = { blob, width: pinned.width, height: pinned.height }
        } catch {
            failDelivery(input, deliveryId, false, 'media_read_failed')
            return retryableFailure('The pinned Telegram media could not be read; retry is safe')
        }
    }
    let outcome: Awaited<ReturnType<ReturnType<typeof createTelegramPublisher>['send']>>
    try {
        outcome = await createPublisher().send({
            token: secrets.accessToken,
            chatId: destination.id,
            text: target.content.text,
            media,
        })
    } catch {
        if (deliveryId) failDelivery(input, deliveryId, true, 'unknown_result')
        return ambiguousFailure('The Telegram publication outcome is unknown')
    }
    if (outcome.type === 'published') {
        if (deliveryId) {
            if (!outcome.mediaId) {
                failDelivery(input, deliveryId, true, 'missing_media_id')
                return ambiguousFailure('Telegram returned no durable media identity')
            }
            const completed = input.providerMediaDeliveryStore.complete({
                projectId: target.projectId,
                deliveryId,
                remoteMediaId: outcome.mediaId,
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
    if (deliveryId) failDelivery(input, deliveryId, outcome.type === 'ambiguous', outcome.code)
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
