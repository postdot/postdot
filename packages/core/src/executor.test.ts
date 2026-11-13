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

    async recoverExpiredClaims() {
        return { requeuedJobIds: [], ambiguousJobIds: [] }
    }

    async claimNextDueJob(): Promise<Job | null> {
        return this.job
    }

    async startExternalEffect(): Promise<boolean> {
        return this.startSucceeds
    }

    async completeExternalEffect(
        input: CompleteExternalEffectInput
    ): Promise<PersistedEffectOutcome> {
        this.completedInput = input
        if (input.outcome.type === 'published') return 'published'
        if (input.outcome.type === 'ambiguous') return 'ambiguous'
        if (
            (input.outcome.type === 'retryable_failure' ||
                input.outcome.type === 'deferred' ||
                (input.outcome.type === 'checkpointed_failure' && input.outcome.retryable)) &&
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

    async recoverExpiredClaims() {
        return { requeuedJobIds: [], ambiguousJobIds: [] }
    }

    async claimNextDueJob(): Promise<TestDelivery | null> {
        return this.work
    }

    async startExternalEffect(): Promise<boolean> {
        return true
    }

    async completeExternalEffect(
        input: CompleteExternalEffectInput
    ): Promise<PersistedEffectOutcome> {
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
    test('drains an in-flight heartbeat without rearming it after the effect finishes', async () => {
        const entered = Promise.withResolvers<void>()
        const effect = Promise.withResolvers<ExternalEffectOutcome>()
        const renewal = Promise.withResolvers<boolean>()
        const timers = new Map<unknown, { callback: () => void | Promise<void>; delay: number }>()
        const store = new FakeExecutorStore()
        let renewals = 0
        const run = processNextWorkflowEvent({
            store: Object.assign(store, {
                renewClaim: () => (++renewals === 1 ? renewal.promise : Promise.resolve(true)),
            }),
            actorId: 'system-one',
            createClaimToken: () => 'claim-one',
            leaseDuration: 90,
            retryPolicy: { nextRunAt: () => null },
            now: () => time,
            activeEffectPolicy: {
                timeoutMs: 250,
                renewalIntervalMs: 30,
                timers: {
                    set(callback, delay) {
                        const handle = {}
                        timers.set(handle, { callback, delay })
                        return handle
                    },
                    clear: handle => {
                        timers.delete(handle)
                    },
                },
            },
            performExternalEffect() {
                entered.resolve()
                return effect.promise
            },
        })
        await entered.promise
        const heartbeat = [...timers.values()].find(timer => timer.delay === 30)!
        const beating = heartbeat.callback()
        effect.resolve({ type: 'published', externalId: 'confirmed' })
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        expect(store.completedInput).toBeNull()
        renewal.resolve(true)
        await beating
        expect((await run).outcome).toBe('published')
        expect(timers.size).toBe(0)
    })

    function fixture() {
        let clock = time
        let expiry = time + 90
        let owned = true
        let renewals = 0
        const scheduled = new Map<number, { at: number; callback: () => void | Promise<void> }>()
        let sequence = 0
        const store = new FakeExecutorStore()
        const renewableStore: WorkflowExecutorStore = {
            recoverExpiredClaims: async () => store.recoverExpiredClaims(),
            claimNextDueJob: async () => store.claimNextDueJob(),
            startExternalEffect: async () => store.startExternalEffect(),
            completeExternalEffect: input => store.completeExternalEffect(input),
            async renewClaim(input) {
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
        // Persistence is asynchronous: let claims, renewals and rescheduling settle
        // around every fake timer callback.
        const settle = () => new Promise(resolve => setTimeout(resolve, 0))
        const advance = async (elapsed: number) => {
            await settle()
            const until = clock + elapsed
            while (true) {
                const next = [...scheduled].sort((a, b) => a[1].at - b[1].at)[0]
                if (!next || next[1].at > until) break
                clock = next[1].at
                scheduled.delete(next[0])
                void next[1].callback()
                await settle()
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
        await f.advance(180)
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
        await f.advance(300)
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
        await f.advance(30)
        expect(f.signal()?.aborted).toBe(true)
        f.release({ type: 'published', externalId: 'stale' })
        expect((await run).outcome).toBe('claim_lost')
        expect(f.store.completedInput).toBeNull()
        expect(f.timers.size).toBe(0)
    })
})

for (const retryable of [true, false])
    test(`checkpointed partial effects ${retryable ? 'schedule a continuation' : 'require an operator retry'}`, async () => {
        const store = new FakeExecutorStore()
        const outcome: ExternalEffectOutcome = {
            type: 'checkpointed_failure',
            effectOccurred: true,
            retryable,
            confirmedMessageCount: 2,
            errorMessage: 'Third message rejected',
        }
        const result = await processNextWorkflowEvent({
            store,
            actorId: 'system-one',
            leaseDuration: 60000,
            createClaimToken: () => 'claim-one',
            now: () => time,
            retryPolicy: createExponentialRetryPolicy({
                maxAttempts: 3,
                initialDelay: 1000,
                maximumDelay: 1000,
            }),
            performExternalEffect: () => outcome,
        })
        expect(result.outcome).toBe(retryable ? 'retry_scheduled' : 'failed')
        expect(store.completedInput?.retryAt).toBe(retryable ? time + 1000 : null)
        expect(store.completedInput?.outcome).toEqual(outcome)
    })
