import type { ExternalEffectOutcome } from '@herald/core'
import {
    readLinkedInTextContent,
    type LinkedInDestination,
    type LinkedInVideoPublisher,
} from '@herald/linkedin'

import { ambiguousFailure, permanentFailure } from '../outcomes'
import { openVerifiedPinnedMedia } from './media-integrity'
import type { BuiltInProviderExecutionInput } from './registry'

export async function publishLinkedInVideo(input: {
    execution: BuiltInProviderExecutionInput
    accessToken: string
    destination: LinkedInDestination
    publisher: LinkedInVideoPublisher
}): Promise<ExternalEffectOutcome> {
    const { execution, publisher } = input
    const item = execution.target.media[0]
    if (
        execution.target.media.length !== 1 ||
        !item ||
        item.family !== 'video' ||
        item.contentType !== 'video/mp4' ||
        item.durationMs === null ||
        item.durationMs < 3000 ||
        item.durationMs > 1_800_000 ||
        item.byteSize < 75_000 ||
        item.byteSize > 500_000_000
    )
        return permanentFailure(
            'LinkedIn requires one MP4 video, 3 seconds to 30 minutes, between 75 kB and 500 MB, without images'
        )
    const commentary = readLinkedInTextContent(execution.target.content)
    if (!commentary) return permanentFailure('The LinkedIn video commentary is unavailable')
    if (!execution.media) return permanentFailure('The LinkedIn video media service is unavailable')
    const store = execution.providerMediaDeliveryStore
    let delivery = store.reserve({
        projectId: execution.target.projectId,
        executionMediaId: item.id,
        publisherId: execution.target.publisherId,
        providerId: 'linkedin',
        at: execution.now,
    })
    if (delivery.state === 'ambiguous')
        return ambiguousFailure(
            delivery.errorMessage ?? 'The LinkedIn video delivery requires reconciliation'
        )
    if (delivery.state === 'failed') {
        const retried = store.retry({
            projectId: delivery.projectId,
            deliveryId: delivery.id,
            at: execution.now,
        })
        if (!retried) return permanentFailure('The LinkedIn video delivery disappeared')
        delivery = retried
    }
    if (delivery.state === 'pending') {
        const started = store.start({
            projectId: delivery.projectId,
            deliveryId: delivery.id,
            at: execution.now,
        })
        if (!started) return permanentFailure('The LinkedIn video delivery could not start')
        delivery = started
        let opened: Awaited<ReturnType<typeof openVerifiedPinnedMedia>>
        try {
            opened = await openVerifiedPinnedMedia(
                execution.media,
                execution.target.projectId,
                item
            )
        } catch {
            opened = null
        }
        if (!opened) {
            store.fail({
                projectId: delivery.projectId,
                deliveryId: delivery.id,
                errorCode: 'media_unavailable',
                errorMessage: 'The pinned LinkedIn video is unavailable or changed',
                at: execution.now,
            })
            return permanentFailure('The pinned LinkedIn video is unavailable or changed')
        }
        const uploaded = await publisher.uploadVideo({
            accessToken: input.accessToken,
            destination: input.destination,
            media: { size: opened.size, stream: opened.stream },
            onInitialized: id => {
                const checkpoint = store.recordRemoteMediaId({
                    projectId: delivery.projectId,
                    deliveryId: delivery.id,
                    remoteMediaId: id,
                    at: execution.now,
                })
                return checkpoint?.remoteMediaId === id
            },
        })
        if (uploaded.type !== 'uploaded') {
            store.fail({
                projectId: delivery.projectId,
                deliveryId: delivery.id,
                errorCode: 'video_upload_failed',
                errorMessage: uploaded.errorMessage,
                ambiguous: uploaded.type === 'ambiguous',
                at: execution.now,
            })
            try {
                await opened.stream.cancel()
            } catch {
                /* Already consumed or cancelled by the publisher. */
            }
            return uploaded
        }
        const completed = store.complete({
            projectId: delivery.projectId,
            deliveryId: delivery.id,
            remoteMediaId: uploaded.remoteMediaId,
            at: execution.now,
        })
        if (!completed)
            return ambiguousFailure(
                'The LinkedIn video finalization checkpoint could not be persisted'
            )
        delivery = completed
    }
    if (!delivery.remoteMediaId)
        return ambiguousFailure('The interrupted LinkedIn video upload has no provider identifier')
    const status = await publisher.getVideo({
        accessToken: input.accessToken,
        videoId: delivery.remoteMediaId,
    })
    if (status.type !== 'available' && status.type !== 'processing' && status.type !== 'waiting')
        return status
    if (status.type === 'waiting') {
        if (delivery.state === 'uploading')
            store.fail({
                projectId: delivery.projectId,
                deliveryId: delivery.id,
                errorCode: 'video_transfer_unconfirmed',
                errorMessage: 'LinkedIn has not confirmed the interrupted video transfer',
                ambiguous: true,
                at: execution.now,
            })
        return ambiguousFailure(
            'LinkedIn has not confirmed the video transfer; reconciliation is required'
        )
    }
    if (delivery.state === 'uploading') {
        const completed = store.complete({
            projectId: delivery.projectId,
            deliveryId: delivery.id,
            remoteMediaId: delivery.remoteMediaId,
            at: execution.now,
        })
        if (!completed)
            return ambiguousFailure(
                'The LinkedIn video processing checkpoint could not be persisted'
            )
        delivery = completed
    }
    if (status.type === 'processing') {
        if (execution.now - delivery.createdAt > 30 * 60_000)
            return permanentFailure('LinkedIn video processing exceeded thirty minutes')
        return {
            type: 'deferred',
            effectOccurred: false,
            resumeAfterMs: 60_000,
            errorMessage: 'LinkedIn is processing the video',
        }
    }
    return publisher.publishVideo({
        accessToken: input.accessToken,
        destination: input.destination,
        commentary,
        videoId: delivery.remoteMediaId!,
    })
}
