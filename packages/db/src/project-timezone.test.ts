import { describe, expect, it } from 'bun:test'

import { createManualStore } from './manual-store'
import { closeTestDatabase, openTestDatabase, seedTestWorkspace } from './testing'

describe('project scheduling timezone', () => {
    it('persists a validated timezone and records an owner change without moving data', async () => {
        const database = (await openTestDatabase()).database

        try {
            const store = createManualStore(database, { now: () => 1_800_000_000_000 })
            const created = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Timezone project',
                subjectId: 'user-1',
                displayName: 'Operator',
                timeZone: 'America/New_York',
            })

            expect(created.project.timeZone).toBe('America/New_York')
            expect(await store.listProjects('user-1')).toEqual([created.project])

            const updated = await store.updateProjectTimeZone({
                projectId: created.project.id,
                subjectId: 'user-1',
                timeZone: 'Europe/Paris',
            })

            expect(updated).toEqual({ ...created.project, timeZone: 'Europe/Paris' })
            expect((await store.listProjects('user-1'))[0]?.timeZone).toBe('Europe/Paris')

            const events = await store.listAuditEvents(created.project.id, 'user-1')
            expect(events?.[0]).toMatchObject({
                action: 'project.timezone_updated',
                entityId: created.project.id,
                metadataJson: JSON.stringify({ from: 'America/New_York', to: 'Europe/Paris' }),
            })
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('defaults new projects to UTC and rejects invalid or unauthorized changes', async () => {
        const database = (await openTestDatabase()).database

        try {
            const store = createManualStore(database, { now: () => 1_800_000_000_000 })
            const created = await store.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: 'Default timezone project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })

            expect(created.project.timeZone).toBe('UTC')
            await expect(
                store.updateProjectTimeZone({
                    projectId: created.project.id,
                    subjectId: 'user-1',
                    timeZone: '+02:00',
                })
            ).rejects.toThrow('timeZone must be a valid IANA time zone identifier')
            expect(
                await store.updateProjectTimeZone({
                    projectId: created.project.id,
                    subjectId: 'other-user',
                    timeZone: 'Europe/Paris',
                })
            ).toBeNull()
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('counts upcoming scheduled and ready publications per project in one batch', async () => {
        const database = (await openTestDatabase()).database
        const now = 1_800_000_000_000

        try {
            const store = createManualStore(database, { now: () => now })
            const workspaceId = await seedTestWorkspace(database)
            const first = await store.createProject({
                workspaceId,
                name: 'First project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const second = await store.createProject({
                workspaceId,
                name: 'Second project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const empty = await store.createProject({
                workspaceId,
                name: 'Empty project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })

            const firstChannel = await store.createChannel({
                projectId: first.project.id,
                subjectId: 'user-1',
                name: 'First manual',
            })
            const secondChannel = await store.createChannel({
                projectId: second.project.id,
                subjectId: 'user-1',
                name: 'Second manual',
            })
            expect(firstChannel).not.toBeNull()
            expect(secondChannel).not.toBeNull()

            const createdFirst = await store.createPost({
                projectId: first.project.id,
                subjectId: 'user-1',
                sourceContent: {
                    body: { text: 'Scheduled post', format: 'plain_text' },
                    media: [],
                },
                publications: [
                    {
                        channelId: firstChannel!.id,
                        deliveryMode: 'manual',
                        scheduledAt: now + 60_000,
                    },
                ],
            })
            const createdDraft = await store.createPost({
                projectId: first.project.id,
                subjectId: 'user-1',
                sourceContent: { body: { text: 'Draft post', format: 'plain_text' }, media: [] },
                publications: [{ channelId: firstChannel!.id, deliveryMode: 'manual' }],
            })
            const createdReady = await store.createPost({
                projectId: first.project.id,
                subjectId: 'user-1',
                sourceContent: { body: { text: 'Ready post', format: 'plain_text' }, media: [] },
                publications: [
                    {
                        channelId: firstChannel!.id,
                        deliveryMode: 'manual',
                        scheduledAt: now + 120_000,
                    },
                ],
            })
            const createdPast = await store.createPost({
                projectId: second.project.id,
                subjectId: 'user-1',
                sourceContent: { body: { text: 'Past post', format: 'plain_text' }, media: [] },
                publications: [
                    {
                        channelId: secondChannel!.id,
                        deliveryMode: 'manual',
                        scheduledAt: now + 30_000,
                    },
                ],
            })
            expect(createdFirst?.publications).toHaveLength(1)
            expect(createdDraft?.publications).toHaveLength(1)
            expect(createdReady?.publications).toHaveLength(1)
            expect(createdPast?.publications).toHaveLength(1)

            await database.sql
                .statement("update publications set state = 'ready' where id = ?1")
                .run(createdReady!.publications[0]!.id)
            await database.sql
                .statement('update publications set scheduled_at = ?1 where id = ?2')
                .run(now - 1_000, createdPast!.publications[0]!.id)

            expect(await store.countUpcomingScheduledPublications([])).toEqual(new Map())

            const counts = await store.countUpcomingScheduledPublications([
                first.project.id,
                second.project.id,
                empty.project.id,
            ])
            expect(counts.get(first.project.id)).toBe(2)
            expect(counts.get(second.project.id) ?? 0).toBe(0)
            expect(counts.get(empty.project.id) ?? 0).toBe(0)
        } finally {
            await closeTestDatabase(database)
        }
    })
})
