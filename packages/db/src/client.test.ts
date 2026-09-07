import { describe, expect, it } from 'bun:test'

import {
    closeDatabase,
    createDatabase,
    createDatabaseTransaction,
    recordDatabaseCommitProject,
    setDatabaseCommitObserver,
} from './client'
import { createManualStore } from './manual-store'
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

function appendEvent(
    database: ReturnType<typeof createDatabase>,
    project: ReturnType<typeof seedProject>,
    suffix: string
) {
    recordDatabaseCommitProject(database, project.projectId)
    database.$client.run(
        `insert into audit_events (
            id, project_id, actor_id, action, entity_type, entity_id,
            metadata_json, event_version, created_at
        ) values (?1, ?2, ?3, 'publication.published', 'publication', ?4, '{}', 1, 100)`,
        [`event-${suffix}`, project.projectId, project.actorId, `publication-${suffix}`]
    )
}

describe('database post-commit observer', () => {
    it('publishes affected projects only after a successful commit', () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const first = seedProject(database, 'first')
            const second = seedProject(database, 'second')
            const observed: string[][] = []
            let committedName: string | undefined
            const clearObserver = setDatabaseCommitObserver(database, projectIds => {
                committedName = database.$client
                    .query<{ name: string }, [string]>('select name from projects where id = ?1')
                    .get(first.projectId)?.name
                observed.push([...projectIds])
            })

            try {
                const transaction = createDatabaseTransaction(database, () => {
                    database.$client
                        .query('update projects set name = ?1 where id = ?2')
                        .run('Changed', first.projectId)
                    appendEvent(database, first, 'first')
                    appendEvent(database, first, 'second')
                    appendEvent(database, second, 'third')
                    expect(observed).toEqual([])
                })

                transaction()

                expect(committedName).toBe('Changed')
                expect(observed).toEqual([[first.projectId, second.projectId]])
            } finally {
                clearObserver()
            }
        } finally {
            closeDatabase(database)
        }
    })

    it('does not publish a transaction that rolls back', () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const project = seedProject(database, 'rollback')
            const observed: string[][] = []
            const clearObserver = setDatabaseCommitObserver(database, projectIds => {
                observed.push([...projectIds])
            })

            try {
                const transaction = createDatabaseTransaction(database, () => {
                    appendEvent(database, project, 'rollback')
                    throw new Error('rollback')
                })

                expect(() => transaction()).toThrow('rollback')
                expect(observed).toEqual([])
                expect(
                    database.$client
                        .query<{ count: number }, []>('select count(*) as count from audit_events')
                        .get()?.count
                ).toBe(0)
            } finally {
                clearObserver()
            }
        } finally {
            closeDatabase(database)
        }
    })

    it('publishes facts written through the manual store boundary', () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const observed: string[][] = []
            const clearObserver = setDatabaseCommitObserver(database, projectIds => {
                observed.push([...projectIds])
            })

            try {
                const store = createManualStore(database, {
                    now: () => 1_800_000_000_000,
                    createId: (() => {
                        let sequence = 0
                        return () => `manual-${++sequence}`
                    })(),
                })
                const created = store.createProject({
                    name: 'Observed project',
                    subjectId: 'subject-manual',
                    displayName: 'Manual actor',
                })

                if (created === null) throw new Error('The project was not created')
                expect(observed).toEqual([[created.project.id]])
            } finally {
                clearObserver()
            }
        } finally {
            closeDatabase(database)
        }
    })

    it('does not leak project ids from a rolled-back nested transaction', () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const project = seedProject(database, 'nested')
            const observed: string[][] = []
            const clearObserver = setDatabaseCommitObserver(database, projectIds => {
                observed.push([...projectIds])
            })

            try {
                const outer = createDatabaseTransaction(database, () => {
                    const inner = createDatabaseTransaction(database, () => {
                        appendEvent(database, project, 'nested-rolled-back')
                        throw new Error('savepoint rollback')
                    })
                    expect(() => inner()).toThrow('savepoint rollback')
                    appendEvent(database, project, 'nested-committed')
                })

                outer()

                expect(observed).toEqual([[project.projectId]])
                expect(
                    database.$client
                        .query<{ count: number }, []>('select count(*) as count from audit_events')
                        .get()?.count
                ).toBe(1)
            } finally {
                clearObserver()
            }
        } finally {
            closeDatabase(database)
        }
    })

    it('does not turn a committed write into a failed write when the observer fails', () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const project = seedProject(database, 'observer-error')
            const errors: unknown[] = []
            const clearObserver = setDatabaseCommitObserver(
                database,
                () => {
                    throw new Error('wakeup failed')
                },
                error => errors.push(error)
            )

            try {
                const transaction = createDatabaseTransaction(database, () => {
                    appendEvent(database, project, 'observer-error')
                    return 'committed'
                })

                expect(transaction()).toBe('committed')
                expect(errors).toHaveLength(1)
                expect(
                    database.$client
                        .query<{ count: number }, []>('select count(*) as count from audit_events')
                        .get()?.count
                ).toBe(1)
            } finally {
                clearObserver()
            }
        } finally {
            closeDatabase(database)
        }
    })
})
