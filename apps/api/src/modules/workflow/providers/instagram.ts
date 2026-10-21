import type { ExternalEffectOutcome } from '@postdot/core'
import type { PublisherCredentialSecrets, PublisherExecutionMedia } from '@postdot/db'
import {
    createInstagramPublisher,
    INSTAGRAM_EXECUTION_REVISION,
    INSTAGRAM_MAX_ACCESSIBILITY_TEXT_LENGTH,
    INSTAGRAM_MAX_CAPTION_LENGTH,
    INSTAGRAM_MAX_IMAGE_BYTES,
    INSTAGRAM_PUBLISH_PERMISSIONS,
    InstagramOAuthError,
    isInstagramImageUrl,
    type createInstagramOAuth,
    type InstagramRefreshedToken,
} from '@postdot/instagram'

import { ambiguousFailure, permanentFailure, retryableFailure } from '../outcomes'
import { verifyPinnedMediaContent } from './media-integrity'
import type { BuiltInProviderAdapter, BuiltInProviderExecutionInput } from './registry'

type InstagramOAuth = ReturnType<typeof createInstagramOAuth>
type InstagramPublisher = ReturnType<typeof createInstagramPublisher>
/** Every provider failure is a sanitized outcome that never claims a publication. */
type InstagramFailureOutcome = Exclude<ExternalEffectOutcome, { readonly type: 'published' }>

/** The Instagram connection kind and the built-in contract identity. */
const providerId = 'instagram'

/**
 * The IG User Media reference accepts image ratios from 4:5 through 1.91:1.
 * The documented 320-1440 pixel width band is provider rescaling and is not
 * grounds to reject, as `packages/instagram/AGENT.md` records.
 */
const minimumAspectRatio = 4 / 5
const maximumAspectRatio = 1.91

/** A credential is refreshed inside this window before its known deadline. */
const refreshWindowMs = 24 * 60 * 60 * 1000
/**
 * The provider refreshes a long-lived token only once it is at least a day
 * old, the same rule `packages/instagram/src/oauth.ts` enforces.
 */
const minimumRefreshAgeMs = 24 * 60 * 60 * 1000
/**
 * The provider's content publishing guide recommends querying a container's
 * status once per minute, for no more than 5 minutes.
 * https://developers.facebook.com/documentation/instagram-platform/content-publishing
 */
const containerPreparationResumeMs = 60_000
/**
 * Container preparation is bounded by that documented window, so a container
 * that never becomes publishable is never queried again and never defers
 * forever. The bound is the provider's own recommendation for this endpoint;
 * it is not copied from another channel.
 */
const containerPreparationBudgetMs = 5 * 60_000

export interface InstagramProviderAdapterOptions {
    /** The transport used for container and publication requests. */
    readonly createPublisher?: () => InstagramPublisher
    /** Resolves the application configuration that issued the credential. */
    readonly resolveOAuth?: (
        providerApplicationId: string | null
    ) => Promise<InstagramOAuth | undefined>
}

export function createInstagramProviderAdapter(
    options: InstagramProviderAdapterOptions = {}
): BuiltInProviderAdapter {
    return {
        providerId,
        contractId: providerId,
        revision: INSTAGRAM_EXECUTION_REVISION,
        execute: input =>
            executeInstagramPublication({
                input,
                createPublisher: options.createPublisher ?? createInstagramPublisher,
                resolveOAuth: options.resolveOAuth,
            }),
    }
}

