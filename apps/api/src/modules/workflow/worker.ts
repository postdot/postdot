import {
    createExponentialRetryPolicy,
    NextEventScheduler,
    processNextWorkflowEvent,
    type ExternalEffectOutcome,
    type Job,
    type RetryPolicy,
} from '@herald/core'
import {
    CUSTOM_HTTP_PUBLISHER_KIND,
    createCustomHttpTransport,
    type CustomHttpMediaDescriptor,
    type CustomHttpTransport,
} from '@herald/custom-http'
import {
    createWorkflowStore,
    createProviderMediaDeliveryStore,
    type createPublisherCredentialStore,
    type createPublisherStore,
    type HeraldDatabase,
    type MediaAssetStore,
    type PublisherExecutionTarget,
} from '@herald/db'
import {
    createLinkedInImagePublisher,
    createLinkedInTextPublisher,
    LINKEDIN_PROVIDER,
    readLinkedInTextContent,
    type LinkedInImagePublisher,
    type LinkedInTextPublisher,
} from '@herald/linkedin'
import {
    refreshAccessToken,
    type OAuthAuthorizationServer,
    type OAuthClientAuthentication,
} from '@herald/oauth'

const defaultLeaseDuration = 5 * 60_000
const defaultRetryPolicy = createExponentialRetryPolicy({
    maxAttempts: 3,
    initialDelay: 60_000,
    maximumDelay: 60 * 60_000,
})

export interface PublicationWorkerOptions {
    readonly database: HeraldDatabase
    readonly publisherStore: ReturnType<typeof createPublisherStore>
    readonly publisherCredentialStore: ReturnType<typeof createPublisherCredentialStore>
    readonly media?: MediaAssetStore
    readonly customHttpTransport?: CustomHttpTransport
    readonly resolveCustomHttpMediaUrl?: (
        media: CustomHttpMediaDescriptor,
        context: { readonly projectId: string }
    ) => string | null | Promise<string | null>
    readonly linkedinOAuth?: {
        readonly authorizationServer: OAuthAuthorizationServer
        readonly clientId: string
        readonly clientAuthentication: OAuthClientAuthentication
    }
    readonly now?: () => number
    readonly leaseDuration?: number
    readonly retryPolicy?: RetryPolicy
    readonly createClaimToken?: () => string
    readonly linkedInPublisher?: LinkedInTextPublisher
    readonly linkedInImagePublisher?: LinkedInImagePublisher
    readonly providerMediaDeliveryStore?: ReturnType<typeof createProviderMediaDeliveryStore>
    readonly onError?: (error: unknown) => void
}

export interface PublicationWorker {
    readonly scheduler: NextEventScheduler
    processDueEvents(now: number): Promise<void>
    start(): void
    stop(): void
    replan(): void
}

export function createPublicationWorker(options: PublicationWorkerOptions): PublicationWorker {
    const now = options.now ?? Date.now
    const workflowStore = createWorkflowStore(options.database)
    const publisherStore = options.publisherStore
    const linkedInPublisher = options.linkedInPublisher ?? createLinkedInTextPublisher()
    const linkedInImagePublisher = options.linkedInImagePublisher ?? createLinkedInImagePublisher()
    const providerMediaDeliveryStore =
        options.providerMediaDeliveryStore ??
        createProviderMediaDeliveryStore(options.database, { now })
    const customHttpTransport = options.customHttpTransport ?? createCustomHttpTransport()
    const leaseDuration = options.leaseDuration ?? defaultLeaseDuration
    const retryPolicy = options.retryPolicy ?? defaultRetryPolicy
    const createClaimToken = options.createClaimToken ?? (() => crypto.randomUUID())

    const processDueEvents = async (at: number) => {
        const timestamp = at

        for (const projectId of workflowStore.listProjectIds()) {
            const actorId = workflowStore.ensureSystemActor(projectId, timestamp)
            if (actorId === null) continue

            while (true) {
                const result = await processNextWorkflowEvent({
                    store: workflowStore,
                    actorId,
                    leaseDuration,
                    retryPolicy,
                    createClaimToken,
                    performExternalEffect: job =>
                        performExternalEffect({
                            job,
                            linkedInPublisher,
                            linkedInImagePublisher,
                            providerMediaDeliveryStore,
                            publisherStore,
                            publisherCredentialStore: options.publisherCredentialStore,
                            media: options.media,
                            customHttpTransport,
                            resolveCustomHttpMediaUrl: options.resolveCustomHttpMediaUrl,
                            linkedinOAuth: options.linkedinOAuth,
                            now: timestamp,
                        }),
                    now: () => timestamp,
                })

                if (result.jobId === null || result.outcome === 'claim_lost') break
            }
        }
    }

    const scheduler = new NextEventScheduler({
        getNextEventAt: workflowStore.getNextEventAt,
        processDueEvents,
        onError: options.onError ?? defaultWorkerErrorHandler,
        clock: { now },
    })

    return {
        scheduler,
        processDueEvents,
        start() {
            scheduler.start()
        },
        stop() {
            scheduler.stop()
        },
        replan() {
            if (scheduler.state === 'started') scheduler.replan()
        },
    }
}

