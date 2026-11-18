import { expect, test } from 'bun:test'

import { createManualChannelProfile } from '@postdot/core'

import { createManualStore } from '../manual-store'
import { closeTestDatabase, openTestDatabase, seedTestWorkspace, workspaceOf } from '../testing'
import { PostCompositionConflictError } from './post-composition-conflict'

const source = (text: string) => ({ body: { text, format: 'plain_text' as const }, media: [] })
const target = (body: string) => ({ body, media: [] })
const now = 1_800_000_000_000

async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
    const f = await setup()
    try {
        await run(f)
    } finally {
        await closeTestDatabase(f.database)
    }
}
async function setup() {
    const database = (await openTestDatabase()).database
    const store = createManualStore(database, { now: () => now })
    const projectId = (
        await store.createProject({
            workspaceId: await seedTestWorkspace(database),
            name: 'Composition',
            subjectId: 'owner',
            displayName: 'Owner',
        })
    ).project.id
    const channels = []
    for (let i = 0; i < 4; i++) {
        channels.push(
            (await store.createChannel({ projectId, subjectId: 'owner', name: `Channel ${i}` }))!
        )
    }
    const created = (await store.createPost({
        projectId,
        subjectId: 'owner',
        sourceContent: source('Original'),
        publications: channels.map(channel => ({ channelId: channel.id })),
    }))!
    const ids = created.publications.map(publication => publication.id)
    const input = {
        projectId,
        postId: created.post.id,
        subjectId: 'owner',
        expectedSourceRevision: 1,
    }
    const editor = (publicationId: string) =>
        store.getPublicationEditorState(projectId, publicationId, 'owner')
    const snapshot = async () => {
        const result = []
        for (const table of [
            'posts',
            'publications',
            'publication_working_drafts',
            'publication_target_revisions',
            'jobs',
            'publication_approval_requests',
            'audit_events',
        ]) {
            result.push(await database.sql.statement(`select * from ${table} order by id`).all())
        }
        return result
    }
    return { database, store, projectId, created, ids, input, editor, snapshot }
}

test('composition writes source and two drafts once, preserving selected targets and jobs', async () => {
    await fixture(async f => {
        const before = await f.editor(f.ids[0]!)
        const result = (await f.store.savePostComposition({
            ...f.input,
            sourceContent: source('Changed'),
            publications: f.ids.slice(0, 2).map(publicationId => ({
                publicationId,
                expectedRevision: 1,
                targetContent: target('Changed'),
            })),
        }))!
        expect(result.post.sourceRevision).toBe(2)
        expect(result.publications).toHaveLength(2)
        for (const editor of result.publications) {
            expect(editor.draft).toMatchObject({
                revision: 2,
                sourceRevision: 2,
                baseSourceContent: source('Changed'),
                content: target('Changed'),
                reviewState: 'compatible',
            })
            expect(editor.publication.state).toBe('draft')
        }
        expect(result.publications[0]!.publication.targetRevisionId).toBe(
            before!.publication.targetRevisionId
        )
        expect(result.publications[0]!.selectedTarget).toEqual(before!.selectedTarget)
        expect(await f.database.sql.statement('select * from jobs').all()).toEqual([])
        expect(
            await f.database.sql
                .statement("select * from audit_events where action = 'post.source.updated'")
                .all()
        ).toHaveLength(1)
    })
})

test('composition reports every stale draft and rolls back the source and all drafts', async () => {
    await fixture(async f => {
        await f.store.savePublicationDraft({
            projectId: f.projectId,
            publicationId: f.ids[1]!,
            subjectId: 'owner',
            expectedRevision: 1,
            targetContent: target('Elsewhere'),
        })
        const before = await f.snapshot()
        await expect(
            f.store.savePostComposition({
                ...f.input,
                sourceContent: source('Changed'),
                publications: [
                    {
                        publicationId: f.ids[0]!,
                        expectedRevision: 1,
                        targetContent: target('Changed'),
                    },
                    { publicationId: f.ids[1]!, expectedRevision: 1 },
                    { publicationId: f.ids[2]!, expectedRevision: 99 },
                ],
            })
        ).rejects.toMatchObject({
            code: 'write_conflict',
            conflictingPublicationIds: [f.ids[1], f.ids[2]],
        })
        expect(await f.snapshot()).toEqual(before)
    })
})

