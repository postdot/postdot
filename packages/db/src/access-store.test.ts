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
                     values ('user-1', 'Postbot Operator', 'operator@postbot.local', 0, 1, 1)`
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
            const workspace = access.getDefaultWorkspace()
            expect(workspace).toMatchObject({
                name: 'My workspace',
                isDefault: true,
            })
            expect(workspace?.organizationId).toBeString()
            expect(access.getDefaultWorkspaceForUser('user-1')?.id).toBe(workspace?.id)
            expect(
                database.$client
                    .query<{ readonly count: number }, [string]>(
                        'select count(*) as count from team where organization_id = ?1'
                    )
                    .get(workspace?.organizationId ?? '')
            ).toEqual({ count: 4 })
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

    it('creates owner memberships and evaluates direct grants through the workspace boundary', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            database.$client.exec(`
                insert into user (id, name, email, email_verified, created_at, updated_at)
                values
                    ('owner', 'Project Owner', 'owner@postbot.local', 0, 1, 1),
                    ('member', 'Project Member', 'member@postbot.local', 0, 2, 2),
                    ('outsider', 'Project Outsider', 'outsider@postbot.local', 0, 3, 3)
                ;
            `)

            const access = createAccessStore(database, { now: () => 1_800_000_000_000 })
            access.claimFirstAccount({ userId: 'owner' })
            const workspace = access.getDefaultWorkspace()
            expect(workspace).not.toBeNull()
            if (workspace === null) throw new Error('The default workspace was not created')
            database.$client
                .query(
                    `insert into instance_memberships
                     (id, user_id, role, state, created_at, updated_at)
                     values ('instance-membership:member', 'member', 'member', 'enabled', 2, 2)`
                )
                .run()
            database.$client
                .query(
                    `insert into member
                     (id, organization_id, user_id, role, created_at)
                     values ('workspace-member:member', ?1, 'member', 'member', 2)`
                )
                .run(workspace.organizationId)

            const manualStore = createManualStore(database, { now: () => 1_800_000_000_000 })
            const created = manualStore.createProject({
                name: 'Access project',
                subjectId: 'owner',
                displayName: 'Project Owner',
                workspaceId: workspace.id,
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

            expect(
                access.grantProjectUserAccess({
                    projectId: created.project.id,
                    userId: 'member',
                    role: 'viewer',
                })
            ).toMatchObject({ role: 'viewer' })
            expect(access.canAccessProject(created.project.id, 'member', 'viewer')).toBe(true)
            expect(access.canAccessProject(created.project.id, 'member', 'editor')).toBe(false)
            expect(access.canAccessProject(created.project.id, 'outsider', 'viewer')).toBe(false)

            access.grantProjectUserAccess({
                projectId: created.project.id,
                userId: 'member',
                role: 'editor',
            })
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

    it('does not treat workspace membership as project access without a Postbot grant', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            database.$client.exec(`
                insert into user (id, name, email, email_verified, created_at, updated_at)
                values
                    ('organization-owner', 'Organization Owner', 'owner@postbot.local', 0, 1, 1),
                    ('organization-member', 'Organization Member', 'member@postbot.local', 0, 2, 2)
                ;
            `)

            const access = createAccessStore(database, { now: () => 1_800_000_000_000 })
            access.claimFirstAccount({ userId: 'organization-owner' })
            const workspace = access.getDefaultWorkspace()
            expect(workspace).not.toBeNull()
            if (workspace === null) throw new Error('The default workspace was not created')
            database.$client.exec(`
                insert into instance_memberships
                    (id, user_id, role, state, created_at, updated_at)
                values ('instance-membership:organization-member', 'organization-member', 'member', 'enabled', 2, 2)
            `)
            database.$client
                .query(
                    `insert into member
                     (id, organization_id, user_id, role, created_at)
                     values ('workspace-member:organization-member', ?1, 'organization-member', 'member', 2)`
                )
                .run(workspace.organizationId)

            const manualStore = createManualStore(database, { now: () => 1_800_000_000_000 })
            const created = manualStore.createProject({
                name: 'Organization project',
                subjectId: 'organization-owner',
                displayName: 'Organization Owner',
                workspaceId: workspace.id,
            })
            access.ensureProjectOwnerMembership({
                projectId: created.project.id,
                userId: 'organization-owner',
            })
            expect(
                access.getProjectMembership(created.project.id, 'organization-member')
            ).toBeNull()
            expect(access.canAccessProject(created.project.id, 'organization-member')).toBe(false)
            expect(
                access.grantProjectUserAccess({
                    projectId: created.project.id,
                    userId: 'organization-member',
                    role: 'viewer',
                })
            ).toMatchObject({ role: 'viewer' })
            expect(access.canAccessProject(created.project.id, 'organization-member')).toBe(true)
            expect(access.removeProjectUserAccess(created.project.id, 'organization-member')).toBe(
                true
            )
            expect(
                access.getProjectMembership(created.project.id, 'organization-member')
            ).toBeNull()
            expect(access.canAccessProject(created.project.id, 'organization-member')).toBe(false)
            expect(access.listProjectMemberships(created.project.id)).toHaveLength(1)
        } finally {
            closeDatabase(database)
        }
    })

    it('keeps project grants separate from workspace membership and resolves team access', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            database.$client.exec(`
                insert into user (id, name, email, email_verified, created_at, updated_at)
                values
                    ('grant-owner', 'Grant Owner', 'grant-owner@postbot.local', 0, 1, 1),
                    ('grant-member', 'Grant Member', 'grant-member@postbot.local', 0, 2, 2)
                ;
                insert into organization (id, name, slug, created_at)
                values ('grant-project-org', 'Grant Project', 'grant-project', 1)
            `)

            const access = createAccessStore(database, { now: () => 1_800_000_000_000 })
            access.claimFirstAccount({ userId: 'grant-owner' })
            const workspace = access.getDefaultWorkspace()
            expect(workspace).not.toBeNull()
            if (workspace === null) throw new Error('The default workspace was not created')

            database.$client.exec(`
                insert into instance_memberships
                    (id, user_id, role, state, created_at, updated_at)
                values ('instance-membership:grant-member', 'grant-member', 'member', 'enabled', 2, 2);
                insert into member (id, organization_id, user_id, role, created_at)
                values ('workspace-member:grant-member', '${workspace.organizationId}', 'grant-member', 'member', 2);
                insert into team_member (id, team_id, user_id, membership_key, created_at)
                values (
                    'editors-member:grant-member',
                    'postbot-workspace-team:${workspace.id}:editors',
                    'grant-member',
                    'editors-member:grant-member',
                    2
                )
            `)

            const manualStore = createManualStore(database, { now: () => 1_800_000_000_000 })
            const created = manualStore.createProject({
                name: 'Grant project',
                subjectId: 'grant-owner',
                displayName: 'Grant Owner',
                workspaceId: workspace.id,
            })
            access.ensureProjectOwnerMembership({
                projectId: created.project.id,
                userId: 'grant-owner',
            })

            expect(access.canAccessProject(created.project.id, 'grant-member')).toBe(false)
            const teamGrant = access.grantProjectTeamAccess({
                projectId: created.project.id,
                teamId: `postbot-workspace-team:${workspace.id}:editors`,
                role: 'editor',
            })
            expect(teamGrant).toMatchObject({ role: 'editor', teamName: 'Editors' })
            expect(access.getProjectMembership(created.project.id, 'grant-member')).toMatchObject({
                role: 'editor',
            })
            expect(access.canAccessProject(created.project.id, 'grant-member', 'editor')).toBe(true)

            expect(
                access.grantProjectUserAccess({
                    projectId: created.project.id,
                    userId: 'grant-member',
                    role: 'viewer',
                })
            ).toMatchObject({ role: 'viewer' })
            // The effective role is the highest role across direct and team grants.
            expect(access.getProjectMembership(created.project.id, 'grant-member')).toMatchObject({
                role: 'editor',
            })

            expect(
                access.removeProjectTeamAccess(
                    created.project.id,
                    `postbot-workspace-team:${workspace.id}:editors`
                )
            ).toBe(true)
            expect(access.getProjectMembership(created.project.id, 'grant-member')).toMatchObject({
                role: 'viewer',
            })
            expect(access.removeProjectUserAccess(created.project.id, 'grant-member')).toBe(true)
            expect(access.canAccessProject(created.project.id, 'grant-member')).toBe(false)
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
                    ('admin', 'Instance Admin', 'admin@postbot.local', 0, 1, 1),
                    ('member', 'Instance Member', 'member@postbot.local', 0, 2, 2),
                    ('admin-2', 'Second Admin', 'admin-2@postbot.local', 0, 3, 3)
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
                    email: 'member@postbot.local',
                    name: 'Instance Member',
                    role: 'member',
                    state: 'enabled',
                }),
                expect.objectContaining({
                    userId: 'admin-2',
                    email: 'admin-2@postbot.local',
                    name: 'Second Admin',
                    role: 'admin',
                    state: 'enabled',
                }),
                expect.objectContaining({
                    userId: 'admin',
                    email: 'admin@postbot.local',
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
