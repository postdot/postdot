import type { BlueskyPublisher, BlueskyVideoService } from '@postdot/bluesky'
import {
    readBlueskyVideoBlob,
    BLUESKY_MAX_ALT_TEXT_LENGTH,
    BLUESKY_MAX_VIDEO_BYTES,
    BLUESKY_MAX_VIDEO_DURATION_MS,
} from '@postdot/bluesky'
import type { ExternalEffectOutcome } from '@postdot/core'

import { ambiguousFailure, permanentFailure } from '../outcomes'
import { openVerifiedPinnedMedia } from './media-integrity'
import type { BuiltInProviderExecutionInput } from './registry'

export async function publishBlueskyVideo(input: {
    execution: BuiltInProviderExecutionInput
    service: BlueskyVideoService
    publisher: BlueskyPublisher
    text: string
}): Promise<ExternalEffectOutcome> {
    const { execution, service } = input
    const target = execution.target
    const item = target.media[0]
    if (
        target.media.length !== 1 ||
        !item ||
        item.family !== 'video' ||
        item.contentType !== 'video/mp4' ||
        item.durationMs === null ||
        item.durationMs < 3000 ||
        item.durationMs > BLUESKY_MAX_VIDEO_DURATION_MS ||
        item.byteSize <= 0 ||
        item.byteSize > BLUESKY_MAX_VIDEO_BYTES ||
        !item.width ||
        !item.height ||
        !item.accessibilityText?.trim() ||
        item.accessibilityText.length > BLUESKY_MAX_ALT_TEXT_LENGTH
    ) {
        return permanentFailure(
            'Bluesky requires one MP4, 3 seconds to 10 minutes, at most 100 MB, with description and dimensions'
        )
    }
    if (!execution.media) return permanentFailure('The Bluesky video media service is unavailable')
    const store = execution.providerMediaDeliveryStore
    let delivery = store.reserve({
        projectId: target.projectId,
        executionMediaId: item.id,
        publisherId: target.publisherId,
        providerId: 'bluesky',
        at: execution.now,
    })
    if (delivery.state === 'ambiguous')
        return ambiguousFailure('The Bluesky video upload requires reconciliation')
    if (delivery.state === 'failed') {
        const retried = store.retry({
            projectId: target.projectId,
            deliveryId: delivery.id,
            at: execution.now,
        })
        if (!retried) return permanentFailure('The Bluesky video delivery disappeared')
        delivery = retried
    }
    const fail = (outcome: ExternalEffectOutcome) => {
        if (outcome.type === 'published' || outcome.type === 'deferred') return outcome
        if (delivery.state === 'uploaded') return outcome
        const failed = store.fail({
            projectId: target.projectId,
            deliveryId: delivery.id,
            errorCode: outcome.type,
            errorMessage: outcome.errorMessage,
            ambiguous: outcome.type === 'ambiguous',
            at: execution.now,
        })
        return failed
            ? outcome
            : ambiguousFailure('The Bluesky video delivery state could not be persisted')
    }
    if (delivery.state === 'pending') {
        const limits = await service.checkLimits(item.byteSize)
        if (limits.type !== 'allowed') return limits
        let opened: Awaited<ReturnType<typeof openVerifiedPinnedMedia>>
        try {
            opened = await openVerifiedPinnedMedia(execution.media, target.projectId, item)
        } catch {
            return permanentFailure('The pinned Bluesky video could not be read')
        }
        if (!opened) return permanentFailure('The pinned Bluesky video is unavailable or changed')
        const started = store.start({
            projectId: target.projectId,
            deliveryId: delivery.id,
            at: execution.now,
        })
        if (!started) return permanentFailure('The Bluesky video delivery could not start')
        delivery = started
        const uploaded = await service.upload({ size: opened.size, stream: opened.stream })
        if (uploaded.type !== 'processing' && uploaded.type !== 'ready') return fail(uploaded)
        const remoteMediaId =
            uploaded.type === 'ready'
                ? JSON.stringify(uploaded.blob)
                : JSON.stringify({ type: 'bluesky-video-job', jobId: uploaded.jobId })
        const saved = store.recordRemoteMediaId({
            projectId: target.projectId,
            deliveryId: delivery.id,
            remoteMediaId,
            at: execution.now,
        })
        if (!saved)
            return ambiguousFailure(
                'The Bluesky video processing checkpoint could not be persisted'
            )
        delivery = saved
    }
    if (!delivery.remoteMediaId)
        return ambiguousFailure('The Bluesky video upload has no durable processing identifier')
    let checkpoint: unknown
    try {
        checkpoint = JSON.parse(delivery.remoteMediaId)
    } catch {
        return ambiguousFailure('The stored Bluesky video checkpoint is invalid')
    }
    if (checkpoint === null || typeof checkpoint !== 'object')
        return ambiguousFailure('The stored Bluesky video checkpoint is invalid')
    if ('type' in checkpoint && checkpoint.type === 'bluesky-video-job') {
        if (
            !('jobId' in checkpoint) ||
            typeof checkpoint.jobId !== 'string' ||
            (delivery.state !== 'uploading' && delivery.state !== 'uploaded')
        ) {
            return ambiguousFailure('The stored Bluesky video processing job is invalid')
        }
        if (
            delivery.state !== 'uploaded' &&
            execution.now - (delivery.lastAttemptAt ?? delivery.createdAt) > 30 * 60_000
        )
            return fail(permanentFailure('Bluesky video processing exceeded thirty minutes'))
        const status = await service.getJob(checkpoint.jobId)
        if (delivery.state === 'uploaded' && status.type !== 'ready') {
            // Processing has already completed. A failed status read now belongs
            // to the bounded publication retry budget, not the processing wait.
            return status.type === 'processing'
                ? ambiguousFailure('The completed Bluesky video job is no longer ready')
                : status
        }
        if (status.type === 'processing' || status.type === 'retryable_failure') {
            return {
                type: 'deferred',
                effectOccurred: false,
                resumeAfterMs: 30_000,
                errorMessage: 'Bluesky is processing the video',
            }
        }
        if (status.type !== 'ready') return fail(status)
        checkpoint = status.blob
        // The provider job identity is immutable. Completion retains that checkpoint;
        // future retries resolve the same job without uploading the file again.
    }
    const blob = readBlueskyVideoBlob(checkpoint)
    if (!blob) return ambiguousFailure('The stored Bluesky video blob is invalid')
    if (delivery.state !== 'uploaded') {
        const completed = store.complete({
            projectId: target.projectId,
            deliveryId: delivery.id,
            remoteMediaId: delivery.remoteMediaId!,
            at: execution.now,
        })
        if (!completed) return ambiguousFailure('The Bluesky video delivery could not be completed')
    }
    return input.publisher.publish({
        text: input.text,
        media: [],
        video: {
            blob,
            accessibilityText: item.accessibilityText,
            width: item.width,
            height: item.height,
        },
    })
}