async function executeInstagramPublication(input: {
    readonly input: BuiltInProviderExecutionInput
    readonly createPublisher: () => InstagramPublisher
    readonly resolveOAuth?: (
        providerApplicationId: string | null
    ) => Promise<InstagramOAuth | undefined>
}): Promise<ExternalEffectOutcome> {
    const execution = input.input
    const target = execution.target

    // The publication always addresses the connected professional account.
    const destination = toInstagramDestination(target.destination)
    if (destination === null || destination.id !== target.externalAccountId)
        return permanentFailure('The Instagram publication destination is unavailable')
    if (
        target.profile.execution.kind !== 'built_in' ||
        target.profile.execution.contractId !== providerId ||
        target.profile.execution.revision !== INSTAGRAM_EXECUTION_REVISION
    )
        return permanentFailure('The Instagram execution contract is unavailable')

    const content = readInstagramContent(target.content)
    if (content === null) return permanentFailure('The Instagram execution content is invalid')

    if (target.media.length !== 1 || target.mediaReferenceCount !== 1)
        return permanentFailure('The Instagram execution requires exactly one image')
    const pinned = target.media[0]
    if (pinned === undefined) return permanentFailure('The Instagram execution requires an image')
    const media = readPinnedInstagramMedia(pinned, content.assetId)
    if (media === null)
        return permanentFailure('The pinned Instagram media is invalid or unavailable')

    if (target.credentialState !== 'active')
        return permanentFailure('The Instagram credential is unavailable')
    let secrets: PublisherCredentialSecrets | null
    try {
        secrets = await execution.credentials.resolvePublisherCredentialSecrets(
            target.projectId,
            target.credentialId
        )
    } catch {
        // A local credential read failure is retryable and happens before any
        // write, so it never becomes an ambiguous external outcome.
        return retryableFailure('The Instagram credential could not be read; retry is safe')
    }
    if (secrets === null) return permanentFailure('The Instagram credential is unavailable')

    // The granted permissions are the credential's own scopes, never a request.
    const grants = readCredentialGrants(
        execution.credentials,
        target.projectId,
        target.credentialId
    )
    if (grants === null)
        return permanentFailure('The Instagram credential scopes cannot be verified')
    if (!INSTAGRAM_PUBLISH_PERMISSIONS.every(scope => grants.scopes.includes(scope))) {
        // The stored grants are known and no longer carry the publishing
        // permissions. The connection lost its grants, so the credential is
        // marked and Studio can reconnect it.
        execution.credentials.markPublisherCredentialReconnectRequired(
            target.projectId,
            target.credentialId
        )
        return permanentFailure('The Instagram connection does not grant publishing access')
    }

    const token = await resolveInstagramAccessToken({
        execution,
        secrets,
        resolveOAuth: input.resolveOAuth,
    })
    if (!token.ok) return token.outcome

    return publishInstagramImage({
        execution,
        publisher: input.createPublisher(),
        accessToken: token.accessToken,
        accountId: destination.id,
        pinned,
        caption: content.caption,
        accessibilityText: media.accessibilityText,
    })
}

/**
 * Enforces the credential lifetime. A durable Instagram credential always has
 * a known deadline; an expired token is never refreshed. A token that expires
 * soon is refreshed only when it is old enough and the issuing application
 * configuration is available.
 */
async function resolveInstagramAccessToken(input: {
    readonly execution: BuiltInProviderExecutionInput
    readonly secrets: PublisherCredentialSecrets
    readonly resolveOAuth?: (
        providerApplicationId: string | null
    ) => Promise<InstagramOAuth | undefined>
}): Promise<
    | { readonly ok: true; readonly accessToken: string }
    | { readonly ok: false; readonly outcome: ExternalEffectOutcome }