test('source conflicts identify all listed publications and support source-only saves', async () => {
    await fixture(async f => {
        await f.store.savePostSource({ ...f.input, sourceContent: source('Elsewhere') })
        const before = await f.snapshot()
        await expect(
            f.store.savePostComposition({
                ...f.input,
                publications: f.ids
                    .slice(0, 2)
                    .map(publicationId => ({ publicationId, expectedRevision: 1 })),
            })
        ).rejects.toMatchObject({ conflictingPublicationIds: f.ids.slice(0, 2) })
        await expect(
            f.store.savePostComposition({ ...f.input, publications: [] })
        ).rejects.toBeInstanceOf(PostCompositionConflictError)
        expect(await f.snapshot()).toEqual(before)
    })
})

test('unlisted unaffected siblings stay current and affected siblings stay behind', async () => {
    await fixture(async f => {
        await f.store.savePublicationDraft({
            projectId: f.projectId,
            publicationId: f.ids[2]!,
            subjectId: 'owner',
            expectedRevision: 1,
            targetContent: target('Changed'),
        })
        await f.store.savePostComposition({
            ...f.input,
            sourceContent: source('Changed'),
            publications: f.ids.slice(0, 2).map(publicationId => ({
                publicationId,
                expectedRevision: 1,
                targetContent: target('Changed'),
            })),
        })
        expect((await f.editor(f.ids[2]!))!.draft).toMatchObject({
            revision: 3,
            sourceRevision: 2,
            baseSourceContent: source('Changed'),
            content: target('Changed'),
        })
        expect((await f.editor(f.ids[3]!))!.draft).toMatchObject({
            revision: 1,
            sourceRevision: 1,
            content: target('Original'),
        })
    })
})

test('a locked listed publication rolls back earlier writes, including source and approval superseding', async () => {
    await fixture(async f => {
        await f.store.submitPublicationForApproval({
            projectId: f.projectId,
            publicationId: f.ids[0]!,
            subjectId: 'owner',
            expectedDraftRevision: 1,
            proposedScheduledAt: now + 60000,
        })
        await f.database.sql
            .statement("update publications set state = 'cancelled' where id = ?1")
            .run(f.ids[1]!)
        const before = await f.snapshot()
        await expect(
            f.store.savePostComposition({
                ...f.input,
                sourceContent: source('Changed'),
                publications: f.ids.slice(0, 2).map(publicationId => ({
                    publicationId,
                    expectedRevision: 1,
                    targetContent: target('Changed'),
                })),
            })
        ).rejects.toMatchObject({ code: 'invalid_transition' })
        expect(await f.snapshot()).toEqual(before)
    })
})

test('composition supersedes pending approvals and keeps invalid content as review required', async () => {
    await fixture(async f => {
        await f.store.submitPublicationForApproval({
            projectId: f.projectId,
            publicationId: f.ids[0]!,
            subjectId: 'owner',
            expectedDraftRevision: 1,
            proposedScheduledAt: now + 60000,
        })
        const result = (await f.store.savePostComposition({
            ...f.input,
            publications: [
                {
                    publicationId: f.ids[0]!,
                    expectedRevision: 1,
                    targetContent: { body: 42, media: [] },
                },
            ],
        }))!
        expect(result.post.sourceRevision).toBe(1)
        expect(result.publications[0]!.draft.reviewState).toBe('review_required')
        expect(result.publications[0]!.draft.validationIssues.length).toBeGreaterThan(0)
        expect(
            await f.database.sql
                .statement("select * from publication_approval_requests where state = 'superseded'")
                .all()
        ).toHaveLength(1)
        expect(
            await f.database.sql
                .statement(
                    "select * from audit_events where action = 'publication.approval_superseded'"
                )
                .all()
        ).toHaveLength(1)
    })
})

