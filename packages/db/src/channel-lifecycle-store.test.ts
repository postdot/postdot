import { describe, expect, it } from 'bun:test'

import { closeDatabase, createDatabase } from './client'
import { createManualStore } from './manual-store'
import { runMigrations } from './migrations'
import { publishers } from './schema'

const now = 1_800_000_000_000

function createFixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const store = createManualStore(database, { now: () => now })
    const project = store.createProject({
        name: 'Channel lifecycle project',
        subjectId: 'user-1',
        displayName: 'Postbot Operator',
    })
    const channel = store.createChannel({
        projectId: project.project.id,
        subjectId: 'user-1',
        name: 'Release notes',
    })
    if (channel === null) throw new Error('The test channel was not created')
    return { channel, database, project, store }
}

describe('channel lifecycle store', () => {
    it('renames, archives, restores, and deletes an empty channel with revisions', () => {
        const fixture = createFixture()

        try {
            expect(fixture.channel).toMatchObject({
                name: 'Release notes',
                state: 'active',
                archivedAt: null,
                revision: 1,
            })

            const renamed = fixture.store.renameChannel({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
                name: 'Product updates',
                expectedRevision: 1,
            })
            expect(renamed).toMatchObject({ name: 'Product updates', revision: 2 })

            const archived = fixture.store.archiveChannel({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
                expectedRevision: 2,
            })
            expect(archived).toMatchObject({
                kind: 'updated',
                channel: { state: 'archived', archivedAt: now, revision: 3 },
            })
            expect(() =>
                fixture.store.createPost({
                    projectId: fixture.project.project.id,
                    subjectId: 'user-1',
                    sourceContent: {
                        body: { text: 'Archived draft', format: 'plain_text' },
                        media: [],
                    },
                    publications: [
                        {
                            channelId: fixture.channel.id,
                            targetContent: { body: 'Archived draft', media: [] },
                        },
                    ],
                })
            ).toThrow('archived channel')

            const restored = fixture.store.restoreChannel({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
                expectedRevision: 3,
            })
            expect(restored).toMatchObject({
                kind: 'updated',
                channel: { state: 'active', archivedAt: null, revision: 4 },
            })

            const archivedAgain = fixture.store.archiveChannel({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
                expectedRevision: 4,
            })
            expect(archivedAgain).toMatchObject({
                kind: 'updated',
                channel: { state: 'archived', revision: 5 },
            })

            expect(
                fixture.store.deleteChannel({
                    projectId: fixture.project.project.id,
                    channelId: fixture.channel.id,
                    subjectId: 'user-1',
                    expectedRevision: 5,
                })
            ).toEqual({ kind: 'deleted' })
            expect(fixture.store.listChannels(fixture.project.project.id, 'user-1')).toEqual([])
            expect(
                fixture.store
                    .listAuditEvents(fixture.project.project.id, 'user-1')
                    ?.map(event => event.action)
            ).toEqual([
                'channel.deleted',
                'channel.archived',
                'channel.restored',
                'channel.archived',
                'channel.renamed',
                'channel.created',
                'project.created',
            ])
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('blocks archive on active work and deletion on retained references', () => {
        const fixture = createFixture()

        try {
            const created = fixture.store.createPost({
                projectId: fixture.project.project.id,
                subjectId: 'user-1',
                sourceContent: {
                    body: { text: 'Scheduled release', format: 'plain_text' },
                    media: [],
                },
                publications: [
                    {
                        channelId: fixture.channel.id,
                        targetContent: { body: 'Scheduled release', media: [] },
                        scheduledAt: now,
                    },
                ],
            })
            expect(created?.publications[0]?.state).toBe('scheduled')

            expect(
                fixture.store.archiveChannel({
                    projectId: fixture.project.project.id,
                    channelId: fixture.channel.id,
                    subjectId: 'user-1',
                    expectedRevision: 1,
                })
            ).toEqual({ kind: 'blocked', blockers: ['active_work'] })
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('blocks deletion while a publisher reference is retained', () => {
        const fixture = createFixture()

        try {
            fixture.store.archiveChannel({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
                expectedRevision: 1,
            })
            fixture.database
                .insert(publishers)
                .values({
                    id: 'publisher-1',
                    projectId: fixture.project.project.id,
                    channelId: fixture.channel.id,
                    kind: 'manual',
                })
                .run()

            expect(
                fixture.store.deleteChannel({
                    projectId: fixture.project.project.id,
                    channelId: fixture.channel.id,
                    subjectId: 'user-1',
                    expectedRevision: 2,
                })
            ).toEqual({ kind: 'blocked', blockers: ['publisher'] })

            fixture.database.$client
                .query('delete from publishers where project_id = ?1 and id = ?2')
                .run(fixture.project.project.id, 'publisher-1')
            expect(
                fixture.store.deleteChannel({
                    projectId: fixture.project.project.id,
                    channelId: fixture.channel.id,
                    subjectId: 'user-1',
                    expectedRevision: 2,
                })
            ).toEqual({ kind: 'deleted' })
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('fails closed on stale revisions and project-scoped access', () => {
        const fixture = createFixture()
        const otherProject = fixture.store.createProject({
            name: 'Other project',
            subjectId: 'user-2',
            displayName: 'Other operator',
        })

        try {
            expect(() =>
                fixture.store.renameChannel({
                    projectId: fixture.project.project.id,
                    channelId: fixture.channel.id,
                    subjectId: 'user-1',
                    name: 'Stale rename',
                    expectedRevision: 2,
                })
            ).toThrow('changed after revision 2')
            expect(
                fixture.store.renameChannel({
                    projectId: otherProject.project.id,
                    channelId: fixture.channel.id,
                    subjectId: 'user-2',
                    name: 'Cross-project rename',
                    expectedRevision: 1,
                })
            ).toBeNull()
        } finally {
            closeDatabase(fixture.database)
        }
    })
})
