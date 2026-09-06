import type { ExternalEffectOutcome } from '@herald/core'
import type { PublisherExecutionTarget } from '@herald/db'
import {
    MASTODON_EXECUTION_CONTRACT_REVISION,
    MASTODON_MAX_IMAGE_BYTES,
    MASTODON_PROVIDER,
    createMastodonPublisher,
    normalizeMastodonInstanceOrigin,
    readMastodonStatusOptions,
    readMastodonTextContent,
    type MastodonOperationFailure,
    type MastodonPublisher,
    type MastodonPublishOutcome,
} from '@herald/mastodon'
import { clientSecretPost, refreshAccessToken, type OAuthAuthorizationServer } from '@herald/oauth'

import { ambiguousFailure, permanentFailure, retryableFailure } from '../outcomes'
import { openVerifiedPinnedMedia } from './media-integrity'
import type {
    BuiltInProviderAdapter,
    BuiltInProviderExecutionInput,
    ProviderMediaDeliveryPort,
} from './registry'

export interface MastodonProviderAdapterOptions {
    readonly createPublisher?: (baseUrl: string) => MastodonPublisher
    readonly refreshAccessToken?: typeof refreshAccessToken
    readonly sleep?: (milliseconds: number) => Promise<void>
    readonly mediaProcessingTimeoutMs?: number
    readonly mediaProcessingIntervalMs?: number
}

interface MastodonProviderSession {
    readonly version: 1
    readonly instanceUrl: string
    readonly clientId: string
    readonly clientSecret: string
}

const defaultSleep = (milliseconds: number) =>
    new Promise<void>(resolve => setTimeout(resolve, milliseconds))

export function createMastodonProviderAdapter(
    options: MastodonProviderAdapterOptions = {}
): BuiltInProviderAdapter {
    return {
        providerId: MASTODON_PROVIDER,
        contractId: MASTODON_PROVIDER,
        revision: MASTODON_EXECUTION_CONTRACT_REVISION,
        execute: input => executeMastodonPublication({ input, options }),
    }
}

async function executeMastodonPublication(input: {
    readonly input: BuiltInProviderExecutionInput
    readonly options: MastodonProviderAdapterOptions
}): Promise<ExternalEffectOutcome> {
    const { input: execution, options } = input
    const target = execution.target
    const instanceUrl = readMastodonInstanceUrl(target.endpointUrl)
    if (instanceUrl === null) {
        return permanentFailure('The Mastodon instance origin is unavailable')
    }

    const destination = toMastodonDestination(target.destination)
    if (destination === null || destination.id !== target.externalAccountId) {
        return permanentFailure('The Mastodon publication destination is unavailable')
    }

    const secrets = await execution.credentials.resolvePublisherCredentialSecrets(
        target.projectId,
        target.credentialId
    )
    if (secrets === null)
        return permanentFailure('The Mastodon publisher credential is unavailable')

    const providerSession = parseProviderSession(secrets.providerSession)
    if (providerSession === null || providerSession.instanceUrl !== instanceUrl) {
        return permanentFailure('The Mastodon publisher session is unavailable')
    }

    let accessToken = secrets.accessToken
    if (target.credentialExpiresAt !== null && target.credentialExpiresAt <= execution.now) {
        if (secrets.refreshToken === null) {
            execution.credentials.markPublisherCredentialReconnectRequired(
                target.projectId,
                target.credentialId
            )
            return permanentFailure('The Mastodon publisher credential requires reconnection')
        }

        try {
            const refreshed = await (options.refreshAccessToken ?? refreshAccessToken)({
                authorizationServer: mastodonAuthorizationServer(instanceUrl),
                clientId: providerSession.clientId,
                clientAuthentication: clientSecretPost(providerSession.clientSecret),
                refreshToken: secrets.refreshToken,
            })
            const replaced = await execution.credentials.replacePublisherCredentialTokens({
                projectId: target.projectId,
                credentialId: target.credentialId,
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken ?? undefined,
                expiresAt: expiryFromSeconds(refreshed.expiresInSeconds, execution.now),
            })
            if (replaced.kind !== 'updated') {
                return retryableFailure('The refreshed Mastodon credential could not be persisted')
            }
            accessToken = refreshed.accessToken
        } catch {
            execution.credentials.markPublisherCredentialReconnectRequired(
                target.projectId,
                target.credentialId
            )
            return permanentFailure('The Mastodon publisher credential could not be refreshed')
        }
    }

    if (accessToken.trim().length === 0) {
        return permanentFailure('The Mastodon publisher access token is unavailable')
    }

    const publisher = (
        options.createPublisher ?? (baseUrl => createMastodonPublisher({ baseUrl }))
    )(instanceUrl)
    const text = readMastodonTextContent(target.content)
    if (text === null) return permanentFailure('The execution revision has no Mastodon status text')

    const mediaResult = await prepareMastodonMedia({
        target,
        accessToken,
        publisher,
        media: execution.media,
        providerMediaDeliveryStore: execution.providerMediaDeliveryStore,
        now: execution.now,
        sleep: options.sleep ?? defaultSleep,
        processingTimeoutMs: options.mediaProcessingTimeoutMs,
        processingIntervalMs: options.mediaProcessingIntervalMs,
    })
    if (mediaResult.kind !== 'ready') {
        if (isMastodonAuthenticationFailure(mediaResult.outcome)) {
            execution.credentials.markPublisherCredentialReconnectRequired(
                target.projectId,
                target.credentialId
            )
        }
        return mediaResult.outcome
    }

    let outcome: MastodonPublishOutcome
    try {
        outcome = await publisher.publishStatus({
            accessToken,
            text,
            mediaIds: mediaResult.mediaIds,
            ...readMastodonStatusOptions(target.content),
            idempotencyKey: `${target.publicationId}:${target.executionRevisionId}`,
        })
    } catch {
        return ambiguousFailure('The Mastodon status publication outcome is unknown')
    }

    if (outcome.type === 'permanent_failure' && outcome.code === 'authentication_required') {
        execution.credentials.markPublisherCredentialReconnectRequired(
            target.projectId,
            target.credentialId
        )
    }
    return outcome
}

