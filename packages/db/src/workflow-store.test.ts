import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    createExponentialRetryPolicy,
    NextEventScheduler,
    processNextWorkflowEvent,
} from '@postdot/core'
import { eq } from 'drizzle-orm'

import type { PostbotDatabase } from './client'
import { closeDatabase, createDatabase } from './client'
import { runMigrations } from './migrations'
import { createResourceLifecycleStore } from './resource-lifecycle-store'
import {
    auditEvents,
    actors,
    channelProfileVersions,
    jobs,
    posts,
    projects,
    publicationExecutionRevisions,
    publicationTargetRevisions,
    publications,
    publishers,
} from './schema'
import { seedWorkspaceChannel, workspaceOf } from './testing'
import { createWorkflowStore } from './workflow-store'

const dueAt = 1_800_000_000_000

function executionAuditEvents(database: PostbotDatabase, publicationId: string) {
    return database
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, publicationId))
        .all()
        .filter(event => event.action.startsWith('publication.execution.'))
}

function executionAuditActions(database: PostbotDatabase, publicationId: string) {
    return executionAuditEvents(database, publicationId).map(event => event.action)
}

function executionAuditMetadata(database: PostbotDatabase, publicationId: string) {
    return executionAuditEvents(database, publicationId).map(event =>
        JSON.parse(event.metadataJson!)
    )
}

const testProfile = {
    id: 'workflow-test',
    version: 1,
    profileHash: 'sha256:workflow-test-profile-v1',
    schemaHash: 'sha256:workflow-test-schema-v1',
    origin: 'built_in' as const,
    contentSchema: {
        type: 'object' as const,
        properties: { body: { type: 'string' as const, minLength: 1 } },
        required: ['body'],
        additionalProperties: false,
    },
    fieldBindings: [{ id: 'body', semantic: 'primary_text' as const, path: '/body' }],
    capabilities: {
        revision: 'workflow-test-v1',
        textFields: [
            {
                bindingId: 'body',
                acceptedSourceFormats: ['plain_text' as const],
                maxLength: 10_000,
            },
        ],
        mediaFields: [],
        relations: [],
    },
    execution: { kind: 'built_in' as const, contractId: 'test', revision: 'v1' },
}

