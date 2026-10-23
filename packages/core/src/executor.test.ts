import { describe, expect, test } from 'bun:test'

import {
    createExponentialRetryPolicy,
    processNextExternalEffect,
    processNextWorkflowEvent,
    type CompleteExternalEffectInput,
    type ExternalEffectOutcome,
    type ExternalEffectExecutorStore,
    type ExternalEffectWork,
    type Job,
    type PersistedEffectOutcome,
    type WorkflowExecutorStore,
} from './index'

const time = 1_800_000_000_000

function runningJob(attempts = 1): Job {
    return {
        id: 'job-one',
        projectId: 'project-one',
        publicationId: 'publication-one',
        state: 'running',
        runAt: time,
        attempts,
        claimToken: 'claim-one',
        claimedByActorId: 'system-one',
        claimedAt: time,
        leaseExpiresAt: time + 60_000,
        effectStartedAt: null,
        startedAt: time,
        completedAt: null,
        errorMessage: null,
        createdAt: time,
        updatedAt: time,
    }
}

class FakeExecutorStore implements WorkflowExecutorStore {
    job: Job | null = runningJob()
    startSucceeds = true
    completedInput: CompleteExternalEffectInput | null = null

    recoverExpiredClaims() {
        return { requeuedJobIds: [], ambiguousJobIds: [] }
    }

    claimNextDueJob(): Job | null {
        return this.job
    }

    startExternalEffect(): boolean {
        return this.startSucceeds
    }

    completeExternalEffect(input: CompleteExternalEffectInput): PersistedEffectOutcome {
        this.completedInput = input
        if (input.outcome.type === 'published') return 'published'
        if (input.outcome.type === 'ambiguous') return 'ambiguous'
        if (
            (input.outcome.type === 'retryable_failure' || input.outcome.type === 'deferred') &&
            input.retryAt !== null
        ) {
            return 'retry_scheduled'
        }
        return 'failed'
    }
}

interface TestDelivery extends ExternalEffectWork {
    readonly transportId: string
}

class FakeDeliveryStore implements ExternalEffectExecutorStore<TestDelivery> {
    work: TestDelivery | null = {
        id: 'delivery-one',
        attempts: 1,
        transportId: 'test',
    }
    completedInput: CompleteExternalEffectInput | null = null

    recoverExpiredClaims() {
        return { requeuedJobIds: [], ambiguousJobIds: [] }
    }

    claimNextDueJob(): TestDelivery | null {
        return this.work
    }

    startExternalEffect(): boolean {
        return true
    }

    completeExternalEffect(input: CompleteExternalEffectInput): PersistedEffectOutcome {
        this.completedInput = input
        return 'published'
    }
}

const noRetry = createExponentialRetryPolicy({
    maxAttempts: 1,
    initialDelay: 1_000,
    maximumDelay: 60_000,
})

async function executeWith(outcome: ExternalEffectOutcome, store = new FakeExecutorStore()) {
    const result = await processNextWorkflowEvent({
        store,
        actorId: 'system-one',
        leaseDuration: 60_000,
        retryPolicy: noRetry,
        createClaimToken: () => 'claim-one',
        performExternalEffect: () => outcome,
        now: () => time,
    })

    return { result, store }
}

describe('retry policy', () => {
    test('bounds exponential delays and stops at the configured attempt limit', () => {
        const policy = createExponentialRetryPolicy({
            maxAttempts: 4,
            initialDelay: 1_000,
            maximumDelay: 2_500,
        })

        expect(policy.nextRunAt({ attempts: 1, failedAt: time })).toBe(time + 1_000)
        expect(policy.nextRunAt({ attempts: 2, failedAt: time })).toBe(time + 2_000)
        expect(policy.nextRunAt({ attempts: 3, failedAt: time })).toBe(time + 2_500)
        expect(policy.nextRunAt({ attempts: 4, failedAt: time })).toBeNull()
    })
})

