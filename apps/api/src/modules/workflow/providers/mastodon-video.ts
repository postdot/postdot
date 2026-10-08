import type { ExternalEffectOutcome } from '@herald/core'
import { MASTODON_MAX_VIDEO_BYTES, type MastodonPublisher } from '@herald/mastodon'

import { ambiguousFailure, permanentFailure } from '../outcomes'
import { openVerifiedPinnedMedia } from './media-integrity'
import type { BuiltInProviderExecutionInput } from './registry'

type MediaResult =
    | { readonly kind: 'ready'; readonly mediaIds: readonly string[] }
    | { readonly kind: 'failed'; readonly outcome: ExternalEffectOutcome }

export async function prepareMastodonVideo(input: {
    execution: BuiltInProviderExecutionInput
    accessToken: string
    publisher: MastodonPublisher
}): Promise<MediaResult> {
    const { execution, publisher, accessToken } = input
    const item = execution.target.media[0]
    const failed = (outcome: ExternalEffectOutcome): MediaResult => ({ kind: 'failed', outcome })
    if (
        execution.target.media.length !== 1 ||
        !item ||
        item.family !== 'video' ||
        item.contentType !== 'video/mp4' ||
        item.byteSize > MASTODON_MAX_VIDEO_BYTES ||
        item.durationMs === null ||
        item.durationMs < 3000 ||
        item.durationMs > 1_800_000 ||
        !item.accessibilityText ||
        item.width === null ||
        item.height === null
    )
        return failed(
            permanentFailure(
                'Mastodon requires one MP4 video with accessibility text, without images'
            )
        )
    if (!execution.media)
        return failed(permanentFailure('The Mastodon media service is unavailable'))
    const store = execution.providerMediaDeliveryStore
    let delivery = store.reserve({
        projectId: execution.target.projectId,
        executionMediaId: item.id,
        publisherId: execution.target.publisherId,
        providerId: 'mastodon',
        at: execution.now,
    })
    if (delivery.state === 'ambiguous')
        return failed(
            ambiguousFailure(delivery.errorMessage ?? 'The Mastodon video requires reconciliation')
        )
    if (delivery.state === 'failed') {
        const retried = store.retry({
            projectId: delivery.projectId,
            deliveryId: delivery.id,
            at: execution.now,
        })
        if (!retried) return failed(permanentFailure('The Mastodon media delivery disappeared'))
        delivery = retried
    }
    if (delivery.state === 'uploaded' && delivery.remoteMediaId)
        return { kind: 'ready', mediaIds: [delivery.remoteMediaId] }
    if (delivery.state === 'pending') {
        const limits = await publisher.getVideoLimits()
        if (limits.kind === 'failure') return failed(limits.outcome)
        if (
            !limits.value.supportedMimeTypes.includes('video/mp4') ||
            item.byteSize > limits.value.maxBytes ||
            item.width * item.height > limits.value.maxPixels
        )
            return failed(
                permanentFailure(
                    'The video exceeds this Mastodon instance’s supported format, size or pixel limit'
                )
            )
        const started = store.start({
            projectId: delivery.projectId,
            deliveryId: delivery.id,
            at: execution.now,
        })
        if (!started) return failed(permanentFailure('The Mastodon media delivery could not start'))
        delivery = started
        const opened = await openVerifiedPinnedMedia(
            execution.media,
            execution.target.projectId,
            item
        ).catch(() => null)
        if (!opened) {
            store.fail({
                projectId: delivery.projectId,
                deliveryId: delivery.id,
                errorCode: 'media_unavailable',
                errorMessage: 'The pinned Mastodon video is unavailable or changed',
                at: execution.now,
            })
            return failed(permanentFailure('The pinned Mastodon video is unavailable or changed'))
        }
        const upload = await publisher.uploadMedia(accessToken, {
            contentType: 'video/mp4',
            size: item.byteSize,
            filename: item.originalFilename,
            accessibilityText: item.accessibilityText,
            stream: opened.stream,
        })
        if (upload.type !== 'uploaded') {
            store.fail({
                projectId: delivery.projectId,
                deliveryId: delivery.id,
                errorCode: 'video_upload_failed',
                errorMessage: upload.errorMessage,
                ambiguous: upload.type === 'ambiguous',
                at: execution.now,
            })
            await opened.stream.cancel().catch(() => undefined)
            return failed(upload)
        }
        const checkpoint = store.recordRemoteMediaId({
            projectId: delivery.projectId,
            deliveryId: delivery.id,
            remoteMediaId: upload.remoteMediaId,
            at: execution.now,
        })
        if (!checkpoint)
            return failed(ambiguousFailure('The Mastodon video identifier could not be persisted'))
        delivery = checkpoint
        if (upload.ready) {
            const completed = store.complete({
                projectId: delivery.projectId,
                deliveryId: delivery.id,
                remoteMediaId: upload.remoteMediaId,
                at: execution.now,
            })
            return completed
                ? { kind: 'ready', mediaIds: [upload.remoteMediaId] }
                : failed(ambiguousFailure('The Mastodon video completion could not be persisted'))
        }
    }
    if (!delivery.remoteMediaId)
        return failed(
            ambiguousFailure('The interrupted Mastodon video upload has no provider identifier')
        )
    const result = await publisher.getMedia(accessToken, delivery.remoteMediaId)
    if (result.kind === 'failure') return failed(result.outcome)
    if (result.value.id !== delivery.remoteMediaId)
        return failed(permanentFailure('Mastodon returned another media attachment'))
    if (result.value.url === null) {
        if (execution.now - delivery.createdAt >= 30 * 60_000)
            return failed(permanentFailure('Mastodon video processing exceeded thirty minutes'))
        return failed({
            type: 'deferred',
            effectOccurred: false,
            resumeAfterMs: 60_000,
            errorMessage: 'Mastodon is processing the video',
        })
    }
    if (result.value.type !== 'video')
        return failed(permanentFailure('Mastodon returned another media type'))
    const completed = store.complete({
        projectId: delivery.projectId,
        deliveryId: delivery.id,
        remoteMediaId: delivery.remoteMediaId,
        remoteMediaUrl: result.value.url,
        at: execution.now,
    })
    return completed
        ? { kind: 'ready', mediaIds: [delivery.remoteMediaId] }
        : failed(ambiguousFailure('The Mastodon video completion could not be persisted'))
}