function seedDueJob(database: PostbotDatabase, suffix = 'one') {
    const projectId = `project-${suffix}`
    const humanActorId = `human-${suffix}`
    const systemActorId = `system-${suffix}`
    const channelId = `channel-${suffix}`
    const postId = `post-${suffix}`
    const publicationId = `publication-${suffix}`
    const jobId = `job-${suffix}`
    const profileVersionId = `profile-${suffix}`
    const targetRevisionId = `target-${suffix}`

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
    seedWorkspaceChannel(database, {
        projectId,
        channelId: channelId,
        name: `Channel ${suffix}`,
        profileVersionId,
        profile: testProfile,
        createdByActorId: humanActorId,
    })
    database
        .insert(publishers)
        .values({
            id: `publisher-${suffix}`,
            workspaceId: workspaceOf(database, projectId),
            channelId,
            kind: 'test',
        })
        .run()
    database
        .insert(posts)
        .values({
            id: postId,
            projectId,
            sourceContent: {
                body: { text: `Post ${suffix}`, format: 'plain_text' },
                media: [],
            },
            sourceRevision: 1,
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
            targetRevisionId,
            deliveryMode: 'automatic',
            reviewState: 'compatible',
            state: 'scheduled',
            scheduledAt: dueAt,
            createdByActorId: humanActorId,
            scheduledByActorId: humanActorId,
            stateChangedByActorId: humanActorId,
        })
        .run()
    database
        .insert(publicationTargetRevisions)
        .values({
            id: targetRevisionId,
            projectId,
            publicationId,
            sequence: 1,
            profileVersionId,
            sourceRevision: 1,
            deliveryMode: 'automatic',
            contentJson: { body: `Publication ${suffix}` },
            contentHash: `sha256:target-${suffix}`,
            profileHash: testProfile.profileHash,
            schemaHash: testProfile.schemaHash,
            validationIssuesJson: [],
            createdByActorId: humanActorId,
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
        profileVersionId,
        targetRevisionId,
    }
}

describe('workflow store', () => {
    it('renews only the current unexpired claim without shortening or resurrecting its lease', () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const fixture = seedDueJob(database)
            const store = createWorkflowStore(database)
            store.claimNextDueJob({
                actorId: fixture.systemActorId,
                claimToken: 'owner',
                now: dueAt,
                leaseExpiresAt: dueAt + 90,
            })
            const renew = (token: string, now: number, leaseExpiresAt: number) =>
                store.renewClaim({ jobId: fixture.jobId, claimToken: token, now, leaseExpiresAt })
            expect(renew('stale', dueAt + 30, dueAt + 120)).toBe(false)
            expect(renew('owner', dueAt + 30, dueAt + 60)).toBe(false)
            expect(renew('owner', dueAt + 30, dueAt + 120)).toBe(true)
            expect(store.startExternalEffect(fixture.jobId, 'owner', dueAt + 100)).toBe(true)
            expect(renew('owner', dueAt + 120, dueAt + 210)).toBe(false)
            expect(store.recoverExpiredClaims(dueAt + 120).ambiguousJobIds).toEqual([fixture.jobId])
            expect(renew('owner', dueAt + 121, dueAt + 211)).toBe(false)
            expect(
                store.completeExternalEffect({
                    jobId: fixture.jobId,
                    claimToken: 'owner',
                    completedAt: dueAt + 121,
                    outcome: { type: 'published' },
                })
            ).toBeNull()
        } finally {
            closeDatabase(database)
        }
    })

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

    it('does not wake or claim work for a disabled target profile', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const fixture = seedDueJob(database, 'disabled')
            database
                .update(channelProfileVersions)
                .set({ state: 'disabled' })
                .where(eq(channelProfileVersions.id, fixture.profileVersionId))
                .run()

            const store = createWorkflowStore(database)
            expect(store.getNextEventAt()).toBeNull()
            expect(
                store.claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'claim-disabled',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).toBeNull()
        } finally {
            closeDatabase(database)
        }
    })

    it('fails closed when a target profile is disabled after claiming and before the effect boundary', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const fixture = seedDueJob(database, 'disabled-after-claim')
            const store = createWorkflowStore(database)
            expect(
                store.claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'claim-disabled-after-claim',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).not.toBeNull()

            database
                .update(channelProfileVersions)
                .set({ state: 'disabled' })
                .where(eq(channelProfileVersions.id, fixture.profileVersionId))
                .run()

            expect(
                store.startExternalEffect(fixture.jobId, 'claim-disabled-after-claim', dueAt + 1)
            ).toBe(false)
            expect(
                database.$client.query('select state from jobs where id = ?').get(fixture.jobId)
            ).toEqual({ state: 'cancelled' })
            expect(
                database.$client
                    .query('select review_state from publications where id = ?')
                    .get(fixture.publicationId)
            ).toEqual({ review_state: 'review_required' })
            expect(
                database
                    .select()
                    .from(publicationExecutionRevisions)
                    .where(eq(publicationExecutionRevisions.jobId, fixture.jobId))
                    .all()
            ).toEqual([])
            expect(database.select().from(jobs).where(eq(jobs.id, fixture.jobId)).all()).toEqual([
                expect.objectContaining({ state: 'cancelled', effectStartedAt: null }),
            ])
            expect(
                database
                    .select()
                    .from(publications)
                    .where(eq(publications.id, fixture.publicationId))
                    .all()
            ).toEqual([expect.objectContaining({ state: 'scheduled' })])
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
            expect(executionAuditActions(database, fixture.publicationId)).toEqual([
                'publication.execution.claimed',
                'publication.execution.effect_started',
            ])
            expect(executionAuditMetadata(database, fixture.publicationId)).toEqual([
                {
                    fromState: 'pending',
                    toState: 'running',
                    leaseExpiresAt: dueAt + 60_000,
                    deliveryMode: 'automatic',
                    provider: 'test',
                    jobId: fixture.jobId,
                    attempt: 1,
                    occurredAt: dueAt,
                    runAt: dueAt,
                },
                {
                    fromState: 'scheduled',
                    toState: 'publishing',
                    effectStartedAt: dueAt + 1,
                    deliveryMode: 'automatic',
                    provider: 'test',
                    jobId: fixture.jobId,
                    attempt: 1,
                    occurredAt: dueAt + 1,
                    runAt: dueAt,
                },
            ])
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
            expect(executionAuditActions(database, fixture.publicationId)).toEqual([
                'publication.execution.claimed',
                'publication.execution.claim_recovered',
            ])
            expect(executionAuditMetadata(database, fixture.publicationId)[1]).toMatchObject({
                fromState: 'running',
                toState: 'pending',
                recoveredAt: dueAt + 60_000,
                runAt: dueAt + 60_000,
                reason: 'lease_expired_before_effect_boundary',
                jobId: fixture.jobId,
                attempt: 1,
            })
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
            expect(executionAuditActions(database, fixture.publicationId)).toEqual([
                'publication.execution.claimed',
                'publication.execution.effect_started',
                'publication.execution.ambiguity_recovered',
            ])
            expect(executionAuditMetadata(database, fixture.publicationId)[2]).toMatchObject({
                fromState: 'publishing',
                toState: 'ambiguous',
                recoveredAt: dueAt + 60_000,
                reason: 'lease_expired_after_effect_boundary',
                errorMessage: 'Worker claim expired after the external-effect boundary',
                jobId: fixture.jobId,
                attempt: 1,
            })
            expect(database.$client.query('pragma foreign_key_check').all()).toEqual([])
        } finally {
            closeDatabase(database)
        }
    })

    it('fails closed when the persisted media index disagrees with the target revision', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const fixture = seedDueJob(database, 'media-mismatch')
            database
                .update(publicationTargetRevisions)
                .set({ mediaReferenceCount: 1 })
                .where(eq(publicationTargetRevisions.id, fixture.targetRevisionId))
                .run()
            const store = createWorkflowStore(database)
            store.claimNextDueJob({
                actorId: fixture.systemActorId,
                claimToken: 'claim-media-mismatch',
                now: dueAt,
                leaseExpiresAt: dueAt + 60_000,
            })

            expect(() =>
                store.startExternalEffect(fixture.jobId, 'claim-media-mismatch', dueAt + 1)
            ).toThrow('inconsistent media reference counts')
            expect(
                database
                    .select()
                    .from(publicationExecutionRevisions)
                    .where(eq(publicationExecutionRevisions.jobId, fixture.jobId))
                    .all()
            ).toEqual([])
            const [job] = database.select().from(jobs).where(eq(jobs.id, fixture.jobId)).all()
            const [publication] = database
                .select()
                .from(publications)
                .where(eq(publications.id, fixture.publicationId))
                .all()
            expect(job?.state).toBe('running')
            expect(job?.effectStartedAt).toBeNull()
            expect(publication?.state).toBe('scheduled')
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
            expect(executionAuditActions(database, fixture.publicationId)).toEqual([
                'publication.execution.claimed',
                'publication.execution.effect_started',
                'publication.execution.succeeded',
            ])
            expect(executionAuditMetadata(database, fixture.publicationId)[2]).toMatchObject({
                fromState: 'publishing',
                toState: 'published',
                outcome: 'published',
                completedAt: dueAt + 2,
                effectStartedAt: dueAt + 1,
                externalId: 'remote-success',
                externalUrl: 'https://example.com/remote-success',
                jobId: fixture.jobId,
                attempt: 1,
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('rolls back execution transitions when their audit event cannot be persisted', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const fixture = seedDueJob(database, 'audit-rollback')
            const store = createWorkflowStore(database)

            database.$client.run(`
                create temp trigger fail_workflow_claim_audit
                before insert on audit_events
                when NEW.action = 'publication.execution.claimed'
                begin
                    select raise(abort, 'workflow claim audit failure');
                end
            `)

            expect(() =>
                store.claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'claim-audit-rollback',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).toThrow('workflow claim audit failure')
            const [unclaimedJob] = database
                .select()
                .from(jobs)
                .where(eq(jobs.id, fixture.jobId))
                .all()
            expect(unclaimedJob?.state).toBe('pending')
            expect(unclaimedJob?.attempts).toBe(0)
            expect(executionAuditEvents(database, fixture.publicationId)).toEqual([])

            database.$client.run('drop trigger fail_workflow_claim_audit')
            expect(
                store.claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'claim-audit-rollback',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).not.toBeNull()
            expect(
                store.startExternalEffect(fixture.jobId, 'claim-audit-rollback', dueAt + 1)
            ).toBe(true)

            database.$client.run(`
                create temp trigger fail_workflow_completion_audit
                before insert on audit_events
                when NEW.action = 'publication.execution.succeeded'
                begin
                    select raise(abort, 'workflow completion audit failure');
                end
            `)

            expect(() =>
                store.completeExternalEffect({
                    jobId: fixture.jobId,
                    claimToken: 'claim-audit-rollback',
                    completedAt: dueAt + 2,
                    outcome: { type: 'published' },
                })
            ).toThrow('workflow completion audit failure')

            const [runningJob] = database
                .select()
                .from(jobs)
                .where(eq(jobs.id, fixture.jobId))
                .all()
            const [publishingPublication] = database
                .select()
                .from(publications)
                .where(eq(publications.id, fixture.publicationId))
                .all()
            expect(runningJob?.state).toBe('running')
            expect(runningJob?.effectStartedAt).toBe(dueAt + 1)
            expect(publishingPublication?.state).toBe('publishing')
            expect(executionAuditActions(database, fixture.publicationId)).toEqual([
                'publication.execution.claimed',
                'publication.execution.effect_started',
            ])
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

            database
                .insert(publicationTargetRevisions)
                .values({
                    id: 'replacement-target-retry',
                    projectId: fixture.projectId,
                    publicationId: fixture.publicationId,
                    sequence: 2,
                    profileVersionId: fixture.profileVersionId,
                    sourceRevision: 1,
                    deliveryMode: 'automatic',
                    contentJson: { body: 'Replacement target must not be retried' },
                    contentHash: 'sha256:replacement-target',
                    profileHash: testProfile.profileHash,
                    schemaHash: testProfile.schemaHash,
                    validationIssuesJson: [],
                    createdByActorId: fixture.humanActorId,
                })
                .run()
            database
                .update(publications)
                .set({ targetRevisionId: 'replacement-target-retry' })
                .where(eq(publications.id, fixture.publicationId))
                .run()

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
            expect(executionAuditActions(database, fixture.publicationId)).toEqual([
                'publication.execution.claimed',
                'publication.execution.effect_started',
                'publication.execution.retry_scheduled',
                'publication.execution.claimed',
                'publication.execution.effect_started',
                'publication.execution.failed',
            ])
            expect(
                executionAuditEvents(database, fixture.publicationId).every(
                    event => event.eventVersion === 1 && event.correlationId === fixture.jobId
                )
            ).toBe(true)
            const retryAuditMetadata = executionAuditMetadata(database, fixture.publicationId)
            expect(retryAuditMetadata[2]).toMatchObject({
                outcome: 'retryable_failure',
                effectOccurred: false,
                errorMessage: 'Provider rejected the request before accepting it',
                retryAt: dueAt + 1_000,
                attempt: 1,
            })
            expect(retryAuditMetadata[5]).toMatchObject({
                outcome: 'retryable_failure',
                effectOccurred: false,
                errorMessage: 'Provider rejected the request before accepting it',
                attempt: 2,
                toState: 'failed',
            })
            expect(
                database.$client
                    .query<{ targetRevisionId: string; contentJson: string }, []>(
                        `select target_revision_id as targetRevisionId, content_json as contentJson
                         from publication_execution_revisions`
                    )
                    .all()
            ).toEqual([
                {
                    targetRevisionId: fixture.targetRevisionId,
                    contentJson: JSON.stringify({ body: `Publication retry` }),
                },
            ])
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
            expect(executionAuditActions(database, fixture.publicationId)).toEqual([
                'publication.execution.claimed',
                'publication.execution.effect_started',
                'publication.execution.ambiguous',
            ])
            expect(executionAuditMetadata(database, fixture.publicationId)[2]).toMatchObject({
                outcome: 'ambiguous',
                toState: 'ambiguous',
                errorMessage: 'External effect threw after its durable boundary: response lost',
                attempt: 1,
            })
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
            expect(executionAuditActions(database, pending.publicationId)).toEqual([
                'publication.execution.cancelled',
            ])
            expect(executionAuditActions(database, running.publicationId)).toEqual([
                'publication.execution.claimed',
                'publication.execution.effect_started',
            ])
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
        const directory = mkdtempSync(join(tmpdir(), 'postbot-workflow-'))
        const filename = join(directory, 'postbot.sqlite')
        const firstDatabase = createDatabase(filename)
        let secondDatabase: PostbotDatabase | undefined

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
        const directory = mkdtempSync(join(tmpdir(), 'postbot-restart-'))
        const filename = join(directory, 'postbot.sqlite')
        const firstDatabase = createDatabase(filename)
        let firstDatabaseOpen = true
        let reopenedDatabase: PostbotDatabase | undefined

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

describe('project retirement effect fencing', () => {
    it('cancels an owned pre-effect claim before it can cross the network boundary', () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const fixture = seedDueJob(database)
            const workflow = createWorkflowStore(database)
            expect(
                workflow.claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'owner',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).not.toBeNull()
            const lifecycle = createResourceLifecycleStore(database)
            const preview = lifecycle.impact('project', fixture.projectId)!
            const archived = lifecycle.mutate({
                kind: 'project',
                id: fixture.projectId,
                action: 'archive',
                actorId: 'operator',
                fingerprint: preview.fingerprint,
                cancelPending: true,
                authorize: () => true,
            })
            expect(archived.state).toBe('archived')
            expect(workflow.startExternalEffect(fixture.jobId, 'owner', dueAt + 1)).toBe(false)
            expect(
                workflow.claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'another',
                    now: dueAt + 1,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).toBeNull()
        } finally {
            closeDatabase(database)
        }
    })
    for (const retry of [false, true])
        it(`persists an already-started ${retry ? 'retryable failure' : 'success'} before retiring`, async () => {
            const database = createDatabase(':memory:')
            try {
                runMigrations(database)
                const fixture = seedDueJob(database)
                const workflow = createWorkflowStore(database)
                workflow.claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'owner',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 60_000,
                })
                expect(workflow.startExternalEffect(fixture.jobId, 'owner', dueAt + 1)).toBe(true)
                const lifecycle = createResourceLifecycleStore(database)
                const preview = lifecycle.impact('project', fixture.projectId)!
                expect(
                    lifecycle.mutate({
                        kind: 'project',
                        id: fixture.projectId,
                        action: 'archive',
                        actorId: 'operator',
                        fingerprint: preview.fingerprint,
                        cancelPending: true,
                        authorize: () => true,
                    }).state
                ).toBe('archiving')
                expect(
                    workflow.completeExternalEffect({
                        jobId: fixture.jobId,
                        claimToken: 'owner',
                        completedAt: dueAt + 2,
                        outcome: retry
                            ? {
                                  type: 'retryable_failure',
                                  effectOccurred: false,
                                  errorMessage: 'Known rejection',
                              }
                            : { type: 'published', externalId: 'remote-post' },
                        ...(retry ? { retryAt: dueAt + 60_000 } : {}),
                    })
                ).toBe(retry ? 'retry_scheduled' : 'published')
                const storage = {
                    storeId: 'test',
                    maxObjectBytes: 1024,
                    put: async () => {
                        throw new Error('Unexpected write')
                    },
                    open: async () => null,
                    stat: async () => null,
                    delete: async () => {},
                }
                await lifecycle.reconcile(storage)
                expect(lifecycle.state('project', fixture.projectId)).toBe('archived')
                expect(database.$client.query('select state from publications').get()).toEqual({
                    state: retry ? 'cancelled' : 'published',
                })
            } finally {
                closeDatabase(database)
            }
        })
})
