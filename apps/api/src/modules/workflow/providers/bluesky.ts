import { Agent, type BlobRef } from '@atproto/api'
import {
    BLUESKY_EXECUTION_CONTRACT_REVISION,
    BLUESKY_PROVIDER,
    createBlueskyPublisher,
    readBlueskyTextContent,
    readBlueskySessionTokenSet,
    restoreBlueskySession,
    type BlueskyOAuthClientMetadata,
} from '@herald/bluesky'
import type { ExternalEffectOutcome } from '@herald/core'
import type { PublisherExecutionMedia, PublisherExecutionTarget } from '@herald/db'

import { ambiguousFailure, permanentFailure, retryableFailure } from '../outcomes'
import { openVerifiedPinnedMedia } from './media-integrity'
import type {
    BuiltInProviderAdapter,
    BuiltInProviderExecutionInput,
    ProviderMediaDeliveryPort,
} from './registry'

export interface BlueskyOAuthConfiguration {
    readonly clientMetadata: BlueskyOAuthClientMetadata
    readonly handleResolver: string
}

export interface BlueskyProviderAdapterOptions {
    readonly oauth?: BlueskyOAuthConfiguration
    readonly resolveOAuth?: (
        providerApplicationId: string | null
    ) => Promise<BlueskyOAuthConfiguration | undefined>
    readonly restoreSession?: typeof restoreBlueskySession
    readonly createPublisher?: typeof createBlueskyPublisher
}

export function createBlueskyProviderAdapter(
    options: BlueskyProviderAdapterOptions = {}
): BuiltInProviderAdapter {
    return {
        providerId: BLUESKY_PROVIDER,
        contractId: BLUESKY_PROVIDER,
        revision: BLUESKY_EXECUTION_CONTRACT_REVISION,
        execute: input =>
            executeBlueskyPublication({
                input,
                oauth: options.oauth,
                resolveOAuth: options.resolveOAuth,
                restoreSession: options.restoreSession ?? restoreBlueskySession,
                createPublisher: options.createPublisher ?? createBlueskyPublisher,
            }),
    }
}

async function executeBlueskyPublication(input: {
    readonly input: BuiltInProviderExecutionInput
    readonly oauth: BlueskyOAuthConfiguration | undefined
    readonly resolveOAuth?: (
        providerApplicationId: string | null
    ) => Promise<BlueskyOAuthConfiguration | undefined>
    readonly restoreSession: typeof restoreBlueskySession
    readonly createPublisher: typeof createBlueskyPublisher
}): Promise<ExternalEffectOutcome> {
    const { input: execution } = input
    const oauth = input.resolveOAuth
        ? await input.resolveOAuth(execution.target.providerApplicationId ?? null)
        : input.oauth
    const target = execution.target
    if (oauth === undefined) {
        return permanentFailure('The Bluesky publisher is not configured')
    }

    const destination = toBlueskyDestination(target.destination)
    if (destination === null) {
        return permanentFailure('The Bluesky publication destination is unavailable')
    }

    const secrets = await execution.credentials.resolvePublisherCredentialSecrets(
        target.projectId,
        target.credentialId
    )
    if (secrets === null || secrets.providerSession === null) {
        return permanentFailure('The Bluesky publisher session is unavailable')
    }

    let restored: Awaited<ReturnType<typeof restoreBlueskySession>>
    try {
        restored = await input.restoreSession({
            sub: destination.id,
            serializedSession: secrets.providerSession,
            client: {
                clientMetadata: oauth.clientMetadata,
                handleResolver: oauth.handleResolver,
            },
        })
    } catch {
        execution.credentials.markPublisherCredentialReconnectRequired(
            target.projectId,
            target.credentialId
        )
        return permanentFailure('The Bluesky publisher session could not be restored')
    }

    if (restored.session.did !== destination.id) {
        return permanentFailure('The Bluesky session does not match the publication destination')
    }

    const serializedSession = restored.getSerializedSession()
    const tokenSet = readBlueskySessionTokenSet(serializedSession)
    if (tokenSet === null || tokenSet.sub !== destination.id) {
        return permanentFailure('The Bluesky publisher session contains invalid token data')
    }

    if (serializedSession !== secrets.providerSession) {
        const replaced = await execution.credentials.replacePublisherCredentialTokens({
            projectId: target.projectId,
            credentialId: target.credentialId,
            accessToken: tokenSet.accessToken,
            refreshToken: tokenSet.refreshToken ?? undefined,
            providerSession: serializedSession,
            expiresAt: tokenExpiry(tokenSet.expiresAt, execution.now),
        })
        if (replaced.kind !== 'updated') {
            return retryableFailure('The refreshed Bluesky session could not be persisted')
        }
    }

    const text = readBlueskyTextContent(target.content)
    if (text === null) {
        return permanentFailure('The execution revision does not contain Bluesky post text')
    }

    const mediaResult = await prepareBlueskyMedia({
        target,
        media: execution.media,
        providerMediaDeliveryStore: execution.providerMediaDeliveryStore,
        now: execution.now,
    })
    if (mediaResult.kind !== 'ready') return mediaResult.outcome

    const publisherWithCheckpoints = input.createPublisher({
        agent: new Agent(restored.session),
        onMediaUploaded: async ({ index, blob }) => {
            const prepared = mediaResult.media[index]
            if (prepared === undefined || prepared.remoteBlob !== undefined) {
                throw new Error('The Bluesky media upload checkpoint is out of sequence')
            }
            const remoteMediaId = serializeBlobRef(blob)
            const checkpoint = execution.providerMediaDeliveryStore.recordRemoteMediaId({
                projectId: target.projectId,
                deliveryId: prepared.delivery.id,
                remoteMediaId,
                at: execution.now,
            })
            if (checkpoint?.remoteMediaId !== remoteMediaId) {
                throw new Error('The Bluesky media upload checkpoint could not be persisted')
            }
            const completed = execution.providerMediaDeliveryStore.complete({
                projectId: target.projectId,
                deliveryId: prepared.delivery.id,
                remoteMediaId,
                at: execution.now,
            })
            if (completed?.state !== 'uploaded') {
                throw new Error('The Bluesky media delivery could not be completed')
            }
            prepared.remoteBlob = blob
        },
    })

    const outcome = await publisherWithCheckpoints.publish({
        text,
        media: mediaResult.media.map(media => ({
            contentType: media.target.contentType as 'image/jpeg' | 'image/png',
            size: media.target.byteSize,
            accessibilityText: media.target.accessibilityText ?? '',
            ...(media.remoteBlob === undefined
                ? { stream: media.stream }
                : { remoteBlob: media.remoteBlob }),
        })),
    })

    for (const media of mediaResult.media) {
        if (media.remoteBlob !== undefined || media.delivery.state !== 'uploading') continue
        const failed = execution.providerMediaDeliveryStore.fail({
            projectId: target.projectId,
            deliveryId: media.delivery.id,
            errorCode: outcome.type,
            errorMessage:
                outcome.type === 'published'
                    ? 'The Bluesky media upload did not finish'
                    : outcome.errorMessage,
            ambiguous: outcome.type === 'ambiguous',
            at: execution.now,
        })
        if (failed === null) {
            return ambiguousFailure('The Bluesky media delivery state could not be persisted')
        }
    }

    return outcome
}

