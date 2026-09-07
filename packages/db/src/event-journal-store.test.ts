import { describe, expect, it } from 'bun:test'

import { DomainInvariantError } from '@herald/core'

import { closeDatabase, createDatabase } from './client'
import {
    createEventJournalStore,
    eventJournalCursorSequence,
    parseEventJournalCursor,
} from './event-journal-store'
import { runMigrations } from './migrations'

function seedProject(database: ReturnType<typeof createDatabase>, suffix: string) {
    const projectId = `project-${suffix}`
    const actorId = `actor-${suffix}`
    database.$client.run(
        `insert into projects (id, name, created_at, updated_at)
         values (?1, ?2, 100, 100)`,
        [projectId, `Project ${suffix}`]
    )
    database.$client.run(
        `insert into actors (id, project_id, kind, display_name, created_at, updated_at)
         values (?1, ?2, 'human', ?3, 100, 100)`,
        [actorId, projectId, `Actor ${suffix}`]
    )
    return { projectId, actorId }
}

function eventInput(project: ReturnType<typeof seedProject>, suffix: string) {
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
    it('persists versioned facts and reads equal-timestamp entries in append order', () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const firstProject = seedProject(database, 'first')
            const secondProject = seedProject(database, 'second')
            let nextId = 0
            const store = createEventJournalStore(database, {
                createId: () => `event-${++nextId}`,
            })

            const first = store.append(eventInput(firstProject, 'first'))
            const second = store.append(eventInput(firstProject, 'second'))
            store.append(eventInput(secondProject, 'hidden'))
            const hidden = store.readAfter({ projectId: secondProject.projectId })[0]
            if (hidden === undefined) throw new Error('The hidden event was not persisted')

            expect(store.readAfter({ projectId: firstProject.projectId })).toEqual([first, second])
            expect(store.latestCursor()).toBe(hidden.cursor)
            expect(eventJournalCursorSequence(second.cursor)).toBe(2)
            expect(
                store.readAfter({ projectId: firstProject.projectId, after: first.cursor })
            ).toEqual([second])
        } finally {
            closeDatabase(database)
        }
    })

    it('validates envelopes before persistence', () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const project = seedProject(database, 'validation')
            const store = createEventJournalStore(database)

            expect(() => store.append({ ...eventInput(project, 'invalid'), version: 0 })).toThrow(
                DomainInvariantError
            )
            expect(store.readAfter({ projectId: project.projectId })).toEqual([])
        } finally {
            closeDatabase(database)
        }
    })

    it('validates persisted consumer cursors before reuse', () => {
        expect(String(parseEventJournalCursor('event-sequence:42'))).toBe('event-sequence:42')
        expect(() => parseEventJournalCursor('42')).toThrow(DomainInvariantError)
        expect(() => parseEventJournalCursor('event-sequence:0')).toThrow(DomainInvariantError)
    })

    it('participates in a surrounding SQLite transaction', () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const project = seedProject(database, 'rollback')
            const store = createEventJournalStore(database, { createId: () => 'event-fixed' })
            store.append(eventInput(project, 'existing'))

            const changeAndAppend = database.$client.transaction(() => {
                database.$client.run(`update projects set name = 'Changed' where id = ?1`, [
                    project.projectId,
                ])
                store.append(eventInput(project, 'duplicate'))
            })

            expect(() => changeAndAppend()).toThrow()
            expect(
                database.$client
                    .query<{ name: string }, [string]>('select name from projects where id = ?1')
                    .get(project.projectId)?.name
            ).toBe('Project rollback')
        } finally {
            closeDatabase(database)
        }
    })

    it('never reuses a cursor after the project owning the latest event is deleted', () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const firstProject = seedProject(database, 'deleted')
            const secondProject = seedProject(database, 'surviving')
            let nextId = 0
            const store = createEventJournalStore(database, {
                createId: () => `event-monotonic-${++nextId}`,
            })
            const deleted = store.append(eventInput(firstProject, 'deleted'))

            database.$client.query('delete from projects where id = ?1').run(firstProject.projectId)
            const surviving = store.append(eventInput(secondProject, 'surviving'))

            expect(surviving.cursor).not.toBe(deleted.cursor)
            expect(
                store.readAfter({ projectId: secondProject.projectId, after: deleted.cursor })
            ).toEqual([surviving])
        } finally {
            closeDatabase(database)
        }
    })
})
