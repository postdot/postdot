import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    createExponentialRetryPolicy,
    NextEventScheduler,
    processNextWorkflowEvent,
} from '@postdot/core'

import type { PostdotDatabase } from './client'
import { closeDatabase, createDatabase, type DatabaseHandle } from './client'
import { runMigrations } from './migrations'
import { createResourceLifecycleStore } from './resource-lifecycle-store'
import {
    closeTestDatabase,
    dropRejectingTrigger,
    foreignKeyViolations,
    fromDbRow,
    insertRow,
    installRejectingTrigger,
    openTestDatabase,
    seedWorkspaceChannel,
    testEngine,
    type TestRow,
    toDbValue,
    workspaceOf,
} from './testing'
import { createWorkflowStore } from './workflow-store'

const dueAt = 1_800_000_000_000

async function executionAuditEvents(database: DatabaseHandle, publicationId: string) {
    return (
        await database.sql
            .statement<TestRow>(
                'select "audit_events"."sequence" as "sequence", "audit_events"."id" as "id", "audit_events"."project_id" as "projectId", "audit_events"."workspace_id" as "workspaceId", "audit_events"."actor_id" as "actorId", "audit_events"."action" as "action", "audit_events"."entity_type" as "entityType", "audit_events"."entity_id" as "entityId", "audit_events"."metadata_json" as "metadataJson", "audit_events"."event_version" as "eventVersion", "audit_events"."correlation_id" as "correlationId", "audit_events"."causation_id" as "causationId", "audit_events"."created_at" as "createdAt" from "audit_events" where "audit_events"."entity_id" = ?1'
            )
            .all(publicationId)
    ).filter(event => event.action.startsWith('publication.execution.'))
}

async function executionAuditActions(database: DatabaseHandle, publicationId: string) {
    return (await executionAuditEvents(database, publicationId)).map(event => event.action)
}

