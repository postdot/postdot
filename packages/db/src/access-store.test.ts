import { describe, expect, it } from 'bun:test'

import { createAccessStore } from './index'
import { createManualStore } from './manual-store'
import {
    closeTestDatabase,
    dropRejectingTrigger,
    installRejectingTrigger,
    openTestDatabase,
} from './testing'

describe('instance access store', () => {
    it('claims a fresh instance once and gives the first user the admin role', async () => {
        const database = (await openTestDatabase()).database

        try {
            await database.sql
                .statement(
                    `insert into "user" (id, name, email, email_verified, created_at, updated_at)
                     values ('user-1', 'Postdot Operator', 'operator@postdot.local', 0, 1, 1)`
                )
                .run()

            const access = createAccessStore(database)
            expect(await access.getInstanceState()).toMatchObject({
                state: 'claimable',
                bootstrapBlocked: false,
            })

            const claimed = await access.claimFirstAccount({ userId: 'user-1' })
            expect(claimed.kind).toBe('claimed')
            expect(await access.isInstanceAdmin('user-1')).toBe(true)
            const workspace = await access.getDefaultWorkspace()
            expect(workspace).toMatchObject({
                name: 'My workspace',
                isDefault: true,
            })
            expect(workspace?.organizationId).toBeString()
            expect((await access.getDefaultWorkspaceForUser('user-1'))?.id).toBe(workspace?.id)
            expect(
                await database.sql
                    .statement<{ readonly count: number }, [string]>(
                        'select count(*) as count from team where organization_id = ?1'
                    )
                    .get(workspace?.organizationId ?? '')
            ).toEqual({ count: 4 })
            expect(await access.claimFirstAccount({ userId: 'user-1' })).toEqual({
                kind: 'already_claimed',
            })
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('does not claim a database explicitly marked for orphan recovery', async () => {
        const database = (await openTestDatabase()).database

        try {
            await database.sql
                .statement(`update instance_state set bootstrap_blocked = 1 where id = 'default'`)
                .run()

            const access = createAccessStore(database)
            expect(await access.getInstanceState()).toMatchObject({
                state: 'claimable',
                bootstrapBlocked: true,
            })
            expect(await access.isSignupAllowed()).toBe(false)
            expect(await access.claimFirstAccount({ userId: 'recovery-user' })).toEqual({
                kind: 'already_claimed',
            })
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('creates owner memberships and evaluates direct grants through the workspace boundary', async () => {
        const database = (await openTestDatabase()).database

        try {
            await database.sql.exec(`
                insert into "user" (id, name, email, email_verified, created_at, updated_at)
                values
                    ('owner', 'Project Owner', 'owner@postdot.local', 0, 1, 1),
                    ('member', 'Project Member', 'member@postdot.local', 0, 2, 2),
                    ('outsider', 'Project Outsider', 'outsider@postdot.local', 0, 3, 3)
                ;
            `)

            const access = createAccessStore(database, { now: () => 1_800_000_000_000 })
            await access.claimFirstAccount({ userId: 'owner' })
            const workspace = await access.getDefaultWorkspace()
            expect(workspace).not.toBeNull()
            if (workspace === null) throw new Error('The default workspace was not created')
            await database.sql
                .statement(
                    `insert into instance_memberships
                     (id, user_id, role, state, created_at, updated_at)
                     values ('instance-membership:member', 'member', 'member', 'enabled', 2, 2)`
                )
                .run()
            await database.sql
                .statement(
                    `insert into member
                     (id, organization_id, user_id, role, created_at)
                     values ('workspace-member:member', ?1, 'member', 'member', 2)`
                )
                .run(workspace.organizationId)

            const manualStore = createManualStore(database, { now: () => 1_800_000_000_000 })
            const created = await manualStore.createProject({
                name: 'Access project',
                subjectId: 'owner',
                displayName: 'Project Owner',
                workspaceId: workspace.id,
            })

            expect(await access.getProjectMembership(created.project.id, 'owner')).toBeNull()
            const ownerMembership = await access.ensureProjectOwnerMembership({
                projectId: created.project.id,
                userId: 'owner',
            })
            expect(ownerMembership).toMatchObject({
                projectId: created.project.id,
                userId: 'owner',
                role: 'owner',
                state: 'active',
            })
            expect(await access.canAccessProject(created.project.id, 'owner', 'editor')).toBe(true)
            expect(
                await access.ensureProjectOwnerMembership({
                    projectId: created.project.id,
                    userId: 'owner',
                })
            ).toMatchObject({ id: ownerMembership?.id, role: 'owner' })

            await installRejectingTrigger(database, {
                name: 'reject_access_actor',
                table: 'actors',
                timing: 'before',
                event: 'insert',
                when: "new.subject_id = 'member'",
                message: 'actor insert failed',
            })
            await expect(
                access.grantProjectUserAccess({
                    projectId: created.project.id,
                    userId: 'member',
                    role: 'viewer',
                })
            ).rejects.toThrow('actor insert failed')
            expect(
                (await access.listProjectUserGrants(created.project.id)).some(
                    grant => grant.userId === 'member'
                )
            ).toBe(false)
            await dropRejectingTrigger(database, 'reject_access_actor')

            expect(
                await access.grantProjectUserAccess({
                    projectId: created.project.id,
                    userId: 'member',
                    role: 'viewer',
                })
            ).toMatchObject({ role: 'viewer' })
            expect(await access.canAccessProject(created.project.id, 'member', 'viewer')).toBe(true)
            expect(await access.canAccessProject(created.project.id, 'member', 'editor')).toBe(
                false
            )
            expect(await access.canAccessProject(created.project.id, 'outsider', 'viewer')).toBe(
                false
            )

            await access.grantProjectUserAccess({
                projectId: created.project.id,
                userId: 'member',
                role: 'editor',
            })
            expect(await access.canAccessProject(created.project.id, 'member', 'editor')).toBe(true)

            await database.sql
                .statement(
                    `update instance_memberships set state = 'disabled' where user_id = 'member'`
                )
                .run()
            expect(await access.getProjectMembership(created.project.id, 'member')).toBeNull()
            expect(await access.canAccessProject(created.project.id, 'member', 'viewer')).toBe(
                false
            )
            expect(
                await access.ensureProjectOwnerMembership({
                    projectId: created.project.id,
                    userId: 'member',
                })
            ).toBeNull()
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('does not treat workspace membership as project access without a Postdot grant', async () => {
        const database = (await openTestDatabase()).database

        try {
            await database.sql.exec(`
                insert into "user" (id, name, email, email_verified, created_at, updated_at)
                values
                    ('organization-owner', 'Organization Owner', 'owner@postdot.local', 0, 1, 1),
                    ('organization-member', 'Organization Member', 'member@postdot.local', 0, 2, 2)
                ;
            `)

            const access = createAccessStore(database, { now: () => 1_800_000_000_000 })
            await access.claimFirstAccount({ userId: 'organization-owner' })
            const workspace = await access.getDefaultWorkspace()
            expect(workspace).not.toBeNull()
            if (workspace === null) throw new Error('The default workspace was not created')
            await database.sql.exec(`
                insert into instance_memberships
                    (id, user_id, role, state, created_at, updated_at)
                values ('instance-membership:organization-member', 'organization-member', 'member', 'enabled', 2, 2)
            `)
            await database.sql
                .statement(
                    `insert into member
                     (id, organization_id, user_id, role, created_at)
                     values ('workspace-member:organization-member', ?1, 'organization-member', 'member', 2)`
                )
                .run(workspace.organizationId)

            const manualStore = createManualStore(database, { now: () => 1_800_000_000_000 })
            const created = await manualStore.createProject({
                name: 'Organization project',
                subjectId: 'organization-owner',
                displayName: 'Organization Owner',
                workspaceId: workspace.id,
            })
            await access.ensureProjectOwnerMembership({
                projectId: created.project.id,
                userId: 'organization-owner',
            })
            expect(
                await access.getProjectMembership(created.project.id, 'organization-member')
            ).toBeNull()
            expect(await access.canAccessProject(created.project.id, 'organization-member')).toBe(
                false
            )
            expect(
                await access.grantProjectUserAccess({
                    projectId: created.project.id,
                    userId: 'organization-member',
                    role: 'viewer',
                })
            ).toMatchObject({ role: 'viewer' })
            expect(await access.canAccessProject(created.project.id, 'organization-member')).toBe(
                true
            )
            expect(
                await access.removeProjectUserAccess(created.project.id, 'organization-member')
            ).toBe(true)
            expect(
                await access.getProjectMembership(created.project.id, 'organization-member')
            ).toBeNull()
            expect(await access.canAccessProject(created.project.id, 'organization-member')).toBe(
                false
            )
            expect(await access.listProjectMemberships(created.project.id)).toHaveLength(1)
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('keeps project grants separate from workspace membership and resolves team access', async () => {
        const database = (await openTestDatabase()).database

        try {
            await database.sql.exec(`
                insert into "user" (id, name, email, email_verified, created_at, updated_at)
                values
                    ('grant-owner', 'Grant Owner', 'grant-owner@postdot.local', 0, 1, 1),
                    ('grant-member', 'Grant Member', 'grant-member@postdot.local', 0, 2, 2)
                ;
                insert into organization (id, name, slug, created_at)
                values ('grant-project-org', 'Grant Project', 'grant-project', 1)
            `)

            const access = createAccessStore(database, { now: () => 1_800_000_000_000 })
            await access.claimFirstAccount({ userId: 'grant-owner' })
            const workspace = await access.getDefaultWorkspace()
            expect(workspace).not.toBeNull()
            if (workspace === null) throw new Error('The default workspace was not created')

            await database.sql.exec(`
                insert into instance_memberships
                    (id, user_id, role, state, created_at, updated_at)
                values ('instance-membership:grant-member', 'grant-member', 'member', 'enabled', 2, 2);
                insert into member (id, organization_id, user_id, role, created_at)
                values ('workspace-member:grant-member', '${workspace.organizationId}', 'grant-member', 'member', 2);
                insert into team_member (id, team_id, user_id, membership_key, created_at)
                values (
                    'editors-member:grant-member',
                    'postdot-workspace-team:${workspace.id}:editors',
                    'grant-member',
                    'editors-member:grant-member',
                    2
                )
            `)

            const manualStore = createManualStore(database, { now: () => 1_800_000_000_000 })
            const created = await manualStore.createProject({
                name: 'Grant project',
                subjectId: 'grant-owner',
                displayName: 'Grant Owner',
                workspaceId: workspace.id,
            })
            await access.ensureProjectOwnerMembership({
                projectId: created.project.id,
                userId: 'grant-owner',
            })

            expect(await access.canAccessProject(created.project.id, 'grant-member')).toBe(false)
            const teamGrant = await access.grantProjectTeamAccess({
                projectId: created.project.id,
                teamId: `postdot-workspace-team:${workspace.id}:editors`,
                role: 'editor',
            })
            expect(teamGrant).toMatchObject({ role: 'editor', teamName: 'Editors' })
            expect(
                await access.getProjectMembership(created.project.id, 'grant-member')
            ).toMatchObject({
                role: 'editor',
            })
            expect(
                await access.canAccessProject(created.project.id, 'grant-member', 'editor')
            ).toBe(true)

            expect(
                await access.grantProjectUserAccess({
                    projectId: created.project.id,
                    userId: 'grant-member',
                    role: 'viewer',
                })
            ).toMatchObject({ role: 'viewer' })
            // The effective role is the highest role across direct and team grants.
            expect(
                await access.getProjectMembership(created.project.id, 'grant-member')
            ).toMatchObject({
                role: 'editor',
            })

            expect(
                await access.removeProjectTeamAccess(
                    created.project.id,
                    `postdot-workspace-team:${workspace.id}:editors`
                )
            ).toBe(true)
            expect(
                await access.getProjectMembership(created.project.id, 'grant-member')
            ).toMatchObject({
                role: 'viewer',
            })
            expect(await access.removeProjectUserAccess(created.project.id, 'grant-member')).toBe(
                true
            )
            expect(await access.canAccessProject(created.project.id, 'grant-member')).toBe(false)
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('lists safe member identity fields and makes role/state updates safe and idempotent', async () => {
        const database = (await openTestDatabase()).database

        try {
            await database.sql.exec(`
                insert into "user" (id, name, email, email_verified, created_at, updated_at)
                values
                    ('admin', 'Instance Admin', 'admin@postdot.local', 0, 1, 1),
                    ('member', 'Instance Member', 'member@postdot.local', 0, 2, 2),
                    ('admin-2', 'Second Admin', 'admin-2@postdot.local', 0, 3, 3)
            `)

            const access = createAccessStore(database, { now: () => 1_800_000_000_000 })
            await access.claimFirstAccount({ userId: 'admin' })
            await database.sql.exec(`
                insert into instance_memberships
                    (id, user_id, role, state, created_at, updated_at)
                values
                    ('instance-membership:member', 'member', 'member', 'enabled', 2, 2),
                    ('instance-membership:admin-2', 'admin-2', 'admin', 'enabled', 3, 3)
            `)

            expect(await access.listInstanceMemberships()).toEqual([
                expect.objectContaining({
                    userId: 'member',
                    email: 'member@postdot.local',
                    name: 'Instance Member',
                    role: 'member',
                    state: 'enabled',
                }),
                expect.objectContaining({
                    userId: 'admin-2',
                    email: 'admin-2@postdot.local',
                    name: 'Second Admin',
                    role: 'admin',
                    state: 'enabled',
                }),
                expect.objectContaining({
                    userId: 'admin',
                    email: 'admin@postdot.local',
                    name: 'Instance Admin',
                    role: 'admin',
                    state: 'enabled',
                }),
            ])

            const promoted = await access.updateInstanceMembership({
                actorUserId: 'admin',
                userId: 'member',
                role: 'admin',
            })
            expect(promoted).toMatchObject({
                kind: 'updated',
                membership: { userId: 'member', role: 'admin', state: 'enabled' },
            })

            expect(
                await access.updateInstanceMembership({
                    actorUserId: 'admin',
                    userId: 'member',
                    role: 'admin',
                })
            ).toEqual(promoted)

            expect(
                await access.updateInstanceMembership({
                    actorUserId: 'admin',
                    userId: 'admin',
                    role: 'member',
                })
            ).toEqual({ kind: 'self_update' })
            expect(await access.getInstanceMembership('admin')).toMatchObject({
                role: 'admin',
                state: 'enabled',
            })

            const disabled = await access.updateInstanceMembership({
                actorUserId: 'admin',
                userId: 'member',
                state: 'disabled',
            })
            expect(disabled).toMatchObject({
                kind: 'updated',
                membership: { userId: 'member', role: 'admin', state: 'disabled' },
            })
            expect(
                await access.updateInstanceMembership({
                    actorUserId: 'admin',
                    userId: 'member',
                    state: 'disabled',
                })
            ).toEqual(disabled)

            expect(
                await access.updateInstanceMembership({
                    actorUserId: 'admin',
                    userId: 'admin-2',
                    role: 'member',
                })
            ).toMatchObject({
                kind: 'updated',
                membership: { userId: 'admin-2', role: 'member', state: 'enabled' },
            })

            expect(
                await access.updateInstanceMembership({
                    actorUserId: 'admin-2',
                    userId: 'admin',
                    role: 'member',
                })
            ).toEqual({ kind: 'last_admin' })
        } finally {
            await closeTestDatabase(database)
        }
    })
})