describe('workflow executor', () => {
    test('schedules processing deferrals after a slow effect completes, independent of retry limits', async () => {
        const store = new FakeExecutorStore()
        let current = time
        const result = await processNextWorkflowEvent({
            store,
            actorId: 'system-one',
            leaseDuration: 300_000,
            retryPolicy: noRetry,
            createClaimToken: () => 'claim-one',
            performExternalEffect: () => {
                current += 120_000
                return {
                    type: 'deferred',
                    effectOccurred: false,
                    errorMessage: 'Processing',
                    resumeAfterMs: 60_000,
                }
            },
            now: () => current,
        })
        expect(result.outcome).toBe('retry_scheduled')
        expect(store.completedInput?.completedAt).toBe(time + 120_000)
        expect(store.completedInput?.retryAt).toBe(time + 180_000)
    })

    test('executes a non-publication work item through the generic boundary', async () => {
        const store = new FakeDeliveryStore()
        const received: { current: TestDelivery | null } = { current: null }

        const result = await processNextExternalEffect({
            store,
            actorId: 'system-one',
            leaseDuration: 60_000,
            retryPolicy: noRetry,
            createClaimToken: () => 'claim-one',
            performExternalEffect: work => {
                received.current = work
                return { type: 'published', externalId: 'message-one' }
            },
            now: () => time,
        })

        expect(result.workId).toBe('delivery-one')
        expect(received.current?.id).toBe('delivery-one')
        expect(received.current?.transportId).toBe('test')
        expect(store.completedInput?.outcome).toEqual({
            type: 'published',
            externalId: 'message-one',
        })
    })

    test('persists a confirmed publication result', async () => {
        const { result, store } = await executeWith({
            type: 'published',
            externalId: 'remote-one',
        })

        expect(result.outcome).toBe('published')
        expect(store.completedInput?.outcome.type).toBe('published')
    })

    test('schedules only failures that explicitly assert no external effect', async () => {
        const store = new FakeExecutorStore()
        const retryPolicy = createExponentialRetryPolicy({
            maxAttempts: 3,
            initialDelay: 5_000,
            maximumDelay: 5_000,
        })
        const result = await processNextWorkflowEvent({
            store,
            actorId: 'system-one',
            leaseDuration: 60_000,
            retryPolicy,
            createClaimToken: () => 'claim-one',
            performExternalEffect: () => ({
                type: 'retryable_failure',
                effectOccurred: false,
                errorMessage: 'Provider is unavailable before request acceptance',
            }),
            now: () => time,
        })

        expect(result.outcome).toBe('retry_scheduled')
        expect(store.completedInput?.retryAt).toBe(time + 5_000)
    })

    test('persists a known permanent rejection without retrying it', async () => {
        const { result, store } = await executeWith({
            type: 'permanent_failure',
            effectOccurred: false,
            errorMessage: 'Provider rejected invalid credentials',
        })

        expect(result.outcome).toBe('failed')
        expect(store.completedInput?.retryAt).toBeNull()
    })

    test('converts an exception after the boundary into an ambiguous outcome', async () => {
        const store = new FakeExecutorStore()
        const result = await processNextWorkflowEvent({
            store,
            actorId: 'system-one',
            leaseDuration: 60_000,
            retryPolicy: noRetry,
            createClaimToken: () => 'claim-one',
            performExternalEffect: () => {
                throw new Error('connection closed before the response')
            },
            now: () => time,
        })

        expect(result.outcome).toBe('ambiguous')
        expect(store.completedInput?.outcome).toEqual({
            type: 'ambiguous',
            errorMessage:
                'External effect threw after its durable boundary: connection closed before the response',
        })
    })

    test('does not call the external effect after losing the claim boundary', async () => {
        const store = new FakeExecutorStore()
        store.startSucceeds = false
        let calls = 0

        const result = await processNextWorkflowEvent({
            store,
            actorId: 'system-one',
            leaseDuration: 60_000,
            retryPolicy: noRetry,
            createClaimToken: () => 'claim-one',
            performExternalEffect: () => {
                calls += 1
                return { type: 'published' }
            },
            now: () => time,
        })

        expect(result.outcome).toBe('claim_lost')
        expect(calls).toBe(0)
        expect(store.completedInput).toBeNull()
    })
})