async function prepareMastodonMedia(input: {
    readonly target: PublisherExecutionTarget
    readonly accessToken: string
    readonly publisher: MastodonPublisher
    readonly media: BuiltInProviderExecutionInput['media']
    readonly providerMediaDeliveryStore: ProviderMediaDeliveryPort
    readonly now: number
    readonly sleep: (milliseconds: number) => Promise<void>
    readonly processingTimeoutMs: number | undefined
    readonly processingIntervalMs: number | undefined
}): Promise<
    | { readonly kind: 'ready'; readonly mediaIds: readonly string[] }
    | { readonly kind: 'failed'; readonly outcome: ExternalEffectOutcome }
> {
    if (input.target.media.length === 0) return { kind: 'ready', mediaIds: [] }
    if (input.media === undefined) {
        return {
            kind: 'failed',
            outcome: permanentFailure(
                'Media lifecycle service is required for Mastodon image posts'
            ),
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
                outcome: permanentFailure('Mastodon image posts support JPEG and PNG images only'),
            }
        }
        if (targetMedia.byteSize > MASTODON_MAX_IMAGE_BYTES) {
            return {
                kind: 'failed',
                outcome: permanentFailure('The Mastodon image exceeds the portable image limit'),
            }
        }
        if (targetMedia.accessibilityText === null) {
            return {
                kind: 'failed',
                outcome: permanentFailure('Mastodon images require accessibility text'),
            }
        }

        const delivery = input.providerMediaDeliveryStore.reserve({
            projectId: input.target.projectId,
            executionMediaId: targetMedia.id,
            publisherId: input.target.publisherId,
            providerId: MASTODON_PROVIDER,
            at: input.now,
        })
        if (delivery.state === 'ambiguous') {
            return {
                kind: 'failed',
                outcome: ambiguousFailure(
                    delivery.errorMessage ?? 'The Mastodon media delivery requires reconciliation'
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
                    outcome: permanentFailure('The Mastodon media delivery disappeared'),
                }
            }
            current = retried
        }

        if (current.state === 'uploaded' && current.remoteMediaId !== null) {
            mediaIds.push(current.remoteMediaId)
            continue
        }

        if (current.state === 'uploading' && current.remoteMediaId !== null) {
            const ready = await waitForMastodonMedia({
                accessToken: input.accessToken,
                publisher: input.publisher,
                mediaId: current.remoteMediaId,
                sleep: input.sleep,
                timeoutMs: input.processingTimeoutMs,
                intervalMs: input.processingIntervalMs,
            })
            if (ready.kind === 'ready') {
                const completed = input.providerMediaDeliveryStore.complete({
                    projectId: input.target.projectId,
                    deliveryId: current.id,
                    remoteMediaId: current.remoteMediaId,
                    remoteMediaUrl: ready.url,
                    at: input.now,
                })
                if (completed?.state === 'uploaded') {
                    mediaIds.push(current.remoteMediaId)
                    continue
                }
            }
            return failMastodonMediaDelivery(
                input.providerMediaDeliveryStore,
                input.target.projectId,
                current.id,
                'media_processing_unknown',
                ready.kind === 'failed'
                    ? ready.errorMessage
                    : 'The Mastodon media processing state could not be confirmed',
                true,
                input.now
            )
        }

        if (current.state === 'uploading') {
            return failMastodonMediaDelivery(
                input.providerMediaDeliveryStore,
                input.target.projectId,
                current.id,
                'upload_in_progress',
                'The Mastodon image upload has no durable provider identifier',
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
                outcome: permanentFailure('The Mastodon media delivery could not be started'),
            }
        }

        let opened: Awaited<
            ReturnType<NonNullable<typeof input.media>['openRepresentationContent']>
        >
        try {
            opened = await openVerifiedPinnedMedia(input.media, input.target.projectId, targetMedia)
        } catch {
            return failMastodonMediaDelivery(
                input.providerMediaDeliveryStore,
                input.target.projectId,
                started.id,
                'media_read_failure',
                'The pinned Mastodon image could not be read; retry is safe',
                false,
                input.now
            )
        }
        if (opened === null) {
            return failMastodonMediaDelivery(
                input.providerMediaDeliveryStore,
                input.target.projectId,
                started.id,
                'media_unavailable',
                'The pinned Mastodon image is unavailable or changed',
                false,
                input.now
            )
        }

        let upload: Awaited<ReturnType<MastodonPublisher['uploadMedia']>>
        try {
            upload = await input.publisher.uploadMedia(input.accessToken, {
                contentType: targetMedia.contentType,
                size: targetMedia.byteSize,
                filename: targetMedia.originalFilename,
                accessibilityText: targetMedia.accessibilityText,
                stream: opened.stream,
            })
        } catch {
            return failMastodonMediaDelivery(
                input.providerMediaDeliveryStore,
                input.target.projectId,
                started.id,
                'upload_exception',
                'The Mastodon media upload outcome is unknown',
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
                        ? ambiguousFailure(
                              'The Mastodon media delivery state could not be persisted'
                          )
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
                outcome: ambiguousFailure(
                    'The Mastodon media provider identifier could not be persisted'
                ),
            }
        }

        if (!upload.ready) {
            const ready = await waitForMastodonMedia({
                accessToken: input.accessToken,
                publisher: input.publisher,
                mediaId: upload.remoteMediaId,
                sleep: input.sleep,
                timeoutMs: input.processingTimeoutMs,
                intervalMs: input.processingIntervalMs,
            })
            if (ready.kind !== 'ready') {
                return failMastodonMediaDelivery(
                    input.providerMediaDeliveryStore,
                    input.target.projectId,
                    started.id,
                    'media_processing_unknown',
                    ready.kind === 'failed'
                        ? ready.errorMessage
                        : 'The Mastodon media processing state could not be confirmed',
                    true,
                    input.now
                )
            }
            const completed = input.providerMediaDeliveryStore.complete({
                projectId: input.target.projectId,
                deliveryId: started.id,
                remoteMediaId: upload.remoteMediaId,
                remoteMediaUrl: ready.url,
                at: input.now,
            })
            if (completed?.state !== 'uploaded') {
                return {
                    kind: 'failed',
                    outcome: ambiguousFailure('The Mastodon media delivery could not be completed'),
                }
            }
        } else {
            const completed = input.providerMediaDeliveryStore.complete({
                projectId: input.target.projectId,
                deliveryId: started.id,
                remoteMediaId: upload.remoteMediaId,
                at: input.now,
            })
            if (completed?.state !== 'uploaded') {
                return {
                    kind: 'failed',
                    outcome: ambiguousFailure('The Mastodon media delivery could not be completed'),
                }
            }
        }

        mediaIds.push(upload.remoteMediaId)
    }

    return { kind: 'ready', mediaIds }
}

