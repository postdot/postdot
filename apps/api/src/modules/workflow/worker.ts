import type { HeraldAuth } from '@herald/auth'
import {
    createExponentialRetryPolicy,
    NextEventScheduler,
    processNextWorkflowEvent,
    type ExternalEffectOutcome,
    type Job,
    type RetryPolicy,
} from '@herald/core'
import {
    createPublisherStore,
    createWorkflowStore,
    type HeraldDatabase,
    type PublisherExecutionTarget,
} from '@herald/db'
import {
    createLinkedInTextPublisher,
    LINKEDIN_PROVIDER,
    type LinkedInTextPublisher,
} from '@herald/linkedin'

const defaultLeaseDuration = 5 * 60_000
const defaultRetryPolicy = createExponentialRetryPolicy({
    maxAttempts: 3,
    initialDelay: 60_000,
    maximumDelay: 60 * 60_000,
})

export interface PublicationWorkerOptions {
    readonly auth: HeraldAuth
    readonly database: HeraldDatabase
    readonly now?: () => number
    readonly leaseDuration?: number
    readonly retryPolicy?: RetryPolicy
    readonly createClaimToken?: () => string
    readonly linkedInPublisher?: LinkedInTextPublisher
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
    const publisherStore = createPublisherStore(options.database)
    const linkedInPublisher = options.linkedInPublisher ?? createLinkedInTextPublisher()
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
                            auth: options.auth,
                            job,
                            linkedInPublisher,
                            publisherStore,
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
    readonly auth: HeraldAuth
    readonly job: Job
    readonly linkedInPublisher: LinkedInTextPublisher
    readonly publisherStore: ReturnType<typeof createPublisherStore>
}): Promise<ExternalEffectOutcome> {
    const { auth, job, linkedInPublisher, publisherStore } = input
    if (job.claimToken === null) {
        return permanentFailure('The claimed publication has no execution fence')
    }

    const target = publisherStore.getPublisherExecutionTarget(job.id, job.claimToken)
    if (target === null) {
        return permanentFailure('The publisher execution context is unavailable')
    }

    if (target.providerId !== LINKEDIN_PROVIDER || target.kind !== LINKEDIN_PROVIDER) {
        return permanentFailure(`No publisher adapter is registered for ${target.providerId}`)
    }

    let accessToken: string
    try {
        const credentials = await auth.api.getAccessToken({
            body: {
                accountId: target.accountId,
                userId: target.accountUserId,
            },
        })
        accessToken = credentials.accessToken
    } catch {
        return permanentFailure('The publisher account access token is unavailable')
    }

    if (accessToken.trim().length === 0) {
        return permanentFailure('The publisher account access token is unavailable')
    }

    return linkedInPublisher.publishText({
        accessToken,
        memberId: target.externalAccountId,
        commentary: target.content,
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

function defaultWorkerErrorHandler(error: unknown): void {
    console.error('[herald-worker] scheduler failed', error)
}

export type { PublisherExecutionTarget }
