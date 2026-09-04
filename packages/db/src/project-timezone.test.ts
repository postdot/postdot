import { describe, expect, it } from 'bun:test'

import { closeDatabase, createDatabase } from './client'
import { createManualStore } from './manual-store'
import { runMigrations } from './migrations'

describe('project scheduling timezone', () => {
    it('persists a validated timezone and records an owner change without moving data', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const store = createManualStore(database, { now: () => 1_800_000_000_000 })
            const created = store.createProject({
                name: 'Timezone project',
                subjectId: 'user-1',
                displayName: 'Operator',
                timeZone: 'America/New_York',
            })

            expect(created.project.timeZone).toBe('America/New_York')
            expect(store.listProjects('user-1')).toEqual([created.project])

            const updated = store.updateProjectTimeZone({
                projectId: created.project.id,
                subjectId: 'user-1',
                timeZone: 'Europe/Paris',
            })

            expect(updated).toEqual({ ...created.project, timeZone: 'Europe/Paris' })
            expect(store.listProjects('user-1')[0]?.timeZone).toBe('Europe/Paris')

            const events = store.listAuditEvents(created.project.id, 'user-1')
            expect(events?.[0]).toMatchObject({
                action: 'project.timezone_updated',
                entityId: created.project.id,
                metadataJson: JSON.stringify({ from: 'America/New_York', to: 'Europe/Paris' }),
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('defaults new projects to UTC and rejects invalid or unauthorized changes', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const store = createManualStore(database, { now: () => 1_800_000_000_000 })
            const created = store.createProject({
                name: 'Default timezone project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })

            expect(created.project.timeZone).toBe('UTC')
            expect(() =>
                store.updateProjectTimeZone({
                    projectId: created.project.id,
                    subjectId: 'user-1',
                    timeZone: '+02:00',
                })
            ).toThrow('timeZone must be a valid IANA time zone identifier')
            expect(
                store.updateProjectTimeZone({
                    projectId: created.project.id,
                    subjectId: 'other-user',
                    timeZone: 'Europe/Paris',
                })
            ).toBeNull()
        } finally {
            closeDatabase(database)
        }
    })
})
