import {
    createExponentialRetryPolicy,
    NextEventScheduler,
    processNextWorkflowEvent,
    type ExternalEffectOutcome,
    type Job,
    type RetryPolicy,
} from '@herald/core'
import {
    createWorkflowStore,
    type createPublisherCredentialStore,
    type createPublisherStore,
    type HeraldDatabase,
    type PublisherExecutionTarget,
} from '@herald/db'
import {
    createLinkedInTextPublisher,
    LINKEDIN_PROVIDER,
    readLinkedInTextContent,
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
                            publisherStore,
                            publisherCredentialStore: options.publisherCredentialStore,
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
    readonly publisherStore: ReturnType<typeof createPublisherStore>
    readonly publisherCredentialStore: ReturnType<typeof createPublisherCredentialStore>
    readonly linkedinOAuth:
        | {
              readonly authorizationServer: OAuthAuthorizationServer
              readonly clientId: string
              readonly clientAuthentication: OAuthClientAuthentication
          }
        | undefined
    readonly now: number
}): Promise<ExternalEffectOutcome> {
    const { job, linkedInPublisher, publisherStore, publisherCredentialStore } = input
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

    const commentary = readLinkedInTextContent(target.content)
    if (commentary === null) {
        return permanentFailure('The execution revision does not contain LinkedIn commentary')
    }

    const outcome = await linkedInPublisher.publishText({
        accessToken,
        memberId: target.externalAccountId,
        commentary,
    })
    if (
        outcome.type === 'permanent_failure' &&
        (outcome.code === 'authentication_required' || outcome.code === 'forbidden')
    ) {
        publisherCredentialStore.markPublisherCredentialReconnectRequired(
            target.projectId,
            target.credentialId
        )
    }
    return outcome
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