async function executionAuditMetadata(database: DatabaseHandle, publicationId: string) {
    return (await executionAuditEvents(database, publicationId)).map(event =>
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

async function seedDueJob(database: DatabaseHandle, suffix = 'one') {
    const projectId = `project-${suffix}`
    const humanActorId = `human-${suffix}`
    const systemActorId = `system-${suffix}`
    const channelId = `channel-${suffix}`
    const postId = `post-${suffix}`
    const publicationId = `publication-${suffix}`
    const jobId = `job-${suffix}`
    const profileVersionId = `profile-${suffix}`
    const targetRevisionId = `target-${suffix}`

    await database.sql
        .statement('insert into "projects" ("id", "name") values (?1, ?2)')
        .run(projectId, `Project ${suffix}`)
    await insertRow(database, 'actors', [
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
    await seedWorkspaceChannel(database, {
        projectId,
        channelId: channelId,
        name: `Channel ${suffix}`,
        profileVersionId,
        profile: testProfile,
        createdByActorId: humanActorId,
    })
    await database.sql
        .statement(
            'insert into "publishers" ("id", "workspace_id", "channel_id", "kind") values (?1, ?2, ?3, ?4)'
        )
        .run(`publisher-${suffix}`, await workspaceOf(database, projectId), channelId, 'test')
    await database.sql
        .statement(
            'insert into "posts" ("id", "project_id", "source_content", "source_revision", "created_by_actor_id") values (?1, ?2, ?3, ?4, ?5)'
        )
        .run(
            postId,
            projectId,
            toDbValue('json', {
                body: { text: `Post ${suffix}`, format: 'plain_text' },
                media: [],
            }),
            1,
            humanActorId
        )
    await database.sql
        .statement(
            'insert into "publications" ("id", "project_id", "post_id", "channel_id", "target_revision_id", "delivery_mode", "review_state", "state", "scheduled_at", "created_by_actor_id", "scheduled_by_actor_id", "state_changed_by_actor_id") values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)'
        )
        .run(
            publicationId,
            projectId,
            postId,
            channelId,
            targetRevisionId,
            'automatic',
            'compatible',
            'scheduled',
            dueAt,
            humanActorId,
            humanActorId,
            humanActorId
        )
    await database.sql
        .statement(
            'insert into "publication_target_revisions" ("id", "project_id", "publication_id", "sequence", "profile_version_id", "source_revision", "delivery_mode", "content_json", "content_hash", "profile_hash", "schema_hash", "validation_issues_json", "created_by_actor_id") values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)'
        )
        .run(
            targetRevisionId,
            projectId,
            publicationId,
            1,
            profileVersionId,
            1,
            'automatic',
            toDbValue('json', { body: `Publication ${suffix}` }),
            `sha256:target-${suffix}`,
            testProfile.profileHash,
            testProfile.schemaHash,
            toDbValue('json', []),
            humanActorId
        )
    await database.sql
        .statement(
            'insert into "jobs" ("id", "project_id", "publication_id", "state", "run_at") values (?1, ?2, ?3, ?4, ?5)'
        )
        .run(jobId, projectId, publicationId, 'pending', dueAt)

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
    it('renews only the current unexpired claim without shortening or resurrecting its lease', async () => {
        const database = (await openTestDatabase()).database
        try {
            const fixture = await seedDueJob(database)
            const store = createWorkflowStore(database)
            await store.claimNextDueJob({
                actorId: fixture.systemActorId,
                claimToken: 'owner',
                now: dueAt,
                leaseExpiresAt: dueAt + 90,
            })
            const renew = (token: string, now: number, leaseExpiresAt: number) =>
                store.renewClaim({ jobId: fixture.jobId, claimToken: token, now, leaseExpiresAt })
            expect(await renew('stale', dueAt + 30, dueAt + 120)).toBe(false)
            expect(await renew('owner', dueAt + 30, dueAt + 60)).toBe(false)
            expect(await renew('owner', dueAt + 30, dueAt + 120)).toBe(true)
            expect(await store.startExternalEffect(fixture.jobId, 'owner', dueAt + 100)).toBe(true)
            expect(await renew('owner', dueAt + 120, dueAt + 210)).toBe(false)
            expect((await store.recoverExpiredClaims(dueAt + 120)).ambiguousJobIds).toEqual([
                fixture.jobId,
            ])
            expect(await renew('owner', dueAt + 121, dueAt + 211)).toBe(false)
            expect(
                await store.completeExternalEffect({
                    jobId: fixture.jobId,
                    claimToken: 'owner',
                    completedAt: dueAt + 121,
                    outcome: { type: 'published' },
                })
            ).toBeNull()
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('never claims work for a manual channel', async () => {
        const database = (await openTestDatabase()).database

        try {
            const fixture = await seedDueJob(database, 'manual')
            await database.sql
                .statement('delete from "publishers" where "publishers"."channel_id" = ?1')
                .run('channel-manual')

            expect(
                await createWorkflowStore(database).claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'claim-one',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).toBeNull()
            expect(await createWorkflowStore(database).getNextEventAt()).toBeNull()
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('does not wake or claim work for a disabled target profile', async () => {
        const database = (await openTestDatabase()).database

        try {
            const fixture = await seedDueJob(database, 'disabled')
            await database.sql
                .statement(
                    'update "channel_profile_versions" set "state" = ?1 where "channel_profile_versions"."id" = ?2'
                )
                .run('disabled', fixture.profileVersionId)

            const store = createWorkflowStore(database)
            expect(await store.getNextEventAt()).toBeNull()
            expect(
                await store.claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'claim-disabled',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).toBeNull()
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('fails closed when a target profile is disabled after claiming and before the effect boundary', async () => {
        const database = (await openTestDatabase()).database

        try {
            const fixture = await seedDueJob(database, 'disabled-after-claim')
            const store = createWorkflowStore(database)
            expect(
                await store.claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'claim-disabled-after-claim',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).not.toBeNull()

            await database.sql
                .statement(
                    'update "channel_profile_versions" set "state" = ?1 where "channel_profile_versions"."id" = ?2'
                )
                .run('disabled', fixture.profileVersionId)

            expect(
                await store.startExternalEffect(
                    fixture.jobId,
                    'claim-disabled-after-claim',
                    dueAt + 1
                )
            ).toBe(false)
            expect(
                await database.sql
                    .statement('select state from jobs where id = ?')
                    .get(fixture.jobId)
            ).toEqual({ state: 'cancelled' })
            expect(
                await database.sql
                    .statement('select review_state from publications where id = ?')
                    .get(fixture.publicationId)
            ).toEqual({ review_state: 'review_required' })
            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "publication_execution_revisions"."id" as "id", "publication_execution_revisions"."project_id" as "projectId", "publication_execution_revisions"."job_id" as "jobId", "publication_execution_revisions"."publication_id" as "publicationId", "publication_execution_revisions"."destination_snapshot_json" as "destinationSnapshotJson", "publication_execution_revisions"."target_revision_id" as "targetRevisionId", "publication_execution_revisions"."profile_version_id" as "profileVersionId", "publication_execution_revisions"."delivery_mode" as "deliveryMode", "publication_execution_revisions"."media_reference_count" as "mediaReferenceCount", "publication_execution_revisions"."content_json" as "contentJson", "publication_execution_revisions"."content_hash" as "contentHash", "publication_execution_revisions"."profile_hash" as "profileHash", "publication_execution_revisions"."schema_hash" as "schemaHash", "publication_execution_revisions"."created_at" as "createdAt" from "publication_execution_revisions" where "publication_execution_revisions"."job_id" = ?1'
                        )
                        .all(fixture.jobId)
                ).map(row =>
                    fromDbRow<TestRow>(row, {
                        destinationSnapshotJson: 'json',
                        contentJson: 'json',
                    })
                )
            ).toEqual([])
            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."id" = ?1'
                    )
                    .all(fixture.jobId)
            ).toEqual([expect.objectContaining({ state: 'cancelled', effectStartedAt: null })])
            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "publications"."id" as "id", "publications"."project_id" as "projectId", "publications"."post_id" as "postId", "publications"."channel_id" as "channelId", "publications"."confirmed_destination_revision" as "confirmedDestinationRevision", "publications"."target_revision_id" as "targetRevisionId", "publications"."delivery_mode" as "deliveryMode", "publications"."review_state" as "reviewState", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId", "publications"."external_url" as "externalUrl", "publications"."error_message" as "errorMessage", "publications"."created_by_actor_id" as "createdByActorId", "publications"."scheduled_by_actor_id" as "scheduledByActorId", "publications"."state_changed_by_actor_id" as "stateChangedByActorId", "publications"."published_by_actor_id" as "publishedByActorId", "publications"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publications"."profile_assessment_issues_json" as "profileAssessmentIssuesJson", "publications"."created_at" as "createdAt", "publications"."updated_at" as "updatedAt" from "publications" where "publications"."id" = ?1'
                        )
                        .all(fixture.publicationId)
                ).map(row => fromDbRow<TestRow>(row, { profileAssessmentIssuesJson: 'json' }))
            ).toEqual([expect.objectContaining({ state: 'scheduled' })])
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('claims one due job atomically and fences stale workers', async () => {
        const database = (await openTestDatabase()).database

        try {
            const fixture = await seedDueJob(database)
            const store = createWorkflowStore(database)

            expect(
                await store.claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'too-early',
                    now: dueAt - 1,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).toBeNull()
            expect(
                await store.claimNextDueJob({
                    actorId: fixture.humanActorId,
                    claimToken: 'human-claim',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).toBeNull()

            const claimed = await store.claimNextDueJob({
                actorId: fixture.systemActorId,
                claimToken: 'claim-one',
                now: dueAt,
                leaseExpiresAt: dueAt + 60_000,
            })

            expect(claimed?.state).toBe('running')
            expect(claimed?.attempts).toBe(1)
            expect(claimed?.claimedByActorId).toBe(fixture.systemActorId)
            expect(
                await store.claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'claim-two',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).toBeNull()
            expect(await store.startExternalEffect(fixture.jobId, 'stale-claim', dueAt + 1)).toBe(
                false
            )
            expect(await store.startExternalEffect(fixture.jobId, 'claim-one', dueAt + 1)).toBe(
                true
            )

            const [job] = await database.sql
                .statement<TestRow>(
                    'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."id" = ?1'
                )
                .all(fixture.jobId)
            const [publication] = (
                await database.sql
                    .statement<TestRow>(
                        'select "publications"."id" as "id", "publications"."project_id" as "projectId", "publications"."post_id" as "postId", "publications"."channel_id" as "channelId", "publications"."confirmed_destination_revision" as "confirmedDestinationRevision", "publications"."target_revision_id" as "targetRevisionId", "publications"."delivery_mode" as "deliveryMode", "publications"."review_state" as "reviewState", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId", "publications"."external_url" as "externalUrl", "publications"."error_message" as "errorMessage", "publications"."created_by_actor_id" as "createdByActorId", "publications"."scheduled_by_actor_id" as "scheduledByActorId", "publications"."state_changed_by_actor_id" as "stateChangedByActorId", "publications"."published_by_actor_id" as "publishedByActorId", "publications"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publications"."profile_assessment_issues_json" as "profileAssessmentIssuesJson", "publications"."created_at" as "createdAt", "publications"."updated_at" as "updatedAt" from "publications" where "publications"."id" = ?1'
                    )
                    .all(fixture.publicationId)
            ).map(row => fromDbRow<TestRow>(row, { profileAssessmentIssuesJson: 'json' }))
            expect(job?.effectStartedAt).toBe(dueAt + 1)
            expect(publication?.state).toBe('publishing')
            expect(publication?.stateChangedByActorId).toBe(fixture.systemActorId)
            expect(await executionAuditActions(database, fixture.publicationId)).toEqual([
                'publication.execution.claimed',
                'publication.execution.effect_started',
            ])
            expect(await executionAuditMetadata(database, fixture.publicationId)).toEqual([
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
            await closeTestDatabase(database)
        }
    })

    it('chooses the nearest pending run or running lease expiry', async () => {
        const database = (await openTestDatabase()).database

        try {
            const first = await seedDueJob(database, 'first')
            const store = createWorkflowStore(database)

            expect(await store.getNextEventAt()).toBe(dueAt)
            await store.claimNextDueJob({
                actorId: first.systemActorId,
                claimToken: 'claim-one',
                now: dueAt,
                leaseExpiresAt: dueAt + 60_000,
            })
            expect(await store.getNextEventAt()).toBe(dueAt + 60_000)

            const second = await seedDueJob(database, 'second')
            await database.sql
                .statement('update "jobs" set "run_at" = ?1 where "jobs"."id" = ?2')
                .run(dueAt + 30_000, second.jobId)
            expect(await store.getNextEventAt()).toBe(dueAt + 30_000)
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('requeues an expired claim when no external effect started', async () => {
        const database = (await openTestDatabase()).database

        try {
            const fixture = await seedDueJob(database)
            const store = createWorkflowStore(database)
            await store.claimNextDueJob({
                actorId: fixture.systemActorId,
                claimToken: 'claim-one',
                now: dueAt,
                leaseExpiresAt: dueAt + 60_000,
            })

            expect(await store.recoverExpiredClaims(dueAt + 60_000)).toEqual({
                requeuedJobIds: [fixture.jobId],
                ambiguousJobIds: [],
            })

            const [job] = await database.sql
                .statement<TestRow>(
                    'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."id" = ?1'
                )
                .all(fixture.jobId)
            const [publication] = (
                await database.sql
                    .statement<TestRow>(
                        'select "publications"."id" as "id", "publications"."project_id" as "projectId", "publications"."post_id" as "postId", "publications"."channel_id" as "channelId", "publications"."confirmed_destination_revision" as "confirmedDestinationRevision", "publications"."target_revision_id" as "targetRevisionId", "publications"."delivery_mode" as "deliveryMode", "publications"."review_state" as "reviewState", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId", "publications"."external_url" as "externalUrl", "publications"."error_message" as "errorMessage", "publications"."created_by_actor_id" as "createdByActorId", "publications"."scheduled_by_actor_id" as "scheduledByActorId", "publications"."state_changed_by_actor_id" as "stateChangedByActorId", "publications"."published_by_actor_id" as "publishedByActorId", "publications"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publications"."profile_assessment_issues_json" as "profileAssessmentIssuesJson", "publications"."created_at" as "createdAt", "publications"."updated_at" as "updatedAt" from "publications" where "publications"."id" = ?1'
                    )
                    .all(fixture.publicationId)
            ).map(row => fromDbRow<TestRow>(row, { profileAssessmentIssuesJson: 'json' }))
            expect(job?.state).toBe('pending')
            expect(job?.attempts).toBe(1)
            expect(job?.claimToken).toBeNull()
            expect(job?.runAt).toBe(dueAt + 60_000)
            expect(publication?.state).toBe('scheduled')
            expect(await executionAuditActions(database, fixture.publicationId)).toEqual([
                'publication.execution.claimed',
                'publication.execution.claim_recovered',
            ])
            expect(
                (await executionAuditMetadata(database, fixture.publicationId))[1]
            ).toMatchObject({
                fromState: 'running',
                toState: 'pending',
                recoveredAt: dueAt + 60_000,
                runAt: dueAt + 60_000,
                reason: 'lease_expired_before_effect_boundary',
                jobId: fixture.jobId,
                attempt: 1,
            })
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('marks the publication ambiguous after an expired effect boundary', async () => {
        const database = (await openTestDatabase()).database

        try {
            const fixture = await seedDueJob(database)
            const store = createWorkflowStore(database)
            await store.claimNextDueJob({
                actorId: fixture.systemActorId,
                claimToken: 'claim-one',
                now: dueAt,
                leaseExpiresAt: dueAt + 60_000,
            })
            await store.startExternalEffect(fixture.jobId, 'claim-one', dueAt + 1)

            expect(await store.recoverExpiredClaims(dueAt + 60_000)).toEqual({
                requeuedJobIds: [],
                ambiguousJobIds: [fixture.jobId],
            })

            const [job] = await database.sql
                .statement<TestRow>(
                    'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."id" = ?1'
                )
                .all(fixture.jobId)
            const [publication] = (
                await database.sql
                    .statement<TestRow>(
                        'select "publications"."id" as "id", "publications"."project_id" as "projectId", "publications"."post_id" as "postId", "publications"."channel_id" as "channelId", "publications"."confirmed_destination_revision" as "confirmedDestinationRevision", "publications"."target_revision_id" as "targetRevisionId", "publications"."delivery_mode" as "deliveryMode", "publications"."review_state" as "reviewState", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId", "publications"."external_url" as "externalUrl", "publications"."error_message" as "errorMessage", "publications"."created_by_actor_id" as "createdByActorId", "publications"."scheduled_by_actor_id" as "scheduledByActorId", "publications"."state_changed_by_actor_id" as "stateChangedByActorId", "publications"."published_by_actor_id" as "publishedByActorId", "publications"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publications"."profile_assessment_issues_json" as "profileAssessmentIssuesJson", "publications"."created_at" as "createdAt", "publications"."updated_at" as "updatedAt" from "publications" where "publications"."id" = ?1'
                    )
                    .all(fixture.publicationId)
            ).map(row => fromDbRow<TestRow>(row, { profileAssessmentIssuesJson: 'json' }))
            expect(job?.state).toBe('failed')
            expect(job?.claimToken).toBeNull()
            expect(job?.errorMessage).toContain('external-effect boundary')
            expect(publication?.state).toBe('ambiguous')
            expect(publication?.errorMessage).toContain('external-effect boundary')
            expect(
                await store.completeExternalEffect({
                    jobId: fixture.jobId,
                    claimToken: 'claim-one',
                    completedAt: dueAt + 60_001,
                    outcome: { type: 'published' },
                })
            ).toBeNull()
            expect(await executionAuditActions(database, fixture.publicationId)).toEqual([
                'publication.execution.claimed',
                'publication.execution.effect_started',
                'publication.execution.ambiguity_recovered',
            ])
            expect(
                (await executionAuditMetadata(database, fixture.publicationId))[2]
            ).toMatchObject({
                fromState: 'publishing',
                toState: 'ambiguous',
                recoveredAt: dueAt + 60_000,
                reason: 'lease_expired_after_effect_boundary',
                errorMessage: 'Worker claim expired after the external-effect boundary',
                jobId: fixture.jobId,
                attempt: 1,
            })
            expect(await foreignKeyViolations(database)).toEqual([])
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('fails closed when the persisted media index disagrees with the target revision', async () => {
        const database = (await openTestDatabase()).database

        try {
            const fixture = await seedDueJob(database, 'media-mismatch')
            await database.sql
                .statement(
                    'update "publication_target_revisions" set "media_reference_count" = ?1 where "publication_target_revisions"."id" = ?2'
                )
                .run(1, fixture.targetRevisionId)
            const store = createWorkflowStore(database)
            await store.claimNextDueJob({
                actorId: fixture.systemActorId,
                claimToken: 'claim-media-mismatch',
                now: dueAt,
                leaseExpiresAt: dueAt + 60_000,
            })

            await expect(
                store.startExternalEffect(fixture.jobId, 'claim-media-mismatch', dueAt + 1)
            ).rejects.toThrow('inconsistent media reference counts')
            expect(
                (
                    await database.sql
                        .statement<TestRow>(
                            'select "publication_execution_revisions"."id" as "id", "publication_execution_revisions"."project_id" as "projectId", "publication_execution_revisions"."job_id" as "jobId", "publication_execution_revisions"."publication_id" as "publicationId", "publication_execution_revisions"."destination_snapshot_json" as "destinationSnapshotJson", "publication_execution_revisions"."target_revision_id" as "targetRevisionId", "publication_execution_revisions"."profile_version_id" as "profileVersionId", "publication_execution_revisions"."delivery_mode" as "deliveryMode", "publication_execution_revisions"."media_reference_count" as "mediaReferenceCount", "publication_execution_revisions"."content_json" as "contentJson", "publication_execution_revisions"."content_hash" as "contentHash", "publication_execution_revisions"."profile_hash" as "profileHash", "publication_execution_revisions"."schema_hash" as "schemaHash", "publication_execution_revisions"."created_at" as "createdAt" from "publication_execution_revisions" where "publication_execution_revisions"."job_id" = ?1'
                        )
                        .all(fixture.jobId)
                ).map(row =>
                    fromDbRow<TestRow>(row, {
                        destinationSnapshotJson: 'json',
                        contentJson: 'json',
                    })
                )
            ).toEqual([])
            const [job] = await database.sql
                .statement<TestRow>(
                    'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."id" = ?1'
                )
                .all(fixture.jobId)
            const [publication] = (
                await database.sql
                    .statement<TestRow>(
                        'select "publications"."id" as "id", "publications"."project_id" as "projectId", "publications"."post_id" as "postId", "publications"."channel_id" as "channelId", "publications"."confirmed_destination_revision" as "confirmedDestinationRevision", "publications"."target_revision_id" as "targetRevisionId", "publications"."delivery_mode" as "deliveryMode", "publications"."review_state" as "reviewState", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId", "publications"."external_url" as "externalUrl", "publications"."error_message" as "errorMessage", "publications"."created_by_actor_id" as "createdByActorId", "publications"."scheduled_by_actor_id" as "scheduledByActorId", "publications"."state_changed_by_actor_id" as "stateChangedByActorId", "publications"."published_by_actor_id" as "publishedByActorId", "publications"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publications"."profile_assessment_issues_json" as "profileAssessmentIssuesJson", "publications"."created_at" as "createdAt", "publications"."updated_at" as "updatedAt" from "publications" where "publications"."id" = ?1'
                    )
                    .all(fixture.publicationId)
            ).map(row => fromDbRow<TestRow>(row, { profileAssessmentIssuesJson: 'json' }))
            expect(job?.state).toBe('running')
            expect(job?.effectStartedAt).toBeNull()
            expect(publication?.state).toBe('scheduled')
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('persists a confirmed external result and fences duplicate completion', async () => {
        const database = (await openTestDatabase()).database

        try {
            const fixture = await seedDueJob(database, 'success')
            const store = createWorkflowStore(database)
            await store.claimNextDueJob({
                actorId: fixture.systemActorId,
                claimToken: 'claim-success',
                now: dueAt,
                leaseExpiresAt: dueAt + 60_000,
            })
            await store.startExternalEffect(fixture.jobId, 'claim-success', dueAt + 1)

            expect(
                await store.completeExternalEffect({
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
                await store.completeExternalEffect({
                    jobId: fixture.jobId,
                    claimToken: 'claim-success',
                    completedAt: dueAt + 3,
                    outcome: { type: 'published' },
                })
            ).toBeNull()

            const [job] = await database.sql
                .statement<TestRow>(
                    'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."id" = ?1'
                )
                .all(fixture.jobId)
            const [publication] = (
                await database.sql
                    .statement<TestRow>(
                        'select "publications"."id" as "id", "publications"."project_id" as "projectId", "publications"."post_id" as "postId", "publications"."channel_id" as "channelId", "publications"."confirmed_destination_revision" as "confirmedDestinationRevision", "publications"."target_revision_id" as "targetRevisionId", "publications"."delivery_mode" as "deliveryMode", "publications"."review_state" as "reviewState", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId", "publications"."external_url" as "externalUrl", "publications"."error_message" as "errorMessage", "publications"."created_by_actor_id" as "createdByActorId", "publications"."scheduled_by_actor_id" as "scheduledByActorId", "publications"."state_changed_by_actor_id" as "stateChangedByActorId", "publications"."published_by_actor_id" as "publishedByActorId", "publications"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publications"."profile_assessment_issues_json" as "profileAssessmentIssuesJson", "publications"."created_at" as "createdAt", "publications"."updated_at" as "updatedAt" from "publications" where "publications"."id" = ?1'
                    )
                    .all(fixture.publicationId)
            ).map(row => fromDbRow<TestRow>(row, { profileAssessmentIssuesJson: 'json' }))
            expect(job?.state).toBe('succeeded')
            expect(job?.completedAt).toBe(dueAt + 2)
            expect(job?.claimToken).toBeNull()
            expect(publication?.state).toBe('published')
            expect(publication?.publishedAt).toBe(dueAt + 2)
            expect(publication?.publishedByActorId).toBe(fixture.systemActorId)
            expect(publication?.externalId).toBe('remote-success')
            expect(await executionAuditActions(database, fixture.publicationId)).toEqual([
                'publication.execution.claimed',
                'publication.execution.effect_started',
                'publication.execution.succeeded',
            ])
            expect(
                (await executionAuditMetadata(database, fixture.publicationId))[2]
            ).toMatchObject({
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
            await closeTestDatabase(database)
        }
    })

    it('rolls back execution transitions when their audit event cannot be persisted', async () => {
        const database = (await openTestDatabase()).database

        try {
            const fixture = await seedDueJob(database, 'audit-rollback')
            const store = createWorkflowStore(database)

            await installRejectingTrigger(database, {
                name: 'fail_workflow_claim_audit',
                table: 'audit_events',
                timing: 'before',
                event: 'insert',
                when: "NEW.action = 'publication.execution.claimed'",
                message: 'workflow claim audit failure',
            })

            await expect(
                store.claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'claim-audit-rollback',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).rejects.toThrow('workflow claim audit failure')
            const [unclaimedJob] = await database.sql
                .statement<TestRow>(
                    'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."id" = ?1'
                )
                .all(fixture.jobId)
            expect(unclaimedJob?.state).toBe('pending')
            expect(unclaimedJob?.attempts).toBe(0)
            expect(await executionAuditEvents(database, fixture.publicationId)).toEqual([])

            await dropRejectingTrigger(database, 'fail_workflow_claim_audit')
            expect(
                await store.claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'claim-audit-rollback',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).not.toBeNull()
            expect(
                await store.startExternalEffect(fixture.jobId, 'claim-audit-rollback', dueAt + 1)
            ).toBe(true)

            await installRejectingTrigger(database, {
                name: 'fail_workflow_completion_audit',
                table: 'audit_events',
                timing: 'before',
                event: 'insert',
                when: "NEW.action = 'publication.execution.succeeded'",
                message: 'workflow completion audit failure',
            })

            await expect(
                store.completeExternalEffect({
                    jobId: fixture.jobId,
                    claimToken: 'claim-audit-rollback',
                    completedAt: dueAt + 2,
                    outcome: { type: 'published' },
                })
            ).rejects.toThrow('workflow completion audit failure')

            const [runningJob] = await database.sql
                .statement<TestRow>(
                    'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."id" = ?1'
                )
                .all(fixture.jobId)
            const [publishingPublication] = (
                await database.sql
                    .statement<TestRow>(
                        'select "publications"."id" as "id", "publications"."project_id" as "projectId", "publications"."post_id" as "postId", "publications"."channel_id" as "channelId", "publications"."confirmed_destination_revision" as "confirmedDestinationRevision", "publications"."target_revision_id" as "targetRevisionId", "publications"."delivery_mode" as "deliveryMode", "publications"."review_state" as "reviewState", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId", "publications"."external_url" as "externalUrl", "publications"."error_message" as "errorMessage", "publications"."created_by_actor_id" as "createdByActorId", "publications"."scheduled_by_actor_id" as "scheduledByActorId", "publications"."state_changed_by_actor_id" as "stateChangedByActorId", "publications"."published_by_actor_id" as "publishedByActorId", "publications"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publications"."profile_assessment_issues_json" as "profileAssessmentIssuesJson", "publications"."created_at" as "createdAt", "publications"."updated_at" as "updatedAt" from "publications" where "publications"."id" = ?1'
                    )
                    .all(fixture.publicationId)
            ).map(row => fromDbRow<TestRow>(row, { profileAssessmentIssuesJson: 'json' }))
            expect(runningJob?.state).toBe('running')
            expect(runningJob?.effectStartedAt).toBe(dueAt + 1)
            expect(publishingPublication?.state).toBe('publishing')
            expect(await executionAuditActions(database, fixture.publicationId)).toEqual([
                'publication.execution.claimed',
                'publication.execution.effect_started',
            ])
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('retries only a known no-effect failure and stops at the policy limit', async () => {
        const database = (await openTestDatabase()).database

        try {
            const fixture = await seedDueJob(database, 'retry')
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
            let [job] = await database.sql
                .statement<TestRow>(
                    'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."id" = ?1'
                )
                .all(fixture.jobId)
            let [publication] = (
                await database.sql
                    .statement<TestRow>(
                        'select "publications"."id" as "id", "publications"."project_id" as "projectId", "publications"."post_id" as "postId", "publications"."channel_id" as "channelId", "publications"."confirmed_destination_revision" as "confirmedDestinationRevision", "publications"."target_revision_id" as "targetRevisionId", "publications"."delivery_mode" as "deliveryMode", "publications"."review_state" as "reviewState", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId", "publications"."external_url" as "externalUrl", "publications"."error_message" as "errorMessage", "publications"."created_by_actor_id" as "createdByActorId", "publications"."scheduled_by_actor_id" as "scheduledByActorId", "publications"."state_changed_by_actor_id" as "stateChangedByActorId", "publications"."published_by_actor_id" as "publishedByActorId", "publications"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publications"."profile_assessment_issues_json" as "profileAssessmentIssuesJson", "publications"."created_at" as "createdAt", "publications"."updated_at" as "updatedAt" from "publications" where "publications"."id" = ?1'
                    )
                    .all(fixture.publicationId)
            ).map(row => fromDbRow<TestRow>(row, { profileAssessmentIssuesJson: 'json' }))
            expect(job?.state).toBe('pending')
            expect(job?.attempts).toBe(1)
            expect(job?.runAt).toBe(dueAt + 1_000)
            expect(publication?.state).toBe('ready')

            await database.sql
                .statement(
                    'insert into "publication_target_revisions" ("id", "project_id", "publication_id", "sequence", "profile_version_id", "source_revision", "delivery_mode", "content_json", "content_hash", "profile_hash", "schema_hash", "validation_issues_json", "created_by_actor_id") values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)'
                )
                .run(
                    'replacement-target-retry',
                    fixture.projectId,
                    fixture.publicationId,
                    2,
                    fixture.profileVersionId,
                    1,
                    'automatic',
                    toDbValue('json', { body: 'Replacement target must not be retried' }),
                    'sha256:replacement-target',
                    testProfile.profileHash,
                    testProfile.schemaHash,
                    toDbValue('json', []),
                    fixture.humanActorId
                )
            await database.sql
                .statement(
                    'update "publications" set "target_revision_id" = ?1 where "publications"."id" = ?2'
                )
                .run('replacement-target-retry', fixture.publicationId)

            currentTime = dueAt + 1_000
            expect((await process()).outcome).toBe('failed')
            ;[job] = await database.sql
                .statement<TestRow>(
                    'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."id" = ?1'
                )
                .all(fixture.jobId)
            ;[publication] = (
                await database.sql
                    .statement<TestRow>(
                        'select "publications"."id" as "id", "publications"."project_id" as "projectId", "publications"."post_id" as "postId", "publications"."channel_id" as "channelId", "publications"."confirmed_destination_revision" as "confirmedDestinationRevision", "publications"."target_revision_id" as "targetRevisionId", "publications"."delivery_mode" as "deliveryMode", "publications"."review_state" as "reviewState", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId", "publications"."external_url" as "externalUrl", "publications"."error_message" as "errorMessage", "publications"."created_by_actor_id" as "createdByActorId", "publications"."scheduled_by_actor_id" as "scheduledByActorId", "publications"."state_changed_by_actor_id" as "stateChangedByActorId", "publications"."published_by_actor_id" as "publishedByActorId", "publications"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publications"."profile_assessment_issues_json" as "profileAssessmentIssuesJson", "publications"."created_at" as "createdAt", "publications"."updated_at" as "updatedAt" from "publications" where "publications"."id" = ?1'
                    )
                    .all(fixture.publicationId)
            ).map(row => fromDbRow<TestRow>(row, { profileAssessmentIssuesJson: 'json' }))
            expect(job?.state).toBe('failed')
            expect(job?.attempts).toBe(2)
            expect(job?.errorMessage).toContain('rejected')
            expect(publication?.state).toBe('failed')
            expect(await store.getNextEventAt()).toBeNull()
            expect(await executionAuditActions(database, fixture.publicationId)).toEqual([
                'publication.execution.claimed',
                'publication.execution.effect_started',
                'publication.execution.retry_scheduled',
                'publication.execution.claimed',
                'publication.execution.effect_started',
                'publication.execution.failed',
            ])
            expect(
                (await executionAuditEvents(database, fixture.publicationId)).every(
                    event => event.eventVersion === 1 && event.correlationId === fixture.jobId
                )
            ).toBe(true)
            const retryAuditMetadata = await executionAuditMetadata(database, fixture.publicationId)
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
                await database.sql
                    .statement<{ targetRevisionId: string; contentJson: string }, []>(
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
            await closeTestDatabase(database)
        }
    })

    it('treats an exception after the effect boundary as ambiguous', async () => {
        const database = (await openTestDatabase()).database

        try {
            const fixture = await seedDueJob(database, 'exception')
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
            const [job] = await database.sql
                .statement<TestRow>(
                    'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."id" = ?1'
                )
                .all(fixture.jobId)
            const [publication] = (
                await database.sql
                    .statement<TestRow>(
                        'select "publications"."id" as "id", "publications"."project_id" as "projectId", "publications"."post_id" as "postId", "publications"."channel_id" as "channelId", "publications"."confirmed_destination_revision" as "confirmedDestinationRevision", "publications"."target_revision_id" as "targetRevisionId", "publications"."delivery_mode" as "deliveryMode", "publications"."review_state" as "reviewState", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId", "publications"."external_url" as "externalUrl", "publications"."error_message" as "errorMessage", "publications"."created_by_actor_id" as "createdByActorId", "publications"."scheduled_by_actor_id" as "scheduledByActorId", "publications"."state_changed_by_actor_id" as "stateChangedByActorId", "publications"."published_by_actor_id" as "publishedByActorId", "publications"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publications"."profile_assessment_issues_json" as "profileAssessmentIssuesJson", "publications"."created_at" as "createdAt", "publications"."updated_at" as "updatedAt" from "publications" where "publications"."id" = ?1'
                    )
                    .all(fixture.publicationId)
            ).map(row => fromDbRow<TestRow>(row, { profileAssessmentIssuesJson: 'json' }))
            expect(job?.state).toBe('failed')
            expect(publication?.state).toBe('ambiguous')
            expect(publication?.errorMessage).toContain('response lost')
            expect(await executionAuditActions(database, fixture.publicationId)).toEqual([
                'publication.execution.claimed',
                'publication.execution.effect_started',
                'publication.execution.ambiguous',
            ])
            expect(
                (await executionAuditMetadata(database, fixture.publicationId))[2]
            ).toMatchObject({
                outcome: 'ambiguous',
                toState: 'ambiguous',
                errorMessage: 'External effect threw after its durable boundary: response lost',
                attempt: 1,
            })
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('cancels pending work atomically but never claims a running effect was prevented', async () => {
        const database = (await openTestDatabase()).database

        try {
            const pending = await seedDueJob(database, 'cancel-pending')
            const running = await seedDueJob(database, 'cancel-running')
            const store = createWorkflowStore(database)

            expect(await store.cancelPendingJob(pending.jobId, pending.humanActorId, dueAt)).toBe(
                true
            )
            expect(
                await store.cancelPendingJob(pending.jobId, pending.humanActorId, dueAt + 1)
            ).toBe(false)

            await store.claimNextDueJob({
                actorId: running.systemActorId,
                claimToken: 'claim-running',
                now: dueAt,
                leaseExpiresAt: dueAt + 60_000,
            })
            await store.startExternalEffect(running.jobId, 'claim-running', dueAt + 1)
            expect(
                await store.cancelPendingJob(running.jobId, running.humanActorId, dueAt + 2)
            ).toBe(false)

            const [cancelledJob] = await database.sql
                .statement<TestRow>(
                    'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."id" = ?1'
                )
                .all(pending.jobId)
            const [cancelledPublication] = (
                await database.sql
                    .statement<TestRow>(
                        'select "publications"."id" as "id", "publications"."project_id" as "projectId", "publications"."post_id" as "postId", "publications"."channel_id" as "channelId", "publications"."confirmed_destination_revision" as "confirmedDestinationRevision", "publications"."target_revision_id" as "targetRevisionId", "publications"."delivery_mode" as "deliveryMode", "publications"."review_state" as "reviewState", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId", "publications"."external_url" as "externalUrl", "publications"."error_message" as "errorMessage", "publications"."created_by_actor_id" as "createdByActorId", "publications"."scheduled_by_actor_id" as "scheduledByActorId", "publications"."state_changed_by_actor_id" as "stateChangedByActorId", "publications"."published_by_actor_id" as "publishedByActorId", "publications"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publications"."profile_assessment_issues_json" as "profileAssessmentIssuesJson", "publications"."created_at" as "createdAt", "publications"."updated_at" as "updatedAt" from "publications" where "publications"."id" = ?1'
                    )
                    .all(pending.publicationId)
            ).map(row => fromDbRow<TestRow>(row, { profileAssessmentIssuesJson: 'json' }))
            const [runningJob] = await database.sql
                .statement<TestRow>(
                    'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."id" = ?1'
                )
                .all(running.jobId)
            expect(cancelledJob?.state).toBe('cancelled')
            expect(cancelledJob?.completedAt).toBe(dueAt)
            expect(cancelledPublication?.state).toBe('cancelled')
            expect(cancelledPublication?.stateChangedByActorId).toBe(pending.humanActorId)
            expect(runningJob?.state).toBe('running')
            expect(await executionAuditActions(database, pending.publicationId)).toEqual([
                'publication.execution.cancelled',
            ])
            expect(await executionAuditActions(database, running.publicationId)).toEqual([
                'publication.execution.claimed',
                'publication.execution.effect_started',
            ])
            expect(await foreignKeyViolations(database)).toEqual([])
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('runs one durable publication from a scheduler wake and returns to empty state', async () => {
        const database = (await openTestDatabase()).database

        try {
            const fixture = await seedDueJob(database, 'scheduled-execution')
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

            await scheduler.start()
            expect(scheduler.scheduledAt).toBe(dueAt)
            if (wake === undefined) throw new Error('Scheduler did not arm its timer')
            await wake()

            const [job] = await database.sql
                .statement<TestRow>(
                    'select "jobs"."id" as "id", "jobs"."project_id" as "projectId", "jobs"."publication_id" as "publicationId", "jobs"."state" as "state", "jobs"."run_at" as "runAt", "jobs"."attempts" as "attempts", "jobs"."claim_token" as "claimToken", "jobs"."claimed_by_actor_id" as "claimedByActorId", "jobs"."claimed_at" as "claimedAt", "jobs"."lease_expires_at" as "leaseExpiresAt", "jobs"."effect_started_at" as "effectStartedAt", "jobs"."started_at" as "startedAt", "jobs"."completed_at" as "completedAt", "jobs"."error_message" as "errorMessage", "jobs"."created_at" as "createdAt", "jobs"."updated_at" as "updatedAt" from "jobs" where "jobs"."id" = ?1'
                )
                .all(fixture.jobId)
            const [publication] = (
                await database.sql
                    .statement<TestRow>(
                        'select "publications"."id" as "id", "publications"."project_id" as "projectId", "publications"."post_id" as "postId", "publications"."channel_id" as "channelId", "publications"."confirmed_destination_revision" as "confirmedDestinationRevision", "publications"."target_revision_id" as "targetRevisionId", "publications"."delivery_mode" as "deliveryMode", "publications"."review_state" as "reviewState", "publications"."state" as "state", "publications"."scheduled_at" as "scheduledAt", "publications"."published_at" as "publishedAt", "publications"."external_id" as "externalId", "publications"."external_url" as "externalUrl", "publications"."error_message" as "errorMessage", "publications"."created_by_actor_id" as "createdByActorId", "publications"."scheduled_by_actor_id" as "scheduledByActorId", "publications"."state_changed_by_actor_id" as "stateChangedByActorId", "publications"."published_by_actor_id" as "publishedByActorId", "publications"."last_assessed_profile_version_id" as "lastAssessedProfileVersionId", "publications"."profile_assessment_issues_json" as "profileAssessmentIssuesJson", "publications"."created_at" as "createdAt", "publications"."updated_at" as "updatedAt" from "publications" where "publications"."id" = ?1'
                    )
                    .all(fixture.publicationId)
            ).map(row => fromDbRow<TestRow>(row, { profileAssessmentIssuesJson: 'json' }))
            expect(job?.state).toBe('succeeded')
            expect(publication?.state).toBe('published')
            expect(await store.getNextEventAt()).toBeNull()
            expect(scheduler.state).toBe('started')
            expect(scheduler.scheduledAt).toBeNull()
        } finally {
            await closeTestDatabase(database)
        }
    })

    it.skipIf(testEngine === 'postgres')(
        'prevents two database connections from claiming the same job',
        async () => {
            const directory = mkdtempSync(join(tmpdir(), 'postdot-workflow-'))
            const filename = join(directory, 'postdot.sqlite')
            const firstDatabase = createDatabase(filename)
            await runMigrations(firstDatabase)
            let secondDatabase: PostdotDatabase | undefined

            try {
                const fixture = await seedDueJob(firstDatabase)
                secondDatabase = createDatabase(filename)
                await runMigrations(secondDatabase)

                const firstClaim = await createWorkflowStore(firstDatabase).claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'claim-one',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 60_000,
                })
                const secondClaim = await createWorkflowStore(secondDatabase).claimNextDueJob({
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
        }
    )

    it.skipIf(testEngine === 'postgres')(
        'reconstructs the next event after the database is reopened',
        async () => {
            const directory = mkdtempSync(join(tmpdir(), 'postdot-restart-'))
            const filename = join(directory, 'postdot.sqlite')
            const firstDatabase = createDatabase(filename)
            await runMigrations(firstDatabase)
            let firstDatabaseOpen = true
            let reopenedDatabase: PostdotDatabase | undefined

            try {
                await seedDueJob(firstDatabase, 'restart')
                expect(await createWorkflowStore(firstDatabase).getNextEventAt()).toBe(dueAt)
                closeDatabase(firstDatabase)
                firstDatabaseOpen = false

                reopenedDatabase = createDatabase(filename)
                await runMigrations(reopenedDatabase)
                expect(await createWorkflowStore(reopenedDatabase).getNextEventAt()).toBe(dueAt)
            } finally {
                if (reopenedDatabase !== undefined) {
                    closeDatabase(reopenedDatabase)
                }
                if (firstDatabaseOpen) {
                    closeDatabase(firstDatabase)
                }
                rmSync(directory, { recursive: true, force: true })
            }
        }
    )
})

describe('project retirement effect fencing', () => {
    it('cancels an owned pre-effect claim before it can cross the network boundary', async () => {
        const database = (await openTestDatabase()).database
        try {
            const fixture = await seedDueJob(database)
            const workflow = createWorkflowStore(database)
            expect(
                await workflow.claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'owner',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).not.toBeNull()
            const lifecycle = createResourceLifecycleStore(database)
            const preview = (await lifecycle.impact('project', fixture.projectId))!
            const archived = await lifecycle.mutate({
                kind: 'project',
                id: fixture.projectId,
                action: 'archive',
                actorId: 'operator',
                fingerprint: preview.fingerprint,
                cancelPending: true,
                authorize: async () => true,
            })
            expect(archived.state).toBe('archived')
            expect(await workflow.startExternalEffect(fixture.jobId, 'owner', dueAt + 1)).toBe(
                false
            )
            expect(
                await workflow.claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'another',
                    now: dueAt + 1,
                    leaseExpiresAt: dueAt + 60_000,
                })
            ).toBeNull()
        } finally {
            await closeTestDatabase(database)
        }
    })
    for (const retry of [false, true])
        it(`persists an already-started ${retry ? 'retryable failure' : 'success'} before retiring`, async () => {
            const database = (await openTestDatabase()).database
            try {
                const fixture = await seedDueJob(database)
                const workflow = createWorkflowStore(database)
                await workflow.claimNextDueJob({
                    actorId: fixture.systemActorId,
                    claimToken: 'owner',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 60_000,
                })
                expect(await workflow.startExternalEffect(fixture.jobId, 'owner', dueAt + 1)).toBe(
                    true
                )
                const lifecycle = createResourceLifecycleStore(database)
                const preview = (await lifecycle.impact('project', fixture.projectId))!
                expect(
                    (
                        await lifecycle.mutate({
                            kind: 'project',
                            id: fixture.projectId,
                            action: 'archive',
                            actorId: 'operator',
                            fingerprint: preview.fingerprint,
                            cancelPending: true,
                            authorize: async () => true,
                        })
                    ).state
                ).toBe('archiving')
                expect(
                    await workflow.completeExternalEffect({
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
                expect(await lifecycle.state('project', fixture.projectId)).toBe('archived')
                expect(
                    await database.sql.statement('select state from publications').get()
                ).toEqual({
                    state: retry ? 'cancelled' : 'published',
                })
            } finally {
                await closeTestDatabase(database)
            }
        })
})

it('paces overdue work before claim, persists timing across store restart and lets another channel run', async () => {
    const database = (await openTestDatabase()).database
    try {
        const a = await seedDueJob(database, 'paced')
        const b = await seedDueJob(database, 'eligible')
        const channelId = 'channel-paced'
        await database.sql
            .statement(`insert into channel_cadence(channel_id,revision,time_zone,minimum_interval_ms,last_effect_at,updated_by_actor_id,updated_at)
            values (?,1,'UTC',1000,?,?,?)`)
            .run(channelId, dueAt - 100, a.humanActorId, dueAt)
        const store = createWorkflowStore(database)
        expect(
            await store.claimNextDueJob({
                actorId: a.systemActorId,
                claimToken: 'early',
                now: dueAt,
                leaseExpiresAt: dueAt + 2000,
            })
        ).toBeNull()
        expect(await store.getNextEventAt()).toBe(dueAt)
        expect(
            (
                await store.claimNextDueJob({
                    actorId: b.systemActorId,
                    claimToken: 'other',
                    now: dueAt,
                    leaseExpiresAt: dueAt + 2000,
                })
            )?.id
        ).toBe(b.jobId)
        expect(await createWorkflowStore(database).getNextEventAt()).toBe(dueAt + 900)
        expect(
            (
                await store.claimNextDueJob({
                    actorId: a.systemActorId,
                    claimToken: 'on-time',
                    now: dueAt + 900,
                    leaseExpiresAt: dueAt + 3000,
                })
            )?.id
        ).toBe(a.jobId)
        expect(await store.startExternalEffect(a.jobId, 'on-time', dueAt + 900)).toBe(true)
        expect(
            await database.sql
                .statement('select scheduled_at from publications where id=?')
                .get(a.publicationId)
        ).toEqual({ scheduled_at: dueAt })
        expect(
            await database.sql
                .statement('select last_effect_at from channel_cadence where channel_id=?')
                .get(channelId)
        ).toEqual({ last_effect_at: dueAt + 900 })
    } finally {
        await closeTestDatabase(database)
    }
})

it('rechecks spacing at the effect boundary and defers without consuming an attempt', async () => {
    const database = (await openTestDatabase()).database
    try {
        const a = await seedDueJob(database, 'boundary')
        const store = createWorkflowStore(database)
        expect(
            await store.claimNextDueJob({
                actorId: a.systemActorId,
                claimToken: 'claimed',
                now: dueAt,
                leaseExpiresAt: dueAt + 2000,
            })
        ).not.toBeNull()
        await database.sql
            .statement(`insert into channel_cadence(channel_id,revision,time_zone,minimum_interval_ms,last_effect_at,updated_by_actor_id,updated_at)
            values ('channel-boundary',1,'UTC',1000,?,?,?)`)
            .run(dueAt, a.humanActorId, dueAt)
        expect(await store.startExternalEffect(a.jobId, 'claimed', dueAt + 1)).toBe(false)
        expect(
            await database.sql
                .statement('select state,attempts,effect_started_at from jobs where id=?')
                .get(a.jobId)
        ).toEqual({ state: 'pending', attempts: 0, effect_started_at: null })
        expect(await store.getNextEventAt()).toBe(dueAt + 1000)
    } finally {
        await closeTestDatabase(database)
    }
})

it('paces actual retries after restart and keeps the original requested schedule', async () => {
    const database = (await openTestDatabase()).database
    try {
        const f = await seedDueJob(database, 'retry-paced')
        await database.sql
            .statement(`insert into channel_cadence(channel_id,revision,time_zone,minimum_interval_ms,updated_by_actor_id,updated_at)
            values ('channel-retry-paced',1,'UTC',1000,?,?)`)
            .run(f.humanActorId, dueAt)
        const store = createWorkflowStore(database)
        expect(
            await store.claimNextDueJob({
                actorId: f.systemActorId,
                claimToken: 'first',
                now: dueAt,
                leaseExpiresAt: dueAt + 2000,
            })
        ).not.toBeNull()
        expect(await store.startExternalEffect(f.jobId, 'first', dueAt)).toBe(true)
        expect(
            await store.completeExternalEffect({
                jobId: f.jobId,
                claimToken: 'first',
                completedAt: dueAt + 10,
                outcome: {
                    type: 'retryable_failure',
                    effectOccurred: false,
                    errorMessage: 'Known rejection',
                },
                retryAt: dueAt + 100,
            })
        ).not.toBeNull()
        const restarted = createWorkflowStore(database)
        expect(await restarted.getNextEventAt()).toBe(dueAt + 1000)
        expect(
            await restarted.claimNextDueJob({
                actorId: f.systemActorId,
                claimToken: 'too-early',
                now: dueAt + 100,
                leaseExpiresAt: dueAt + 2000,
            })
        ).toBeNull()
        expect(
            (
                await restarted.claimNextDueJob({
                    actorId: f.systemActorId,
                    claimToken: 'retry',
                    now: dueAt + 1000,
                    leaseExpiresAt: dueAt + 3000,
                })
            )?.attempts
        ).toBe(2)
        expect(await restarted.startExternalEffect(f.jobId, 'retry', dueAt + 1000)).toBe(true)
        expect(
            await database.sql
                .statement('select scheduled_at from publications where id=?')
                .get(f.publicationId)
        ).toEqual({ scheduled_at: dueAt })
    } finally {
        await closeTestDatabase(database)
    }
})