async function waitForMastodonMedia(input: {
    readonly accessToken: string
    readonly publisher: MastodonPublisher
    readonly mediaId: string
    readonly sleep: (milliseconds: number) => Promise<void>
    readonly timeoutMs: number | undefined
    readonly intervalMs: number | undefined
}): Promise<
    | { readonly kind: 'ready'; readonly url: string | null }
    | { readonly kind: 'failed'; readonly errorMessage: string }
    | { readonly kind: 'timeout' }
> {
    const timeoutMs = input.timeoutMs ?? 30_000
    const intervalMs = input.intervalMs ?? 500
    const startedAt = Date.now()

    while (Date.now() - startedAt <= timeoutMs) {
        const result = await input.publisher.getMedia(input.accessToken, input.mediaId)
        if (result.kind === 'failure') {
            return { kind: 'failed', errorMessage: mastodonFailureMessage(result.outcome) }
        }
        if (result.value.url !== null) return { kind: 'ready', url: result.value.url }
        await input.sleep(intervalMs)
    }
    return { kind: 'timeout' }
}

function failMastodonMediaDelivery(
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
                outcome: ambiguousFailure(
                    'The Mastodon media delivery state could not be persisted'
                ),
            }
        }
    } catch {
        return {
            kind: 'failed',
            outcome: ambiguousFailure('The Mastodon media delivery state could not be persisted'),
        }
    }
    return {
        kind: 'failed',
        outcome: ambiguous ? ambiguousFailure(errorMessage) : retryableFailure(errorMessage),
    }
}

