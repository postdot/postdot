import { describe, expect, it } from 'bun:test'

import { DomainInvariantError } from '@postdot/core'

import { type DatabaseHandle } from './client'
import {
    createEventJournalStore,
    eventJournalCursorSequence,
    parseEventJournalCursor,
} from './event-journal-store'
import { closeTestDatabase, openTestDatabase } from './testing'

async function seedProject(database: DatabaseHandle, suffix: string) {
    const projectId = `project-${suffix}`
    const actorId = `actor-${suffix}`
    await database.sql
        .statement(`insert into projects (id, name, created_at, updated_at)
         values (?1, ?2, 100, 100)`)
        .run(projectId, `Project ${suffix}`)
    await database.sql
        .statement(`insert into actors (id, project_id, kind, display_name, created_at, updated_at)
         values (?1, ?2, 'human', ?3, 100, 100)`)
        .run(actorId, projectId, `Actor ${suffix}`)
    return { projectId, actorId }
}

function eventInput(project: Awaited<ReturnType<typeof seedProject>>, suffix: string) {
    return {
        projectId: project.projectId,
        actorId: project.actorId,
        name: 'publication.published',
        version: 2,
        subject: { type: 'publication', id: `publication-${suffix}` },
        payload: { externalId: `remote-${suffix}` },
        occurredAt: 1_800_000_000_000,
        correlationId: `correlation-${suffix}`,
        causationId: `causation-${suffix}`,
    } as const
}

describe('event journal store', () => {
    it('returns no cursor for an empty journal, including a zero sqlite sequence', async () => {
        const database = (await openTestDatabase()).database
        try {
            // SQLite keeps an explicit zero high-water row; PostgreSQL's sequence starts uncalled.
            if (database.sql.dialect === 'sqlite') {
                await database.sql.exec(
                    "insert into sqlite_sequence (name, seq) values ('audit_events', 0)"
                )
            }

            const store = createEventJournalStore(database)

            expect(await store.latestCursor()).toBeNull()
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('persists versioned facts and reads equal-timestamp entries in append order', async () => {
        const database = (await openTestDatabase()).database
        try {
            const firstProject = await seedProject(database, 'first')
            const secondProject = await seedProject(database, 'second')
            let nextId = 0
            const store = createEventJournalStore(database, {
                createId: () => `event-${++nextId}`,
            })

            const first = await store.append(eventInput(firstProject, 'first'))
            const second = await store.append(eventInput(firstProject, 'second'))
            await store.append(eventInput(secondProject, 'hidden'))
            const hidden = (await store.readAfter({ projectId: secondProject.projectId }))[0]
            if (hidden === undefined) throw new Error('The hidden event was not persisted')

            expect(await store.readAfter({ projectId: firstProject.projectId })).toEqual([
                first,
                second,
            ])
            expect(await store.latestCursor()).toBe(hidden.cursor)
            expect(eventJournalCursorSequence(second.cursor)).toBe(2)
            expect(
                await store.readAfter({ projectId: firstProject.projectId, after: first.cursor })
            ).toEqual([second])
            expect(await store.readAllAfter({ after: first.cursor })).toEqual([second, hidden])
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('validates envelopes before persistence', async () => {
        const database = (await openTestDatabase()).database
        try {
            const project = await seedProject(database, 'validation')
            const store = createEventJournalStore(database)

            await expect(
                store.append({ ...eventInput(project, 'invalid'), version: 0 })
            ).rejects.toThrow(DomainInvariantError)
            expect(await store.readAfter({ projectId: project.projectId })).toEqual([])
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('validates persisted consumer cursors before reuse', () => {
        expect(String(parseEventJournalCursor('event-sequence:42'))).toBe('event-sequence:42')
        expect(() => parseEventJournalCursor('42')).toThrow(DomainInvariantError)
        expect(() => parseEventJournalCursor('event-sequence:0')).toThrow(DomainInvariantError)
    })

    it('participates in a surrounding SQLite transaction', async () => {
        const database = (await openTestDatabase()).database
        try {
            const project = await seedProject(database, 'rollback')
            const store = createEventJournalStore(database, { createId: () => 'event-fixed' })
            await store.append(eventInput(project, 'existing'))

            const changeAndAppend = () =>
                database.sql.transaction(async () => {
                    await database.sql
                        .statement<never, [string]>(
                            `update projects set name = 'Changed' where id = ?1`
                        )
                        .run(project.projectId)
                    await store.append(eventInput(project, 'duplicate'))
                })

            await expect(changeAndAppend()).rejects.toThrow()
            expect(
                (
                    await database.sql
                        .statement<{ name: string }, [string]>(
                            'select name from projects where id = ?1'
                        )
                        .get(project.projectId)
                )?.name
            ).toBe('Project rollback')
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('never reuses a cursor after the project owning the latest event is deleted', async () => {
        const database = (await openTestDatabase()).database
        try {
            const firstProject = await seedProject(database, 'deleted')
            const secondProject = await seedProject(database, 'surviving')
            let nextId = 0
            const store = createEventJournalStore(database, {
                createId: () => `event-monotonic-${++nextId}`,
            })
            const deleted = await store.append(eventInput(firstProject, 'deleted'))

            await database.sql
                .statement('delete from projects where id = ?1')
                .run(firstProject.projectId)
            const surviving = await store.append(eventInput(secondProject, 'surviving'))

            expect(surviving.cursor).not.toBe(deleted.cursor)
            expect(
                await store.readAfter({ projectId: secondProject.projectId, after: deleted.cursor })
            ).toEqual([surviving])
        } finally {
            await closeTestDatabase(database)
        }
    })
})