> {
    const execution = input.execution
    const target = execution.target
    const expiresAt = target.credentialExpiresAt
    if (expiresAt === null) {
        execution.credentials.markPublisherCredentialReconnectRequired(
            target.projectId,
            target.credentialId
        )
        return {
            ok: false,
            outcome: permanentFailure(
                'The Instagram credential has no known expiration; reconnect the account'
            ),
        }
    }
    if (expiresAt <= execution.now) {
        // An expired token can never be refreshed.
        execution.credentials.markPublisherCredentialReconnectRequired(
            target.projectId,
            target.credentialId
        )
        return {
            ok: false,
            outcome: permanentFailure('The Instagram connection expired; reconnect the account'),
        }
    }

    let accessToken = input.secrets.accessToken
    if (accessToken.trim().length === 0)
        return { ok: false, outcome: permanentFailure('The Instagram access token is unavailable') }
    if (expiresAt - execution.now > refreshWindowMs) return { ok: true, accessToken }

    const session = parseInstagramProviderSession(input.secrets.providerSession)
    // Without usable issuance metadata the credential cannot be refreshed. The
    // stored token is still inside its own known lifetime, so it is used as it
    // is instead of inventing an expiration.
    if (session === null) return { ok: true, accessToken }
    if (execution.now - session.issuedAt < minimumRefreshAgeMs) return { ok: true, accessToken }

    let oauth: InstagramOAuth | undefined
    try {
        // The issuing configuration is read from the encrypted application
        // settings. A resolution failure is a local error, not a provider
        // error, and it happens before any write.
        oauth = await input.resolveOAuth?.(target.providerApplicationId ?? null)
    } catch {
        return {
            ok: false,
            outcome: retryableFailure(
                'The Instagram application configuration could not be read; retry is safe'
            ),
        }
    }
    if (oauth === undefined) return { ok: true, accessToken }

    let refreshed: InstagramRefreshedToken
    try {
        refreshed = await oauth.refresh({
            accessToken,
            issuedAt: session.issuedAt,
            expiresAt,
        })
    } catch (error) {
        const code = error instanceof InstagramOAuthError ? error.code : null
        if (code === 'token_invalid' || code === 'token_expired') {
            execution.credentials.markPublisherCredentialReconnectRequired(
                target.projectId,
                target.credentialId
            )
            return {
                ok: false,
                outcome: permanentFailure(
                    'The Instagram connection is no longer valid; reconnect the account'
                ),
            }
        }
        return {
            ok: false,
            outcome: retryableFailure(
                'The Instagram credential could not be refreshed; retry is safe'
            ),
        }
    }

    const replaced = await execution.credentials.replacePublisherCredentialTokens({
        projectId: target.projectId,
        credentialId: target.credentialId,
        accessToken: refreshed.accessToken,
        // The provider grants no refresh token; none is invented.
        refreshToken: null,
        providerSession: JSON.stringify({
            version: 1,
            issuedAt: refreshed.issuedAt,
            appScopedId: session.appScopedId,
            accountType: session.accountType,
        }),
        expiresAt: refreshed.expiresAt,
    })
    if (replaced.kind !== 'updated')
        return {
            ok: false,
            outcome: retryableFailure(
                'The refreshed Instagram credential could not be persisted; retry is safe'
            ),
        }
    accessToken = refreshed.accessToken
    return { ok: true, accessToken }
}

/**
 * Prepares the container and publishes it. The container identity is durable
 * before any status read or final publication, so an interrupted run never
 * recreates a container and a lost write acknowledgement is never replayed.
 */
