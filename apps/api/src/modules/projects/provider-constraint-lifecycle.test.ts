import { expect, test } from 'bun:test'

import type { ChannelProfileDefinition } from '@postdot/core'
import { createManualStore, createMediaAssetStore, createWorkflowStore } from '@postdot/db'
import { closeTestDatabase, openTestDatabase, seedTestWorkspace } from '@postdot/db/testing'
import { linkedinChannelProfile } from '@postdot/linkedin'

// Synthetic limits exercise the shipped identity/execution contract, not current provider limits.
function limitedProfile(limit: number): ChannelProfileDefinition {
    const profile = structuredClone(linkedinChannelProfile)
    const schema = profile.contentSchema as { properties: { commentary: { maxLength: number } } }
    schema.properties.commentary.maxLength = limit
    return {
        ...profile,
        profileHash: `synthetic-linkedin-${limit}`,
        schemaHash: `synthetic-linkedin-schema-${limit}`,
        capabilities: {
            ...profile.capabilities,
            textFields: profile.capabilities.textFields.map(field => ({
                ...field,
                maxLength: limit,
            })),
        },
    }
}
async function fixture() {
    const database = (await openTestDatabase()).database
    let now = 1_800_000_000_000
    const media = createMediaAssetStore(database, {
        storeId: 'metadata-fixture',
        maxObjectBytes: 100_000_000,
        put: async () => {
            throw new Error('No storage write expected')
        },
        stat: async () => null,
        open: async () => null,
        delete: async () => {},
    })
    const manual = createManualStore(database, { now: () => now, media })
    const workflow = createWorkflowStore(database)
    const { project } = await manual.createProject({
        workspaceId: await seedTestWorkspace(database),
        name: 'Constraint evolution',
        subjectId: 'operator',
        displayName: 'Operator',
    })
    const channel = (await manual.createChannel({
        projectId: project.id,
        subjectId: 'operator',
        name: 'Synthetic LinkedIn',
        profile: limitedProfile(500),
    }))!
    await database.sql
        .statement(
            "insert into publishers (id,workspace_id,channel_id,kind) values (?,(select workspace_id from projects where id = ?),?,'linkedin')"
        )
        .run('publisher', project.id, channel.id)
    const actorId = (await workflow.ensureSystemActor(project.id, now))!
    let sequence = 0
    async function create(
        length: number,
        scheduledAt?: number,
        attachments: { assetId: string }[] = []
    ) {
        const result = (await manual.createPost({
            projectId: project.id,
            subjectId: 'operator',
            sourceContent: {
                body: { format: 'plain_text', text: 'x'.repeat(length) },
                media: attachments,
            },
            publications: [
                {
                    channelId: channel.id,
                    deliveryMode: 'automatic',
                    ...(scheduledAt === undefined ? {} : { scheduledAt }),
                },
            ],
        }))!
        return result.publications[0]!
    }
    async function claim() {
        const claimToken = `claim-${++sequence}`
        const job = (await workflow.claimNextDueJob({
            actorId,
            claimToken,
            now,
            leaseExpiresAt: now + 120_000,
        }))!
        expect(job).not.toBeNull()
        return { job, claimToken }
    }
    async function start() {
        const work = await claim()
        expect(await workflow.startExternalEffect(work.job.id, work.claimToken, now)).toBe(true)
        return work
    }
    async function activate(
        execution = linkedinChannelProfile.execution,
        profile = limitedProfile(300)
    ) {
        const draft = (await manual.createChannelProfileDraft({
            projectId: project.id,
            channelId: channel.id,
            subjectId: 'operator',
            profile: { ...profile, execution },
        }))!
        const preview = (await manual.previewChannelProfileActivation({
            projectId: project.id,
            channelId: channel.id,
            subjectId: 'operator',
            profileVersionId: draft.id,
        }))!
        const result = (await manual.activateChannelProfile({
            projectId: project.id,
            channelId: channel.id,
            subjectId: 'operator',
            profileVersionId: draft.id,
            expectedRevision: draft.revision,
        }))!
        return { draft, preview, result }
    }
    const publication = async (id: string) =>
        (await database.sql.statement('select * from publications where id = ?').get(id)) as {
            review_state: string
            target_revision_id: string
            state: string
        }
    const target = async (id: string) =>
        await database.sql
            .statement('select * from publication_target_revisions where publication_id = ?')
            .all(id)
    const execution = async (id: string) =>
        await database.sql
            .statement('select * from publication_execution_revisions where publication_id = ?')
            .all(id)
    return {
        database,
        media,
        manual,
        workflow,
        project,
        channel,
        create,
        claim,
        start,
        activate,
        publication,
        target,
        execution,
        get now() {
            return now
        },
        advance() {
            now += 60_000
        },
    }
}

