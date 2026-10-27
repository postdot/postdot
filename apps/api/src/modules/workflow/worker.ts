import {
    createExponentialRetryPolicy,
    NextEventScheduler,
    processNextWorkflowEvent,
    type ExternalEffectOutcome,
    type Job,
    type RetryPolicy,
    type SchedulerTimers,
} from '@postdot/core'
import {
    CUSTOM_HTTP_PUBLISHER_KIND,
    createCustomHttpTransport,
    type CustomHttpMediaDescriptor,
    type CustomHttpTransport,
} from '@postdot/custom-http'
import {
    createWorkflowStore,
    createProviderMediaDeliveryStore,
    type createPublisherCredentialStore,
    type createPublisherStore,
    type PostdotDatabase,
    type MediaAssetStore,
    type PublisherExecutionTarget,
} from '@postdot/db'

import { permanentFailure, retryableFailure } from './outcomes'
import { cancelMediaStream, verifyPinnedMediaContent } from './providers/media-integrity'
import type { BuiltInProviderRegistry } from './providers/registry'

const defaultLeaseDuration = 5 * 60_000
const defaultRetryPolicy = createExponentialRetryPolicy({
    maxAttempts: 3,
    initialDelay: 60_000,
    maximumDelay: 60 * 60_000,
})

export interface PublicationWorkerRunObservation {
    readonly outcome: 'success' | 'failure'
    readonly durationSeconds: number
}

export interface PublicationWorkerOptions {
    readonly replies?: {
        getNextEventAt(): number | null
        processDueEvent(projectId: string): Promise<boolean>
    }
    readonly firstComments?: {
        getNextEventAt(): number | null
        processDueEvent(projectId: string): Promise<boolean>
    }
    readonly database: PostdotDatabase
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
    readonly effectTimeoutMs?: number
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
    const workflowStore = createWorkflowStore(options.database, {
        publicMediaUrlAvailable:
            options.resolveBuiltInMediaUrl !== undefined ||
            options.resolveCustomHttpMediaUrl !== undefined,
    })
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

    let stopping = false
    let activeBatch: Promise<void> | null = null
    let wake: (() => void) | undefined
    let refreshAdmission: (() => void) | undefined
    let lastProject: string | undefined
    const lastFamily = new Map<string, string>()
    const processDueEventsWithoutObservation = (at: number): Promise<void> => {
        if (activeBatch) return activeBatch
        if (stopping) return Promise.resolve()
        const run = async () => {
            const processingNow = () => Math.max(at, now())
            const active = new Map<string, Promise<void>>()
            const idleCandidates = new Set<string>()
            refreshAdmission = () => {
                idleCandidates.clear()
                wake?.()
            }
            let failure: unknown
            let failed = false
            try {
                while (!stopping && !failed) {
                    const projects = workflowStore.listProjectIds()
                    for (const projectId of lastFamily.keys()) {
                        if (!projects.includes(projectId)) lastFamily.delete(projectId)
                    }
                    const previous = lastProject === undefined ? -1 : projects.indexOf(lastProject)
                    const orderedProjects = [
                        ...projects.slice(previous + 1),
                        ...projects.slice(0, previous + 1),
                    ]
                    const ordered = orderedProjects.flatMap(projectId => {
                        const families = [
                            'publication',
                            ...(options.replies ? ['reply'] : []),
                            ...(options.firstComments ? ['first-comment'] : []),
                        ]
                        const previousFamily = families.indexOf(lastFamily.get(projectId) ?? '')
                        return [
                            ...families.slice(previousFamily + 1),
                            ...families.slice(0, previousFamily + 1),
                        ].map(kind => ({ projectId, kind }))
                    })
                    for (const candidate of ordered) {
                        if (active.size >= 2 || stopping || failed) break
                        const key = `${candidate.projectId}:${candidate.kind}`
                        if (active.has(candidate.projectId) || idleCandidates.has(key)) continue
                        lastProject = candidate.projectId
                        lastFamily.set(candidate.projectId, candidate.kind)
                        let processed = false
                        const task = (async () => {
                            if (candidate.kind === 'reply') {
                                processed = await options.replies!.processDueEvent(
                                    candidate.projectId
                                )
                                return
                            }
                            if (candidate.kind === 'first-comment') {
                                processed = await options.firstComments!.processDueEvent(
                                    candidate.projectId
                                )
                                return
                            }
                            const actorId = workflowStore.ensureSystemActor(
                                candidate.projectId,
                                processingNow()
                            )
                            if (!actorId) return
                            const result = await processNextWorkflowEvent({
                                store: workflowStore,
                                actorId,
                                leaseDuration,
                                activeEffectPolicy: {
                                    renewalIntervalMs: Math.max(
                                        1,
                                        Math.min(30_000, Math.floor(leaseDuration / 3))
                                    ),
                                    timeoutMs: options.effectTimeoutMs ?? 15 * 60_000,
                                },
                                retryPolicy,
                                createClaimToken,
                                performExternalEffect: (job, context) =>
                                    performExternalEffect({
                                        job,
                                        signal: context.signal,
                                        assertActive: context.assertActive,
                                        builtInProviderRegistry: options.builtInProviderRegistry,
                                        providerMediaDeliveryStore,
                                        publisherStore,
                                        publisherCredentialStore: options.publisherCredentialStore,
                                        media: options.media,
                                        resolveBuiltInMediaUrl: options.resolveBuiltInMediaUrl,
                                        customHttpTransport,
                                        resolveCustomHttpMediaUrl:
                                            options.resolveCustomHttpMediaUrl,
                                        now: processingNow(),
                                    }),
                                now: processingNow,
                            })
                            processed = result.jobId !== null
                        })()
                            .catch(error => {
                                failed = true
                                failure = error
                            })
                            .finally(() => {
                                if (processed) {
                                    idleCandidates.clear()
                                } else idleCandidates.add(key)
                                active.delete(candidate.projectId)
                                wake?.()
                            })
                        active.set(candidate.projectId, task)
                    }
                    if (failed || stopping) break
                    if (active.size === 0) break
                    await new Promise<void>(resolve => {
                        const timer = setTimeout(() => {
                            idleCandidates.clear()
                            resolve()
                        }, 1_000)
                        wake = () => {
                            clearTimeout(timer)
                            resolve()
                        }
                    })
                    wake = undefined
                    // Empty claims and immediate local failures must not starve lease timers,
                    // incoming requests or stop signals through an endless microtask chain.
                    await new Promise<void>(resolve => setTimeout(resolve, 0))
                }
            } finally {
                refreshAdmission = undefined
                await Promise.all(active.values())
            }
            if (failed) throw failure
        }
        activeBatch = run().finally(() => {
            activeBatch = null
        })
        return activeBatch
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
        async stop() {
            stopping = true
            wake?.()
            await scheduler.stop()
            await activeBatch
        },
        replan() {
            if (activeBatch) refreshAdmission?.()
            if (scheduler.state === 'started') scheduler.replan()
        },
    }
}