describe('active external effects', () => {
    function fixture() {
        let clock = time
        let expiry = time + 90
        let owned = true
        let renewals = 0
        const scheduled = new Map<number, { at: number; callback: () => void | Promise<void> }>()
        let sequence = 0
        const store = new FakeExecutorStore()
        const renewableStore: WorkflowExecutorStore = {
            recoverExpiredClaims: () => store.recoverExpiredClaims(),
            claimNextDueJob: () => store.claimNextDueJob(),
            startExternalEffect: () => store.startExternalEffect(),
            completeExternalEffect: input => store.completeExternalEffect(input),
            renewClaim(input) {
                if (!owned || input.claimToken !== 'claim-one' || input.now >= expiry) return false
                expiry = input.leaseExpiresAt
                renewals++
                return true
            },
        }
        let release!: (outcome: ExternalEffectOutcome) => void
        const effect = new Promise<ExternalEffectOutcome>(resolve => {
            release = resolve
        })
        let signal: AbortSignal | undefined
        const run = () =>
            processNextWorkflowEvent({
                store: renewableStore,
                actorId: 'system-one',
                createClaimToken: () => 'claim-one',
                leaseDuration: 90,
                retryPolicy: { nextRunAt: () => null },
                now: () => clock,
                activeEffectPolicy: {
                    timeoutMs: 250,
                    renewalIntervalMs: 30,
                    timers: {
                        set(callback, delay) {
                            const id = ++sequence
                            scheduled.set(id, { at: clock + delay, callback })
                            return id
                        },
                        clear(handle) {
                            if (typeof handle === 'number') scheduled.delete(handle)
                        },
                    },
                },
                performExternalEffect(_work, context) {
                    signal = context.signal
                    return effect
                },
            })
        const advance = (elapsed: number) => {
            const until = clock + elapsed
            while (true) {
                const next = [...scheduled].sort((a, b) => a[1].at - b[1].at)[0]
                if (!next || next[1].at > until) break
                clock = next[1].at
                scheduled.delete(next[0])
                void next[1].callback()
            }
            clock = until
        }
        return {
            store,
            run,
            advance,
            release,
            signal: () => signal,
            renewals: () => renewals,
            revoke: () => {
                owned = false
            },
            timers: scheduled,
        }
    }

    test('renews a slow effect beyond its initial lease and clears all timers after completion', async () => {
        const f = fixture()
        const run = f.run()
        f.advance(180)
        expect(f.renewals()).toBe(6)
        expect(f.signal()?.aborted).toBe(false)
        f.release({ type: 'published', externalId: 'confirmed' })
        expect((await run).outcome).toBe('published')
        expect(f.timers.size).toBe(0)
    })

    test('requests cancellation at the deadline but drains the actual effect before releasing ownership', async () => {
        const f = fixture()
        let settled = false
        const run = f.run().finally(() => {
            settled = true
        })
        f.advance(300)
        await Promise.resolve()
        expect(f.signal()?.aborted).toBe(true)
        expect(settled).toBe(false)
        expect(f.store.completedInput).toBeNull()
        expect(f.renewals()).toBe(10)
        f.release({ type: 'published', externalId: 'late' })
        expect((await run).outcome).toBe('ambiguous')
        expect(f.timers.size).toBe(0)
    })

    test('aborts on lost ownership and never submits a stale completion', async () => {
        const f = fixture()
        const run = f.run()
        f.revoke()
        f.advance(30)
        expect(f.signal()?.aborted).toBe(true)
        f.release({ type: 'published', externalId: 'stale' })
        expect((await run).outcome).toBe('claim_lost')
        expect(f.store.completedInput).toBeNull()
        expect(f.timers.size).toBe(0)
    })
})