test('composition rejects duplicate and foreign publications without writes', async () => {
    await fixture(async f => {
        const item = { publicationId: f.ids[0]!, expectedRevision: 1 }
        const foreign = (await f.store.createPost({
            projectId: f.projectId,
            subjectId: 'owner',
            sourceContent: source('Other'),
            publications: [{ channelId: f.created.publications[0]!.channelId }],
        }))!
        const before = await f.snapshot()
        for (const publications of [
            [item, item],
            [{ ...item, publicationId: foreign.publications[0]!.id }],
        ]) {
            await expect(
                f.store.savePostComposition({
                    ...f.input,
                    sourceContent: source('Changed'),
                    publications,
                })
            ).rejects.toMatchObject({ code: 'invalid_input' })
            expect(await f.snapshot()).toEqual(before)
        }
    })
})

test('composition preserves omitted content and settings and rejects draft scheduling or mode changes', async () => {
    await fixture(async f => {
        const result = (await f.store.savePostComposition({
            ...f.input,
            publications: [
                {
                    publicationId: f.ids[0]!,
                    expectedRevision: 1,
                    deliveryMode: 'manual',
                    scheduledAt: null,
                },
            ],
        }))!
        expect(result.publications[0]!.draft.content).toEqual(target('Original'))
        const before = await f.snapshot()
        for (const settings of [
            { scheduledAt: now + 60000 },
            { deliveryMode: 'automatic' as const },
        ]) {
            await expect(
                f.store.savePostComposition({
                    ...f.input,
                    sourceContent: source('Changed'),
                    publications: [{ publicationId: f.ids[0]!, expectedRevision: 2, ...settings }],
                })
            ).rejects.toMatchObject({ code: 'invalid_transition' })
            expect(await f.snapshot()).toEqual(before)
        }
    })
})

test('composition validates source media and reschedules existing publications without promotion', async () => {
    await fixture(async f => {
        const before = await f.snapshot()
        await expect(
            f.store.savePostComposition({
                ...f.input,
                sourceContent: { media: [{ assetId: 'missing' }] },
                publications: [],
            })
        ).rejects.toThrow('Source media')
        expect(await f.snapshot()).toEqual(before)
        await f.store.promotePublicationDraft({
            projectId: f.projectId,
            publicationId: f.ids[0]!,
            subjectId: 'owner',
            expectedRevision: 1,
            scheduledAt: now + 60000,
        })
        const previous = (await f.editor(f.ids[0]!))!
        const result = (await f.store.savePostComposition({
            ...f.input,
            publications: [
                {
                    publicationId: f.ids[0]!,
                    expectedRevision: previous.draft.revision,
                    scheduledAt: now + 120000,
                },
            ],
        }))!
        expect(result.publications[0]!.publication).toMatchObject({
            state: 'scheduled',
            scheduledAt: now + 120000,
            targetRevisionId: previous.publication.targetRevisionId,
        })
        expect(result.publications[0]!.selectedTarget).toEqual(previous.selectedTarget)
    })
})

test('composition accepts an existing source revision for stale listed drafts and preserves omitted target content', async () => {
    await fixture(async f => {
        await f.store.savePostSource({ ...f.input, sourceContent: source('Elsewhere') })
        const result = (await f.store.savePostComposition({
            ...f.input,
            expectedSourceRevision: 2,
            publications: [{ publicationId: f.ids[0]!, expectedRevision: 1 }],
        }))!
        expect(result.post.sourceRevision).toBe(2)
        expect(result.publications[0]!.draft).toMatchObject({
            revision: 2,
            sourceRevision: 2,
            baseSourceContent: source('Elsewhere'),
            content: target('Original'),
        })
        expect((await f.editor(f.ids[1]!))!.draft.sourceRevision).toBe(1)
    })
})

test('source-only composition saves keep unaffected siblings current without rewriting targets', async () => {
    await fixture(async f => {
        await f.store.savePublicationDraft({
            projectId: f.projectId,
            publicationId: f.ids[0]!,
            subjectId: 'owner',
            expectedRevision: 1,
            targetContent: target('Changed'),
        })
        const result = (await f.store.savePostComposition({
            ...f.input,
            sourceContent: source('Changed'),
            publications: [],
        }))!
        expect(result.post.sourceRevision).toBe(2)
        expect(result.publications).toEqual([])
        expect((await f.editor(f.ids[0]!))!.draft).toMatchObject({ revision: 3, sourceRevision: 2 })
        expect((await f.editor(f.ids[1]!))!.draft).toMatchObject({ revision: 1, sourceRevision: 1 })
    })
})

