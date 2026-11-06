import { describe, expect, it } from 'bun:test'

import { createManualStore } from './manual-store'
import { closeTestDatabase, openTestDatabase, seedTestWorkspace, workspaceOf } from './testing'

const now = 1_800_000_000_000

async function createFixture() {
    const database = (await openTestDatabase()).database
    const store = createManualStore(database, { now: () => now })
    const project = await store.createProject({
        workspaceId: await seedTestWorkspace(database),
        name: 'Channel lifecycle project',
        subjectId: 'user-1',
        displayName: 'Postdot Operator',
    })
    const channel = await store.createChannel({
        projectId: project.project.id,
        subjectId: 'user-1',
        name: 'Release notes',
    })
    if (channel === null) throw new Error('The test channel was not created')
    return { channel, database, project, store }
}

describe('channel lifecycle store', () => {
    it('renames, archives, restores, and deletes an empty channel with revisions', async () => {
        const fixture = await createFixture()

        try {
            expect(fixture.channel).toMatchObject({
                name: 'Release notes',
                state: 'active',
                archivedAt: null,
                revision: 1,
            })

            const renamed = await fixture.store.renameChannel({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
                name: 'Product updates',
                expectedRevision: 1,
            })
            expect(renamed).toMatchObject({ name: 'Product updates', revision: 2 })

            const archived = await fixture.store.archiveChannel({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
                expectedRevision: 2,
            })
            expect(archived).toMatchObject({
                kind: 'updated',
                channel: { state: 'archived', archivedAt: now, revision: 3 },
            })
            await expect(
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
            ).rejects.toThrow('archived channel')

            const restored = await fixture.store.restoreChannel({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
                expectedRevision: 3,
            })
            expect(restored).toMatchObject({
                kind: 'updated',
                channel: { state: 'active', archivedAt: null, revision: 4 },
            })

            const archivedAgain = await fixture.store.archiveChannel({
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
                await fixture.store.deleteChannel({
                    projectId: fixture.project.project.id,
                    channelId: fixture.channel.id,
                    subjectId: 'user-1',
                    expectedRevision: 5,
                })
            ).toEqual({ kind: 'deleted' })
            expect(await fixture.store.listChannels(fixture.project.project.id, 'user-1')).toEqual(
                []
            )
            expect(
                (await fixture.store.listAuditEvents(fixture.project.project.id, 'user-1'))?.map(
                    event => event.action
                )
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
            await closeTestDatabase(fixture.database)
        }
    })

    it('blocks archive on active work and deletion on retained references', async () => {
        const fixture = await createFixture()

        try {
            const created = await fixture.store.createPost({
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
                await fixture.store.archiveChannel({
                    projectId: fixture.project.project.id,
                    channelId: fixture.channel.id,
                    subjectId: 'user-1',
                    expectedRevision: 1,
                })
            ).toEqual({ kind: 'blocked', blockers: ['active_work'] })
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('blocks deletion while a publisher reference is retained', async () => {
        const fixture = await createFixture()

        try {
            await fixture.store.archiveChannel({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
                expectedRevision: 1,
            })
            await fixture.database.sql
                .statement<never, [string, string, string, string]>(
                    'insert into publishers (id, workspace_id, channel_id, kind) values (?1, ?2, ?3, ?4)'
                )
                .run(
                    'publisher-1',
                    await workspaceOf(fixture.database, fixture.project.project.id),
                    fixture.channel.id,
                    'manual'
                )

            expect(
                await fixture.store.deleteChannel({
                    projectId: fixture.project.project.id,
                    channelId: fixture.channel.id,
                    subjectId: 'user-1',
                    expectedRevision: 2,
                })
            ).toEqual({ kind: 'blocked', blockers: ['publisher'] })

            await fixture.database.sql
                .statement('delete from publishers where id = ?1')
                .run('publisher-1')
            expect(
                await fixture.store.deleteChannel({
                    projectId: fixture.project.project.id,
                    channelId: fixture.channel.id,
                    subjectId: 'user-1',
                    expectedRevision: 2,
                })
            ).toEqual({ kind: 'deleted' })
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('fails closed on stale revisions and project-scoped access', async () => {
        const fixture = await createFixture()
        const otherProject = await fixture.store.createProject({
            workspaceId: await seedTestWorkspace(fixture.database),
            name: 'Other project',
            subjectId: 'user-2',
            displayName: 'Other operator',
        })

        try {
            await expect(
                fixture.store.renameChannel({
                    projectId: fixture.project.project.id,
                    channelId: fixture.channel.id,
                    subjectId: 'user-1',
                    name: 'Stale rename',
                    expectedRevision: 2,
                })
            ).rejects.toThrow('changed after revision 2')
            expect(
                await fixture.store.renameChannel({
                    projectId: otherProject.project.id,
                    channelId: fixture.channel.id,
                    subjectId: 'user-2',
                    name: 'Cross-project rename',
                    expectedRevision: 1,
                })
            ).toBeNull()
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })
})
