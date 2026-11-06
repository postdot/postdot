import { expect, it } from 'bun:test'

import { createManualChannelProfile, type ChannelProfileDefinition } from '@postdot/core'

import { CadenceConflictError } from '../channel-cadence'
import { setDatabaseCommitObserver } from '../client'
import { createManualStore } from '../manual-store'
import {
    closeTestDatabase,
    foreignKeyViolations,
    installRejectingTrigger,
    openTestDatabase,
    seedTestWorkspace,
} from '../testing'
import type { MovePublicationInput } from './publication-move-store'
const now = 1_800_000_000_000
function profile(limit = 1000): ChannelProfileDefinition {
    return {
        id: 'move-test',
        version: 1,
        origin: 'built_in',
        profileHash: 'move-profile-' + limit,
        schemaHash: 'move-schema-' + limit,
        contentSchema: {
            type: 'object',
            properties: { body: { type: 'string', maxLength: limit } },
            required: ['body'],
            additionalProperties: false,
        },
        fieldBindings: [{ id: 'body', semantic: 'primary_text', path: '/body' }],
        capabilities: {
            revision: 'move-v1',
            textFields: [
                { bindingId: 'body', acceptedSourceFormats: ['plain_text'], maxLength: limit },
            ],
            mediaFields: [],
            relations: [],
        },
        execution: { kind: 'built_in', contractId: 'move-test', revision: 'v1' },
    }
}
async function fixture() {
    const database = (await openTestDatabase()).database
    const store = createManualStore(database, { now: () => now })
    const project = await store.createProject({
        workspaceId: await seedTestWorkspace(database),
        name: 'Moves',
        subjectId: 'operator',
        displayName: 'Operator',
    })
    const projectId = project.project.id
    const source = (await store.createChannel({
        projectId,
        subjectId: 'operator',
        name: 'Source',
        profile: profile(),
    }))!
    const target = (await store.createChannel({
        projectId,
        subjectId: 'operator',
        name: 'Target',
        profile: profile(),
    }))!
    const narrow = (await store.createChannel({
        projectId,
        subjectId: 'operator',
        name: 'Narrow',
        profile: profile(3),
    }))!
    const create = async (scheduledAt: number | null = now + 60000) =>
        (await store.createPost({
            projectId,
            subjectId: 'operator',
            sourceContent: {
                body: { format: 'plain_text', text: 'Saved target content' },
                media: [],
            },
            publications: [{ channelId: source.id, deliveryMode: 'manual', scheduledAt }],
        }))!.publications[0]!
    const publication = await create()
    async function input(id = publication.id, channel = target): Promise<MovePublicationInput> {
        const editor = (await store.getPublicationEditorState(projectId, id, 'operator'))!
        return {
            projectId,
            subjectId: 'operator',
            publicationId: id,
            targetChannelId: channel.id,
            deliveryMode: 'manual',
            expectedTargetProfileVersionId: channel.profileVersionId,
            expectedDraftRevision: editor.draft.revision,
            expectedSourceRevision: editor.post.sourceRevision,
            expectedPublicationUpdatedAt: editor.publication.updatedAt,
            expectedTargetRevisionId: editor.publication.targetRevisionId,
            expectedScheduledAt: editor.publication.scheduledAt,
        }
    }
    return { database, store, projectId, source, target, narrow, publication, create, input }
}
it('moves future work atomically in the same post, preserving exact content, source and original revision', async () => {
    const f = await fixture()
    try {
        const original = (await f.store.getPublicationEditorState(
            f.projectId,
            f.publication.id,
            'operator'
        ))!
        const moved = (await f.store.movePublication(await f.input()))!
        expect(moved.post).toEqual(original.post)
        expect(moved.publication).toMatchObject({
            postId: original.post.id,
            channelId: f.target.id,
            scheduledAt: original.publication.scheduledAt,
            state: 'scheduled',
        })
        expect(moved.draft.content).toEqual(original.draft.content)
        expect(moved.publication.id).not.toBe(original.publication.id)
        expect(moved.selectedTarget!.id).not.toBe(original.selectedTarget!.id)
        expect(moved.movement).toMatchObject({
            fromPublicationId: original.publication.id,
            requestedScheduledAt: original.publication.scheduledAt,
        })
        const old = (await f.store.getPublicationEditorState(
            f.projectId,
            f.publication.id,
            'operator'
        ))!
        expect(old.publication.state).toBe('cancelled')
        expect(old.selectedTarget).toEqual(original.selectedTarget)
        expect(old.draft).toEqual(original.draft)
        expect(old.movement?.toPublicationId).toBe(moved.publication.id)
        expect(
            await f.database.sql
                .statement('select * from publication_approval_requests where publication_id=?')
                .all(moved.publication.id)
        ).toEqual([])
        expect(await foreignKeyViolations(f.database)).toEqual([])
        await expect(f.store.movePublication(await f.input())).rejects.toThrow('Only future work')
    } finally {
        await closeTestDatabase(f.database)
    }
})
it('keeps incompatible destination content as an unscheduled review draft with the requested time retained', async () => {
    const f = await fixture()
    try {
        const moved = (await f.store.movePublication(await f.input(f.publication.id, f.narrow)))!
        expect(moved.publication).toMatchObject({
            state: 'draft',
            scheduledAt: null,
            reviewState: 'review_required',
            targetRevisionId: null,
        })
        expect(moved.draft.content).toEqual({ body: 'Saved target content' })
        expect(moved.draft.validationIssues.length).toBeGreaterThan(0)
        expect(moved.movement?.requestedScheduledAt).toBe(f.publication.scheduledAt)
        expect(
            await f.database.sql
                .statement('select id from jobs where publication_id=?')
                .all(moved.publication.id)
        ).toEqual([])
        expect(
            (await f.store.getPublicationEditorState(f.projectId, f.publication.id, 'operator'))!
                .publication.state
        ).toBe('cancelled')
        // Explicit draft deletion may remove its live link, but not the original or move audit fact.
        expect(
            (
                await f.store.deleteDraftPublication({
                    projectId: f.projectId,
                    subjectId: 'operator',
                    publicationId: moved.publication.id,
                })
            ).kind
        ).toBe('deleted')
        expect(
            (await f.store.getPublicationEditorState(f.projectId, f.publication.id, 'operator'))!
                .publication.state
        ).toBe('cancelled')
        expect(
            await f.database.sql
                .statement(
                    "select id from audit_events where entity_id=? and action='publication.moved'"
                )
                .all(f.publication.id)
        ).toHaveLength(1)
    } finally {
        await closeTestDatabase(f.database)
    }
})
it('rejects stale publication, source and destination profile revisions without touching the original', async () => {
    const f = await fixture()
    try {
        const input = await f.input()
        for (const change of [
            { expectedDraftRevision: 99 },
            { expectedSourceRevision: 99 },
            { expectedPublicationUpdatedAt: 0 },
            { expectedScheduledAt: null },
            { expectedTargetRevisionId: 'other' },
            { expectedTargetProfileVersionId: 'other' },
        ])
            await expect(f.store.movePublication({ ...input, ...change })).rejects.toThrow(
                'changed'
            )
        expect(
            (await f.store.getPublicationEditorState(f.projectId, f.publication.id, 'operator'))!
                .publication.state
        ).toBe('scheduled')
        expect(await f.database.sql.statement('select * from publication_moves').all()).toEqual([])
    } finally {
        await closeTestDatabase(f.database)
    }
})
it('refuses any execution attempt, even when no remote effect occurred or a claim was compensated', async () => {
    const f = await fixture()
    try {
        await f.database.sql
            .statement(
                `insert into jobs(id,project_id,publication_id,state,run_at,attempts,created_at,updated_at,completed_at) values ('attempted',?,?,'cancelled',?,1,?,?,?)`
            )
            .run(f.projectId, f.publication.id, now, now, now, now)
        await expect(f.store.movePublication(await f.input())).rejects.toThrow(
            'without an execution attempt'
        )
        await f.database.sql.statement('update jobs set attempts=0 where id=?').run('attempted')
        const actor = (await f.database.sql
            .statement<{ id: string }, [string]>('select id from actors where project_id=? limit 1')
            .get(f.projectId))!.id
        await f.database.sql
            .statement(
                `insert into audit_events(id,project_id,actor_id,action,entity_type,entity_id,created_at) values ('claim-proof',?,?,'publication.execution.claimed','publication',?,?)`
            )
            .run(f.projectId, actor, f.publication.id, now)
        await expect(f.store.movePublication(await f.input())).rejects.toThrow(
            'without an execution attempt'
        )
    } finally {
        await closeTestDatabase(f.database)
    }
})
it('rolls back cancellation, new work and observer wakeups if move history cannot persist', async () => {
    const f = await fixture()
    try {
        const commits: unknown[] = []
        setDatabaseCommitObserver(f.database, ids => commits.push(ids))
        await installRejectingTrigger(f.database, {
            name: 'reject_move',
            table: 'publication_moves',
            timing: 'before',
            event: 'insert',
            message: 'Move rejected',
        })
        await expect(f.store.movePublication(await f.input())).rejects.toThrow('Move rejected')
        expect(
            (await f.store.getPublicationEditorState(f.projectId, f.publication.id, 'operator'))!
                .publication.state
        ).toBe('scheduled')
        expect(await f.database.sql.statement('select id from publications').all()).toHaveLength(1)
        expect(commits).toEqual([])
    } finally {
        await closeTestDatabase(f.database)
    }
})
it('can recover detached pending work but never write a detached, foreign or archived destination', async () => {
    const f = await fixture()
    try {
        await f.database.sql
            .statement(
                "update project_channel_attachments set state='detached',detached_at=? where project_id=? and channel_id=?"
            )
            .run(now, f.projectId, f.source.id)
        expect((await f.store.movePublication(await f.input()))!.publication.channelId).toBe(
            f.target.id
        )
        const fresh = (await f.store.createPost({
            projectId: f.projectId,
            subjectId: 'operator',
            sourceContent: { body: { format: 'plain_text', text: 'Another' }, media: [] },
            publications: [{ channelId: f.target.id, deliveryMode: 'manual' }],
        }))!.publications[0]!
        expect(await f.store.movePublication({ ...(await f.input(fresh.id, f.source)) })).toBeNull()
        expect(
            await f.store.movePublication({
                ...(await f.input(fresh.id)),
                targetChannelId: 'foreign',
            })
        ).toBeNull()
    } finally {
        await closeTestDatabase(f.database)
    }
})