test('composition rolls back source and draft writes when a changed schedule is invalid', async () => {
    await fixture(async f => {
        await f.store.promotePublicationDraft({
            projectId: f.projectId,
            publicationId: f.ids[0]!,
            subjectId: 'owner',
            expectedRevision: 1,
            scheduledAt: now + 60000,
        })
        const previous = (await f.editor(f.ids[0]!))!
        const before = await f.snapshot()
        for (const scheduledAt of [null, now - 1]) {
            await expect(
                f.store.savePostComposition({
                    ...f.input,
                    sourceContent: source('Changed'),
                    publications: [
                        {
                            publicationId: f.ids[0]!,
                            expectedRevision: previous.draft.revision,
                            scheduledAt,
                        },
                    ],
                })
            ).rejects.toThrow(
                scheduledAt === null ? 'Removing a schedule' : 'scheduledAt must not be before now'
            )
            expect(await f.snapshot()).toEqual(before)
        }
    })
})

test('composition rejects a started thread even when the publication is scheduled again', async () => {
    await fixture(async f => {
        const channel = (await f.store.createChannel({
            projectId: f.projectId,
            subjectId: 'owner',
            name: 'Thread',
            profile: {
                ...createManualChannelProfile(),
                execution: { kind: 'built_in', contractId: 'thread-test', revision: 'v1' },
            },
        }))!
        await f.database.sql
            .statement(
                'insert into publishers(id, workspace_id, channel_id, kind) values (?1, ?2, ?3, ?4)'
            )
            .run(
                'thread-publisher',
                await workspaceOf(f.database, f.projectId),
                channel.id,
                'thread-test'
            )
        const added = (await f.store.addPostDestinations({
            ...f.input,
            publications: [{ channelId: channel.id, deliveryMode: 'automatic' }],
        }))!
        const publicationId = added.publications[0]!.id
        await f.store.promotePublicationDraft({
            projectId: f.projectId,
            publicationId,
            subjectId: 'owner',
            expectedRevision: 1,
            scheduledAt: now + 60000,
        })
        await f.database.sql
            .statement(`
            insert into publication_execution_revisions(
                id, project_id, job_id, publication_id, target_revision_id, profile_version_id,
                delivery_mode, content_json, content_hash, profile_hash, schema_hash, created_at
            )
            select 'thread-execution', targets.project_id, jobs.id, targets.publication_id,
                targets.id, targets.profile_version_id, targets.delivery_mode, targets.content_json,
                targets.content_hash, targets.profile_hash, targets.schema_hash, targets.created_at
            from publication_target_revisions targets
            inner join jobs on jobs.project_id = targets.project_id and jobs.publication_id = targets.publication_id
            where targets.publication_id = ?1
        `)
            .run(publicationId)
        await f.database.sql
            .statement(`
            insert into publication_thread_messages(project_id, execution_revision_id, position, state, external_id)
            values (?1, 'thread-execution', 0, 'confirmed', 'first-message')
        `)
            .run(f.projectId)
        const before = await f.snapshot()
        await expect(
            f.store.savePostComposition({
                ...f.input,
                sourceContent: source('Changed'),
                publications: [
                    { publicationId, expectedRevision: 1, targetContent: target('Changed') },
                ],
            })
        ).rejects.toThrow('A started thread keeps its original version')
        expect(await f.snapshot()).toEqual(before)
    })
})

test('composition assesses unavailable target media exactly like an individual draft save', async () => {
    await fixture(async f => {
        const content = { body: 'Changed', media: [{ assetId: 'missing' }] }
        const individual = (await f.store.savePublicationDraft({
            projectId: f.projectId,
            publicationId: f.ids[0]!,
            subjectId: 'owner',
            expectedRevision: 1,
            targetContent: content,
        }))!
        const result = (await f.store.savePostComposition({
            ...f.input,
            publications: [
                { publicationId: f.ids[1]!, expectedRevision: 1, targetContent: content },
            ],
        }))!
        expect(result.publications[0]!.draft.reviewState).toBe('review_required')
        expect(result.publications[0]!.draft.validationIssues).toEqual(individual.validationIssues)
        expect(individual.validationIssues.length).toBeGreaterThan(0)
    })
})