async function performExternalEffect(input: {
    readonly job: Job
    readonly linkedInPublisher: LinkedInTextPublisher
    readonly linkedInImagePublisher: LinkedInImagePublisher
    readonly providerMediaDeliveryStore: ReturnType<typeof createProviderMediaDeliveryStore>
    readonly publisherStore: ReturnType<typeof createPublisherStore>
    readonly publisherCredentialStore: ReturnType<typeof createPublisherCredentialStore>
    readonly media?: MediaAssetStore
    readonly customHttpTransport: CustomHttpTransport
    readonly resolveCustomHttpMediaUrl?: (
        media: CustomHttpMediaDescriptor,
        context: { readonly projectId: string }
    ) => string | null | Promise<string | null>
    readonly linkedinOAuth:
        | {
              readonly authorizationServer: OAuthAuthorizationServer
              readonly clientId: string
              readonly clientAuthentication: OAuthClientAuthentication
          }
        | undefined
    readonly now: number
}): Promise<ExternalEffectOutcome> {
    const {
        job,
        linkedInPublisher,
        linkedInImagePublisher,
        providerMediaDeliveryStore,
        publisherStore,
        publisherCredentialStore,
    } = input
    if (job.claimToken === null) {
        return permanentFailure('The claimed publication has no execution fence')
    }

    const target = publisherStore.getPublisherExecutionTarget(job.id, job.claimToken)
    if (target === null) {
        return permanentFailure('The publisher execution context is unavailable')
    }

    if (target.kind === CUSTOM_HTTP_PUBLISHER_KIND) {
        if (target.providerId !== CUSTOM_HTTP_PUBLISHER_KIND) {
            return permanentFailure('The custom HTTP publisher credential is invalid')
        }
        return performCustomHttpEffect(input, target)
    }

    if (target.providerId !== LINKEDIN_PROVIDER || target.kind !== LINKEDIN_PROVIDER) {
        return permanentFailure(`No publisher adapter is registered for ${target.providerId}`)
    }

    const secrets = await publisherCredentialStore.resolvePublisherCredentialSecrets(
        target.projectId,
        target.credentialId
    )
    if (secrets === null) {
        return permanentFailure('The publisher credential is unavailable')
    }

    let accessToken = secrets.accessToken
    const refreshToken = secrets.refreshToken
    try {
        if (target.credentialExpiresAt !== null && target.credentialExpiresAt <= input.now) {
            if (refreshToken === null || input.linkedinOAuth === undefined) {
                publisherCredentialStore.markPublisherCredentialReconnectRequired(
                    target.projectId,
                    target.credentialId
                )
                return permanentFailure('The publisher credential requires reconnection')
            }

            const refreshed = await refreshAccessToken({
                authorizationServer: input.linkedinOAuth.authorizationServer,
                clientId: input.linkedinOAuth.clientId,
                clientAuthentication: input.linkedinOAuth.clientAuthentication,
                refreshToken,
            })
            const expiresAt =
                refreshed.expiresInSeconds === null
                    ? null
                    : input.now + refreshed.expiresInSeconds * 1000
            const replaced = await publisherCredentialStore.replacePublisherCredentialTokens({
                projectId: target.projectId,
                credentialId: target.credentialId,
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken ?? undefined,
                expiresAt,
            })
            if (replaced.kind !== 'updated') {
                return permanentFailure('The publisher credential could not be refreshed')
            }
            accessToken = refreshed.accessToken
        }
    } catch {
        publisherCredentialStore.markPublisherCredentialReconnectRequired(
            target.projectId,
            target.credentialId
        )
        return permanentFailure('The publisher credential could not be refreshed')
    }

    if (accessToken.trim().length === 0) {
        return permanentFailure('The publisher account access token is unavailable')
    }

    const outcome =
        target.media.length === 0
            ? await publishLinkedInText({
                  accessToken,
                  memberId: target.externalAccountId,
                  content: target.content,
                  publisher: linkedInPublisher,
              })
            : await publishLinkedInImage({
                  accessToken,
                  memberId: target.externalAccountId,
                  target,
                  media: input.media,
                  publisher: linkedInImagePublisher,
                  providerMediaDeliveryStore,
                  now: input.now,
              })
    if (
        outcome.type === 'permanent_failure' &&
        'code' in outcome &&
        (outcome.code === 'authentication_required' || outcome.code === 'forbidden')
    ) {
        publisherCredentialStore.markPublisherCredentialReconnectRequired(
            target.projectId,
            target.credentialId
        )
    }
    return outcome
}