interface PreparedBlueskyMedia {
    readonly target: PublisherExecutionMedia
    readonly delivery: ReturnType<ProviderMediaDeliveryPort['reserve']>
    readonly stream?: ReadableStream<Uint8Array>
    remoteBlob?: BlobRef
}

async function prepareBlueskyMedia(input: {
    readonly target: PublisherExecutionTarget
    readonly media: BuiltInProviderExecutionInput['media']
    readonly providerMediaDeliveryStore: ProviderMediaDeliveryPort
    readonly now: number
}): Promise<
    | { readonly kind: 'ready'; readonly media: PreparedBlueskyMedia[] }
    | { readonly kind: 'failed'; readonly outcome: ExternalEffectOutcome }
> {
    if (input.target.media.length === 0) return { kind: 'ready', media: [] }
    if (input.media === undefined) {
        return {
            kind: 'failed',
            outcome: permanentFailure(
                'Media lifecycle service is required for Bluesky image posts'
            ),
        }
    }

    const prepared: PreparedBlueskyMedia[] = []
    for (const targetMedia of input.target.media) {
        if (
            targetMedia.family !== 'image' ||
            (targetMedia.contentType !== 'image/jpeg' && targetMedia.contentType !== 'image/png')
        ) {
            return {
                kind: 'failed',
                outcome: permanentFailure('Bluesky posts support JPEG and PNG images only'),
            }
        }
        if (targetMedia.accessibilityText === null) {
            return {
                kind: 'failed',
                outcome: permanentFailure('Bluesky images require accessibility text'),
            }
        }

        const delivery = input.providerMediaDeliveryStore.reserve({
            projectId: input.target.projectId,
            executionMediaId: targetMedia.id,
            publisherId: input.target.publisherId,
            providerId: BLUESKY_PROVIDER,
            at: input.now,
        })
        if (delivery.state === 'ambiguous') {
            return {
                kind: 'failed',
                outcome: ambiguousFailure(
                    delivery.errorMessage ?? 'The Bluesky media delivery requires reconciliation'
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
                return {
                    kind: 'failed',
                    outcome: permanentFailure('The Bluesky media delivery disappeared'),
                }
            }
            current = retried
        }

        if (current.state === 'uploaded' && current.remoteMediaId !== null) {
            const remoteBlob = parseBlobRef(current.remoteMediaId)
            if (remoteBlob === null) {
                return {
                    kind: 'failed',
                    outcome: ambiguousFailure('The stored Bluesky media blob is invalid'),
                }
            }
            prepared.push({ target: targetMedia, delivery: current, remoteBlob })
            continue
        }

        if (current.state === 'uploading' && current.remoteMediaId !== null) {
            const completed = input.providerMediaDeliveryStore.complete({
                projectId: input.target.projectId,
                deliveryId: current.id,
                remoteMediaId: current.remoteMediaId,
                at: input.now,
            })
            if (completed?.state === 'uploaded') {
                const remoteBlob = parseBlobRef(completed.remoteMediaId)
                if (remoteBlob !== null) {
                    prepared.push({ target: targetMedia, delivery: completed, remoteBlob })
                    continue
                }
            }
            return {
                kind: 'failed',
                outcome: ambiguousFailure('The Bluesky media delivery could not be resumed safely'),
            }
        }

        if (current.state === 'uploading') {
            return {
                kind: 'failed',
                outcome: ambiguousFailure(
                    'The Bluesky image upload has no durable provider identifier'
                ),
            }
        }

        const started = input.providerMediaDeliveryStore.start({
            projectId: input.target.projectId,
            deliveryId: current.id,
            at: input.now,
        })
        if (started === null || started.state !== 'uploading') {
            return {
                kind: 'failed',
                outcome: permanentFailure('The Bluesky media delivery could not be started'),
            }
        }

        let opened: Awaited<
            ReturnType<NonNullable<typeof input.media>['openRepresentationContent']>
        >
        try {
            opened = await openVerifiedPinnedMedia(input.media, input.target.projectId, targetMedia)
        } catch {
            const failed = input.providerMediaDeliveryStore.fail({
                projectId: input.target.projectId,
                deliveryId: started.id,
                errorCode: 'media_read_failure',
                errorMessage: 'The pinned Bluesky image could not be read; retry is safe',
                at: input.now,
            })
            return {
                kind: 'failed',
                outcome:
                    failed === null
                        ? ambiguousFailure(
                              'The Bluesky media delivery state could not be persisted'
                          )
                        : retryableFailure(
                              'The pinned Bluesky image could not be read; retry is safe'
                          ),
            }
        }
        if (opened === null) {
            const failed = input.providerMediaDeliveryStore.fail({
                projectId: input.target.projectId,
                deliveryId: started.id,
                errorCode: 'media_unavailable',
                errorMessage: 'The pinned Bluesky image is unavailable or changed',
                at: input.now,
            })
            return {
                kind: 'failed',
                outcome:
                    failed === null
                        ? ambiguousFailure(
                              'The Bluesky media delivery state could not be persisted'
                          )
                        : permanentFailure(
                              failed.errorMessage ??
                                  'The pinned Bluesky image is unavailable or changed'
                          ),
            }
        }

        prepared.push({ target: targetMedia, delivery: started, stream: opened.stream })
    }

    return { kind: 'ready', media: prepared }
}

function toBlueskyDestination(
    value: PublisherExecutionTarget['destination']
): { readonly type: 'account'; readonly id: string } | null {
    if (value === null || value.type !== 'account') return null
    const id = value.id.trim()
    return /^did:[^\s:]+:[^\s]+$/.test(id) ? { type: 'account', id } : null
}

function serializeBlobRef(blob: BlobRef): string {
    const serialized = JSON.stringify(blob)
    if (serialized === undefined) throw new Error('The Bluesky blob reference is not serializable')
    return serialized
}

function parseBlobRef(value: string | null): BlobRef | null {
    if (value === null) return null
    try {
        const parsed = JSON.parse(value) as {
            readonly ref?: { readonly $link?: unknown }
            readonly mimeType?: unknown
            readonly size?: unknown
        }
        if (
            parsed === null ||
            typeof parsed !== 'object' ||
            parsed.ref === undefined ||
            typeof parsed.ref.$link !== 'string' ||
            typeof parsed.mimeType !== 'string' ||
            typeof parsed.size !== 'number' ||
            !Number.isSafeInteger(parsed.size) ||
            parsed.size <= 0
        ) {
            return null
        }
        return parsed as BlobRef
    } catch {
        return null
    }
}

function tokenExpiry(expiresAt: string | null, now: number): number | null {
    if (expiresAt === null) return null
    const timestamp = Date.parse(expiresAt)
    return Number.isSafeInteger(timestamp) && timestamp > now ? timestamp : null
}
