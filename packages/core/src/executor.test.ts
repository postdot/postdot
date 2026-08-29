import { describe, expect, test } from 'bun:test'

import {
    createExponentialRetryPolicy,
    processNextWorkflowEvent,
    type CompleteExternalEffectInput,
    type ExternalEffectOutcome,
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
        if (input.outcome.type === 'retryable_failure' && input.retryAt !== null) {
            return 'retry_scheduled'
        }
        return 'failed'
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
