import {
    createExponentialRetryPolicy,
    NextEventScheduler,
    processNextWorkflowEvent,
    type ExternalEffectOutcome,
    type Job,
    type RetryPolicy,
    type SchedulerTimers,
} from '@postbot/core'
import {
    CUSTOM_HTTP_PUBLISHER_KIND,
    createCustomHttpTransport,
    type CustomHttpMediaDescriptor,
    type CustomHttpTransport,
} from '@postbot/custom-http'
import {
    createWorkflowStore,
    createProviderMediaDeliveryStore,
    type createPublisherCredentialStore,
    type createPublisherStore,
    type PostbotDatabase,
    type MediaAssetStore,
    type PublisherExecutionTarget,
} from '@postbot/db'

import { permanentFailure, retryableFailure } from './outcomes'
import { cancelMediaStream, verifyPinnedMediaContent } from './providers/media-integrity'
import type { BuiltInProviderRegistry } from './providers/registry'

const defaultLeaseDuration = 5 * 60_000
const defaultRetryPolicy = createExponentialRetryPolicy({
    maxAttempts: 3,
    initialDelay: 60_000,
    maximumDelay: 60 * 60_000,
})
const jobsPerProjectPerRound = 1

export interface PublicationWorkerRunObservation {
    readonly outcome: 'success' | 'failure'
    readonly durationSeconds: number
}

export interface PublicationWorkerOptions {
    readonly replies?: { getNextEventAt(): number | null; processDueEvents(): Promise<void> }
    readonly firstComments?: { getNextEventAt(): number | null; processDueEvents(): Promise<void> }
    readonly database: PostbotDatabase
    readonly publisherStore: ReturnType<typeof createPublisherStore>
    readonly publisherCredentialStore: ReturnType<typeof createPublisherCredentialStore>
    readonly media?: MediaAssetStore
    readonly customHttpTransport?: CustomHttpTransport
    readonly resolveCustomHttpMediaUrl?: (
        media: CustomHttpMediaDescriptor,
        context: { readonly projectId: string }
    ) => string | null | Promise<string | null>
    readonly resolveBuiltInMediaUrl?: (
        media: PublisherExecutionTarget['media'][number],
        context: { readonly projectId: string }
    ) => string | null | Promise<string | null>
    readonly builtInProviderRegistry: BuiltInProviderRegistry
    readonly now?: () => number
    readonly leaseDuration?: number
    readonly retryPolicy?: RetryPolicy
    readonly timers?: SchedulerTimers
    readonly createClaimToken?: () => string
    readonly providerMediaDeliveryStore?: ReturnType<typeof createProviderMediaDeliveryStore>
    readonly onError?: (error: unknown) => void
    readonly onRunCompleted?: (observation: PublicationWorkerRunObservation) => void
}

export interface PublicationWorker {
    readonly scheduler: NextEventScheduler
    processDueEvents(now: number): Promise<void>
    start(): void
    stop(): Promise<void>
    replan(): void
}

