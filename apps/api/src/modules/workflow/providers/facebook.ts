import { createHash } from 'node:crypto'

import type { ExternalEffectOutcome } from '@postdot/core'
import {
    createFacebookPublisher,
    FACEBOOK_EXECUTION_REVISION,
    facebookChannelProfileValidationAdapter,
    FACEBOOK_MAX_PHOTO_BYTES,
    type FacebookPhoto,
} from '@postdot/facebook'

import { ambiguousFailure, permanentFailure, retryableFailure } from '../outcomes'
import { effectFetcher } from './effect-fetcher'
import { openVerifiedPinnedMedia } from './media-integrity'
import type { BuiltInProviderAdapter, BuiltInProviderExecutionInput } from './registry'

export function createFacebookProviderAdapter(
    options: { readonly createPublisher?: () => ReturnType<typeof createFacebookPublisher> } = {}
): BuiltInProviderAdapter {
    return {
        providerId: 'facebook',
        contractId: 'facebook',
        revision: FACEBOOK_EXECUTION_REVISION,
        execute: input =>
            execute(
                input,
                options.createPublisher ??
                    (() =>
                        createFacebookPublisher({
                            fetcher: effectFetcher(input.signal, undefined, input.assertActive),
                        }))
            ),
    }
}

async function execute(
    input: BuiltInProviderExecutionInput,
    createPublisher: () => ReturnType<typeof createFacebookPublisher>
): Promise<ExternalEffectOutcome> {
    const { target } = input
    const destination = target.destination
    if (
        destination?.type !== 'channel' ||
        !/^[1-9]\d*$/.test(destination.id) ||
        target.externalAccountId !== destination.id
    )
        return permanentFailure('The Facebook channel destination is unavailable')
    if (
        (target.content.text !== undefined && typeof target.content.text !== 'string') ||
        (target.content.link !== undefined && typeof target.content.link !== 'string') ||
        target.profile.execution.kind !== 'built_in' ||
        target.profile.execution.contractId !== 'facebook' ||
        target.profile.execution.revision !== FACEBOOK_EXECUTION_REVISION ||
        !Array.isArray(target.content.media) ||
        target.media.length > 1 ||
        target.mediaReferenceCount !== target.media.length ||
        target.content.media.length !== target.media.length ||
        facebookChannelProfileValidationAdapter.validate(target.profile, target.content).length > 0
    )
        return permanentFailure('The Facebook execution content is invalid')
    const secrets = await input.credentials.resolvePublisherCredentialSecrets(
        target.projectId,
        target.credentialId
    )
    if (!secrets) return permanentFailure('The Facebook credential is unavailable')
    let photoInput: FacebookPhoto | undefined
    let deliveryId: string | undefined
    const pinned = target.media[0]
    if (pinned) {
        const reference = target.content.media[0]
        if (
            reference === null ||
            typeof reference !== 'object' ||
            !('assetId' in reference) ||
            reference.assetId !== pinned.assetId
        )
            return permanentFailure('The Facebook media reference does not match its pinned asset')
        const photo =
            pinned.family === 'image' && ['image/png', 'image/jpeg'].includes(pinned.contentType)
        if (
            !input.media ||
            !photo ||
            pinned.byteSize <= 0 ||
            pinned.byteSize > FACEBOOK_MAX_PHOTO_BYTES ||
            !pinned.width ||
            !pinned.height
        )
            return permanentFailure('The pinned Facebook media is invalid or unavailable')
        let delivery = input.providerMediaDeliveryStore.reserve({
            projectId: target.projectId,
            executionMediaId: pinned.id,
            publisherId: target.publisherId,
            providerId: 'facebook',
            at: input.now,
        })
        if (
            ['uploading', 'uploaded', 'ambiguous'].includes(delivery.state) ||
            delivery.remoteMediaId !== null
        )
            return ambiguousFailure(
                'The Facebook media delivery requires reconciliation before retrying'
            )
        if (delivery.state === 'failed') {
            const retried = input.providerMediaDeliveryStore.retry({
                projectId: target.projectId,
                deliveryId: delivery.id,
                at: input.now,
            })
            if (!retried) return permanentFailure('The Facebook media delivery cannot be retried')
            delivery = retried
        }
        deliveryId = delivery.id
        const started = input.providerMediaDeliveryStore.start({
            projectId: target.projectId,
            deliveryId,
            at: input.now,
        })
        if (!started || started.state !== 'uploading')
            return ambiguousFailure('The Facebook media delivery could not be claimed')
        try {
            const opened = await openVerifiedPinnedMedia(input.media, target.projectId, pinned)
            if (!opened) {
                failDelivery(input, deliveryId, false, 'media_unavailable')
                return permanentFailure('The pinned Facebook media changed or is unavailable')
            }
            // Preserve the inspected MIME explicitly: Bun may omit Response.blob() type.
            const blob = new Blob([await new Response(opened.stream).arrayBuffer()], {
                type: pinned.contentType,
            })
            const hash = createHash('sha256')
            for await (const bytes of blob.stream()) hash.update(bytes)
            if (blob.size !== pinned.byteSize || hash.digest('hex') !== pinned.sha256) {
                failDelivery(input, deliveryId, false, 'media_changed')
                return permanentFailure('The pinned Facebook media changed while reading')
            }
            photoInput = { blob, accessibilityText: pinned.accessibilityText ?? undefined }
        } catch {
            failDelivery(input, deliveryId, false, 'media_read_failed')
            return retryableFailure('The pinned Facebook media could not be read; retry is safe')
        }
    }
    let outcome: Awaited<ReturnType<ReturnType<typeof createFacebookPublisher>['send']>>
    try {
        outcome = await createPublisher().send({
            pageToken: secrets.accessToken,
            pageId: destination.id,
            text: typeof target.content.text === 'string' ? target.content.text : '',
            link: typeof target.content.link === 'string' ? target.content.link : undefined,
            photo: photoInput,
        })
    } catch {
        if (deliveryId) failDelivery(input, deliveryId, true, 'unknown_result')
        return ambiguousFailure('The Facebook publication outcome is unknown')
    }
    if (outcome.type === 'published') {
        if (deliveryId) {
            if (!outcome.mediaId) {
                failDelivery(input, deliveryId, true, 'missing_media_id')
                return ambiguousFailure('Facebook returned no durable media identity')
            }
            const completed = input.providerMediaDeliveryStore.complete({
                projectId: target.projectId,
                deliveryId,
                remoteMediaId: outcome.mediaId,
                at: input.now,
            })
            if (completed?.state !== 'uploaded')
                return ambiguousFailure('The Facebook media delivery could not be completed')
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
            ? 'The Facebook delivery result requires inspection'
            : 'The Facebook media delivery did not complete',
        at: input.now,
    })
}
