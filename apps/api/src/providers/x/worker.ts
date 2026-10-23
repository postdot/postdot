import type { ExternalEffectOutcome } from '@postdot/core'
import type { PublisherExecutionTarget } from '@postdot/db'
import {
    refreshAccessToken,
    type OAuthAuthorizationServer,
    type OAuthClientAuthentication,
} from '@postdot/oauth'
import {
    X_EXECUTION_CONTRACT_REVISION,
    X_MAX_IMAGE_BYTES,
    X_PROVIDER,
    X_UPLOADED_MEDIA_REUSE_TTL_MS,
    createXPublisher,
    isXPostTextValid,
    parseXPostText,
    readXTextContent,
    type XFetcher,
    type XOperationFailure,
    type XPublishOutcome,
    type XPublisher,
} from '@postdot/x'

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

export interface XOAuthConfig {
    readonly authorizationServer: OAuthAuthorizationServer
    readonly clientId: string
    readonly clientAuthentication: OAuthClientAuthentication
}

export interface XProviderAdapterOptions {
    readonly oauth?: XOAuthConfig
    readonly resolveOAuth?: (
        providerApplicationId: string | null
    ) => Promise<XOAuthConfig | undefined>
    readonly publisher?: XPublisher
    readonly createPublisher?: () => XPublisher
    readonly fetcher?: XFetcher
    readonly refreshAccessToken?: typeof refreshAccessToken
}

export function createXProviderAdapter(
    options: XProviderAdapterOptions = {}
): BuiltInProviderAdapter {
    return {
        providerId: X_PROVIDER,
        contractId: X_PROVIDER,
        revision: X_EXECUTION_CONTRACT_REVISION,
        execute: input => executeXPublication({ input, options }),
    }
}

async function executeXPublication(input: {
    readonly input: BuiltInProviderExecutionInput
    readonly options: XProviderAdapterOptions
}): Promise<ExternalEffectOutcome> {
    const { input: execution, options } = input
    const oauth = options.resolveOAuth
        ? await options.resolveOAuth(execution.target.providerApplicationId ?? null)
        : options.oauth
    const target = execution.target

    const destination = toXDestination(target.destination)
    if (destination === null || destination.id !== target.externalAccountId) {
        return permanentFailure('The X publication destination is unavailable')
    }

    const secrets = await execution.credentials.resolvePublisherCredentialSecrets(
        target.projectId,
        target.credentialId
    )
    if (secrets === null) {
        return permanentFailure('The X publisher credential is unavailable')
    }

    let accessToken = secrets.accessToken
    if (target.credentialExpiresAt !== null && target.credentialExpiresAt <= execution.now) {
        if (secrets.refreshToken === null || oauth === undefined) {
            execution.credentials.markPublisherCredentialReconnectRequired(
                target.projectId,
                target.credentialId
            )
            return permanentFailure('The X publisher credential requires reconnection')
        }

        try {
            const refreshed = await (options.refreshAccessToken ?? refreshAccessToken)({
                authorizationServer: oauth.authorizationServer,
                clientId: oauth.clientId,
                clientAuthentication: oauth.clientAuthentication,
                refreshToken: secrets.refreshToken,
                fetcher: effectFetcher(execution.signal, options.fetcher, execution.assertActive),
            })
            const replaced = await execution.credentials.replacePublisherCredentialTokens({
                projectId: target.projectId,
                credentialId: target.credentialId,
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken ?? undefined,
                expiresAt: expiryFromSeconds(refreshed.expiresInSeconds, execution.now),
            })
            if (replaced.kind !== 'updated') {
                return retryableFailure('The refreshed X credential could not be persisted')
            }
            accessToken = refreshed.accessToken
        } catch {
            execution.credentials.markPublisherCredentialReconnectRequired(
                target.projectId,
                target.credentialId
            )
            return permanentFailure('The X publisher credential could not be refreshed')
        }
    }

    if (accessToken.trim().length === 0) {
        return permanentFailure('The X publisher access token is unavailable')
    }

    const publisher =
        options.publisher ??
        (options.createPublisher !== undefined
            ? options.createPublisher()
            : createXPublisher({
                  fetcher: effectFetcher(execution.signal, options.fetcher, execution.assertActive),
              }))

    const text = readXTextContent(target.content)
    if (text === null) {
        return permanentFailure('The execution revision has no X post text')
    }
    if (!isXPostTextValid(text)) {
        const parsed = parseXPostText(text)
        if (parsed.hasInvalidCharacters) {
            return permanentFailure('The X post text contains characters that X does not allow')
        }
        return permanentFailure(
            parsed.weightedLength === null
                ? 'The X post text cannot be measured by twitter-text'
                : `The X post text exceeds the 280 weighted-character limit (weighted length ${parsed.weightedLength})`
        )
    }

    const mediaResult = await prepareXMedia({
        target,
        accessToken,
        publisher,
        media: execution.media,
        providerMediaDeliveryStore: execution.providerMediaDeliveryStore,
        now: execution.now,
    })
    if (mediaResult.kind !== 'ready') {
        if (isXAuthenticationFailure(mediaResult.outcome)) {
            execution.credentials.markPublisherCredentialReconnectRequired(
                target.projectId,
                target.credentialId
            )
        }
        return mediaResult.outcome
    }

    let outcome: XPublishOutcome
    try {
        outcome = await publisher.publishTweet({
            accessToken,
            text,
            mediaIds: mediaResult.mediaIds,
        })
    } catch {
        return ambiguousFailure('The X tweet publication outcome is unknown')
    }

    if (outcome.type === 'permanent_failure' && outcome.code === 'authentication_required') {
        execution.credentials.markPublisherCredentialReconnectRequired(
            target.projectId,
            target.credentialId
        )
    }

    return outcome
}