async function publishInstagramImage(input: {
    readonly execution: BuiltInProviderExecutionInput
    readonly publisher: InstagramPublisher
    readonly accessToken: string
    readonly accountId: string
    readonly pinned: PublisherExecutionMedia
    readonly caption?: string
    readonly accessibilityText?: string
}): Promise<ExternalEffectOutcome> {
    const execution = input.execution
    const target = execution.target
    const store = execution.providerMediaDeliveryStore

    let delivery = store.reserve({
        projectId: target.projectId,
        executionMediaId: input.pinned.id,
        publisherId: target.publisherId,
        providerId,
        at: execution.now,
    })
    if (delivery.state === 'ambiguous')
        return ambiguousFailure(
            delivery.errorMessage ?? 'The Instagram media delivery requires reconciliation'
        )
    if (delivery.state === 'failed') {
        const retried = store.retry({
            projectId: delivery.projectId,
            deliveryId: delivery.id,
            at: execution.now,
        })
        if (!retried) return permanentFailure('The Instagram media delivery disappeared')
        delivery = retried
    }

    if (delivery.remoteMediaId === null) {
        if (delivery.state === 'uploading')
            // The container write may have reached the provider without an
            // acknowledged identity. It is never recreated.
            return ambiguousFailure(
                'The interrupted Instagram container preparation requires reconciliation'
            )
        const started = store.start({
            projectId: delivery.projectId,
            deliveryId: delivery.id,
            at: execution.now,
        })
        if (!started || started.state !== 'uploading')
            return ambiguousFailure('The Instagram media delivery could not be claimed')
        delivery = started

        const created = await createInstagramContainer({
            execution,
            publisher: input.publisher,
            accessToken: input.accessToken,
            accountId: input.accountId,
            pinned: input.pinned,
            ...(input.caption === undefined ? {} : { caption: input.caption }),
            ...(input.accessibilityText === undefined
                ? {}
                : { accessibilityText: input.accessibilityText }),
        })
        if (!created.ok) {
            const failed = store.fail({
                projectId: delivery.projectId,
                deliveryId: delivery.id,
                errorCode:
                    created.outcome.type === 'ambiguous' ? 'unknown_result' : 'container_rejected',
                errorMessage: created.outcome.errorMessage,
                ambiguous: created.outcome.type === 'ambiguous',
                at: execution.now,
            })
            return failed === null
                ? ambiguousFailure('The Instagram media delivery state could not be persisted')
                : created.outcome
        }

        const checkpoint = store.recordRemoteMediaId({
            projectId: delivery.projectId,
            deliveryId: delivery.id,
            remoteMediaId: created.containerId,
            at: execution.now,
        })
        if (checkpoint?.remoteMediaId !== created.containerId)
            return ambiguousFailure('The Instagram container identity could not be persisted')
        const completed = store.complete({
            projectId: delivery.projectId,
            deliveryId: delivery.id,
            remoteMediaId: created.containerId,
            at: execution.now,
        })
        if (completed?.state !== 'uploaded')
            return ambiguousFailure('The Instagram media delivery could not be completed')
        delivery = completed
    } else if (delivery.state === 'uploading') {
        // The container identity was acknowledged before the completion checkpoint.
        const completed = store.complete({
            projectId: delivery.projectId,
            deliveryId: delivery.id,
            remoteMediaId: delivery.remoteMediaId,
            at: execution.now,
        })
        if (completed?.state !== 'uploaded')
            return ambiguousFailure('The Instagram media delivery could not be completed')
        delivery = completed
    }

    const containerId = delivery.remoteMediaId
    if (containerId === null)
        return ambiguousFailure('The Instagram media delivery has no container identity')

    // The preparation budget is checked before the status read, never after it.
    // The provider documents one status query per minute for no more than five
    // minutes, so the query that would land in the sixth minute is never sent.
    // The clock is the durable start of the current attempt, so a resumed
    // execution cannot extend the window by restarting it.
    const preparationStartedAt = delivery.lastAttemptAt ?? delivery.createdAt
    if (execution.now - preparationStartedAt >= containerPreparationBudgetMs)
        return permanentFailure(
            'The Instagram container did not finish preparing within the supported window'
        )

    const status = await input.publisher.readContainerStatus({
        accessToken: input.accessToken,
        containerId,
    })
    if (!status.ok) {
        // A failed read keeps the checkpoint; the container is never recreated.
        if (status.outcome.code === 'authentication_required')
            execution.credentials.markPublisherCredentialReconnectRequired(
                target.projectId,
                target.credentialId
            )
        return status.outcome
    }

    const containerStatus = status.value.status
    if (containerStatus === 'in_progress')
        // The container is still preparing. The execution resumes one minute
        // later, and the budget above stops the queries at the documented
        // window.
        return {
            type: 'deferred',
            effectOccurred: false,
            errorMessage: 'The Instagram container is still preparing',
            resumeAfterMs: containerPreparationResumeMs,
        }
    if (containerStatus === 'error')
        return permanentFailure('The Instagram container failed to prepare')
    if (containerStatus === 'expired')
        return permanentFailure('The Instagram container expired before publication')
    if (containerStatus === 'published')
        // A published container status is a status, never a media receipt.
        return ambiguousFailure(
            'The Instagram container reports a published state without a media receipt; reconciliation is required'
        )

    const published = await input.publisher.publishContainer({
        accountId: input.accountId,
        accessToken: input.accessToken,
        containerId,
    })
    if (published.type === 'published')
        // Only the provider's own published media identity is a receipt.
        return { type: 'published', externalId: published.externalId }
    if (published.code === 'authentication_required' || published.code === 'permission_denied')
        execution.credentials.markPublisherCredentialReconnectRequired(
            target.projectId,
            target.credentialId
        )
    return published
}

