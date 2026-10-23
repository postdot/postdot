import { DomainInvariantError, requireNonBlank, requireTimestamp } from './invariants'
import type { Job } from './model'
import type { SchedulerTimers } from './scheduler'

export type ExternalEffectOutcome =
    | {
          readonly type: 'published'
          readonly externalId?: string
          readonly externalUrl?: string
      }
    | {
          readonly type: 'deferred'
          readonly effectOccurred: false
          readonly errorMessage: string
          readonly resumeAfterMs: number
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

export interface ExternalEffectWork {
    readonly id: string
    readonly attempts: number
}

export interface ExternalEffectExecutorStore<Work extends ExternalEffectWork> {
    recoverExpiredClaims(now: number): ExpiredClaimRecovery
    claimNextDueJob(input: {
        readonly actorId: string
        readonly claimToken: string
        readonly now: number
        readonly leaseExpiresAt: number
        readonly projectId?: string
    }): Work | null
    renewClaim?(input: {
        readonly jobId: string
        readonly claimToken: string
        readonly now: number
        readonly leaseExpiresAt: number
    }): boolean
    startExternalEffect(jobId: string, claimToken: string, now: number): boolean
    completeExternalEffect(input: CompleteExternalEffectInput): PersistedEffectOutcome | null
}

export type WorkflowExecutorStore = ExternalEffectExecutorStore<Job>

export interface RetryPolicyInput {
    readonly attempts: number
    readonly failedAt: number
}

export interface RetryPolicy {
    nextRunAt(input: RetryPolicyInput): number | null
}

export interface EffectExecutionContext {
    readonly signal: AbortSignal
    assertActive(): void
}

export interface ActiveEffectPolicy {
    readonly renewalIntervalMs: number
    readonly timeoutMs: number
    readonly timers?: SchedulerTimers
}

export interface ProcessWorkflowEventOptions {
    readonly store: WorkflowExecutorStore
    readonly actorId: string
    readonly leaseDuration: number
    readonly retryPolicy: RetryPolicy
    readonly createClaimToken: () => string
    readonly activeEffectPolicy?: ActiveEffectPolicy
    readonly performExternalEffect: (
        job: Job,
        context: EffectExecutionContext
    ) => ExternalEffectOutcome | Promise<ExternalEffectOutcome>
    readonly now?: () => number
}

export interface ProcessExternalEffectOptions<Work extends ExternalEffectWork> {
    readonly store: ExternalEffectExecutorStore<Work>
    readonly actorId: string
    readonly leaseDuration: number
    readonly retryPolicy: RetryPolicy
    readonly createClaimToken: () => string
    readonly activeEffectPolicy?: ActiveEffectPolicy
    readonly projectId?: string
    readonly performExternalEffect: (
        work: Work,
        context: EffectExecutionContext
    ) => ExternalEffectOutcome | Promise<ExternalEffectOutcome>
    readonly now?: () => number
}

export interface ProcessWorkflowEventResult {
    readonly recovery: ExpiredClaimRecovery
    readonly jobId: string | null
    readonly outcome: PersistedEffectOutcome | 'idle' | 'claim_lost'
}

export interface ProcessExternalEffectResult {
    readonly recovery: ExpiredClaimRecovery
    readonly workId: string | null
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
    const result = await processNextExternalEffect(options)
    return {
        recovery: result.recovery,
        jobId: result.workId,
        outcome: result.outcome,
    }
}

export async function processNextExternalEffect<Work extends ExternalEffectWork>(
    options: ProcessExternalEffectOptions<Work>
): Promise<ProcessExternalEffectResult> {
    const now = options.now ?? Date.now
    const claimedAt = requireTimestamp(now(), 'now')
    const leaseDuration = requirePositiveSafeInteger(options.leaseDuration, 'leaseDuration')
    const leaseExpiresAt = requireTimestamp(claimedAt + leaseDuration, 'leaseExpiresAt')
    const policy = options.activeEffectPolicy
    if (policy) {
        requirePositiveSafeInteger(policy.timeoutMs, 'timeoutMs')
        requirePositiveSafeInteger(policy.renewalIntervalMs, 'renewalIntervalMs')
        if (policy.renewalIntervalMs >= leaseDuration || !options.store.renewClaim) {
            throw new DomainInvariantError(
                'invalid_time',
                'Active effects require renewal before lease expiry'
            )
        }
    }
    const recovery = options.store.recoverExpiredClaims(claimedAt)
    const claimToken = requireNonBlank(options.createClaimToken(), 'claimToken')
    const work = options.store.claimNextDueJob({
        actorId: requireNonBlank(options.actorId, 'actorId'),
        claimToken,
        now: claimedAt,
        leaseExpiresAt,
        projectId: options.projectId,
    })

    if (work === null) return { recovery, workId: null, outcome: 'idle' }

    const effectStartedAt = requireTimestamp(now(), 'now')
    if (!options.store.startExternalEffect(work.id, claimToken, effectStartedAt)) {
        return { recovery, workId: work.id, outcome: 'claim_lost' }
    }

    const controller = new AbortController()
    const timers: SchedulerTimers = policy?.timers ?? {
        set: (callback, delay) => setTimeout(() => void callback(), delay),
        clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    }
    let renewalTimer: unknown
    let deadlineTimer: unknown
    let claimLost = false
    const renew = () => {
        if (!policy) return true
        const at = requireTimestamp(now(), 'now')
        try {
            if (
                options.store.renewClaim!({
                    jobId: work.id,
                    claimToken,
                    now: at,
                    leaseExpiresAt: at + leaseDuration,
                })
            )
                return true
        } catch {
            // Persistence failure cannot establish continued ownership.
        }
        claimLost = true
        controller.abort()
        return false
    }
    const heartbeat = () => {
        if (renew()) renewalTimer = timers.set(heartbeat, policy!.renewalIntervalMs)
    }
    if (policy) {
        renewalTimer = timers.set(heartbeat, policy.renewalIntervalMs)
        deadlineTimer = timers.set(() => controller.abort(), policy.timeoutMs)
    }

    let outcome: ExternalEffectOutcome
    try {
        // Never race away from an unsettled effect: its slot and shutdown drain remain owned.
        outcome = await options.performExternalEffect(work, {
            signal: controller.signal,
            assertActive() {
                controller.signal.throwIfAborted()
                if (policy && now() - effectStartedAt >= policy.timeoutMs) controller.abort()
                if (!renew()) controller.abort()
                controller.signal.throwIfAborted()
            },
        })
    } catch (error) {
        outcome = {
            type: 'ambiguous',
            errorMessage: describeUnknownExternalOutcome(error),
        }
    } finally {
        if (renewalTimer !== undefined) timers.clear(renewalTimer)
        if (deadlineTimer !== undefined) timers.clear(deadlineTimer)
    }

    const completedAt = requireTimestamp(now(), 'now')
    if (policy && (claimLost || !renew())) {
        options.store.recoverExpiredClaims(completedAt)
        return { recovery, workId: work.id, outcome: 'claim_lost' }
    }
    if (
        policy &&
        (controller.signal.aborted || completedAt - effectStartedAt >= policy.timeoutMs)
    ) {
        outcome = {
            type: 'ambiguous',
            errorMessage:
                'The external effect exceeded its execution deadline; its remote outcome requires review',
        }
    }
    const retryAt =
        outcome.type === 'deferred'
            ? requireTimestamp(
                  completedAt + requirePositiveSafeInteger(outcome.resumeAfterMs, 'resumeAfterMs'),
                  'resumeAt'
              )
            : outcome.type === 'retryable_failure'
              ? options.retryPolicy.nextRunAt({ attempts: work.attempts, failedAt: completedAt })
              : null

    if (retryAt !== null && retryAt < completedAt) {
        throw new DomainInvariantError('invalid_time', 'A retry cannot predate its failure')
    }

    const persisted = options.store.completeExternalEffect({
        jobId: work.id,
        claimToken,
        completedAt,
        outcome,
        retryAt,
    })

    return {
        recovery,
        workId: work.id,
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