async function prepareXMedia(input: {
    readonly target: PublisherExecutionTarget
    readonly accessToken: string
    readonly publisher: XPublisher
    readonly media: BuiltInProviderExecutionInput['media']
    readonly providerMediaDeliveryStore: ProviderMediaDeliveryPort
    readonly now: number
}): Promise<
    | { readonly kind: 'ready'; readonly mediaIds: readonly string[] }
    | { readonly kind: 'failed'; readonly outcome: ExternalEffectOutcome }
> {
    if (input.target.media.length === 0) return { kind: 'ready', mediaIds: [] }
    if (input.media === undefined) {
        return {
            kind: 'failed',
            outcome: permanentFailure('Media lifecycle service is required for X image posts'),
        }
    }

    const mediaIds: string[] = []
    for (const targetMedia of input.target.media) {
        if (
            targetMedia.family !== 'image' ||
            (targetMedia.contentType !== 'image/jpeg' && targetMedia.contentType !== 'image/png')
        ) {
            return {
                kind: 'failed',
                outcome: permanentFailure('X image posts support JPEG and PNG images only'),
            }
        }
        if (targetMedia.byteSize > X_MAX_IMAGE_BYTES) {
            return {
                kind: 'failed',
                outcome: permanentFailure('The X image exceeds the maximum 5MB image limit'),
            }
        }

        const delivery = input.providerMediaDeliveryStore.reserve({
            projectId: input.target.projectId,
            executionMediaId: targetMedia.id,
            publisherId: input.target.publisherId,
            providerId: X_PROVIDER,
            at: input.now,
        })
        if (delivery.state === 'ambiguous') {
            return {
                kind: 'failed',
                outcome: ambiguousFailure(
                    delivery.errorMessage ?? 'The X media delivery requires reconciliation'
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
                    outcome: permanentFailure('The X media delivery disappeared'),
                }
            }
            current = retried
        }

        if (current.state === 'uploaded' && current.remoteMediaId !== null) {
            if (
                isXMediaCheckpointFresh(
                    current.completedAt,
                    current.remoteMediaExpiresAt,
                    input.now
                )
            ) {
                mediaIds.push(current.remoteMediaId)
                continue
            }
            // The provider expiry, when available, or Postdot's conservative
            // reuse horizon (see X_UPLOADED_MEDIA_REUSE_TTL_MS) has elapsed.
            // The provider effect is unknown, so this requires explicit
            // reconciliation instead of silently reusing a stale identifier.
            return {
                kind: 'failed',
                outcome: ambiguousFailure(
                    'The X media checkpoint expired and requires reconciliation'
                ),
            }
        }

        if (current.state === 'uploading') {
            return failXMediaDelivery(
                input.providerMediaDeliveryStore,
                input.target.projectId,
                current.id,
                'upload_in_progress',
                'The X image upload has no durable provider identifier',
                true,
                input.now
            )
        }

        const started = input.providerMediaDeliveryStore.start({
            projectId: input.target.projectId,
            deliveryId: current.id,
            at: input.now,
        })
        if (started === null || started.state !== 'uploading') {
            return {
                kind: 'failed',
                outcome: permanentFailure('The X media delivery could not be started'),
            }
        }

        let opened: Awaited<
            ReturnType<NonNullable<typeof input.media>['openRepresentationContent']>
        >
        try {
            opened = await openVerifiedPinnedMedia(input.media, input.target.projectId, targetMedia)
        } catch {
            return failXMediaDelivery(
                input.providerMediaDeliveryStore,
                input.target.projectId,
                started.id,
                'media_read_failure',
                'The pinned X image could not be read; retry is safe',
                false,
                input.now
            )
        }
        if (opened === null) {
            return failXMediaDelivery(
                input.providerMediaDeliveryStore,
                input.target.projectId,
                started.id,
                'media_unavailable',
                'The pinned X image is unavailable or changed',
                false,
                input.now
            )
        }

        let upload: Awaited<ReturnType<XPublisher['uploadMedia']>>
        try {
            upload = await input.publisher.uploadMedia(input.accessToken, {
                contentType: targetMedia.contentType,
                size: targetMedia.byteSize,
                filename: targetMedia.originalFilename,
                accessibilityText: targetMedia.accessibilityText,
                stream: opened.stream,
            })
        } catch {
            return failXMediaDelivery(
                input.providerMediaDeliveryStore,
                input.target.projectId,
                started.id,
                'upload_exception',
                'The X media upload outcome is unknown',
                true,
                input.now
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
            return {
                kind: 'failed',
                outcome:
                    failed === null
                        ? ambiguousFailure('The X media delivery state could not be persisted')
                        : upload,
            }
        }

        const checkpoint = input.providerMediaDeliveryStore.recordRemoteMediaId({
            projectId: input.target.projectId,
            deliveryId: started.id,
            remoteMediaId: upload.remoteMediaId,
            at: input.now,
        })
        if (checkpoint === null || checkpoint.remoteMediaId !== upload.remoteMediaId) {
            return {
                kind: 'failed',
                outcome: ambiguousFailure('The X media provider identifier could not be persisted'),
            }
        }

        const completed = input.providerMediaDeliveryStore.complete({
            projectId: input.target.projectId,
            deliveryId: started.id,
            remoteMediaId: upload.remoteMediaId,
            remoteMediaExpiresAt: expiryFromSeconds(upload.expiresAfterSecs, input.now),
            at: input.now,
        })
        if (completed?.state !== 'uploaded') {
            return {
                kind: 'failed',
                outcome: ambiguousFailure('The X media delivery could not be completed'),
            }
        }

        mediaIds.push(upload.remoteMediaId)
    }

    return { kind: 'ready', mediaIds }
}

function failXMediaDelivery(
    store: ProviderMediaDeliveryPort,
    projectId: string,
    deliveryId: string,
    errorCode: string,
    errorMessage: string,
    ambiguous: boolean,
    at: number
): { readonly kind: 'failed'; readonly outcome: ExternalEffectOutcome } {
    try {
        const failed = store.fail({
            projectId,
            deliveryId,
            errorCode,
            errorMessage,
            ambiguous,
            at,
        })
        if (failed === null) {
            return {
                kind: 'failed',
                outcome: ambiguousFailure('The X media delivery state could not be persisted'),
            }
        }
    } catch {
        return {
            kind: 'failed',
            outcome: ambiguousFailure('The X media delivery state could not be persisted'),
        }
    }
    return {
        kind: 'failed',
        outcome: ambiguous ? ambiguousFailure(errorMessage) : retryableFailure(errorMessage),
    }
}

function isXMediaCheckpointFresh(
    completedAt: number | null,
    remoteMediaExpiresAt: number | null,
    now: number
): boolean {
    if (completedAt === null) return false
    const age = now - completedAt
    const providerExpiryIsFresh = remoteMediaExpiresAt === null || now < remoteMediaExpiresAt
    return age >= 0 && age <= X_UPLOADED_MEDIA_REUSE_TTL_MS && providerExpiryIsFresh
}

function isXAuthenticationFailure(outcome: ExternalEffectOutcome): boolean {
    return (
        outcome.type === 'permanent_failure' &&
        'code' in outcome &&
        (outcome as XOperationFailure).code === 'authentication_required'
    )
}

function toXDestination(
    value: PublisherExecutionTarget['destination']
): { readonly type: 'account'; readonly id: string } | null {
    if (value === null || value.type !== 'account') return null
    const id = value.id.trim()
    return id.length > 0 && !/\s/.test(id) ? { type: 'account', id } : null
}

function expiryFromSeconds(seconds: number | null, now: number): number | null {
    if (seconds === null || !Number.isSafeInteger(seconds) || seconds <= 0) return null
    const expiry = now + seconds * 1_000
    return Number.isSafeInteger(expiry) ? expiry : null
}
