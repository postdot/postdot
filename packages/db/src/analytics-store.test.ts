import { describe, expect, it } from 'bun:test'

import type { ChannelProfileDefinition } from '@postdot/core'
import { DomainInvariantError } from '@postdot/core'
import { eq } from 'drizzle-orm'

import { createAnalyticsStore } from './analytics-store'
import { closeDatabase, createDatabase } from './client'
import { createEventJournalStore } from './event-journal-store'
import { createManualStore } from './manual-store'
import { runMigrations } from './migrations'
import { jobs, publications, publishers } from './schema'
import { seedTestWorkspace, workspaceOf } from './testing'

const dayMs = 24 * 60 * 60 * 1_000

const automaticProfile: ChannelProfileDefinition = {
    id: 'analytics-automatic',
    version: 1,
    profileHash: 'sha256:analytics-automatic-profile-v1',
    schemaHash: 'sha256:analytics-automatic-schema-v1',
    origin: 'built_in',
    contentSchema: {
        type: 'object',
        properties: { body: { type: 'string', minLength: 1 } },
        required: ['body'],
        additionalProperties: false,
    },
    fieldBindings: [{ id: 'body', semantic: 'primary_text', path: '/body' }],
    capabilities: {
        revision: 'analytics-automatic-v1',
        textFields: [
            {
                bindingId: 'body',
                acceptedSourceFormats: ['plain_text'],
                maxLength: 10_000,
            },
        ],
        mediaFields: [],
        relations: [],
    },
    execution: { kind: 'built_in', contractId: 'analytics-automatic', revision: 'v1' },
}

function sourceContent(text: string) {
    return {
        body: { text, format: 'plain_text' as const },
        media: [],
    }
}

async function createFixture(
    timeZone = 'Europe/Paris',
    setupAt = Date.UTC(2025, 0, 1),
    prefix = 'analytics'
) {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const store = createManualStore(database, {
        now: () => setupAt,
        createId: (() => {
            let sequence = 0
            return () => prefix + '-generated-' + ++sequence
        })(),
    })
    const project = await store.createProject({
        workspaceId: await seedTestWorkspace(database),
        name: 'Analytics project',
        subjectId: 'user-1',
        displayName: 'Analytics operator',
        timeZone,
    })
    const manualChannel = await store.createChannel({
        projectId: project.project.id,
        subjectId: 'user-1',
        name: 'Manual channel',
    })
    const automaticChannel = await store.createChannel({
        projectId: project.project.id,
        subjectId: 'user-1',
        name: 'Automatic channel',
        profile: automaticProfile,
    })
    if (manualChannel === null || automaticChannel === null) {
        throw new Error('The analytics fixture channels were not created')
    }
    database
        .insert(publishers)
        .values({
            id: prefix + '-publisher',
            workspaceId: await workspaceOf(database, project.project.id),
            channelId: automaticChannel.id,
            kind: 'analytics-provider',
        })
        .run()

    return { database, store, project, manualChannel, automaticChannel }
}

async function createPublication(
    fixture: Awaited<ReturnType<typeof createFixture>>,
    channelId: string,
    deliveryMode: 'manual' | 'automatic',
    scheduledAt?: number
): Promise<string> {
    const created = await fixture.store.createPost({
        projectId: fixture.project.project.id,
        subjectId: 'user-1',
        sourceContent: sourceContent('Analytics ' + channelId),
        publications: [
            {
                channelId,
                deliveryMode,
                scheduledAt,
            },
        ],
    })
    const publication = created?.publications[0]
    if (publication === undefined) throw new Error('The analytics publication was not created')
    return publication.id
}

function appendFact(
    journal: ReturnType<typeof createEventJournalStore>,
    fixture: Awaited<ReturnType<typeof createFixture>>,
    input: {
        readonly id: string
        readonly name: string
        readonly entityId: string
        readonly occurredAt: number
        readonly payload?: Readonly<Record<string, unknown>>
        readonly version?: number
    }
) {
    return journal.append({
        id: input.id,
        projectId: fixture.project.project.id,
        actorId: fixture.project.actor.id,
        name: input.name,
        version: input.version ?? 1,
        subject: { type: 'publication', id: input.entityId },
        payload: input.payload ?? {},
        occurredAt: input.occurredAt,
    })
}