test('a reduced built-in limit preserves drafts/targets/history and admits only compatible new and pending work', async () => {
    const f = await fixture()
    try {
        const historical = await f.create(420, f.now)
        const completed = await f.start()
        expect(
            await f.workflow.completeExternalEffect({
                jobId: completed.job.id,
                claimToken: completed.claimToken,
                completedAt: f.now,
                outcome: { type: 'published', externalId: 'historical' },
            })
        ).toBe('published')
        const historicalTarget = await f.target(historical.id)
        const historicalExecution = await f.execution(historical.id)
        const long = await f.create(420, f.now + 60_000)
        const short = await f.create(280, f.now + 60_000)
        const draft = await f.create(420)
        const beforeTargets = await f.target(long.id)
        const beforeDraft = await f.database.sql
            .statement(
                'select content_json from publication_working_drafts where publication_id = ?'
            )
            .get(draft.id)
        const activation = await f.activate()
        expect(activation.preview.pendingTargets).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: long.id, state: 'review_required' }),
                expect.objectContaining({ id: short.id, state: 'compatible' }),
            ])
        )
        expect((await f.publication(long.id)).review_state).toBe('review_required')
        expect((await f.publication(short.id)).review_state).toBe('compatible')
        expect(await f.target(long.id)).toEqual(beforeTargets)
        expect(
            await f.database.sql
                .statement(
                    'select content_json from publication_working_drafts where publication_id = ?'
                )
                .get(draft.id)
        ).toEqual(beforeDraft)
        expect(
            await f.database.sql
                .statement(
                    'select review_state from publication_working_drafts where publication_id = ?'
                )
                .get(draft.id)
        ).toEqual({ review_state: 'review_required' })
        expect(await f.target(historical.id)).toEqual(historicalTarget)
        expect(await f.execution(historical.id)).toEqual(historicalExecution)
        expect((await f.create(420)).reviewState).toBe('review_required')
        await expect(f.create(420, f.now)).rejects.toThrow()
        const newDraft = await f.create(280)
        expect(
            await f.database.sql
                .statement(
                    'select profile_version_id from publication_working_drafts where publication_id = ?'
                )
                .get(newDraft.id)
        ).toEqual({ profile_version_id: activation.draft.id })
        f.advance()
        const allowed = await f.start()
        expect(allowed.job.publicationId).toBe(short.id)
        expect(
            await f.workflow.completeExternalEffect({
                jobId: allowed.job.id,
                claimToken: allowed.claimToken,
                completedAt: f.now,
                outcome: { type: 'published' },
            })
        ).toBe('published')
        expect(
            await f.workflow.claimNextDueJob({
                actorId: allowed.job.claimedByActorId!,
                claimToken: 'none',
                now: f.now,
                leaseExpiresAt: f.now + 60_000,
            })
        ).toBeNull()
    } finally {
        await closeTestDatabase(f.database)
    }
})

test('a claim made before limit activation cannot cross the effect boundary with newly incompatible content', async () => {
    const f = await fixture()
    try {
        const publication = await f.create(420, f.now)
        const work = await f.claim()
        const before = await f.target(publication.id)
        await f.activate()
        expect(await f.workflow.startExternalEffect(work.job.id, work.claimToken, f.now)).toBe(
            false
        )
        expect((await f.publication(publication.id)).review_state).toBe('review_required')
        expect(await f.target(publication.id)).toEqual(before)
        expect(await f.execution(publication.id)).toHaveLength(0)
    } finally {
        await closeTestDatabase(f.database)
    }
})

for (const retry of [false, true]) {
    test(`an already-started effect retains its snapshot after activation and ${retry ? 'cannot retry incompatible content' : 'can finish recording success'}`, async () => {
        const f = await fixture()
        try {
            const publication = await f.create(420, f.now)
            const work = await f.start()
            const before = await f.execution(publication.id)
            await f.activate()
            expect(await f.execution(publication.id)).toEqual(before)
            expect(
                await f.workflow.completeExternalEffect({
                    jobId: work.job.id,
                    claimToken: work.claimToken,
                    completedAt: f.now,
                    outcome: retry
                        ? {
                              type: 'retryable_failure',
                              effectOccurred: false,
                              errorMessage: 'Synthetic rejection',
                          }
                        : { type: 'published', externalId: 'already-sent' },
                    ...(retry ? { retryAt: f.now + 60_000 } : {}),
                })
            ).toBe(retry ? 'failed' : 'published')
            expect(await f.execution(publication.id)).toEqual(before)
            if (retry) {
                f.advance()
                expect(
                    await f.workflow.claimNextDueJob({
                        actorId: work.job.claimedByActorId!,
                        claimToken: 'forbidden-retry',
                        now: f.now,
                        leaseExpiresAt: f.now + 60_000,
                    })
                ).toBeNull()
            } else expect((await f.publication(publication.id)).state).toBe('published')
        } finally {
            await closeTestDatabase(f.database)
        }
    })
}

