import type { ExternalEffectOutcome } from '@postdot/core'
import type { PublisherExecutionTarget } from '@postdot/db'
import {
    createLinkedInImagePublisher,
    createLinkedInTextPublisher,
    createLinkedInVideoPublisher,
    type LINKEDIN_IMAGE_EXECUTION_CONTRACT_REVISION,
    type LinkedInVideoPublisher,
    LINKEDIN_EXECUTION_CONTRACT_REVISION,
    LINKEDIN_LEGACY_EXECUTION_CONTRACT_REVISION,
    LINKEDIN_MAX_IMAGES,
    LINKEDIN_PROVIDER,
    readLinkedInTextContent,
    type LinkedInDestination,
    type LinkedInImagePublisher,
    type LinkedInTextPublisher,
} from '@postdot/linkedin'
import {
    refreshAccessToken,
    type OAuthAuthorizationServer,
    type OAuthClientAuthentication,
} from '@postdot/oauth'

import {
    ambiguousFailure,
    permanentFailure,
    retryableFailure,
} from '../../modules/workflow/outcomes'
import { effectFetcher } from '../../modules/workflow/providers/effect-fetcher'
import { openVerifiedPinnedMedia } from '../../modules/workflow/providers/media-integrity'
import type {
    BuiltInProviderAdapter,
    BuiltInProviderExecutionInput,
    ProviderMediaDeliveryPort,
} from '../../modules/workflow/providers/registry'
import { publishLinkedInVideo } from './video'

export interface LinkedInOAuthConfiguration {
    readonly authorizationServer: OAuthAuthorizationServer
    readonly clientId: string
    readonly clientAuthentication: OAuthClientAuthentication
}

export interface LinkedInProviderAdapterOptions {
    readonly revision?:
        | typeof LINKEDIN_EXECUTION_CONTRACT_REVISION
        | typeof LINKEDIN_LEGACY_EXECUTION_CONTRACT_REVISION
        | typeof LINKEDIN_IMAGE_EXECUTION_CONTRACT_REVISION
    readonly oauth?: LinkedInOAuthConfiguration
    readonly resolveOAuth?: (
        providerApplicationId: string | null
    ) => Promise<LinkedInOAuthConfiguration | undefined>
    readonly textPublisher?: LinkedInTextPublisher
    readonly imagePublisher?: LinkedInImagePublisher
    readonly videoPublisher?: LinkedInVideoPublisher
}

export function createLinkedInProviderAdapter(
    options: LinkedInProviderAdapterOptions = {}
): BuiltInProviderAdapter {
    return {
        providerId: LINKEDIN_PROVIDER,
        contractId: LINKEDIN_PROVIDER,
        revision: options.revision ?? LINKEDIN_EXECUTION_CONTRACT_REVISION,
        execute: input =>
            executeLinkedInPublication({
                input,
                oauth: options.oauth,
                resolveOAuth: options.resolveOAuth,
                textPublisher:
                    options.textPublisher ??
                    createLinkedInTextPublisher({
                        fetcher: effectFetcher(input.signal, undefined, input.assertActive),
                    }),
                imagePublisher:
                    options.imagePublisher ??
                    createLinkedInImagePublisher({
                        fetcher: effectFetcher(input.signal, undefined, input.assertActive),
                    }),
                videoPublisher:
                    options.videoPublisher ??
                    createLinkedInVideoPublisher({
                        fetcher: effectFetcher(input.signal, undefined, input.assertActive),
                    }),
                allowVideo:
                    (options.revision ?? LINKEDIN_EXECUTION_CONTRACT_REVISION) ===
                    LINKEDIN_EXECUTION_CONTRACT_REVISION,
                maxImages:
                    options.revision === LINKEDIN_LEGACY_EXECUTION_CONTRACT_REVISION
                        ? 1
                        : LINKEDIN_MAX_IMAGES,
            }),
    }
}