/**
 * Creates the container. The image is verified by bytes and addressed by the
 * signed public URL minted for the pinned representation; no user-provided
 * image address is ever sent.
 */
async function createInstagramContainer(input: {
    readonly execution: BuiltInProviderExecutionInput
    readonly publisher: InstagramPublisher
    readonly accessToken: string
    readonly accountId: string
    readonly pinned: PublisherExecutionMedia
    readonly caption?: string
    readonly accessibilityText?: string
}): Promise<
    | { readonly ok: true; readonly containerId: string }
    | { readonly ok: false; readonly outcome: InstagramFailureOutcome }
> {
    const execution = input.execution
    const target = execution.target
    if (!execution.media)
        return {
            ok: false,
            outcome: permanentFailure('The Instagram media service is unavailable'),
        }

    let verified: boolean
    try {
        verified = await verifyPinnedMediaContent(execution.media, target.projectId, input.pinned)
    } catch {
        return {
            ok: false,
            outcome: retryableFailure(
                'The pinned Instagram media could not be read; retry is safe'
            ),
        }
    }
    if (!verified)
        return {
            ok: false,
            outcome: permanentFailure('The pinned Instagram media changed or is unavailable'),
        }

    if (!execution.resolveMediaUrl)
        return {
            ok: false,
            outcome: permanentFailure(
                'Instagram image publishing requires signed public media delivery'
            ),
        }
    let imageUrl: string | null
    try {
        imageUrl = await execution.resolveMediaUrl(input.pinned, {
            projectId: target.projectId,
        })
    } catch {
        return {
            ok: false,
            outcome: retryableFailure(
                'The Instagram media URL could not be prepared; retry is safe'
            ),
        }
    }
    if (imageUrl === null)
        return { ok: false, outcome: permanentFailure('The Instagram media URL is unavailable') }
    if (!isInstagramImageUrl(imageUrl))
        return {
            ok: false,
            outcome: permanentFailure('The Instagram media URL is not a public HTTPS address'),
        }

    const created = await input.publisher.createContainer({
        accountId: input.accountId,
        accessToken: input.accessToken,
        imageUrl,
        ...(input.caption === undefined ? {} : { caption: input.caption }),
        ...(input.accessibilityText === undefined
            ? {}
            : { accessibilityText: input.accessibilityText }),
    })
    if (!created.ok) return { ok: false, outcome: created.outcome }
    return { ok: true, containerId: created.value.containerId }
}

interface InstagramContent {
    readonly caption?: string
    readonly assetId: string
}

function readInstagramContent(content: Readonly<Record<string, unknown>>): InstagramContent | null {
    const caption = content.caption
    if (caption !== undefined) {
        if (typeof caption !== 'string') return null
        if (codePointLength(caption) > INSTAGRAM_MAX_CAPTION_LENGTH) return null
    }
    const media = content.media
    if (!Array.isArray(media) || media.length !== 1) return null
    const reference = media[0]
    if (typeof reference !== 'object' || reference === null || Array.isArray(reference)) return null
    const assetId = (reference as { readonly assetId?: unknown }).assetId
    if (typeof assetId !== 'string' || assetId.trim().length === 0) return null
    return {
        ...(caption === undefined ? {} : { caption }),
        assetId: assetId.trim(),
    }
}