test('explicit retries of retained failed targets cannot bypass a newer incompatible limit', async () => {
    const f = await fixture()
    try {
        const publication = await f.create(420, f.now)
        const work = await f.start()
        await f.workflow.completeExternalEffect({
            jobId: work.job.id,
            claimToken: work.claimToken,
            completedAt: f.now,
            outcome: {
                type: 'permanent_failure',
                effectOccurred: false,
                errorMessage: 'Synthetic failure',
            },
        })
        const before = await f.target(publication.id)
        await f.activate()
        expect(
            (
                await f.manual.retryFailedPublication({
                    projectId: f.project.id,
                    publicationId: publication.id,
                    subjectId: 'operator',
                })
            ).kind
        ).toBe('not_retryable')
        expect(await f.target(publication.id)).toEqual(before)
    } finally {
        await closeTestDatabase(f.database)
    }
})

test('a compatible old target can retry after activation without replacing its immutable snapshot', async () => {
    const f = await fixture()
    try {
        const publication = await f.create(280, f.now)
        const work = await f.start()
        const target = await f.target(publication.id)
        await f.activate()
        expect(
            await f.workflow.completeExternalEffect({
                jobId: work.job.id,
                claimToken: work.claimToken,
                completedAt: f.now,
                outcome: {
                    type: 'retryable_failure',
                    effectOccurred: false,
                    errorMessage: 'Known rejection',
                },
                retryAt: f.now + 60_000,
            })
        ).toBe('retry_scheduled')
        f.advance()
        const retry = await f.start()
        expect(retry.job.publicationId).toBe(publication.id)
        expect(await f.target(publication.id)).toEqual(target)
        expect(
            await f.workflow.completeExternalEffect({
                jobId: retry.job.id,
                claimToken: retry.claimToken,
                completedAt: f.now,
                outcome: { type: 'published' },
            })
        ).toBe('published')
    } finally {
        await closeTestDatabase(f.database)
    }
})

test('a changed built-in execution contract blocks even a short retained target before its effect', async () => {
    const f = await fixture()
    try {
        const publication = await f.create(280, f.now)
        const work = await f.claim()
        await f.activate({
            kind: 'built_in',
            contractId: 'linkedin',
            revision: 'synthetic-unsupported-revision',
        })
        expect(await f.workflow.startExternalEffect(work.job.id, work.claimToken, f.now)).toBe(
            false
        )
        expect((await f.publication(publication.id)).review_state).toBe('review_required')
        expect(await f.execution(publication.id)).toHaveLength(0)
    } finally {
        await closeTestDatabase(f.database)
    }
})

test('an in-flight retry rechecks the current media requirements while preserving pinned media', async () => {
    const f = await fixture()
    try {
        const reservation = (await f.media.reserveUpload({
            projectId: f.project.id,
            subjectId: 'operator',
            originalFilename: 'retained.png',
        }))!
        await f.database.sql
            .statement("update media_assets set state = 'ready' where id = ?")
            .run(reservation.asset.id)
        await f.database.sql
            .statement(
                "update media_representations set state = 'ready', detected_content_type = 'image/png', detected_format = 'png', family = 'image', byte_size = 67, sha256 = ?, width = 1, height = 1 where id = ?"
            )
            .run('a'.repeat(64), reservation.representation.id)
        const publication = await f.create(280, f.now, [{ assetId: reservation.asset.id }])
        const work = await f.start()
        const before = await f.database.sql
            .statement(
                'select * from publication_execution_revision_media where execution_revision_id = ?'
            )
            .all(((await f.execution(publication.id))[0] as { id: string }).id)
        const profile = limitedProfile(300)
        const schema = profile.contentSchema as { properties: { media: { maxItems: number } } }
        schema.properties.media.maxItems = 0
        const next = {
            ...profile,
            capabilities: {
                ...profile.capabilities,
                mediaFields: profile.capabilities.mediaFields.map(field => ({
                    ...field,
                    maxItems: 0,
                })),
            },
        }
        await f.activate(undefined, next)
        expect(
            await f.workflow.completeExternalEffect({
                jobId: work.job.id,
                claimToken: work.claimToken,
                completedAt: f.now,
                outcome: {
                    type: 'retryable_failure',
                    effectOccurred: false,
                    errorMessage: 'No effect',
                },
                retryAt: f.now + 60_000,
            })
        ).toBe('failed')
        expect((await f.publication(publication.id)).review_state).toBe('review_required')
        expect(
            await f.database.sql
                .statement(
                    'select * from publication_execution_revision_media where execution_revision_id = ?'
                )
                .all(((await f.execution(publication.id))[0] as { id: string }).id)
        ).toEqual(before)
        expect(before).toHaveLength(1)
    } finally {
        await closeTestDatabase(f.database)
    }
})