it('cancels only the old pending job and creates a fresh automatic job without any execution or approval state', async () => {
    const f = await fixture()
    try {
        const workspace = (await f.database.sql
            .statement<{ workspace_id: string }, [string]>(
                'select workspace_id from projects where id=?'
            )
            .get(f.projectId))!.workspace_id
        for (const [id, channel] of [
            ['source-publisher', f.source],
            ['target-publisher', f.target],
        ] as const)
            await f.database.sql
                .statement(
                    "insert into publishers(id,workspace_id,channel_id,kind,created_at,updated_at) values (?,?,?,'move-test',?,?)"
                )
                .run(id, workspace, channel.id, now, now)
        const source = (await f.store.createPost({
            projectId: f.projectId,
            subjectId: 'operator',
            sourceContent: { body: { format: 'plain_text', text: 'Automatic' }, media: [] },
            publications: [
                { channelId: f.source.id, deliveryMode: 'automatic', scheduledAt: now + 60000 },
            ],
        }))!.publications[0]!
        const moved = (await f.store.movePublication({
            ...(await f.input(source.id)),
            deliveryMode: 'automatic',
        }))!
        expect(
            await f.database.sql
                .statement('select state,attempts from jobs where publication_id=?')
                .get(source.id)
        ).toEqual({ state: 'cancelled', attempts: 0 })
        expect(
            await f.database.sql
                .statement(
                    'select state,attempts,run_at,claim_token from jobs where publication_id=?'
                )
                .get(moved.publication.id)
        ).toEqual({ state: 'pending', attempts: 0, run_at: source.scheduledAt, claim_token: null })
        expect(
            await f.database.sql
                .statement('select * from publication_execution_revisions where publication_id=?')
                .all(moved.publication.id)
        ).toEqual([])
    } finally {
        await closeTestDatabase(f.database)
    }
})
it('binds a cadence confirmation to the move and rolls back the first conflicting write', async () => {
    const f = await fixture()
    try {
        await f.store.createPost({
            projectId: f.projectId,
            subjectId: 'operator',
            sourceContent: { body: { format: 'plain_text', text: 'Occupied' }, media: [] },
            publications: [
                {
                    channelId: f.target.id,
                    deliveryMode: 'manual',
                    scheduledAt: f.publication.scheduledAt,
                },
            ],
        })
        const ctx = (await f.store.sharedChannels.contextFor({
            contextProjectId: f.projectId,
            subjectId: 'operator',
            authorization: {
                authorizeProject: async () => true,
                authorizeWorkspace: async () => false,
                authorizeSharing: async () => true,
            },
        }))!
        await f.store.sharedChannels.configureCadence(ctx, {
            channelId: f.target.id,
            expectedRevision: 0,
            dailyMax: 1,
            weeklyMax: null,
            minimumIntervalMs: null,
        })
        let confirmation = ''
        try {
            await f.store.movePublication(await f.input())
            throw new Error('Expected conflict')
        } catch (error) {
            expect(error).toBeInstanceOf(CadenceConflictError)
            confirmation = (error as CadenceConflictError).confirmation
        }
        expect(
            (await f.store.getPublicationEditorState(f.projectId, f.publication.id, 'operator'))!
                .publication.state
        ).toBe('scheduled')
        expect(await f.database.sql.statement('select * from publication_moves').all()).toEqual([])
        expect(
            (await f.store.movePublication({
                ...(await f.input()),
                cadenceConfirmation: confirmation,
            }))!.publication.state
        ).toBe('scheduled')
    } finally {
        await closeTestDatabase(f.database)
    }
})
it('supersedes pending approval without granting a new approval to the replacement', async () => {
    const f = await fixture()
    try {
        const draft = await f.create(null)
        await f.store.submitPublicationForApproval({
            projectId: f.projectId,
            subjectId: 'operator',
            publicationId: draft.id,
            expectedDraftRevision: 1,
            proposedScheduledAt: now + 90000,
        })
        const moved = (await f.store.movePublication(await f.input(draft.id)))!
        expect(moved.publication.state).toBe('draft')
        expect(
            await f.database.sql
                .statement('select state from publication_approval_requests where publication_id=?')
                .get(draft.id)
        ).toEqual({ state: 'superseded' })
        expect(
            await f.database.sql
                .statement('select * from publication_approval_requests where publication_id=?')
                .all(moved.publication.id)
        ).toEqual([])
    } finally {
        await closeTestDatabase(f.database)
    }
})
it('revalidates media references and keeps unavailable media intact for review', async () => {
    const f = await fixture()
    try {
        const target = (await f.store.createChannel({
            projectId: f.projectId,
            subjectId: 'operator',
            name: 'Media review',
            profile: createManualChannelProfile(),
        }))!
        const source = (await f.store.createPost({
            projectId: f.projectId,
            subjectId: 'operator',
            sourceContent: { body: { format: 'plain_text', text: 'Missing media' }, media: [] },
            publications: [
                {
                    channelId: f.source.id,
                    deliveryMode: 'manual',
                    targetContent: {
                        body: 'Saved media',
                        media: [
                            {
                                assetId: 'missing-asset',
                                representationId: 'missing-representation',
                            },
                        ],
                    },
                },
            ],
        }))!.publications[0]!
        const moved = (await f.store.movePublication(await f.input(source.id, target)))!
        expect(moved.draft.content).toEqual({
            body: 'Saved media',
            media: [{ assetId: 'missing-asset', representationId: 'missing-representation' }],
        })
        expect(moved.publication.reviewState).toBe('review_required')
        expect(moved.draft.validationIssues.length).toBeGreaterThan(0)
    } finally {
        await closeTestDatabase(f.database)
    }
})
it('keeps move receipts immutable and permits authorized project graph deletion without foreign-key damage', async () => {
    const f = await fixture()
    try {
        await f.store.movePublication(await f.input())
        await expect(
            f.database.sql
                .statement('update publication_moves set created_at=0 where project_id=?')
                .run(f.projectId)
        ).rejects.toThrow('immutable')
        await f.database.sql.statement('delete from projects where id=?').run(f.projectId)
        expect(await f.database.sql.statement('select * from publication_moves').all()).toEqual([])
        expect(await foreignKeyViolations(f.database)).toEqual([])
    } finally {
        await closeTestDatabase(f.database)
    }
})
