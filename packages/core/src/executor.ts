import { DomainInvariantError, requireNonBlank, requireTimestamp } from './invariants'
import type { Job } from './model'

export type ExternalEffectOutcome =
    | {
          readonly type: 'published'
          readonly externalId?: string
          readonly externalUrl?: string
      }
    | {
          readonly type: 'retryable_failure'
          readonly effectOccurred: false
          readonly errorMessage: string
      }
    | {
          readonly type: 'permanent_failure'
          readonly effectOccurred: false
          readonly errorMessage: string
      }
    | {
          readonly type: 'ambiguous'
          readonly errorMessage: string
      }

export type PersistedEffectOutcome = 'published' | 'retry_scheduled' | 'failed' | 'ambiguous'

export interface ExpiredClaimRecovery {
    readonly requeuedJobIds: readonly string[]
    readonly ambiguousJobIds: readonly string[]
}

export interface CompleteExternalEffectInput {
    readonly jobId: string
    readonly claimToken: string
    readonly completedAt: number
    readonly outcome: ExternalEffectOutcome
    readonly retryAt?: number | null
}

export interface WorkflowExecutorStore {
    recoverExpiredClaims(now: number): ExpiredClaimRecovery
    claimNextDueJob(input: {
        readonly actorId: string
        readonly claimToken: string
        readonly now: number
        readonly leaseExpiresAt: number
    }): Job | null
    startExternalEffect(jobId: string, claimToken: string, now: number): boolean
    completeExternalEffect(input: CompleteExternalEffectInput): PersistedEffectOutcome | null
}

export interface RetryPolicyInput {
    readonly attempts: number
    readonly failedAt: number
}

export interface RetryPolicy {
    nextRunAt(input: RetryPolicyInput): number | null
}

export interface ProcessWorkflowEventOptions {
    readonly store: WorkflowExecutorStore
    readonly actorId: string
    readonly leaseDuration: number
    readonly retryPolicy: RetryPolicy
    readonly createClaimToken: () => string
    readonly performExternalEffect: (
        job: Job
    ) => ExternalEffectOutcome | Promise<ExternalEffectOutcome>
    readonly now?: () => number
}

export interface ProcessWorkflowEventResult {
    readonly recovery: ExpiredClaimRecovery
    readonly jobId: string | null
    readonly outcome: PersistedEffectOutcome | 'idle' | 'claim_lost'
}

export interface ExponentialRetryPolicyOptions {
    readonly maxAttempts: number
    readonly initialDelay: number
    readonly maximumDelay: number
}

export function createExponentialRetryPolicy(options: ExponentialRetryPolicyOptions): RetryPolicy {
    requirePositiveSafeInteger(options.maxAttempts, 'maxAttempts')
    requirePositiveSafeInteger(options.initialDelay, 'initialDelay')
    requirePositiveSafeInteger(options.maximumDelay, 'maximumDelay')

    if (options.maximumDelay < options.initialDelay) {
        throw new DomainInvariantError(
            'invalid_time',
            'maximumDelay must not be shorter than initialDelay'
        )
    }

    return {
        nextRunAt(input) {
            const failedAt = requireTimestamp(input.failedAt, 'failedAt')
            requirePositiveSafeInteger(input.attempts, 'attempts')

            if (input.attempts >= options.maxAttempts) return null

            const multiplier = 2 ** Math.min(input.attempts - 1, 52)
            const delay = Math.min(options.initialDelay * multiplier, options.maximumDelay)
            return requireTimestamp(failedAt + delay, 'nextRunAt')
        },
    }
}

export async function processNextWorkflowEvent(
    options: ProcessWorkflowEventOptions
): Promise<ProcessWorkflowEventResult> {
    const now = options.now ?? Date.now
    const claimedAt = requireTimestamp(now(), 'now')
    const leaseDuration = requirePositiveSafeInteger(options.leaseDuration, 'leaseDuration')
    const leaseExpiresAt = requireTimestamp(claimedAt + leaseDuration, 'leaseExpiresAt')
    const recovery = options.store.recoverExpiredClaims(claimedAt)
    const claimToken = requireNonBlank(options.createClaimToken(), 'claimToken')
    const job = options.store.claimNextDueJob({
        actorId: requireNonBlank(options.actorId, 'actorId'),
        claimToken,
        now: claimedAt,
        leaseExpiresAt,
    })

    if (job === null) return { recovery, jobId: null, outcome: 'idle' }

    const effectStartedAt = requireTimestamp(now(), 'now')
    if (!options.store.startExternalEffect(job.id, claimToken, effectStartedAt)) {
        return { recovery, jobId: job.id, outcome: 'claim_lost' }
    }

    let outcome: ExternalEffectOutcome
    try {
        outcome = await options.performExternalEffect(job)
    } catch (error) {
        outcome = {
            type: 'ambiguous',
            errorMessage: describeUnknownExternalOutcome(error),
        }
    }

    const completedAt = requireTimestamp(now(), 'now')
    const retryAt =
        outcome.type === 'retryable_failure'
            ? options.retryPolicy.nextRunAt({ attempts: job.attempts, failedAt: completedAt })
            : null

    if (retryAt !== null && retryAt < completedAt) {
        throw new DomainInvariantError('invalid_time', 'A retry cannot predate its failure')
    }

    const persisted = options.store.completeExternalEffect({
        jobId: job.id,
        claimToken,
        completedAt,
        outcome,
        retryAt,
    })

    return {
        recovery,
        jobId: job.id,
        outcome: persisted ?? 'claim_lost',
    }
}

function requirePositiveSafeInteger(value: number, field: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new DomainInvariantError('invalid_time', `${field} must be a positive safe integer`)
    }
    return value
}

function describeUnknownExternalOutcome(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return `External effect threw after its durable boundary: ${error.message.trim()}`
    }
    return 'External effect threw after its durable boundary with an unknown outcome'
}