function executionPayload(
    _fixture: Awaited<ReturnType<typeof createFixture>>,
    jobId: string,
    attempt: number,
    runAt: number,
    extra: Readonly<Record<string, unknown>> = {}
) {
    return {
        jobId,
        attempt,
        runAt,
        deliveryMode: 'automatic',
        provider: 'analytics-provider',
        ...extra,
    }
}

function byState(
    values: readonly { readonly state: string; readonly count: number }[]
): Record<string, number> {
    return Object.fromEntries(values.map(value => [value.state, value.count]))
}

describe('analytics store', () => {
    it('returns current publication, execution, and workload snapshots independently of history', async () => {
        const observedAt = Date.UTC(2026, 5, 1, 12)
        const fixture = await createFixture('Europe/Paris', observedAt - 1_000)

        try {
            await createPublication(fixture, fixture.manualChannel.id, 'manual', observedAt - 1)
            const automaticDue = await createPublication(
                fixture,
                fixture.automaticChannel.id,
                'automatic',
                observedAt - 500
            )
            await createPublication(
                fixture,
                fixture.automaticChannel.id,
                'automatic',
                observedAt + 10_000
            )
            const automaticRunning = await createPublication(
                fixture,
                fixture.automaticChannel.id,
                'automatic',
                observedAt - 400
            )
            const automaticSucceeded = await createPublication(
                fixture,
                fixture.automaticChannel.id,
                'automatic',
                observedAt - 300
            )
            const automaticFailed = await createPublication(
                fixture,
                fixture.automaticChannel.id,
                'automatic',
                observedAt - 200
            )
            const automaticAmbiguous = await createPublication(
                fixture,
                fixture.automaticChannel.id,
                'automatic',
                observedAt - 100
            )

            const jobFor = (publicationId: string) => {
                const job = fixture.database
                    .select()
                    .from(jobs)
                    .where(eq(jobs.publicationId, publicationId))
                    .all()[0]
                if (job === undefined) {
                    throw new Error('Job for ' + publicationId + ' is missing')
                }
                return job
            }

            const retryJob = jobFor(automaticDue)
            const journal = createEventJournalStore(fixture.database)
            await journal.append({
                id: 'current-retry-scheduled',
                projectId: fixture.project.project.id,
                actorId: fixture.project.actor.id,
                name: 'publication.execution.retry_scheduled',
                version: 1,
                subject: { type: 'publication', id: retryJob.publicationId },
                payload: {
                    jobId: retryJob.id,
                    attempt: 1,
                    retryAt: observedAt + 10_000,
                },
                occurredAt: observedAt - 450,
            })

            const runningJob = jobFor(automaticRunning)
            fixture.database
                .update(jobs)
                .set({
                    state: 'running',
                    attempts: 1,
                    claimToken: 'analytics-running',
                    claimedByActorId: fixture.project.actor.id,
                    claimedAt: observedAt - 300,
                    leaseExpiresAt: observedAt + 100_000,
                    startedAt: observedAt - 300,
                })
                .where(eq(jobs.id, runningJob.id))
                .run()

            const succeededJob = jobFor(automaticSucceeded)
            fixture.database
                .update(jobs)
                .set({
                    state: 'succeeded',
                    attempts: 1,
                    startedAt: observedAt - 300,
                    completedAt: observedAt - 250,
                })
                .where(eq(jobs.id, succeededJob.id))
                .run()
            fixture.database
                .update(publications)
                .set({
                    state: 'published',
                    publishedAt: observedAt - 250,
                    publishedByActorId: fixture.project.actor.id,
                })
                .where(eq(publications.id, automaticSucceeded))
                .run()

            const failedJob = jobFor(automaticFailed)
            fixture.database
                .update(jobs)
                .set({
                    state: 'failed',
                    attempts: 1,
                    startedAt: observedAt - 250,
                    completedAt: observedAt - 150,
                    errorMessage: 'analytics failure',
                })
                .where(eq(jobs.id, failedJob.id))
                .run()
            fixture.database
                .update(publications)
                .set({ state: 'failed', errorMessage: 'analytics failure' })
                .where(eq(publications.id, automaticFailed))
                .run()

            const ambiguousJob = jobFor(automaticAmbiguous)
            fixture.database
                .update(jobs)
                .set({
                    state: 'failed',
                    attempts: 1,
                    startedAt: observedAt - 150,
                    completedAt: observedAt - 50,
                    errorMessage: 'analytics ambiguity',
                })
                .where(eq(jobs.id, ambiguousJob.id))
                .run()
            fixture.database
                .update(publications)
                .set({ state: 'ambiguous', errorMessage: 'analytics ambiguity' })
                .where(eq(publications.id, automaticAmbiguous))
                .run()
            await journal.append({
                id: 'current-ambiguity-history',
                projectId: fixture.project.project.id,
                actorId: fixture.project.actor.id,
                name: 'publication.execution.ambiguous',
                version: 1,
                subject: { type: 'publication', id: automaticAmbiguous },
                payload: {
                    jobId: ambiguousJob.id,
                    attempt: 1,
                    toState: 'ambiguous',
                },
                occurredAt: observedAt - 50,
            })

            const analytics = await createAnalyticsStore(fixture.database, {
                now: () => observedAt,
            }).getProjectAnalytics({
                projectId: fixture.project.project.id,
                subjectId: 'user-1',
                from: observedAt,
                to: observedAt,
            })
            if (analytics === null) throw new Error('The authorized analytics response is missing')

            expect(analytics.range).toEqual({ from: observedAt, to: observedAt })
            expect(analytics.historical.buckets).toEqual([])
            expect(analytics.current.publications.total).toBe(7)
            expect(byState(analytics.current.publications.byState)).toEqual({
                draft: 0,
                scheduled: 4,
                ready: 0,
                publishing: 0,
                published: 1,
                failed: 1,
                ambiguous: 1,
                cancelled: 0,
            })
            expect(analytics.current.publications.byDeliveryMode).toEqual([
                { deliveryMode: 'manual', count: 1 },
                { deliveryMode: 'automatic', count: 6 },
            ])
            expect(analytics.current.executions).toEqual({
                scheduled: 2,
                due: 1,
                running: 1,
                retryablePending: 1,
                succeeded: 1,
                failed: 1,
                ambiguous: 1,
            })
            expect(analytics.current.workload).toEqual({
                manualDue: 1,
                ambiguousReconciliation: 1,
                oldestDueAt: observedAt - 500,
                nextRunAt: observedAt - 500,
                futureScheduled: 1,
                overdue: 1,
            })
            expect(analytics.current.publications.byDimension).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        channelId: fixture.manualChannel.id,
                        provider: 'manual',
                        deliveryMode: 'manual',
                        count: 1,
                    }),
                    expect.objectContaining({
                        channelId: fixture.automaticChannel.id,
                        provider: 'analytics-provider',
                        deliveryMode: 'automatic',
                        count: 6,
                    }),
                ])
            )

            const manualOnly = await createAnalyticsStore(fixture.database, {
                now: () => observedAt,
            }).getProjectAnalytics({
                projectId: fixture.project.project.id,
                subjectId: 'user-1',
                deliveryMode: 'manual',
                from: observedAt,
                to: observedAt,
            })
            expect(manualOnly?.current.publications.total).toBe(1)
            expect(manualOnly?.current.executions.scheduled).toBe(0)
            expect(manualOnly?.current.workload.manualDue).toBe(1)
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('keeps the automatic provider on reconciliation and supports provider filtering', async () => {
        const observedAt = Date.UTC(2026, 0, 2)
        const setupAt = observedAt - 1_000
        const fixture = await createFixture('UTC', setupAt)

        try {
            const publicationId = await createPublication(
                fixture,
                fixture.automaticChannel.id,
                'automatic',
                setupAt
            )
            const job = fixture.database
                .select()
                .from(jobs)
                .where(eq(jobs.publicationId, publicationId))
                .all()[0]
            if (job === undefined) throw new Error('The reconciliation job is missing')

            fixture.database
                .update(publications)
                .set({ state: 'ambiguous', errorMessage: 'provider response was lost' })
                .where(eq(publications.id, publicationId))
                .run()

            const journal = createEventJournalStore(fixture.database)
            await journal.append({
                id: 'reconciliation-ambiguity',
                projectId: fixture.project.project.id,
                actorId: fixture.project.actor.id,
                name: 'publication.execution.ambiguous',
                version: 1,
                subject: { type: 'publication', id: publicationId },
                payload: {
                    jobId: job.id,
                    attempt: 1,
                    deliveryMode: 'automatic',
                    provider: 'analytics-provider',
                    toState: 'ambiguous',
                },
                occurredAt: setupAt + 100,
            })
            fixture.database
                .delete(publishers)
                .where(eq(publishers.channelId, fixture.automaticChannel.id))
                .run()

            const reconciled = await fixture.store.reconcileAmbiguousPublication({
                projectId: fixture.project.project.id,
                publicationId,
                subjectId: 'user-1',
                resolution: 'published',
                externalId: 'provider-publication-1',
            })
            expect(reconciled.kind).toBe('reconciled')

            const reconciliationEvent = (
                await fixture.store.listAuditEvents(fixture.project.project.id, 'user-1')
            )?.find(event => event.action === 'publication.reconciled')
            expect(reconciliationEvent).not.toBeUndefined()
            expect(JSON.parse(reconciliationEvent?.metadataJson ?? '{}')).toMatchObject({
                deliveryMode: 'automatic',
                provider: 'analytics-provider',
            })

            const providerFiltered = await createAnalyticsStore(fixture.database, {
                now: () => observedAt,
            }).getProjectAnalytics({
                projectId: fixture.project.project.id,
                subjectId: 'user-1',
                provider: 'analytics-provider',
                from: setupAt,
                to: observedAt,
            })
            expect(providerFiltered?.historical.publications.published).toBe(1)
            expect(providerFiltered?.historical.publications.byDimension.published).toEqual([
                expect.objectContaining({
                    provider: 'analytics-provider',
                    deliveryMode: 'automatic',
                    count: 1,
                }),
            ])
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('counts historical lifecycle and execution facts with retry, ambiguity, recovery, and replay semantics', async () => {
        const observedAt = Date.UTC(2026, 0, 2)
        const fixture = await createFixture('UTC', observedAt - dayMs)

        try {
            const journal = createEventJournalStore(fixture.database)
            const manualPublication = await createPublication(
                fixture,
                fixture.manualChannel.id,
                'manual'
            )
            const successfulPublication = await createPublication(
                fixture,
                fixture.automaticChannel.id,
                'automatic'
            )
            const directAmbiguousPublication = await createPublication(
                fixture,
                fixture.automaticChannel.id,
                'automatic'
            )
            const recoveredPublication = await createPublication(
                fixture,
                fixture.automaticChannel.id,
                'automatic'
            )
            const recoveredClaimPublication = await createPublication(
                fixture,
                fixture.automaticChannel.id,
                'automatic'
            )
            const failedPublication = await createPublication(
                fixture,
                fixture.automaticChannel.id,
                'automatic'
            )
            const cancelledPublication = await createPublication(
                fixture,
                fixture.automaticChannel.id,
                'automatic'
            )
            const unknownPublication = 'historical-unknown-publication'
            const start = observedAt - 10_000
            const manualMetadata = {
                channelId: fixture.manualChannel.id,
                deliveryMode: 'manual',
                provider: 'manual',
            }
            const automaticMetadata = {
                channelId: fixture.automaticChannel.id,
                state: 'scheduled',
                scheduledAt: start,
                deliveryMode: 'automatic',
                provider: 'analytics-provider',
            }

            await appendFact(journal, fixture, {
                id: 'history-manual-created',
                name: 'publication.created',
                entityId: manualPublication,
                occurredAt: start,
                payload: {
                    ...manualMetadata,
                    state: 'scheduled',
                    scheduledAt: start,
                },
            })
            await appendFact(journal, fixture, {
                id: 'history-manual-ready',
                name: 'publication.ready',
                entityId: manualPublication,
                occurredAt: start + 50,
                payload: { ...manualMetadata, fromState: 'scheduled', toState: 'ready' },
            })
            await appendFact(journal, fixture, {
                id: 'history-manual-published',
                name: 'publication.published',
                entityId: manualPublication,
                occurredAt: start + 80,
                payload: { ...manualMetadata, fromState: 'ready', toState: 'published' },
            })

            await appendFact(journal, fixture, {
                id: 'history-success-created',
                name: 'publication.created',
                entityId: successfulPublication,
                occurredAt: start,
                payload: automaticMetadata,
            })
            await appendFact(journal, fixture, {
                id: 'history-success-created-replay',
                name: 'publication.created',
                entityId: successfulPublication,
                occurredAt: start + 1,
                payload: automaticMetadata,
            })
            await appendFact(journal, fixture, {
                id: 'history-success-claim-one',
                name: 'publication.execution.claimed',
                entityId: successfulPublication,
                occurredAt: start + 10,
                payload: executionPayload(fixture, 'job-success', 1, start),
            })
            await appendFact(journal, fixture, {
                id: 'history-success-effect-one',
                name: 'publication.execution.effect_started',
                entityId: successfulPublication,
                occurredAt: start + 100,
                payload: executionPayload(fixture, 'job-success', 1, start, {
                    effectStartedAt: start + 100,
                    toState: 'publishing',
                }),
            })
            await appendFact(journal, fixture, {
                id: 'history-success-retry',
                name: 'publication.execution.retry_scheduled',
                entityId: successfulPublication,
                occurredAt: start + 200,
                payload: executionPayload(fixture, 'job-success', 1, start, {
                    fromState: 'publishing',
                    toState: 'ready',
                    retryAt: start + 500,
                }),
            })
            await appendFact(journal, fixture, {
                id: 'history-success-claim-two',
                name: 'publication.execution.claimed',
                entityId: successfulPublication,
                occurredAt: start + 510,
                payload: executionPayload(fixture, 'job-success', 2, start + 500),
            })
            await appendFact(journal, fixture, {
                id: 'history-success-effect-two',
                name: 'publication.execution.effect_started',
                entityId: successfulPublication,
                occurredAt: start + 520,
                payload: executionPayload(fixture, 'job-success', 2, start + 500, {
                    effectStartedAt: start + 520,
                    toState: 'publishing',
                }),
            })
            await appendFact(journal, fixture, {
                id: 'history-success-effect-two-replay',
                name: 'publication.execution.effect_started',
                entityId: successfulPublication,
                occurredAt: start + 521,
                payload: executionPayload(fixture, 'job-success', 2, start + 500),
            })
            await appendFact(journal, fixture, {
                id: 'history-success-succeeded',
                name: 'publication.execution.succeeded',
                entityId: successfulPublication,
                occurredAt: start + 620,
                payload: executionPayload(fixture, 'job-success', 2, start + 500, {
                    fromState: 'publishing',
                    toState: 'published',
                }),
            })
            await appendFact(journal, fixture, {
                id: 'history-success-succeeded-replay',
                name: 'publication.execution.succeeded',
                entityId: successfulPublication,
                occurredAt: start + 621,
                payload: executionPayload(fixture, 'job-success', 2, start + 500),
            })

            const appendAutomaticOutcome = async (
                idPrefix: string,
                publicationId: string,
                jobId: string,
                action: string,
                effectAt: number,
                outcomeAt: number,
                extra: Readonly<Record<string, unknown>> = {}
            ) => {
                await appendFact(journal, fixture, {
                    id: idPrefix + '-created',
                    name: 'publication.created',
                    entityId: publicationId,
                    occurredAt: start,
                    payload: automaticMetadata,
                })
                await appendFact(journal, fixture, {
                    id: idPrefix + '-claim',
                    name: 'publication.execution.claimed',
                    entityId: publicationId,
                    occurredAt: effectAt - 10,
                    payload: executionPayload(fixture, jobId, 1, start),
                })
                await appendFact(journal, fixture, {
                    id: idPrefix + '-effect',
                    name: 'publication.execution.effect_started',
                    entityId: publicationId,
                    occurredAt: effectAt,
                    payload: executionPayload(fixture, jobId, 1, start, {
                        effectStartedAt: effectAt,
                        toState: 'publishing',
                    }),
                })
                const outcomePayload: Record<string, unknown> = {
                    ...executionPayload(fixture, jobId, 1, start, {
                        ...extra,
                    }),
                }
                if (action === 'publication.execution.failed') {
                    outcomePayload.toState = 'failed'
                } else if (
                    action === 'publication.execution.ambiguous' ||
                    action === 'publication.execution.ambiguity_recovered'
                ) {
                    outcomePayload.toState = 'ambiguous'
                }
                await appendFact(journal, fixture, {
                    id: idPrefix + '-outcome',
                    name: action,
                    entityId: publicationId,
                    occurredAt: outcomeAt,
                    payload: outcomePayload,
                })
            }

            await appendAutomaticOutcome(
                'history-direct-ambiguous',
                directAmbiguousPublication,
                'job-direct-ambiguous',
                'publication.execution.ambiguous',
                start + 300,
                start + 400
            )
            await appendAutomaticOutcome(
                'history-recovered',
                recoveredPublication,
                'job-recovered',
                'publication.execution.ambiguity_recovered',
                start + 500,
                start + 600
            )
            await appendFact(journal, fixture, {
                id: 'history-claim-recovered-created',
                name: 'publication.created',
                entityId: recoveredClaimPublication,
                occurredAt: start,
                payload: automaticMetadata,
            })
            await appendFact(journal, fixture, {
                id: 'history-claim-recovered-claim',
                name: 'publication.execution.claimed',
                entityId: recoveredClaimPublication,
                occurredAt: start + 700,
                payload: executionPayload(fixture, 'job-claim-recovered', 1, start),
            })
            await appendFact(journal, fixture, {
                id: 'history-claim-recovered-recovery',
                name: 'publication.execution.claim_recovered',
                entityId: recoveredClaimPublication,
                occurredAt: start + 800,
                payload: executionPayload(fixture, 'job-claim-recovered', 1, start, {
                    fromState: 'running',
                    toState: 'pending',
                }),
            })
            await appendAutomaticOutcome(
                'history-failed',
                failedPublication,
                'job-failed',
                'publication.execution.failed',
                start + 900,
                start + 1_000
            )
            await appendFact(journal, fixture, {
                id: 'history-cancelled-created',
                name: 'publication.created',
                entityId: cancelledPublication,
                occurredAt: start,
                payload: automaticMetadata,
            })
            await appendFact(journal, fixture, {
                id: 'history-cancelled',
                name: 'publication.execution.cancelled',
                entityId: cancelledPublication,
                occurredAt: start + 1_100,
                payload: executionPayload(fixture, 'job-cancelled', 1, start, {
                    toState: 'cancelled',
                }),
            })
            await appendFact(journal, fixture, {
                id: 'history-contradictory-success',
                name: 'publication.execution.succeeded',
                entityId: 'history-contradictory-publication',
                occurredAt: start + 1_150,
                payload: executionPayload(fixture, 'job-contradictory', 1, start),
            })
            await appendFact(journal, fixture, {
                id: 'history-contradictory-failure',
                name: 'publication.execution.failed',
                entityId: 'history-contradictory-publication',
                occurredAt: start + 1_160,
                payload: executionPayload(fixture, 'job-contradictory', 1, start),
            })
            await appendFact(journal, fixture, {
                id: 'history-unknown-version',
                name: 'publication.created',
                entityId: 'unknown-version-publication',
                occurredAt: start + 1_200,
                version: 2,
                payload: automaticMetadata,
            })
            await appendFact(journal, fixture, {
                id: 'history-known-unsupported',
                name: 'publication.analytics.unhandled',
                entityId: unknownPublication,
                occurredAt: start + 1_250,
                payload: automaticMetadata,
            })
            await appendFact(journal, fixture, {
                id: 'history-missing-attempt',
                name: 'publication.execution.effect_started',
                entityId: unknownPublication,
                occurredAt: start + 1_400,
                payload: { deliveryMode: 'automatic', provider: 'analytics-provider' },
            })
            await appendFact(journal, fixture, {
                id: 'history-missing-dimension',
                name: 'publication.created',
                entityId: unknownPublication,
                occurredAt: start + 1_500,
                payload: { state: 'draft' },
            })

            const analytics = await createAnalyticsStore(fixture.database, {
                now: () => observedAt,
            }).getProjectAnalytics({
                projectId: fixture.project.project.id,
                subjectId: 'user-1',
                from: start,
                to: observedAt,
            })
            if (analytics === null) throw new Error('The authorized analytics response is missing')

            expect(analytics.historical.publications.created).toBe(8)
            expect(analytics.historical.publications.published).toBe(2)
            expect(analytics.historical.publications.failed).toBe(1)
            expect(analytics.historical.publications.ambiguous).toBe(2)
            expect(analytics.historical.executions).toMatchObject({
                claimed: 6,
                attempts: 5,
                succeeded: 1,
                failed: 1,
                retryable: 1,
                ambiguous: 2,
                directAmbiguous: 1,
                claimRecoveries: 1,
                ambiguityRecoveries: 1,
                cancelled: 1,
            })
            expect(analytics.historical.retries).toEqual({
                scheduled: 1,
                rate: 1 / 5,
                attemptsPerPublication: 5 / 4,
            })
            expect(analytics.historical.latency.effectDuration).toEqual({
                count: 5,
                totalMs: 500,
                minMs: 100,
                maxMs: 100,
                averageMs: 100,
            })
            expect(analytics.historical.latency.queueDelay).toEqual({
                count: 5,
                totalMs: 1_820,
                minMs: 20,
                maxMs: 900,
                averageMs: 364,
            })
            expect(analytics.historical.latency.manualCompletion).toEqual({
                count: 1,
                totalMs: 80,
                minMs: 80,
                maxMs: 80,
                averageMs: 80,
            })
            expect(analytics.historical.latency.scheduledToOutcome).toEqual({
                count: 4,
                totalMs: 2_120,
                minMs: 120,
                maxMs: 1_000,
                averageMs: 530,
            })
            expect(analytics.coverage.dataQuality).toMatchObject({
                unknownEventVersions: 1,
                unsupportedFacts: 1,
                missingLifecycleState: 1,
                missingAttemptMetadata: 1,
                duplicateAttemptFacts: 2,
                contradictoryAttempts: 1,
            })
            expect(analytics.coverage.skippedFactCount).toBe(3)
            expect(analytics.coverage.dataQuality.missingHistoricalDimensions).toBeGreaterThan(0)
            expect(analytics.historical.executions.byDimension.succeeded).toEqual([
                expect.objectContaining({
                    channelId: fixture.automaticChannel.id,
                    provider: 'analytics-provider',
                    deliveryMode: 'automatic',
                    count: 1,
                }),
            ])
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('uses half-open bounded ranges and project-timezone DST buckets', async () => {
        const observedAt = Date.UTC(2026, 2, 30)
        const fixture = await createFixture('Europe/Paris', observedAt - dayMs)

        try {
            const journal = createEventJournalStore(fixture.database)
            const from = Date.UTC(2026, 2, 28, 23, 30)
            const boundary = Date.UTC(2026, 2, 29, 1, 30)
            const afterBoundary = Date.UTC(2026, 2, 29, 22, 30)
            await appendFact(journal, fixture, {
                id: 'dst-inclusive',
                name: 'publication.created',
                entityId: 'dst-inclusive-publication',
                occurredAt: from,
                payload: {
                    channelId: fixture.manualChannel.id,
                    deliveryMode: 'manual',
                    provider: 'manual',
                    state: 'draft',
                },
            })
            await appendFact(journal, fixture, {
                id: 'dst-exclusive',
                name: 'publication.created',
                entityId: 'dst-exclusive-publication',
                occurredAt: boundary,
                payload: {
                    channelId: fixture.manualChannel.id,
                    deliveryMode: 'manual',
                    provider: 'manual',
                    state: 'draft',
                },
            })
            await appendFact(journal, fixture, {
                id: 'dst-next-day',
                name: 'publication.created',
                entityId: 'dst-next-day-publication',
                occurredAt: afterBoundary,
                payload: {
                    channelId: fixture.manualChannel.id,
                    deliveryMode: 'manual',
                    provider: 'manual',
                    state: 'draft',
                },
            })

            const analyticsStore = createAnalyticsStore(fixture.database, {
                now: () => observedAt,
            })
            const analytics = await analyticsStore.getProjectAnalytics({
                projectId: fixture.project.project.id,
                subjectId: 'user-1',
                from,
                to: afterBoundary,
            })
            if (analytics === null) throw new Error('The authorized analytics response is missing')

            expect(analytics.historical.publications.created).toBe(2)
            expect(analytics.historical.buckets).toHaveLength(1)
            const bucket = analytics.historical.buckets[0]
            if (bucket === undefined) throw new Error('The DST bucket is missing')
            expect(bucket).toMatchObject({
                bucketDate: '2026-03-29',
                bucketStartUtc: Date.UTC(2026, 2, 28, 23),
                bucketEndUtc: Date.UTC(2026, 2, 29, 22),
                metrics: { publicationsCreated: 2 },
            })
            expect(bucket.bucketEndUtc - bucket.bucketStartUtc).toBe(23 * 60 * 60 * 1_000)
            expect(
                (
                    await analyticsStore.getProjectAnalytics({
                        projectId: fixture.project.project.id,
                        subjectId: 'user-1',
                        from,
                        to: boundary,
                    })
                )?.historical.publications.created
            ).toBe(1)
            expect(
                (
                    await analyticsStore.getProjectAnalytics({
                        projectId: fixture.project.project.id,
                        subjectId: 'user-1',
                    })
                )?.range
            ).toEqual({
                from: observedAt - 30 * dayMs,
                to: observedAt,
            })
            await expect(
                analyticsStore.getProjectAnalytics({
                    projectId: fixture.project.project.id,
                    subjectId: 'user-1',
                    from: observedAt - 366 * dayMs - 1,
                    to: observedAt,
                })
            ).rejects.toThrow(DomainInvariantError)
            await expect(
                analyticsStore.getProjectAnalytics({
                    projectId: fixture.project.project.id,
                    subjectId: 'user-1',
                    from: observedAt,
                    to: observedAt + 1,
                })
            ).rejects.toThrow(DomainInvariantError)
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('authorizes before project reads and isolates project-scoped facts and filters', async () => {
        const observedAt = Date.UTC(2026, 0, 2)
        const first = await createFixture('UTC', observedAt - dayMs, 'first')
        const second = await createFixture('UTC', observedAt - dayMs, 'second')

        try {
            const firstJournal = createEventJournalStore(first.database)
            await appendFact(firstJournal, first, {
                id: 'first-project-fact',
                name: 'publication.created',
                entityId: 'first-publication',
                occurredAt: observedAt - 1,
                payload: {
                    channelId: first.automaticChannel.id,
                    deliveryMode: 'automatic',
                    provider: 'analytics-provider',
                    state: 'draft',
                },
            })
            const secondJournal = createEventJournalStore(second.database)
            await appendFact(secondJournal, second, {
                id: 'second-project-fact',
                name: 'publication.created',
                entityId: 'second-publication',
                occurredAt: observedAt - 1,
                payload: {
                    channelId: second.automaticChannel.id,
                    deliveryMode: 'automatic',
                    provider: 'analytics-provider',
                    state: 'draft',
                },
            })

            const firstAnalytics = createAnalyticsStore(first.database, {
                now: () => observedAt,
            })
            expect(
                (
                    await firstAnalytics.getProjectAnalytics({
                        projectId: first.project.project.id,
                        subjectId: 'user-1',
                        from: observedAt - dayMs,
                        to: observedAt,
                        provider: 'analytics-provider',
                        channelId: first.automaticChannel.id,
                    })
                )?.historical.publications.created
            ).toBe(1)
            expect(
                (
                    await firstAnalytics.getProjectAnalytics({
                        projectId: first.project.project.id,
                        subjectId: 'user-1',
                        from: observedAt - dayMs,
                        to: observedAt,
                        channelId: second.automaticChannel.id,
                    })
                )?.historical.publications.created
            ).toBe(0)
            expect(
                await firstAnalytics.getProjectAnalytics({
                    projectId: first.project.project.id,
                    subjectId: 'other-user',
                })
            ).toBeNull()
        } finally {
            closeDatabase(first.database)
            closeDatabase(second.database)
        }
    })

    it('returns an empty, typed response for an authorized project with no matching data', async () => {
        const observedAt = Date.UTC(2026, 0, 2)
        const fixture = await createFixture('UTC', observedAt - dayMs)

        try {
            const analytics = await createAnalyticsStore(fixture.database, {
                now: () => observedAt,
            }).getProjectAnalytics({
                projectId: fixture.project.project.id,
                subjectId: 'user-1',
                from: observedAt - dayMs,
                to: observedAt,
                provider: 'not-configured',
            })
            if (analytics === null) throw new Error('The authorized analytics response is missing')

            expect(analytics.current.publications.total).toBe(0)
            expect(analytics.current.executions).toEqual({
                scheduled: 0,
                due: 0,
                running: 0,
                retryablePending: 0,
                succeeded: 0,
                failed: 0,
                ambiguous: 0,
            })
            expect(analytics.current.workload).toEqual({
                manualDue: 0,
                ambiguousReconciliation: 0,
                oldestDueAt: null,
                nextRunAt: null,
                futureScheduled: 0,
                overdue: 0,
            })
            expect(analytics.historical.publications.created).toBe(0)
            expect(analytics.historical.latency.queueDelay).toBeNull()
            expect(analytics.historical.latency.effectDuration).toBeNull()
            expect(analytics.coverage.dataQuality.unknownEventVersions).toBe(0)
        } finally {
            closeDatabase(fixture.database)
        }
    })
})
