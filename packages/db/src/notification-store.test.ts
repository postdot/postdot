import { describe, expect, it } from 'bun:test'

import { DomainInvariantError } from '@postdot/core'

import { closeDatabase, createDatabase } from './client'
import { createEventJournalStore } from './event-journal-store'
import { createManualStore } from './manual-store'
import { runMigrations } from './migrations'
import { createNotificationStore } from './notification-store'
import { seedTestWorkspace } from './testing'

const eventTime = 1_800_000_000_000
const operationTime = eventTime + 1_000

async function createFixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)
    let nextId = 0
    const createId = () => `generated-${++nextId}`
    const manual = createManualStore(database, { createId, now: () => eventTime - 1_000 })
    const project = await manual.createProject({
        workspaceId: await seedTestWorkspace(database),
        name: 'Postdot',
        subjectId: 'human-1',
        displayName: 'First human',
    })
    const journal = createEventJournalStore(database)
    const notifications = createNotificationStore(database, {
        createId,
        now: () => operationTime,
    })
    return { database, manual, project, journal, notifications }
}

function appendPublicationEvent(
    fixture: Awaited<ReturnType<typeof createFixture>>,
    input: { readonly id: string; readonly name: string; readonly version?: number }
) {
    return fixture.journal.append({
        id: input.id,
        projectId: fixture.project.project.id,
        actorId: fixture.project.actor.id,
        name: input.name,
        version: input.version ?? 1,
        subject: { type: 'publication', id: `publication-${input.id}` },
        occurredAt: eventTime,
    })
}