async function publishLinkedInText(input: {
    readonly accessToken: string
    readonly memberId: string
    readonly content: Readonly<Record<string, unknown>>
    readonly publisher: LinkedInTextPublisher
}): Promise<ExternalEffectOutcome> {
    const commentary = readLinkedInTextContent(input.content)
    if (commentary === null) {
        return permanentFailure('The execution revision does not contain LinkedIn commentary')
    }

    return input.publisher.publishText({
        accessToken: input.accessToken,
        memberId: input.memberId,
        commentary,
    })
}

async function publishLinkedInImage(input: {
    readonly accessToken: string
    readonly memberId: string
    readonly target: PublisherExecutionTarget
    readonly media: MediaAssetStore | undefined
    readonly publisher: LinkedInImagePublisher
    readonly providerMediaDeliveryStore: ReturnType<typeof createProviderMediaDeliveryStore>
    readonly now: number
}): Promise<ExternalEffectOutcome> {
    if (input.target.media.length !== 1) {
        return permanentFailure('LinkedIn member image posts require exactly one image')
    }
    const targetMedia = input.target.media[0]
    if (targetMedia === undefined) {
        return permanentFailure('The LinkedIn image reference is unavailable')
    }
    if (
        targetMedia.family !== 'image' ||
        (targetMedia.contentType !== 'image/jpeg' && targetMedia.contentType !== 'image/png')
    ) {
        return permanentFailure(
            'The pinned LinkedIn media representation is not a JPEG or PNG image'
        )
    }
    if (input.media === undefined) {
        return permanentFailure('Media lifecycle service is required for LinkedIn image posts')
    }

    const commentary = readLinkedInTextContent(input.target.content)
    if (commentary === null) {
        return permanentFailure('The execution revision does not contain LinkedIn commentary')
    }

    const delivery = input.providerMediaDeliveryStore.reserve({
        projectId: input.target.projectId,
        executionMediaId: targetMedia.id,
        publisherId: input.target.publisherId,
        providerId: LINKEDIN_PROVIDER,
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
        return input.publisher.publishImage({
            accessToken: input.accessToken,
            memberId: input.memberId,
            commentary,
            imageId: current.remoteMediaId,
            accessibilityText: targetMedia.accessibilityText,
        })
    }

    if (current.state === 'uploading' && current.remoteMediaId !== null) {
        const completed = input.providerMediaDeliveryStore.complete({
            projectId: input.target.projectId,
            deliveryId: current.id,
            remoteMediaId: current.remoteMediaId,
            at: input.now,
        })
        if (completed?.state === 'uploaded' && completed.remoteMediaId !== null) {
            return input.publisher.publishImage({
                accessToken: input.accessToken,
                memberId: input.memberId,
                commentary,
                imageId: completed.remoteMediaId,
                accessibilityText: targetMedia.accessibilityText,
            })
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

    let opened: Awaited<ReturnType<MediaAssetStore['openRepresentationContent']>>
    try {
        opened = await input.media.openRepresentationContent(
            input.target.projectId,
            targetMedia.assetId,
            targetMedia.representationId
        )
    } catch {
        return failLinkedInImageDelivery(
            input,
            started.id,
            'media_read_failure',
            'The pinned LinkedIn image representation could not be read; retry is safe',
            false
        )
    }
    if (
        opened === null ||
        opened.representation.storeId !== targetMedia.storeId ||
        opened.representation.objectKey !== targetMedia.objectKey ||
        opened.size !== targetMedia.byteSize ||
        opened.contentType !== targetMedia.contentType ||
        opened.sha256 !== targetMedia.sha256
    ) {
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
            memberId: input.memberId,
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

    return input.publisher.publishImage({
        accessToken: input.accessToken,
        memberId: input.memberId,
        commentary,
        imageId: upload.remoteMediaId,
        accessibilityText: targetMedia.accessibilityText,
    })
}

async function performCustomHttpEffect(
    input: Parameters<typeof performExternalEffect>[0],
    target: PublisherExecutionTarget
): Promise<ExternalEffectOutcome> {
    if (target.profile.execution.kind !== 'declarative_http') {
        return permanentFailure('The custom HTTP channel profile is not executable')
    }
    if (target.endpointUrl === null || target.authentication === null) {
        return permanentFailure('The custom HTTP connection is incomplete')
    }

    const secrets = await input.publisherCredentialStore.resolvePublisherCredentialSecrets(
        target.projectId,
        target.credentialId
    )
    if (secrets === null || secrets.accessToken.trim().length === 0) {
        return permanentFailure('The custom HTTP connection secret is unavailable')
    }

    const mediaReader =
        input.media === undefined
            ? undefined
            : {
                  open: async (media: CustomHttpMediaDescriptor) => {
                      const opened = await input.media!.openRepresentationContent(
                          target.projectId,
                          media.assetId,
                          media.representationId
                      )
                      if (
                          opened === null ||
                          opened.representation.storeId !== media.storeId ||
                          opened.representation.objectKey !== media.objectKey ||
                          opened.size !== media.byteSize ||
                          opened.contentType !== media.contentType
                      ) {
                          return null
                      }
                      return {
                          size: opened.size,
                          contentType: opened.contentType,
                          stream: opened.stream,
                      }
                  },
              }

    return input.customHttpTransport.deliver({
        execution: target.profile.execution,
        content: target.content,
        context: {
            deliveryId: target.jobId,
            jobId: target.jobId,
            projectId: target.projectId,
            publicationId: target.publicationId,
            channelId: target.channelId,
            channelName: target.channelName,
            scheduledAt: target.scheduledAt,
            attempt: target.attempt,
            externalAccountId: target.externalAccountId,
            deliveredAt: input.now,
        },
        media: target.media,
        connection: {
            endpointUrl: target.endpointUrl,
            authentication: target.authentication,
            secret: secrets.accessToken,
        },
        mediaReader,
        resolveMediaUrl:
            input.resolveCustomHttpMediaUrl === undefined
                ? undefined
                : (media, context) => input.resolveCustomHttpMediaUrl!(media, context),
    })
}

function permanentFailure(
    errorMessage: string
): Extract<ExternalEffectOutcome, { type: 'permanent_failure' }> {
    return {
        type: 'permanent_failure',
        effectOccurred: false,
        errorMessage,
    }
}

function ambiguousFailure(
    errorMessage: string
): Extract<ExternalEffectOutcome, { type: 'ambiguous' }> {
    return { type: 'ambiguous', errorMessage }
}

function retryableFailure(
    errorMessage: string
): Extract<ExternalEffectOutcome, { type: 'retryable_failure' }> {
    return { type: 'retryable_failure', effectOccurred: false, errorMessage }
}

function failLinkedInImageDelivery(
    input: Parameters<typeof publishLinkedInImage>[0],
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

function defaultWorkerErrorHandler(error: unknown): void {
    console.error('[herald-worker] scheduler failed', error)
}

export type { PublisherExecutionTarget }