async function executeLinkedInPublication(input: {
    readonly input: BuiltInProviderExecutionInput
    readonly oauth: LinkedInOAuthConfiguration | undefined
    readonly resolveOAuth?: (
        providerApplicationId: string | null
    ) => Promise<LinkedInOAuthConfiguration | undefined>
    readonly textPublisher: LinkedInTextPublisher
    readonly imagePublisher: LinkedInImagePublisher
    readonly videoPublisher: LinkedInVideoPublisher
    readonly allowVideo: boolean
    readonly maxImages: number
}): Promise<ExternalEffectOutcome> {
    const { input: execution, textPublisher, imagePublisher } = input
    const target = execution.target
    const prepared = await execution.credentials.withPublisherCredentialRefresh(
        target.projectId,
        target.credentialId,
        async context => {
            if (!context)
                return {
                    kind: 'failed',
                    outcome: permanentFailure('The publisher credential is unavailable'),
                } as const
            const secrets = context.secrets
            const oauth = input.resolveOAuth
                ? await input.resolveOAuth(context.credential.providerApplicationId ?? null)
                : input.oauth

            let accessToken = secrets.accessToken
            const refreshToken = secrets.refreshToken
            try {
                if (
                    context.credential.expiresAt !== null &&
                    context.credential.expiresAt <= context.now()
                ) {
                    if (refreshToken === null || oauth === undefined) {
                        context.markReconnectRequired()
                        return {
                            kind: 'failed',
                            outcome: permanentFailure(
                                'The publisher credential requires reconnection'
                            ),
                        } as const
                    }

                    const refreshed = await refreshAccessToken({
                        authorizationServer: oauth.authorizationServer,
                        clientId: oauth.clientId,
                        clientAuthentication: oauth.clientAuthentication,
                        refreshToken,
                        fetcher: effectFetcher(execution.signal, undefined, execution.assertActive),
                    })
                    const expiresAt =
                        refreshed.expiresInSeconds === null
                            ? null
                            : context.now() + refreshed.expiresInSeconds * 1000
                    const replaced = await context.replaceTokens({
                        accessToken: refreshed.accessToken,
                        refreshToken: refreshed.refreshToken ?? undefined,
                        expiresAt,
                    })
                    if (replaced.kind !== 'updated') {
                        return {
                            kind: 'failed',
                            outcome: permanentFailure(
                                'The publisher credential could not be refreshed'
                            ),
                        } as const
                    }
                    accessToken = refreshed.accessToken
                }
            } catch {
                if (!execution.signal?.aborted) context.markReconnectRequired()
                return {
                    kind: 'failed',
                    outcome: permanentFailure('The publisher credential could not be refreshed'),
                } as const
            }

            return {
                kind: 'ready',
                accessToken,
                markReconnectRequired: context.markReconnectRequired,
            } as const
        },
        execution.signal
    )
    if (prepared.kind === 'failed') return prepared.outcome
    const accessToken = prepared.accessToken

    if (accessToken.trim().length === 0) {
        return permanentFailure('The publisher account access token is unavailable')
    }

    const destination = toLinkedInDestination(target.destination)
    if (destination === null) {
        return permanentFailure('The LinkedIn publication destination is unavailable')
    }

    const outcome =
        target.media.length === 0
            ? await publishLinkedInText({
                  accessToken,
                  destination,
                  content: target.content,
                  publisher: textPublisher,
              })
            : target.media.some(item => item.family === 'video')
              ? input.allowVideo
                  ? await publishLinkedInVideo({
                        execution,
                        accessToken,
                        destination,
                        publisher: input.videoPublisher,
                    })
                  : permanentFailure('The LinkedIn execution revision does not support video')
              : await publishLinkedInImage({
                    accessToken,
                    destination,
                    target,
                    media: execution.media,
                    publisher: imagePublisher,
                    providerMediaDeliveryStore: execution.providerMediaDeliveryStore,
                    now: execution.now,
                    maxImages: input.maxImages,
                })
    if (
        outcome.type === 'permanent_failure' &&
        'code' in outcome &&
        (outcome.code === 'authentication_required' || outcome.code === 'forbidden')
    ) {
        prepared.markReconnectRequired()
    }
    return outcome
}

async function publishLinkedInText(input: {
    readonly accessToken: string
    readonly destination: LinkedInDestination
    readonly content: Readonly<Record<string, unknown>>
    readonly publisher: LinkedInTextPublisher
}): Promise<ExternalEffectOutcome> {
    const commentary = readLinkedInTextContent(input.content)
    if (commentary === null) {
        return permanentFailure('The execution revision does not contain LinkedIn commentary')
    }

    return input.publisher.publishText({
        accessToken: input.accessToken,
        destination: input.destination,
        commentary,
    })
}