function mastodonFailureMessage(outcome: MastodonOperationFailure): string {
    return outcome.errorMessage
}

function isMastodonAuthenticationFailure(outcome: ExternalEffectOutcome): boolean {
    return (
        outcome.type === 'permanent_failure' &&
        'code' in outcome &&
        outcome.code === 'authentication_required'
    )
}

function readMastodonInstanceUrl(value: string | null): string | null {
    if (value === null) return null
    try {
        return normalizeMastodonInstanceOrigin(value)
    } catch {
        return null
    }
}

function toMastodonDestination(
    value: PublisherExecutionTarget['destination']
): { readonly type: 'account'; readonly id: string } | null {
    if (value === null || value.type !== 'account') return null
    const id = value.id.trim()
    return id.length > 0 && !/\s/.test(id) ? { type: 'account', id } : null
}

function parseProviderSession(value: string | null): MastodonProviderSession | null {
    if (value === null) return null
    try {
        const parsed = JSON.parse(value) as Partial<MastodonProviderSession>
        if (
            parsed.version !== 1 ||
            typeof parsed.instanceUrl !== 'string' ||
            typeof parsed.clientId !== 'string' ||
            typeof parsed.clientSecret !== 'string'
        ) {
            return null
        }
        const instanceUrl = normalizeMastodonInstanceOrigin(parsed.instanceUrl)
        if (parsed.clientId.trim().length === 0 || parsed.clientSecret.trim().length === 0) {
            return null
        }
        return {
            version: 1,
            instanceUrl,
            clientId: parsed.clientId,
            clientSecret: parsed.clientSecret,
        }
    } catch {
        return null
    }
}

function mastodonAuthorizationServer(instanceUrl: string): OAuthAuthorizationServer {
    return {
        issuer: instanceUrl,
        authorizationEndpoint: `${instanceUrl}/oauth/authorize`,
        tokenEndpoint: `${instanceUrl}/oauth/token`,
        pkce: 'required',
    }
}

function expiryFromSeconds(seconds: number | null, now: number): number | null {
    if (seconds === null || !Number.isSafeInteger(seconds) || seconds <= 0) return null
    const expiry = now + seconds * 1_000
    return Number.isSafeInteger(expiry) ? expiry : null
}
