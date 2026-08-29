import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    createExponentialRetryPolicy,
    NextEventScheduler,
    processNextWorkflowEvent,
} from '@herald/core'
import { eq } from 'drizzle-orm'

import type { HeraldDatabase } from './client'
import { closeDatabase, createDatabase } from './client'
import { runMigrations } from './migrations'
import { actors, channels, jobs, posts, projects, publications, publishers } from './schema'
import { createWorkflowStore } from './workflow-store'

const dueAt = 1_800_000_000_000

function seedDueJob(database: HeraldDatabase, suffix = 'one') {
    const projectId = `project-${suffix}`
    const humanActorId = `human-${suffix}`
    const systemActorId = `system-${suffix}`
    const channelId = `channel-${suffix}`
    const postId = `post-${suffix}`
    const publicationId = `publication-${suffix}`
    const jobId = `job-${suffix}`

    database
        .insert(projects)
        .values({ id: projectId, name: `Project ${suffix}` })
        .run()
    database
        .insert(actors)
        .values([
            {
                id: humanActorId,
                projectId,
                kind: 'human',
                displayName: `Editor ${suffix}`,
            },
            {
                id: systemActorId,
                projectId,
                kind: 'system',
                displayName: `Worker ${suffix}`,
            },
        ])
        .run()
    database
        .insert(channels)
        .values({ id: channelId, projectId, name: `Channel ${suffix}` })
        .run()
    database
        .insert(publishers)
        .values({
            id: `publisher-${suffix}`,
            projectId,
            channelId,
            kind: 'test',
        })
        .run()
    database
        .insert(posts)
        .values({
            id: postId,
            projectId,
            content: `Post ${suffix}`,
            createdByActorId: humanActorId,
        })
        .run()
    database
        .insert(publications)
        .values({
            id: publicationId,
            projectId,
            postId,
            channelId,
            content: `Publication ${suffix}`,
            state: 'scheduled',
            scheduledAt: dueAt,
            createdByActorId: humanActorId,
            scheduledByActorId: humanActorId,
            stateChangedByActorId: humanActorId,
        })
        .run()
    database
        .insert(jobs)
        .values({
            id: jobId,
            projectId,
            publicationId,
            state: 'pending',
            runAt: dueAt,
        })
        .run()

    return {
        projectId,
        humanActorId,
        systemActorId,
        publicationId,
        jobId,
    }
}