interface LinkedInImageExecutionInput {
    readonly accessToken: string
    readonly destination: LinkedInDestination
    readonly target: PublisherExecutionTarget
    readonly media: BuiltInProviderExecutionInput['media']
    readonly publisher: LinkedInImagePublisher
    readonly providerMediaDeliveryStore: ProviderMediaDeliveryPort
    readonly now: number
    readonly maxImages: number
}

async function publishLinkedInImage(
    input: LinkedInImageExecutionInput
): Promise<ExternalEffectOutcome> {
    if (input.target.media.length < 1 || input.target.media.length > input.maxImages) {
        return permanentFailure('The LinkedIn image count exceeds the execution contract limit')
    }
    // Validate the whole batch before any upload. A bad later item must not dispatch earlier ones.
    if (
        input.target.media.some(
            item =>
                item.family !== 'image' ||
                (item.contentType !== 'image/jpeg' && item.contentType !== 'image/png')
        )
    ) {
        return permanentFailure(
            'The pinned LinkedIn media representation is not a JPEG or PNG image'
        )
    }
    const commentary = readLinkedInTextContent(input.target.content)
    if (commentary === null)
        return permanentFailure('The execution revision does not contain LinkedIn commentary')
    const images: { imageId: string; accessibilityText: string | null }[] = []
    for (const targetMedia of input.target.media) {
        const result = await prepareLinkedInImage(input, targetMedia)
        if (result.type !== 'uploaded') return result
        images.push({
            imageId: result.remoteMediaId,
            accessibilityText: targetMedia.accessibilityText,
        })
    }
    const common = { accessToken: input.accessToken, destination: input.destination, commentary }
    if (images.length === 1) return input.publisher.publishImage({ ...common, ...images[0]! })
    return input.publisher.publishImages({ ...common, images })
}