export function createPublicationWorker(options: PublicationWorkerOptions): PublicationWorker {
    const now = options.now ?? Date.now
    const workflowStore = createWorkflowStore(options.database)
    const publisherStore = options.publisherStore
    const providerMediaDeliveryStore =
        options.providerMediaDeliveryStore ??
        createProviderMediaDeliveryStore(options.database, { now })
    const customHttpTransport = options.customHttpTransport ?? createCustomHttpTransport()
    const leaseDuration = options.leaseDuration ?? defaultLeaseDuration
    const retryPolicy = options.retryPolicy ?? defaultRetryPolicy
    const createClaimToken = options.createClaimToken ?? (() => crypto.randomUUID())

    const processDueEvents = async (at: number) => {
        const startedAt = performance.now()
        let outcome: PublicationWorkerRunObservation['outcome'] = 'success'

        try {
            await processDueEventsWithoutObservation(at)
        } catch (error) {
            outcome = 'failure'
            throw error
        } finally {
            options.onRunCompleted?.({
                outcome,
                durationSeconds: (performance.now() - startedAt) / 1_000,
            })
        }
    }

    const processDueEventsWithoutObservation = async (at: number) => {
        const processingNow = () => Math.max(at, now())
        const projects = workflowStore
            .listProjectIds()
            .map(projectId => ({
                projectId,
                actorId: workflowStore.ensureSystemActor(projectId, processingNow()),
            }))
            .filter(
                (project): project is { projectId: string; actorId: string } =>
                    project.actorId !== null
            )

        await options.replies?.processDueEvents()
        await options.firstComments?.processDueEvents()
        while (true) {
            let processedAny = false

            for (const { actorId } of projects) {
                for (let jobCount = 0; jobCount < jobsPerProjectPerRound; jobCount += 1) {
                    const result = await processNextWorkflowEvent({
                        store: workflowStore,
                        actorId,
                        leaseDuration,
                        retryPolicy,
                        createClaimToken,
                        performExternalEffect: job =>
                            performExternalEffect({
                                job,
                                builtInProviderRegistry: options.builtInProviderRegistry,
                                providerMediaDeliveryStore,
                                publisherStore,
                                publisherCredentialStore: options.publisherCredentialStore,
                                media: options.media,
                                resolveBuiltInMediaUrl: options.resolveBuiltInMediaUrl,
                                customHttpTransport,
                                resolveCustomHttpMediaUrl: options.resolveCustomHttpMediaUrl,
                                now: processingNow(),
                            }),
                        now: processingNow,
                    })

                    if (result.jobId === null || result.outcome === 'claim_lost') break
                    processedAny = true
                }
            }

            if (!processedAny) break
        }
    }

    const scheduler = new NextEventScheduler({
        getNextEventAt: () => {
            const times = [
                workflowStore.getNextEventAt(),
                options.replies?.getNextEventAt() ?? null,
                options.firstComments?.getNextEventAt() ?? null,
            ].filter((at): at is number => at !== null)
            return times.length ? Math.min(...times) : null
        },
        processDueEvents,
        onError: options.onError ?? defaultWorkerErrorHandler,
        clock: { now },
        timers: options.timers,
    })

    return {
        scheduler,
        processDueEvents,
        start() {
            scheduler.start()
        },
        stop() {
            return scheduler.stop()
        },
        replan() {
            if (scheduler.state === 'started') scheduler.replan()
        },
    }
}

async function performExternalEffect(input: {
    readonly job: Job
    readonly builtInProviderRegistry: BuiltInProviderRegistry
    readonly providerMediaDeliveryStore: ReturnType<typeof createProviderMediaDeliveryStore>
    readonly publisherStore: ReturnType<typeof createPublisherStore>
    readonly publisherCredentialStore: ReturnType<typeof createPublisherCredentialStore>
    readonly media?: MediaAssetStore
    readonly resolveBuiltInMediaUrl?: (
        media: PublisherExecutionTarget['media'][number],
        context: { readonly projectId: string }
    ) => string | null | Promise<string | null>
    readonly customHttpTransport: CustomHttpTransport
    readonly resolveCustomHttpMediaUrl?: (
        media: CustomHttpMediaDescriptor,
        context: { readonly projectId: string }
    ) => string | null | Promise<string | null>
    readonly now: number
}): Promise<ExternalEffectOutcome> {
    const { job, builtInProviderRegistry, providerMediaDeliveryStore, publisherStore } = input
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

    const adapter = builtInProviderRegistry.resolve({
        providerId: target.providerId,
        kind: target.kind,
        execution: target.profile.execution,
    })
    if (adapter === null) {
        return permanentFailure(`No publisher adapter is registered for ${target.providerId}`)
    }

    return adapter.execute({
        target,
        now: input.now,
        credentials: input.publisherCredentialStore,
        media: input.media,
        resolveMediaUrl:
            input.resolveBuiltInMediaUrl === undefined
                ? undefined
                : (media, context) => input.resolveBuiltInMediaUrl!(media, context),
        providerMediaDeliveryStore,
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
                          opened.contentType !== media.contentType ||
                          opened.sha256 !== media.sha256
                      ) {
                          await cancelMediaStream(opened)
                          return null
                      }
                      return {
                          size: opened.size,
                          contentType: opened.contentType,
                          sha256: opened.sha256,
                          stream: opened.stream,
                      }
                  },
              }

    if (target.profile.execution.request?.body?.kind === 'multipart') {
        if (input.media === undefined && target.media.length > 0) {
            return permanentFailure('Media lifecycle service is required for custom HTTP media')
        }
        for (const media of target.media) {
            let verified: boolean
            try {
                verified = await verifyPinnedMediaContent(input.media!, target.projectId, media)
            } catch {
                return retryableFailure(
                    'The pinned custom HTTP media representation could not be read; retry is safe'
                )
            }
            if (!verified) {
                return permanentFailure(
                    'The pinned custom HTTP media representation is unavailable or changed'
                )
            }
        }
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

function defaultWorkerErrorHandler(error: unknown): void {
    console.error('[postbot-worker] scheduler failed', error)
}

export type { PublisherExecutionTarget }
