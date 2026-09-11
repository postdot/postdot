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
                ;
                insert into organization (id, name, slug, created_at)
                values ('access-project-org', 'Access Project', 'access-project', 1)
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
                organizationId: 'access-project-org',
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
                    `insert into member
                     (id, organization_id, user_id, role, created_at)
                     values ('project-member-row', 'access-project-org', 'member', 'viewer', 2)`
                )
                .run(created.project.id)
            expect(access.canAccessProject(created.project.id, 'member', 'viewer')).toBe(true)
            expect(access.canAccessProject(created.project.id, 'member', 'editor')).toBe(false)
            expect(access.canAccessProject(created.project.id, 'outsider', 'viewer')).toBe(false)

            database.$client
                .query(
                    `update member
                     set role = 'editor'
                     where organization_id = 'access-project-org' and user_id = 'member'`
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

    it('uses Better Auth organization membership as the authority for migrated projects', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            database.$client.exec(`
                insert into user (id, name, email, email_verified, created_at, updated_at)
                values
                    ('organization-owner', 'Organization Owner', 'owner@herald.local', 0, 1, 1),
                    ('organization-member', 'Organization Member', 'member@herald.local', 0, 2, 2)
                ;
                insert into organization (id, name, slug, created_at)
                values ('organization-project', 'Organization Project', 'organization-project', 1)
            `)

            const access = createAccessStore(database, { now: () => 1_800_000_000_000 })
            access.claimFirstAccount({ userId: 'organization-owner' })
            database.$client.exec(`
                insert into instance_memberships
                    (id, user_id, role, state, created_at, updated_at)
                values ('instance-membership:organization-member', 'organization-member', 'member', 'enabled', 2, 2)
            `)

            const manualStore = createManualStore(database, { now: () => 1_800_000_000_000 })
            const created = manualStore.createProject({
                name: 'Organization project',
                subjectId: 'organization-owner',
                displayName: 'Organization Owner',
                organizationId: 'organization-project',
            })
            access.ensureProjectOwnerMembership({
                projectId: created.project.id,
                userId: 'organization-owner',
            })
            database.$client
                .query(
                    `insert into member (id, organization_id, user_id, role, created_at)
                     values ('organization-member-row', 'organization-project', 'organization-member', 'viewer', 2)`
                )
                .run()

            expect(
                access.getProjectMembership(created.project.id, 'organization-member')
            ).toMatchObject({
                projectId: created.project.id,
                userId: 'organization-member',
                role: 'viewer',
                state: 'active',
            })
            expect(access.canAccessProject(created.project.id, 'organization-member')).toBe(true)
            expect(
                access.canAccessProject(created.project.id, 'organization-member', 'editor')
            ).toBe(false)

            database.$client
                .query(
                    `update member
                     set role = 'editor'
                     where organization_id = 'organization-project'
                       and user_id = 'organization-member'`
                )
                .run()
            expect(
                access.canAccessProject(created.project.id, 'organization-member', 'editor')
            ).toBe(true)

            database.$client
                .query(
                    `delete from member
                     where organization_id = 'organization-project'
                       and user_id = 'organization-member'`
                )
                .run()
            expect(
                access.getProjectMembership(created.project.id, 'organization-member')
            ).toBeNull()
            expect(access.canAccessProject(created.project.id, 'organization-member')).toBe(false)
            expect(access.listProjectMemberships(created.project.id)).toHaveLength(1)
        } finally {
            closeDatabase(database)
        }
    })

    it('lists safe member identity fields and makes role/state updates safe and idempotent', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            database.$client.exec(`
                insert into user (id, name, email, email_verified, created_at, updated_at)
                values
                    ('admin', 'Instance Admin', 'admin@herald.local', 0, 1, 1),
                    ('member', 'Instance Member', 'member@herald.local', 0, 2, 2),
                    ('admin-2', 'Second Admin', 'admin-2@herald.local', 0, 3, 3)
            `)

            const access = createAccessStore(database, { now: () => 1_800_000_000_000 })
            access.claimFirstAccount({ userId: 'admin' })
            database.$client.exec(`
                insert into instance_memberships
                    (id, user_id, role, state, created_at, updated_at)
                values
                    ('instance-membership:member', 'member', 'member', 'enabled', 2, 2),
                    ('instance-membership:admin-2', 'admin-2', 'admin', 'enabled', 3, 3)
            `)

            expect(access.listInstanceMemberships()).toEqual([
                expect.objectContaining({
                    userId: 'member',
                    email: 'member@herald.local',
                    name: 'Instance Member',
                    role: 'member',
                    state: 'enabled',
                }),
                expect.objectContaining({
                    userId: 'admin-2',
                    email: 'admin-2@herald.local',
                    name: 'Second Admin',
                    role: 'admin',
                    state: 'enabled',
                }),
                expect.objectContaining({
                    userId: 'admin',
                    email: 'admin@herald.local',
                    name: 'Instance Admin',
                    role: 'admin',
                    state: 'enabled',
                }),
            ])

            const promoted = access.updateInstanceMembership({
                actorUserId: 'admin',
                userId: 'member',
                role: 'admin',
            })
            expect(promoted).toMatchObject({
                kind: 'updated',
                membership: { userId: 'member', role: 'admin', state: 'enabled' },
            })

            expect(
                access.updateInstanceMembership({
                    actorUserId: 'admin',
                    userId: 'member',
                    role: 'admin',
                })
            ).toEqual(promoted)

            expect(
                access.updateInstanceMembership({
                    actorUserId: 'admin',
                    userId: 'admin',
                    role: 'member',
                })
            ).toEqual({ kind: 'self_update' })
            expect(access.getInstanceMembership('admin')).toMatchObject({
                role: 'admin',
                state: 'enabled',
            })

            const disabled = access.updateInstanceMembership({
                actorUserId: 'admin',
                userId: 'member',
                state: 'disabled',
            })
            expect(disabled).toMatchObject({
                kind: 'updated',
                membership: { userId: 'member', role: 'admin', state: 'disabled' },
            })
            expect(
                access.updateInstanceMembership({
                    actorUserId: 'admin',
                    userId: 'member',
                    state: 'disabled',
                })
            ).toEqual(disabled)

            expect(
                access.updateInstanceMembership({
                    actorUserId: 'admin',
                    userId: 'admin-2',
                    role: 'member',
                })
            ).toMatchObject({
                kind: 'updated',
                membership: { userId: 'admin-2', role: 'member', state: 'enabled' },
            })

            expect(
                access.updateInstanceMembership({
                    actorUserId: 'admin-2',
                    userId: 'admin',
                    role: 'member',
                })
            ).toEqual({ kind: 'last_admin' })
        } finally {
            closeDatabase(database)
        }
    })
})