describe('notification store', () => {
    it('projects supported outcomes once for human actors only', async () => {
        const fixture = await createFixture()
        try {
            fixture.database.$client.run(
                `insert into actors (
                    id, project_id, kind, subject_id, display_name, created_at, updated_at
                ) values ('human-2', ?1, 'human', 'subject-2', 'Second human', 1, 1),
                         ('machine-1', ?1, 'api_token', 'token-1', 'Machine', 1, 1)`,
                [fixture.project.project.id]
            )
            await appendPublicationEvent(fixture, {
                id: 'event-succeeded',
                name: 'publication.execution.succeeded',
            })
            await appendPublicationEvent(fixture, {
                id: 'event-claimed',
                name: 'publication.execution.claimed',
            })

            expect(await fixture.notifications.project(fixture.project.project.id)).toEqual({
                scanned: 3,
                created: 2,
                hasMore: false,
            })
            expect(await fixture.notifications.project(fixture.project.project.id)).toEqual({
                scanned: 0,
                created: 0,
                hasMore: false,
            })
            expect(
                fixture.database.$client
                    .query<{ recipientActorId: string }, []>(
                        'select recipient_actor_id as recipientActorId from notifications order by recipient_actor_id'
                    )
                    .all()
            ).toEqual([
                { recipientActorId: fixture.project.actor.id },
                { recipientActorId: 'human-2' },
            ])
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('uses default preferences and suppresses only future matching items', async () => {
        const fixture = await createFixture()
        try {
            expect(
                await fixture.notifications.listPreferences(fixture.project.project.id, 'human-1')
            ).toEqual([
                { kind: 'publication_published', inAppEnabled: true },
                { kind: 'publication_failed', inAppEnabled: true },
                { kind: 'publication_ambiguous', inAppEnabled: true },
            ])
            await fixture.notifications.updatePreference({
                projectId: fixture.project.project.id,
                subjectId: 'human-1',
                kind: 'publication_failed',
                inAppEnabled: false,
            })
            await appendPublicationEvent(fixture, {
                id: 'event-failed',
                name: 'publication.execution.failed',
            })
            await appendPublicationEvent(fixture, {
                id: 'event-ambiguous',
                name: 'publication.execution.ambiguous',
            })

            await fixture.notifications.project(fixture.project.project.id)
            expect(
                (
                    await fixture.notifications.list({
                        projectId: fixture.project.project.id,
                        subjectId: 'human-1',
                    })
                )?.items.map(notification => notification.kind)
            ).toEqual(['publication_ambiguous'])
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('advances past unsupported versions and resumes from its durable cursor', async () => {
        const fixture = await createFixture()
        try {
            await appendPublicationEvent(fixture, {
                id: 'event-future',
                name: 'publication.execution.succeeded',
                version: 2,
            })
            expect(await fixture.notifications.project(fixture.project.project.id, 1)).toEqual({
                scanned: 1,
                created: 0,
                hasMore: true,
            })

            const restarted = createNotificationStore(fixture.database, {
                createId: () => crypto.randomUUID(),
                now: () => operationTime,
            })
            await appendPublicationEvent(fixture, {
                id: 'event-supported',
                name: 'publication.execution.succeeded',
            })
            while ((await restarted.project(fixture.project.project.id, 1)).hasMore) {}

            expect(
                (
                    await restarted.list({
                        projectId: fixture.project.project.id,
                        subjectId: 'human-1',
                    })
                )?.items.map(notification => notification.sourceEventId)
            ).toEqual(['event-supported'])
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('rolls back inbox writes when cursor advancement fails', async () => {
        const fixture = await createFixture()
        try {
            await appendPublicationEvent(fixture, {
                id: 'event-rollback',
                name: 'publication.execution.failed',
            })
            fixture.database.$client.run(`
                create trigger reject_notification_cursor
                before insert on notification_projection_cursors
                begin
                    select raise(abort, 'cursor rejected');
                end
            `)

            await expect(
                fixture.notifications.project(fixture.project.project.id)
            ).rejects.toThrow()
            expect(
                fixture.database.$client
                    .query<{ count: number }, []>('select count(*) as count from notifications')
                    .get()?.count
            ).toBe(0)

            fixture.database.$client.run('drop trigger reject_notification_cursor')
            expect((await fixture.notifications.project(fixture.project.project.id)).created).toBe(
                1
            )
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('keeps read and archive transitions idempotent and project isolated', async () => {
        const fixture = await createFixture()
        try {
            await appendPublicationEvent(fixture, {
                id: 'event-lifecycle',
                name: 'publication.execution.ambiguous',
            })
            await fixture.notifications.project(fixture.project.project.id)
            const notification = (
                await fixture.notifications.list({
                    projectId: fixture.project.project.id,
                    subjectId: 'human-1',
                })
            )?.items[0]
            expect(notification).toBeDefined()
            expect(
                await fixture.notifications.countUnread(fixture.project.project.id, 'human-1')
            ).toBe(1)

            const firstRead = await fixture.notifications.markRead(
                fixture.project.project.id,
                notification?.id ?? '',
                'human-1'
            )
            const secondRead = await fixture.notifications.markRead(
                fixture.project.project.id,
                notification?.id ?? '',
                'human-1'
            )
            expect(secondRead?.readAt).toBe(firstRead?.readAt)
            expect(
                await fixture.notifications.countUnread(fixture.project.project.id, 'human-1')
            ).toBe(0)

            const archived = await fixture.notifications.archive(
                fixture.project.project.id,
                notification?.id ?? '',
                'human-1'
            )
            expect(archived?.archivedAt).toBe(operationTime)
            expect(
                (
                    await fixture.notifications.list({
                        projectId: fixture.project.project.id,
                        subjectId: 'human-1',
                    })
                )?.items
            ).toEqual([])
            expect(
                (
                    await fixture.notifications.list({
                        projectId: fixture.project.project.id,
                        subjectId: 'human-1',
                        includeArchived: true,
                    })
                )?.items[0]?.id
            ).toBe(notification?.id)
            expect(
                await fixture.notifications.markRead(
                    fixture.project.project.id,
                    notification?.id ?? '',
                    'other-human'
                )
            ).toBeNull()
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('rejects unbounded reads and unknown project identities', async () => {
        const fixture = await createFixture()
        try {
            await expect(
                fixture.notifications.list({
                    projectId: fixture.project.project.id,
                    subjectId: 'human-1',
                    limit: 101,
                })
            ).rejects.toThrow(DomainInvariantError)
            expect(
                await fixture.notifications.list({
                    projectId: fixture.project.project.id,
                    subjectId: 'unknown',
                })
            ).toBeNull()
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('paginates more than the default limit at one timestamp without gaps or duplicates', async () => {
        const fixture = await createFixture()
        try {
            for (let index = 0; index < 55; index += 1) {
                await appendPublicationEvent(fixture, {
                    id: `event-${index}`,
                    name: 'publication.execution.succeeded',
                })
            }
            await fixture.notifications.project(fixture.project.project.id)

            const ids: string[] = []
            let before: string | null | undefined
            do {
                const page = await fixture.notifications.list({
                    projectId: fixture.project.project.id,
                    subjectId: 'human-1',
                    limit: 20,
                    before,
                })
                expect(page).not.toBeNull()
                ids.push(...(page?.items.map(item => item.id) ?? []))
                before = page?.nextCursor
            } while (before !== null && before !== undefined)

            expect(ids).toHaveLength(55)
            expect(new Set(ids).size).toBe(55)
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('rejects malformed inbox cursors', async () => {
        const fixture = await createFixture()
        try {
            for (const before of [
                'invalid',
                'notification:1',
                'notification:01:item',
                'notification:1:',
            ]) {
                await expect(
                    fixture.notifications.list({
                        projectId: fixture.project.project.id,
                        subjectId: 'human-1',
                        before,
                    })
                ).rejects.toThrow(DomainInvariantError)
            }
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('builds one user inbox across projects and keeps projectless notifications supported', async () => {
        const fixture = await createFixture()
        try {
            const second = await fixture.manual.createProject({
                workspaceId: await seedTestWorkspace(fixture.database),
                name: 'Second project',
                subjectId: 'human-1',
                displayName: 'First human',
            })
            const secondEvent = await fixture.journal.append({
                id: 'event-second-project',
                projectId: second.project.id,
                actorId: second.actor.id,
                name: 'publication.execution.succeeded',
                version: 1,
                subject: { type: 'publication', id: 'publication-second-project' },
                occurredAt: eventTime + 1,
            })
            await fixture.notifications.project(second.project.id)

            fixture.database.$client.run(
                `insert into notifications (
                    id, project_id, recipient_user_id, recipient_actor_id, source_event_id,
                    kind, severity, subject_type, subject_id, title, body, created_at
                ) values ('global-notification', null, 'human-1', null, 'system-update-1',
                    'publication_ambiguous', 'warning', 'system', 'system-update-1',
                    'Postdot update available', 'A new Postdot update is available.', ?1)`,
                [eventTime + 2]
            )

            const page = await fixture.notifications.listForUser({ userId: 'human-1' })
            expect(page.items.map(item => item.sourceEventId)).toEqual([
                'system-update-1',
                secondEvent.id,
            ])
            expect(page.items[0]?.projectId).toBeNull()
            expect(page.items[1]?.projectId).toBe(second.project.id)
            expect(await fixture.notifications.countUnreadForUser('human-1')).toBe(2)

            const read = await fixture.notifications.markReadForUser(
                'global-notification',
                'human-1'
            )
            expect(read?.readAt).toBe(operationTime)
            expect(await fixture.notifications.countUnreadForUser('human-1')).toBe(1)
            expect(
                await fixture.notifications.markReadForUser('global-notification', 'other-user')
            ).toBeNull()
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('applies user preferences before project fallbacks during projection', async () => {
        const fixture = await createFixture()
        try {
            await fixture.notifications.updateUserPreference({
                userId: 'human-1',
                kind: 'publication_failed',
                inAppEnabled: false,
            })
            await appendPublicationEvent(fixture, {
                id: 'event-user-preference-failed',
                name: 'publication.execution.failed',
            })
            await fixture.notifications.project(fixture.project.project.id)

            expect((await fixture.notifications.listForUser({ userId: 'human-1' })).items).toEqual(
                []
            )
            expect(await fixture.notifications.listUserPreferences('human-1')).toContainEqual({
                kind: 'publication_failed',
                inAppEnabled: false,
            })
        } finally {
            closeDatabase(fixture.database)
        }
    })
})