interface PinnedInstagramMedia {
    readonly accessibilityText?: string
}

/**
 * The pinned representation is the only accepted image: one JPEG with
 * positive bytes inside the conservative envelope, inspected dimensions and an
 * aspect ratio the provider accepts.
 */
function readPinnedInstagramMedia(
    pinned: PublisherExecutionMedia,
    referenceAssetId: string
): PinnedInstagramMedia | null {
    if (pinned.family !== 'image' || pinned.contentType !== 'image/jpeg') return null
    if (pinned.assetId !== referenceAssetId) return null
    if (pinned.byteSize <= 0 || pinned.byteSize > INSTAGRAM_MAX_IMAGE_BYTES) return null
    if (pinned.width === null || pinned.height === null) return null
    if (pinned.width <= 0 || pinned.height <= 0) return null
    const ratio = pinned.width / pinned.height
    if (ratio < minimumAspectRatio || ratio > maximumAspectRatio) return null
    const accessibilityText = pinned.accessibilityText
    if (accessibilityText === null) return {}
    if (codePointLength(accessibilityText) > INSTAGRAM_MAX_ACCESSIBILITY_TEXT_LENGTH) return null
    return { accessibilityText }
}

interface InstagramProviderSession {
    readonly issuedAt: number
    readonly appScopedId: string
    readonly accountType: 'BUSINESS' | 'MEDIA_CREATOR'
}

/**
 * Reads the encrypted issuance metadata written by the connection flow in
 * `apps/api/src/modules/publishers/instagram-connection-flow.ts`. A corrupt
 * session never yields a guessed issuance time.
 */
function parseInstagramProviderSession(value: string | null): InstagramProviderSession | null {
    if (value === null) return null
    let parsed: unknown
    try {
        parsed = JSON.parse(value)
    } catch {
        return null
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const session = parsed as Record<string, unknown>
    if (session.version !== 1) return null
    const issuedAt = session.issuedAt
    if (typeof issuedAt !== 'number' || !Number.isSafeInteger(issuedAt) || issuedAt < 0) return null
    const appScopedId = session.appScopedId
    if (typeof appScopedId !== 'string' || !/^[1-9]\d{0,63}$/.test(appScopedId)) return null
    const accountType = session.accountType
    if (accountType !== 'BUSINESS' && accountType !== 'MEDIA_CREATOR') return null
    return { issuedAt, appScopedId, accountType }
}

/**
 * The shared credential port exposes secrets, not the granted permissions. The
 * scopes are read through the credential record when the port offers it; a
 * credential whose permissions cannot be read is never published with.
 *
 * An unreadable record is an unknown grant set, not a lost grant. It fails
 * closed without marking the credential, because a static access failure is
 * not something a reconnection would repair.
 */
function readCredentialGrants(
    credentials: BuiltInProviderExecutionInput['credentials'],
    projectId: string,
    credentialId: string
): { readonly scopes: readonly string[] } | null {
    const reader = credentials.getPublisherCredential
    if (typeof reader !== 'function') return null
    let credential: { readonly scopes: readonly string[] } | null
    try {
        credential = reader.call(credentials, projectId, credentialId)
    } catch {
        return null
    }
    if (credential === null) return null
    if (!Array.isArray(credential.scopes)) return null
    return { scopes: credential.scopes }
}

function toInstagramDestination(
    value: BuiltInProviderExecutionInput['target']['destination']
): { readonly type: 'account'; readonly id: string } | null {
    if (value === null || value.type !== 'account') return null
    const id = value.id.trim()
    if (!/^[1-9]\d{0,63}$/.test(id)) return null
    return { type: 'account', id }
}

function codePointLength(value: string): number {
    return Array.from(value).length
}
