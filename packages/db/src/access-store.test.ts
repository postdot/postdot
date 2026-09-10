import { describe, expect, it } from 'bun:test'

import { closeDatabase, createAccessStore, createDatabase, runMigrations } from './index'
import { createManualStore } from './manual-store'

describe('instance access store', () => {
    it('claims a fresh instance once and gives the first user the admin role', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            database.$client
                .query(
                    `insert into user (id, name, email, email_verified, created_at, updated_at)
                     values ('user-1', 'Herald Operator', 'operator@herald.local', 0, 1, 1)`
                )
                .run()

            const access = createAccessStore(database)
            expect(access.getInstanceState()).toMatchObject({
                state: 'claimable',
                bootstrapBlocked: false,
            })

            const claimed = access.claimFirstAccount({ userId: 'user-1' })
            expect(claimed.kind).toBe('claimed')
            expect(access.isInstanceAdmin('user-1')).toBe(true)
            expect(access.claimFirstAccount({ userId: 'user-1' })).toEqual({
                kind: 'already_claimed',
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('does not claim a database explicitly marked for orphan recovery', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            database.$client
                .query(`update instance_state set bootstrap_blocked = 1 where id = 'default'`)
                .run()

            const access = createAccessStore(database)
            expect(access.getInstanceState()).toMatchObject({
                state: 'claimable',
                bootstrapBlocked: true,
            })
            expect(access.isSignupAllowed()).toBe(false)
            expect(access.claimFirstAccount({ userId: 'recovery-user' })).toEqual({
                kind: 'already_claimed',
            })
        } finally {
            closeDatabase(database)
        }
    })

    it('creates owner memberships and evaluates member roles through the instance boundary', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            database.$client.exec(`
                insert into user (id, name, email, email_verified, created_at, updated_at)
                values
                    ('owner', 'Project Owner', 'owner@herald.local', 0, 1, 1),
                    ('member', 'Project Member', 'member@herald.local', 0, 2, 2),
                    ('outsider', 'Project Outsider', 'outsider@herald.local', 0, 3, 3)
            `)

            const access = createAccessStore(database, { now: () => 1_800_000_000_000 })
            access.claimFirstAccount({ userId: 'owner' })
            database.$client
                .query(
                    `insert into instance_memberships
                     (id, user_id, role, state, created_at, updated_at)
                     values ('instance-membership:member', 'member', 'member', 'enabled', 2, 2)`
                )
                .run()

            const manualStore = createManualStore(database, { now: () => 1_800_000_000_000 })
            const created = manualStore.createProject({
                name: 'Access project',
                subjectId: 'owner',
                displayName: 'Project Owner',
            })

            expect(access.getProjectMembership(created.project.id, 'owner')).toBeNull()
            const ownerMembership = access.ensureProjectOwnerMembership({
                projectId: created.project.id,
                userId: 'owner',
            })
            expect(ownerMembership).toMatchObject({
                projectId: created.project.id,
                userId: 'owner',
                role: 'owner',
                state: 'active',
            })
            expect(access.canAccessProject(created.project.id, 'owner', 'editor')).toBe(true)
            expect(
                access.ensureProjectOwnerMembership({
                    projectId: created.project.id,
                    userId: 'owner',
                })
            ).toMatchObject({ id: ownerMembership?.id, role: 'owner' })

            database.$client
                .query(
                    `insert into project_memberships
                     (id, project_id, user_id, role, state, created_at, updated_at)
                     values ('project-membership:viewer', ?1, 'member', 'viewer', 'active', 2, 2)`
                )
                .run(created.project.id)
            expect(access.canAccessProject(created.project.id, 'member', 'viewer')).toBe(true)
            expect(access.canAccessProject(created.project.id, 'member', 'editor')).toBe(false)
            expect(access.canAccessProject(created.project.id, 'outsider', 'viewer')).toBe(false)

            database.$client
                .query(
                    `update project_memberships
                     set role = 'editor'
                     where project_id = ?1 and user_id = 'member'`
                )
                .run(created.project.id)
            expect(access.canAccessProject(created.project.id, 'member', 'editor')).toBe(true)

            database.$client
                .query(
                    `update instance_memberships set state = 'disabled' where user_id = 'member'`
                )
                .run()
            expect(access.getProjectMembership(created.project.id, 'member')).toBeNull()
            expect(access.canAccessProject(created.project.id, 'member', 'viewer')).toBe(false)
            expect(
                access.ensureProjectOwnerMembership({
                    projectId: created.project.id,
                    userId: 'member',
                })
            ).toBeNull()
        } finally {
            closeDatabase(database)
        }
    })
})
