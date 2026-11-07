import { expect, test } from 'bun:test'

import { createManualStore } from '../manual-store'
import { closeTestDatabase, openTestDatabase, seedTestWorkspace } from '../testing'

const sourceContent = { body: { text: 'Shared source', format: 'plain_text' as const }, media: [] }

test('adds current-source drafts atomically without changing existing targets or scheduling jobs', async () => {
    const database = (await openTestDatabase()).database
    try {
        const store = createManualStore(database, { now: () => 1_800_000_000_000 })
        const project = (
            await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Reuse',
                subjectId: 'owner',
                displayName: 'Owner',
            })
        ).project
        const first = (await store.createChannel({
            projectId: project.id,
            subjectId: 'owner',
            name: 'First',
        }))!
        const second = (await store.createChannel({
            projectId: project.id,
            subjectId: 'owner',
            name: 'Second',
        }))!
        const initial = (await store.createPost({
            projectId: project.id,
            subjectId: 'owner',
            sourceContent,
            publications: [{ channelId: first.id, scheduledAt: 1_800_000_010_000 }],
        }))!
        const before = await store.getPublicationEditorState(
            project.id,
            initial.publications[0]!.id,
            'owner'
        )
        const jobsBefore = await database.sql.statement('select * from jobs').all()
        const input = {
            projectId: project.id,
            postId: initial.post.id,
            subjectId: 'owner',
            expectedSourceRevision: 1,
        }
        expect(await store.getPost(project.id, initial.post.id, 'other')).toBeNull()
        await expect(
            store.addPostDestinations({
                ...input,
                expectedSourceRevision: 2,
                publications: [{ channelId: second.id, deliveryMode: 'manual' }],
            })
        ).rejects.toThrow('source post changed')
        await expect(
            store.addPostDestinations({
                ...input,
                publications: [
                    { channelId: second.id, deliveryMode: 'manual' },
                    { channelId: 'missing', deliveryMode: 'manual' },
                ],
            })
        ).rejects.toThrow()
        expect(
            await database.sql.statement('select count(*) as count from publications').get()
        ).toEqual({
            count: 1,
        })
        await expect(
            store.addPostDestinations({
                ...input,
                publications: [{ channelId: first.id, deliveryMode: 'manual' }],
            })
        ).rejects.toThrow('requires confirmation')
        const added = (await store.addPostDestinations({
            ...input,
            confirmExistingChannels: true,
            publications: [
                { channelId: second.id, deliveryMode: 'manual' },
                { channelId: first.id, deliveryMode: 'manual' },
            ],
        }))!
        expect(added.post).toEqual(initial.post)
        expect(added.publications).toHaveLength(2)
        for (const publication of added.publications) {
            expect(publication).toMatchObject({
                postId: initial.post.id,
                state: 'draft',
                scheduledAt: null,
                targetRevisionId: null,
            })
            const editor = (await store.getPublicationEditorState(
                project.id,
                publication.id,
                'owner'
            ))!
            expect(editor.draft.sourceRevision).toBe(1)
            expect(editor.draft.baseSourceContent).toEqual(sourceContent)
        }
        expect(
            await store.getPublicationEditorState(project.id, initial.publications[0]!.id, 'owner')
        ).toEqual(before)
        expect(await database.sql.statement('select * from jobs').all()).toEqual(jobsBefore)
        expect(await database.sql.statement('select count(*) as count from posts').get()).toEqual({
            count: 1,
        })
    } finally {
        await closeTestDatabase(database)
    }
})
