import { expect, test } from 'bun:test'

import { createManualStore } from '../manual-store'
import { closeTestDatabase, openTestDatabase, seedTestWorkspace } from '../testing'

test('saves a shared source after publication without changing drafts, targets or jobs', async () => {
    const database = (await openTestDatabase()).database
    try {
        const store = createManualStore(database, { now: () => 1_800_000_000_000 })
        const projectId = (
            await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Source editing',
                subjectId: 'owner',
                displayName: 'Owner',
            })
        ).project.id
        const channel = (await store.createChannel({
            projectId,
            subjectId: 'owner',
            name: 'Manual',
        }))!
        const initial = (await store.createPost({
            projectId,
            subjectId: 'owner',
            sourceContent: { body: { text: 'Original', format: 'plain_text' }, media: [] },
            publications: [{ channelId: channel.id, scheduledAt: 1_800_000_000_000 }],
        }))!
        const publicationId = initial.publications[0]!.id
        await store.publishManualPublication({
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
            tables.map(async table => await database.sql.statement(`select * from ${table}`).all())
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
        const saved = (await store.savePostSource(input))!
        expect(saved.sourceRevision).toBe(2)
        expect(saved.sourceContent).toEqual(input.sourceContent)
        expect(snapshot()).toEqual(before)
        expect(await store.savePostSource({ ...input, expectedSourceRevision: 2 })).toEqual(saved)
        await expect(
            store.savePostSource({
                ...input,
                sourceContent: { body: { text: 'Stale', format: 'plain_text' }, media: [] },
            })
        ).rejects.toThrow('source post changed')
        expect(await store.getPost(projectId, initial.post.id, 'owner')).toEqual(saved)
        expect(await store.savePostSource({ ...input, subjectId: 'outsider' })).toBeNull()
        await expect(
            store.savePostSource({
                ...input,
                expectedSourceRevision: 2,
                sourceContent: { media: [] },
            })
        ).rejects.toThrow()
        await expect(
            store.savePostSource({
                ...input,
                expectedSourceRevision: 2,
                sourceContent: { media: [{ assetId: 'foreign-or-missing' }] },
            })
        ).rejects.toThrow('Source media')
        expect(await store.getPost(projectId, initial.post.id, 'owner')).toEqual(saved)
        expect(snapshot()).toEqual(before)
        const events = await database.sql
            .statement<{ action: string; metadata: string }, []>(
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
        await closeTestDatabase(database)
    }
})