async function prepareLinkedInImage(
    input: LinkedInImageExecutionInput,
    targetMedia: PublisherExecutionTarget['media'][number]
): Promise<ExternalEffectOutcome | { type: 'uploaded'; remoteMediaId: string }> {
    if (targetMedia.contentType !== 'image/jpeg' && targetMedia.contentType !== 'image/png') {
        return permanentFailure(
            'The pinned LinkedIn media representation is not a JPEG or PNG image'
        )
    }
    if (input.media === undefined) {
        return permanentFailure('Media lifecycle service is required for LinkedIn image posts')
    }
    const delivery = input.providerMediaDeliveryStore.reserve({
        projectId: input.target.projectId,
        executionMediaId: targetMedia.id,
        publisherId: input.target.publisherId,
        providerId: LINKEDIN_PROVIDER,
        at: input.now,
    })
    if (delivery.state === 'ambiguous') {
        return ambiguousFailure(
            delivery.errorMessage ?? 'The LinkedIn image delivery requires reconciliation'
        )
    }

    let current = delivery
    if (current.state === 'failed') {
        const retried = input.providerMediaDeliveryStore.retry({
            projectId: input.target.projectId,
            deliveryId: current.id,
            at: input.now,
        })
        if (retried === null) return permanentFailure('The LinkedIn image delivery disappeared')
        current = retried
    }

    if (current.state === 'uploaded' && current.remoteMediaId !== null) {
        return { type: 'uploaded', remoteMediaId: current.remoteMediaId }
    }

    if (current.state === 'uploading' && current.remoteMediaId !== null) {
        const completed = input.providerMediaDeliveryStore.complete({
            projectId: input.target.projectId,
            deliveryId: current.id,
            remoteMediaId: current.remoteMediaId,
            at: input.now,
        })
        if (completed?.state === 'uploaded' && completed.remoteMediaId !== null) {
            return { type: 'uploaded', remoteMediaId: completed.remoteMediaId }
        }
        return ambiguousFailure('The LinkedIn image delivery could not be resumed safely')
    }

    if (current.state === 'uploading') {
        return failLinkedInImageDelivery(
            input,
            current.id,
            'upload_in_progress',
            'The LinkedIn image upload has no durable provider identifier',
            true
        )
    }

    const started = input.providerMediaDeliveryStore.start({
        projectId: input.target.projectId,
        deliveryId: current.id,
        at: input.now,
    })
    if (started === null || started.state !== 'uploading') {
        return permanentFailure('The LinkedIn image delivery could not be started')
    }

    let opened: Awaited<ReturnType<NonNullable<typeof input.media>['openRepresentationContent']>>
    try {
        opened = await openVerifiedPinnedMedia(input.media, input.target.projectId, targetMedia)
    } catch {
        return failLinkedInImageDelivery(
            input,
            started.id,
            'media_read_failure',
            'The pinned LinkedIn image representation could not be read; retry is safe',
            false
        )
    }
    if (opened === null) {
        const failed = input.providerMediaDeliveryStore.fail({
            projectId: input.target.projectId,
            deliveryId: started.id,
            errorCode: 'media_unavailable',
            errorMessage: 'The pinned LinkedIn image representation is unavailable or changed',
            at: input.now,
        })
        return permanentFailure(
            failed?.errorMessage ??
                'The pinned LinkedIn image representation is unavailable or changed'
        )
    }

    let upload: Awaited<ReturnType<LinkedInImagePublisher['uploadImage']>>
    try {
        upload = await input.publisher.uploadImage({
            accessToken: input.accessToken,
            destination: input.destination,
            media: {
                contentType: targetMedia.contentType,
                size: targetMedia.byteSize,
                stream: opened.stream,
            },
        })
    } catch {
        return failLinkedInImageDelivery(
            input,
            started.id,
            'upload_exception',
            'The LinkedIn image upload threw after dispatch; the media outcome is ambiguous',
            true
        )
    }
    if (upload.type !== 'uploaded') {
        if (upload.type === 'ambiguous' && upload.remoteMediaId !== undefined) {
            input.providerMediaDeliveryStore.recordRemoteMediaId({
                projectId: input.target.projectId,
                deliveryId: started.id,
                remoteMediaId: upload.remoteMediaId,
                at: input.now,
            })
        }
        const failed = input.providerMediaDeliveryStore.fail({
            projectId: input.target.projectId,
            deliveryId: started.id,
            errorCode: upload.code,
            errorMessage: upload.errorMessage,
            ambiguous: upload.type === 'ambiguous',
            at: input.now,
        })
        return failed === null
            ? ambiguousFailure('The LinkedIn image delivery state could not be persisted')
            : upload
    }

    const checkpoint = input.providerMediaDeliveryStore.recordRemoteMediaId({
        projectId: input.target.projectId,
        deliveryId: started.id,
        remoteMediaId: upload.remoteMediaId,
        at: input.now,
    })
    if (checkpoint === null || checkpoint.remoteMediaId !== upload.remoteMediaId) {
        return ambiguousFailure('The LinkedIn image provider identifier could not be persisted')
    }
    const completed = input.providerMediaDeliveryStore.complete({
        projectId: input.target.projectId,
        deliveryId: started.id,
        remoteMediaId: upload.remoteMediaId,
        at: input.now,
    })
    if (completed?.state !== 'uploaded') {
        return ambiguousFailure('The LinkedIn image delivery could not be completed')
    }

    return { type: 'uploaded', remoteMediaId: upload.remoteMediaId }
}

function toLinkedInDestination(
    value: PublisherExecutionTarget['destination']
): LinkedInDestination | null {
    if (value === null) return null
    if (value.type !== 'member' && value.type !== 'organization') return null
    const id = value.id.trim()
    if (
        id.length === 0 ||
        /\s/.test(id) ||
        id.startsWith('urn:') ||
        (value.type === 'organization' && !/^[1-9]\d*$/.test(id))
    ) {
        return null
    }
    return { type: value.type, id }
}

function failLinkedInImageDelivery(
    input: LinkedInImageExecutionInput,
    deliveryId: string,
    errorCode: string,
    errorMessage: string,
    ambiguous: boolean
): ExternalEffectOutcome {
    try {
        const failed = input.providerMediaDeliveryStore.fail({
            projectId: input.target.projectId,
            deliveryId,
            errorCode,
            errorMessage,
            ambiguous,
            at: input.now,
        })
        if (failed === null) {
            return ambiguousFailure('The LinkedIn image delivery state could not be persisted')
        }
    } catch {
        return ambiguousFailure('The LinkedIn image delivery state could not be persisted')
    }

    return ambiguous ? ambiguousFailure(errorMessage) : retryableFailure(errorMessage)
}