async function performExternalEffect(input: {
    readonly job: Job
    readonly signal: AbortSignal
    readonly assertActive: () => void
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

    input.assertActive()
    return adapter.execute({
        signal: input.signal,
        assertActive: input.assertActive,
        target,
        now: input.now,
        credentials: {
            withPublisherCredentialRefresh: (projectId, credentialId, operation, signal) =>
                input.publisherCredentialStore.withPublisherCredentialRefresh(
                    projectId,
                    credentialId,
                    context => {
                        input.assertActive()
                        return operation(
                            context === null
                                ? null
                                : {
                                      ...context,
                                      replaceTokens: value => {
                                          input.assertActive()
                                          return context.replaceTokens(value)
                                      },
                                      markReconnectRequired: () => {
                                          input.assertActive()
                                          context.markReconnectRequired()
                                      },
                                  }
                        )
                    },
                    signal
                ),
            getPublisherCredential: (projectId, credentialId) => {
                input.assertActive()
                return input.publisherCredentialStore.getPublisherCredential(
                    projectId,
                    credentialId
                )
            },
            resolvePublisherCredentialSecrets: (projectId, credentialId) => {
                input.assertActive()
                return input.publisherCredentialStore.resolvePublisherCredentialSecrets(
                    projectId,
                    credentialId
                )
            },
            replacePublisherCredentialTokens: value => {
                input.assertActive()
                return input.publisherCredentialStore.replacePublisherCredentialTokens(value)
            },
            markPublisherCredentialReconnectRequired: (projectId, credentialId) => {
                input.assertActive()
                input.publisherCredentialStore.markPublisherCredentialReconnectRequired(
                    projectId,
                    credentialId
                )
            },
        },
        media: input.media,
        resolveMediaUrl:
            input.resolveBuiltInMediaUrl === undefined
                ? undefined
                : (media, context) => input.resolveBuiltInMediaUrl!(media, context),
        providerMediaDeliveryStore: {
            reserve: value => {
                input.assertActive()
                return providerMediaDeliveryStore.reserve(value)
            },
            start: value => {
                input.assertActive()
                return providerMediaDeliveryStore.start(value)
            },
            recordRemoteMediaId: value => {
                input.assertActive()
                return providerMediaDeliveryStore.recordRemoteMediaId(value)
            },
            complete: value => {
                input.assertActive()
                return providerMediaDeliveryStore.complete(value)
            },
            fail: value => {
                input.assertActive()
                return providerMediaDeliveryStore.fail(value)
            },
            retry: value => {
                input.assertActive()
                return providerMediaDeliveryStore.retry(value)
            },
        },
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

    input.assertActive()
    return input.customHttpTransport.deliver({
        signal: input.signal,
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
    console.error('[postdot-worker] scheduler failed', error)
}

export type { PublisherExecutionTarget }
