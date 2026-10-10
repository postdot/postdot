import { expect, test } from 'bun:test'

import { closeDatabase, createDatabase } from '../client'
import { createManualStore } from '../manual-store'
import { runMigrations } from '../migrations'

test('saves a shared source after publication without changing drafts, targets or jobs', () => {
    const database = createDatabase(':memory:')
    try {
        runMigrations(database)
        const store = createManualStore(database, { now: () => 1_800_000_000_000 })
        const projectId = store.createProject({
            name: 'Source editing',
            subjectId: 'owner',
            displayName: 'Owner',
        }).project.id
        const channel = store.createChannel({ projectId, subjectId: 'owner', name: 'Manual' })!
        const initial = store.createPost({
            projectId,
            subjectId: 'owner',
            sourceContent: { body: { text: 'Original', format: 'plain_text' }, media: [] },
            publications: [{ channelId: channel.id, scheduledAt: 1_800_000_000_000 }],
        })!
        const publicationId = initial.publications[0]!.id
        store.publishManualPublication({
            projectId,
            subjectId: 'owner',
            publicationId,
            externalId: 'manual-1',
        })
        const tables = [
            'publications',
            'publication_working_drafts',
            'publication_target_revisions',
            'jobs',
            'publication_approval_requests',
        ]
        const snapshot = () =>
            tables.map(table => database.$client.query(`select * from ${table}`).all())
        const before = snapshot()
        const input = {
            projectId,
            postId: initial.post.id,
            subjectId: 'owner',
            expectedSourceRevision: 1,
            sourceContent: {
                body: { text: 'New shared source', format: 'markdown' as const },
                headline: 'New headline',
                media: [],
            },
        }
        const saved = store.savePostSource(input)!
        expect(saved.sourceRevision).toBe(2)
        expect(saved.sourceContent).toEqual(input.sourceContent)
        expect(snapshot()).toEqual(before)
        expect(store.savePostSource({ ...input, expectedSourceRevision: 2 })).toEqual(saved)
        expect(() =>
            store.savePostSource({
                ...input,
                sourceContent: { body: { text: 'Stale', format: 'plain_text' }, media: [] },
            })
        ).toThrow('source post changed')
        expect(store.getPost(projectId, initial.post.id, 'owner')).toEqual(saved)
        expect(store.savePostSource({ ...input, subjectId: 'outsider' })).toBeNull()
        expect(() =>
            store.savePostSource({
                ...input,
                expectedSourceRevision: 2,
                sourceContent: { media: [] },
            })
        ).toThrow()
        expect(() =>
            store.savePostSource({
                ...input,
                expectedSourceRevision: 2,
                sourceContent: { media: [{ assetId: 'foreign-or-missing' }] },
            })
        ).toThrow('Source media')
        expect(store.getPost(projectId, initial.post.id, 'owner')).toEqual(saved)
        expect(snapshot()).toEqual(before)
        const events = database.$client
            .query<{ action: string; metadata: string }, []>(
                "select action, metadata_json as metadata from audit_events where action = 'post.source.updated'"
            )
            .all()
        expect(events).toHaveLength(1)
        expect(JSON.parse(events[0]!.metadata)).toEqual({
            fromSourceRevision: 1,
            toSourceRevision: 2,
        })
        expect(events[0]!.metadata).not.toContain('New shared source')
    } finally {
        closeDatabase(database)
    }
})
