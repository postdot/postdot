import { expect, test } from 'bun:test'

import { closeDatabase, createDatabase } from '../client'
import { createManualStore } from '../manual-store'
import { runMigrations } from '../migrations'

const sourceContent = { body: { text: 'Shared source', format: 'plain_text' as const }, media: [] }

test('adds current-source drafts atomically without changing existing targets or scheduling jobs', () => {
    const database = createDatabase(':memory:')
    try {
        runMigrations(database)
        const store = createManualStore(database, { now: () => 1_800_000_000_000 })
        const project = store.createProject({
            name: 'Reuse',
            subjectId: 'owner',
            displayName: 'Owner',
        }).project
        const first = store.createChannel({
            projectId: project.id,
            subjectId: 'owner',
            name: 'First',
        })!
        const second = store.createChannel({
            projectId: project.id,
            subjectId: 'owner',
            name: 'Second',
        })!
        const initial = store.createPost({
            projectId: project.id,
            subjectId: 'owner',
            sourceContent,
            publications: [{ channelId: first.id, scheduledAt: 1_800_000_010_000 }],
        })!
        const before = store.getPublicationEditorState(
            project.id,
            initial.publications[0]!.id,
            'owner'
        )
        const jobsBefore = database.$client.query('select * from jobs').all()
        const input = {
            projectId: project.id,
            postId: initial.post.id,
            subjectId: 'owner',
            expectedSourceRevision: 1,
        }
        expect(store.getPost(project.id, initial.post.id, 'other')).toBeNull()
        expect(() =>
            store.addPostDestinations({
                ...input,
                expectedSourceRevision: 2,
                publications: [{ channelId: second.id, deliveryMode: 'manual' }],
            })
        ).toThrow('source post changed')
        expect(() =>
            store.addPostDestinations({
                ...input,
                publications: [
                    { channelId: second.id, deliveryMode: 'manual' },
                    { channelId: 'missing', deliveryMode: 'manual' },
                ],
            })
        ).toThrow()
        expect(database.$client.query('select count(*) as count from publications').get()).toEqual({
            count: 1,
        })
        expect(() =>
            store.addPostDestinations({
                ...input,
                publications: [{ channelId: first.id, deliveryMode: 'manual' }],
            })
        ).toThrow('requires confirmation')
        const added = store.addPostDestinations({
            ...input,
            confirmExistingChannels: true,
            publications: [
                { channelId: second.id, deliveryMode: 'manual' },
                { channelId: first.id, deliveryMode: 'manual' },
            ],
        })!
        expect(added.post).toEqual(initial.post)
        expect(added.publications).toHaveLength(2)
        for (const publication of added.publications) {
            expect(publication).toMatchObject({
                postId: initial.post.id,
                state: 'draft',
                scheduledAt: null,
                targetRevisionId: null,
            })
            const editor = store.getPublicationEditorState(project.id, publication.id, 'owner')!
            expect(editor.draft.sourceRevision).toBe(1)
            expect(editor.draft.baseSourceContent).toEqual(sourceContent)
        }
        expect(
            store.getPublicationEditorState(project.id, initial.publications[0]!.id, 'owner')
        ).toEqual(before)
        expect(database.$client.query('select * from jobs').all()).toEqual(jobsBefore)
        expect(database.$client.query('select count(*) as count from posts').get()).toEqual({
            count: 1,
        })
    } finally {
        closeDatabase(database)
    }
})