describe('workflow store', () => {
    it('never claims work for a manual channel', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const fixture = seedDueJob(database, 'manual')
            database.delete(publishers).where(eq(publishers.channelId, 'channel-manual')).run()

            expect(
                createWorkflowStore(database).claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'claim-one',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).toBeNull()
            expect(createWorkflowStore(database).getNextEventAt()).toBeNull()
        } finally {
            closeDatabase(database)
        }
    })

    it('claims one due job atomically and fences stale workers', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const fixture = seedDueJob(database)
            const store = createWorkflowStore(database)

            expect(
                store.claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'too-early',
                    now: dueAt - 1,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).toBeNull()
            expect(
                store.claimNextDueJob({
                    actorId: fixture.humanActorId,
                    claimToken: 'human-claim',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).toBeNull()

            const claimed = store.claimNextDueJob({
                actorId: fixture.systemActorId,
                claimToken: 'claim-one',
                now: dueAt,
                leaseExpiresAt: dueAt + 60_000,
            })

            expect(claimed?.state).toBe('running')
            expect(claimed?.attempts).toBe(1)
            expect(claimed?.claimedByActorId).toBe(fixture.systemActorId)
            expect(
                store.claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'claim-two',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).toBeNull()
            expect(store.startExternalEffect(fixture.jobId, 'stale-claim', dueAt + 1)).toBe(false)
            expect(store.startExternalEffect(fixture.jobId, 'claim-one', dueAt + 1)).toBe(true)

            const [job] = database.select().from(jobs).where(eq(jobs.id, fixture.jobId)).all()
            const [publication] = database
                .select()
                .from(publications)
                .where(eq(publications.id, fixture.publicationId))
                .all()
            expect(job?.effectStartedAt).toBe(dueAt + 1)
            expect(publication?.state).toBe('publishing')
            expect(publication?.stateChangedByActorId).toBe(fixture.systemActorId)
        } finally {
            closeDatabase(database)
        }
    })

    it('chooses the nearest pending run or running lease expiry', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const first = seedDueJob(database, 'first')
            const store = createWorkflowStore(database)

            expect(store.getNextEventAt()).toBe(dueAt)
            store.claimNextDueJob({
                actorId: first.systemActorId,
                claimToken: 'claim-one',
                now: dueAt,
                leaseExpiresAt: dueAt + 60_000,
            })
            expect(store.getNextEventAt()).toBe(dueAt + 60_000)

            const second = seedDueJob(database, 'second')
            database
                .update(jobs)
                .set({ runAt: dueAt + 30_000 })
                .where(eq(jobs.id, second.jobId))
                .run()
            expect(store.getNextEventAt()).toBe(dueAt + 30_000)
        } finally {
            closeDatabase(database)
        }
    })

    it('requeues an expired claim when no external effect started', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const fixture = seedDueJob(database)
            const store = createWorkflowStore(database)
            store.claimNextDueJob({
                actorId: fixture.systemActorId,
                claimToken: 'claim-one',
                now: dueAt,
                leaseExpiresAt: dueAt + 60_000,
            })

            expect(store.recoverExpiredClaims(dueAt + 60_000)).toEqual({
                requeuedJobIds: [fixture.jobId],
                ambiguousJobIds: [],
            })

            const [job] = database.select().from(jobs).where(eq(jobs.id, fixture.jobId)).all()
            const [publication] = database
                .select()
                .from(publications)
                .where(eq(publications.id, fixture.publicationId))
                .all()
            expect(job?.state).toBe('pending')
            expect(job?.attempts).toBe(1)
            expect(job?.claimToken).toBeNull()
            expect(job?.runAt).toBe(dueAt + 60_000)
            expect(publication?.state).toBe('scheduled')
        } finally {
            closeDatabase(database)
        }
    })

    it('marks the publication ambiguous after an expired effect boundary', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const fixture = seedDueJob(database)
            const store = createWorkflowStore(database)
            store.claimNextDueJob({
                actorId: fixture.systemActorId,
                claimToken: 'claim-one',
                now: dueAt,
                leaseExpiresAt: dueAt + 60_000,
            })
            store.startExternalEffect(fixture.jobId, 'claim-one', dueAt + 1)

            expect(store.recoverExpiredClaims(dueAt + 60_000)).toEqual({
                requeuedJobIds: [],
                ambiguousJobIds: [fixture.jobId],
            })

            const [job] = database.select().from(jobs).where(eq(jobs.id, fixture.jobId)).all()
            const [publication] = database
                .select()
                .from(publications)
                .where(eq(publications.id, fixture.publicationId))
                .all()
            expect(job?.state).toBe('failed')
            expect(job?.claimToken).toBeNull()
            expect(job?.errorMessage).toContain('external-effect boundary')
            expect(publication?.state).toBe('ambiguous')
            expect(publication?.errorMessage).toContain('external-effect boundary')
            expect(
                store.completeExternalEffect({
                    jobId: fixture.jobId,
                    claimToken: 'claim-one',
                    completedAt: dueAt + 60_001,
                    outcome: { type: 'published' },
                })
            ).toBeNull()
            expect(database.$client.query('pragma foreign_key_check').all()).toEqual([])
        } finally {
            closeDatabase(database)
        }
    })

    it('persists a confirmed external result and fences duplicate completion', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const fixture = seedDueJob(database, 'success')
            const store = createWorkflowStore(database)
            store.claimNextDueJob({
                actorId: fixture.systemActorId,
                claimToken: 'claim-success',
                now: dueAt,
                leaseExpiresAt: dueAt + 60_000,
            })
            store.startExternalEffect(fixture.jobId, 'claim-success', dueAt + 1)

            expect(
                store.completeExternalEffect({
                    jobId: fixture.jobId,
                    claimToken: 'claim-success',
                    completedAt: dueAt + 2,
                    outcome: {
                        type: 'published',
                        externalId: 'remote-success',
                        externalUrl: 'https://example.com/remote-success',
                    },
                })
            ).toBe('published')
            expect(
                store.completeExternalEffect({
                    jobId: fixture.jobId,
                    claimToken: 'claim-success',
                    completedAt: dueAt + 3,
                    outcome: { type: 'published' },
                })
            ).toBeNull()

            const [job] = database.select().from(jobs).where(eq(jobs.id, fixture.jobId)).all()
            const [publication] = database
                .select()
                .from(publications)
                .where(eq(publications.id, fixture.publicationId))
                .all()
            expect(job?.state).toBe('succeeded')
            expect(job?.completedAt).toBe(dueAt + 2)
            expect(job?.claimToken).toBeNull()
            expect(publication?.state).toBe('published')
            expect(publication?.publishedAt).toBe(dueAt + 2)
            expect(publication?.publishedByActorId).toBe(fixture.systemActorId)
            expect(publication?.externalId).toBe('remote-success')
        } finally {
            closeDatabase(database)
        }
    })

    it('retries only a known no-effect failure and stops at the policy limit', async () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const fixture = seedDueJob(database, 'retry')
            const store = createWorkflowStore(database)
            const retryPolicy = createExponentialRetryPolicy({
                maxAttempts: 2,
                initialDelay: 1_000,
                maximumDelay: 1_000,
            })
            let currentTime = dueAt
            let claimNumber = 0
            const process = () =>
                processNextWorkflowEvent({
                    store,
                    actorId: fixture.systemActorId,
                    leaseDuration: 60_000,
                    retryPolicy,
                    createClaimToken: () => `claim-retry-${(claimNumber += 1)}`,
                    performExternalEffect: () => ({
                        type: 'retryable_failure',
                        effectOccurred: false,
                        errorMessage: 'Provider rejected the request before accepting it',
                    }),
                    now: () => currentTime,
                })

            expect((await process()).outcome).toBe('retry_scheduled')
            let [job] = database.select().from(jobs).where(eq(jobs.id, fixture.jobId)).all()
            let [publication] = database
                .select()
                .from(publications)
                .where(eq(publications.id, fixture.publicationId))
                .all()
            expect(job?.state).toBe('pending')
            expect(job?.attempts).toBe(1)
            expect(job?.runAt).toBe(dueAt + 1_000)
            expect(publication?.state).toBe('ready')

            currentTime = dueAt + 1_000
            expect((await process()).outcome).toBe('failed')
            ;[job] = database.select().from(jobs).where(eq(jobs.id, fixture.jobId)).all()
            ;[publication] = database
                .select()
                .from(publications)
                .where(eq(publications.id, fixture.publicationId))
                .all()
            expect(job?.state).toBe('failed')
            expect(job?.attempts).toBe(2)
            expect(job?.errorMessage).toContain('rejected')
            expect(publication?.state).toBe('failed')
            expect(store.getNextEventAt()).toBeNull()
        } finally {
            closeDatabase(database)
        }
    })

    it('treats an exception after the effect boundary as ambiguous', async () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const fixture = seedDueJob(database, 'exception')
            const store = createWorkflowStore(database)
            const result = await processNextWorkflowEvent({
                store,
                actorId: fixture.systemActorId,
                leaseDuration: 60_000,
                retryPolicy: createExponentialRetryPolicy({
                    maxAttempts: 3,
                    initialDelay: 1_000,
                    maximumDelay: 10_000,
                }),
                createClaimToken: () => 'claim-exception',
                performExternalEffect: () => {
                    throw new Error('response lost')
                },
                now: () => dueAt,
            })

            expect(result.outcome).toBe('ambiguous')
            const [job] = database.select().from(jobs).where(eq(jobs.id, fixture.jobId)).all()
            const [publication] = database
                .select()
                .from(publications)
                .where(eq(publications.id, fixture.publicationId))
                .all()
            expect(job?.state).toBe('failed')
            expect(publication?.state).toBe('ambiguous')
            expect(publication?.errorMessage).toContain('response lost')
        } finally {
            closeDatabase(database)
        }
    })

    it('cancels pending work atomically but never claims a running effect was prevented', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const pending = seedDueJob(database, 'cancel-pending')
            const running = seedDueJob(database, 'cancel-running')
            const store = createWorkflowStore(database)

            expect(store.cancelPendingJob(pending.jobId, pending.humanActorId, dueAt)).toBe(true)
            expect(store.cancelPendingJob(pending.jobId, pending.humanActorId, dueAt + 1)).toBe(
                false
            )

            store.claimNextDueJob({
                actorId: running.systemActorId,
                claimToken: 'claim-running',
                now: dueAt,
                leaseExpiresAt: dueAt + 60_000,
            })
            store.startExternalEffect(running.jobId, 'claim-running', dueAt + 1)
            expect(store.cancelPendingJob(running.jobId, running.humanActorId, dueAt + 2)).toBe(
                false
            )

            const [cancelledJob] = database
                .select()
                .from(jobs)
                .where(eq(jobs.id, pending.jobId))
                .all()
            const [cancelledPublication] = database
                .select()
                .from(publications)
                .where(eq(publications.id, pending.publicationId))
                .all()
            const [runningJob] = database
                .select()
                .from(jobs)
                .where(eq(jobs.id, running.jobId))
                .all()
            expect(cancelledJob?.state).toBe('cancelled')
            expect(cancelledJob?.completedAt).toBe(dueAt)
            expect(cancelledPublication?.state).toBe('cancelled')
            expect(cancelledPublication?.stateChangedByActorId).toBe(pending.humanActorId)
            expect(runningJob?.state).toBe('running')
            expect(database.$client.query('pragma foreign_key_check').all()).toEqual([])
        } finally {
            closeDatabase(database)
        }
    })

    it('runs one durable publication from a scheduler wake and returns to empty state', async () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const fixture = seedDueJob(database, 'scheduled-execution')
            const store = createWorkflowStore(database)
            let wake: (() => void | Promise<void>) | undefined
            const scheduler = new NextEventScheduler({
                getNextEventAt: store.getNextEventAt,
                processDueEvents: () =>
                    processNextWorkflowEvent({
                        store,
                        actorId: fixture.systemActorId,
                        leaseDuration: 60_000,
                        retryPolicy: createExponentialRetryPolicy({
                            maxAttempts: 2,
                            initialDelay: 1_000,
                            maximumDelay: 10_000,
                        }),
                        createClaimToken: () => 'claim-scheduled-execution',
                        performExternalEffect: () => ({ type: 'published' }),
                        now: () => dueAt,
                    }).then(() => undefined),
                onError: error => {
                    throw error
                },
                clock: { now: () => dueAt },
                timers: {
                    set(callback) {
                        wake = callback
                        return 1
                    },
                    clear() {
                        wake = undefined
                    },
                },
            })

            scheduler.start()
            expect(scheduler.scheduledAt).toBe(dueAt)
            if (wake === undefined) throw new Error('Scheduler did not arm its timer')
            await wake()

            const [job] = database.select().from(jobs).where(eq(jobs.id, fixture.jobId)).all()
            const [publication] = database
                .select()
                .from(publications)
                .where(eq(publications.id, fixture.publicationId))
                .all()
            expect(job?.state).toBe('succeeded')
            expect(publication?.state).toBe('published')
            expect(store.getNextEventAt()).toBeNull()
            expect(scheduler.state).toBe('started')
            expect(scheduler.scheduledAt).toBeNull()
        } finally {
            closeDatabase(database)
        }
    })

    it('prevents two database connections from claiming the same job', () => {
        const directory = mkdtempSync(join(tmpdir(), 'herald-workflow-'))
        const filename = join(directory, 'herald.sqlite')
        const firstDatabase = createDatabase(filename)
        let secondDatabase: HeraldDatabase | undefined

        try {
            runMigrations(firstDatabase)
            const fixture = seedDueJob(firstDatabase)
            secondDatabase = createDatabase(filename)

            const firstClaim = createWorkflowStore(firstDatabase).claimNextDueJob({
                actorId: fixture.systemActorId,
                claimToken: 'claim-one',
                now: dueAt,
                leaseExpiresAt: dueAt + 60_000,
            })
            const secondClaim = createWorkflowStore(secondDatabase).claimNextDueJob({
                actorId: fixture.systemActorId,
                claimToken: 'claim-two',
                now: dueAt,
                leaseExpiresAt: dueAt + 60_000,
            })

            expect(firstClaim?.id).toBe(fixture.jobId)
            expect(secondClaim).toBeNull()
        } finally {
            if (secondDatabase !== undefined) closeDatabase(secondDatabase)
            closeDatabase(firstDatabase)
            rmSync(directory, { recursive: true, force: true })
        }
    })

    it('reconstructs the next event after the database is reopened', () => {
        const directory = mkdtempSync(join(tmpdir(), 'herald-restart-'))
        const filename = join(directory, 'herald.sqlite')
        const firstDatabase = createDatabase(filename)
        let firstDatabaseOpen = true
        let reopenedDatabase: HeraldDatabase | undefined

        try {
            runMigrations(firstDatabase)
            seedDueJob(firstDatabase, 'restart')
            expect(createWorkflowStore(firstDatabase).getNextEventAt()).toBe(dueAt)
            closeDatabase(firstDatabase)
            firstDatabaseOpen = false

            reopenedDatabase = createDatabase(filename)
            expect(createWorkflowStore(reopenedDatabase).getNextEventAt()).toBe(dueAt)
        } finally {
            if (reopenedDatabase !== undefined) {
                closeDatabase(reopenedDatabase)
            }
            if (firstDatabaseOpen) {
                closeDatabase(firstDatabase)
            }
            rmSync(directory, { recursive: true, force: true })
        }
    })
})
