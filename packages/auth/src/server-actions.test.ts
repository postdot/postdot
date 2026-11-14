import { describe, expect, it } from 'bun:test'

import { createAccessStore, createManualStore } from '@postdot/db'
import { closeTestDatabase, openTestDatabase } from '@postdot/db/testing'

import {
    createAuth,
    createPostdotAuthServerActions,
    postdotUserApiKeyConfigId,
    runWithAuthorizedBootstrap,
    runWithAuthorizedMemberProvisioning,
    type PostdotOrganizationInvitationEmail,
} from './index'

const baseURL = 'http://localhost:3000'
const secret = 'postdot-test-secret-with-at-least-32-characters'

async function createFixture() {
    const { database } = await openTestDatabase()
    const access = createAccessStore(database)
    const sentEmails: PostdotOrganizationInvitationEmail[] = []
    const auth = createAuth(database, {
        baseURL,
        secret,
        access,
        isOpenSignupAllowed: () => false,
        sendOrganizationInvitationEmail: email => {
            sentEmails.push(email)
        },
        organizationInvitationURL: ({ id, organizationId, projectId }) =>
            projectId === undefined
                ? `http://localhost:3000/dashboard/workspaces/${organizationId}/invite/${id}`
                : `http://localhost:3000/dashboard/projects/${projectId}/invite/${id}`,
    })
    const serverActions = createPostdotAuthServerActions(auth)
    const manualStore = createManualStore(database, { now: Date.now })

    const admin = await runWithAuthorizedBootstrap(() =>
        auth.api.createUser({
            body: {
                email: 'admin@postdot.local',
                password: 'Password123!',
                name: 'Initial Admin',
                role: 'admin',
            },
        })
    )
    return { database, access, auth, serverActions, manualStore, admin: admin.user, sentEmails }
}

describe('createPostdotAuthServerActions', () => {
    it('guards direct member provisioning behind runWithAuthorizedMemberProvisioning and supports user role/ban sync', async () => {
        const { database, access, auth, serverActions } = await createFixture()
        try {
            await expect(
                auth.api.createUser({
                    body: {
                        email: 'blocked@postdot.local',
                        name: 'Blocked User',
                        role: 'user',
                    },
                })
            ).rejects.toThrow()

            const bot = await runWithAuthorizedMemberProvisioning(() =>
                auth.api.createUser({
                    body: {
                        email: 'bot@postdot.local',
                        name: 'Agent Bot',
                        role: 'user',
                    },
                })
            )
            await access.provisionDirectInstanceMembership({
                userId: bot.user.id,
                role: 'member',
                displayName: 'Agent Bot',
            })

            let membership = await access.getInstanceMembership(bot.user.id)
            expect(membership?.role).toBe('member')
            expect(membership?.state).toBe('enabled')

            await serverActions.setUserRole({ userId: bot.user.id, role: 'admin' })
            membership = await access.getInstanceMembership(bot.user.id)
            expect(membership?.role).toBe('admin')

            await serverActions.banUser({ userId: bot.user.id, banReason: 'Paused' })
            membership = await access.getInstanceMembership(bot.user.id)
            expect(membership?.state).toBe('disabled')

            await serverActions.unbanUser({ userId: bot.user.id })
            membership = await access.getInstanceMembership(bot.user.id)
            expect(membership?.state).toBe('enabled')

            const rollbackUser = await runWithAuthorizedMemberProvisioning(() =>
                auth.api.createUser({
                    body: {
                        email: 'rollback@postdot.local',
                        name: 'Rollback Bot',
                        role: 'user',
                    },
                })
            )
            await serverActions.deleteUser({ userId: rollbackUser.user.id })
            expect(await access.getInstanceMembership(rollbackUser.user.id)).toBeNull()
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('lists and deletes user API keys without session headers and parses permissions/metadata cleanly', async () => {
        const { database, auth, serverActions, admin } = await createFixture()
        try {
            const first = await auth.api.createApiKey({
                body: {
                    configId: postdotUserApiKeyConfigId,
                    name: 'Scoped Agent Key',
                    userId: admin.id,
                    permissions: { project: ['read'], publication: ['approve'] },
                    metadata: {
                        postdotApiKeyVersion: 2,
                        postdotProjectAccess: 'selected',
                        postdotProjectIds: ['proj-1'],
                    },
                },
            })
            const second = await auth.api.createApiKey({
                body: {
                    configId: postdotUserApiKeyConfigId,
                    name: 'Unrestricted Key',
                    userId: admin.id,
                    metadata: { postdotApiKeyVersion: 2, postdotProjectAccess: 'all' },
                },
            })

            const listed = await serverActions.listUserApiKeys({
                userId: admin.id,
                configId: postdotUserApiKeyConfigId,
            })
            expect(listed).toHaveLength(2)
            expect(listed[0]?.id).toBe(first.id)
            expect(listed[0]?.permissions).toEqual({
                project: ['read'],
                publication: ['approve'],
            })
            expect(listed[0]?.metadata).toEqual({
                postdotApiKeyVersion: 2,
                postdotProjectAccess: 'selected',
                postdotProjectIds: ['proj-1'],
            })
            expect(listed[1]?.id).toBe(second.id)
            expect(listed[1]?.permissions).toBeNull()

            await expect(
                serverActions.deleteUserApiKey({
                    userId: 'other-user',
                    keyId: first.id,
                    configId: postdotUserApiKeyConfigId,
                })
            ).rejects.toThrow('API key not found')

            await serverActions.deleteUserApiKey({
                userId: admin.id,
                keyId: first.id,
                configId: postdotUserApiKeyConfigId,
            })

            const remaining = await serverActions.listUserApiKeys({
                userId: admin.id,
                configId: postdotUserApiKeyConfigId,
            })
            expect(remaining.map(key => key.id)).toEqual([second.id])
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('synchronizes workspace teams, team grants, invitations, and organization cleanup without headers', async () => {
        const { database, access, auth, serverActions, manualStore, admin, sentEmails } =
            await createFixture()
        try {
            const member = await runWithAuthorizedMemberProvisioning(() =>
                auth.api.createUser({
                    body: {
                        email: 'editor@postdot.local',
                        password: 'Password123!',
                        name: 'Project Editor',
                        role: 'user',
                    },
                })
            )
            await access.provisionDirectInstanceMembership({
                userId: member.user.id,
                role: 'member',
                displayName: 'Project Editor',
            })

            const defaultWorkspace = await access.getDefaultWorkspace()
            expect(defaultWorkspace).not.toBeNull()

            const team = await serverActions.createOrganizationTeam({
                organizationId: defaultWorkspace!.organizationId,
                name: 'Editorial',
            })
            expect(team.name).toBe('Editorial')

            const renamed = await serverActions.updateOrganizationTeam({
                organizationId: defaultWorkspace!.organizationId,
                teamId: team.id,
                name: 'Reviewers Guild',
            })
            expect(renamed.name).toBe('Reviewers Guild')

            const { project } = await manualStore.createProject({
                name: 'Launch Project',
                timeZone: 'UTC',
                workspaceId: defaultWorkspace!.id,
                subjectId: admin.id,
                displayName: admin.name,
            })
            await access.ensureProjectOwnerMembership({ projectId: project.id, userId: admin.id })
            await access.grantProjectTeamAccess({
                projectId: project.id,
                teamId: team.id,
                role: 'editor',
            })

            const addedTeamMember = await serverActions.addOrganizationTeamMember({
                organizationId: defaultWorkspace!.organizationId,
                teamId: team.id,
                userId: member.user.id,
            })
            expect(addedTeamMember.userId).toBe(member.user.id)

            const membership = await access.getProjectMembership(project.id, member.user.id)
            expect(membership?.role).toBe('editor')

            const teams = await serverActions.listOrganizationTeams({
                organizationId: defaultWorkspace!.organizationId,
            })
            expect(teams.find(candidate => candidate.id === team.id)?.memberCount).toBe(1)

            await serverActions.removeOrganizationTeamMember({
                organizationId: defaultWorkspace!.organizationId,
                teamId: team.id,
                userId: member.user.id,
            })
            const teamsAfterRemove = await serverActions.listOrganizationTeams({
                organizationId: defaultWorkspace!.organizationId,
            })
            expect(teamsAfterRemove.find(candidate => candidate.id === team.id)?.memberCount).toBe(
                0
            )

            const invitation = await serverActions.createOrganizationInvitation({
                organizationId: defaultWorkspace!.organizationId,
                inviterUserId: admin.id,
                email: 'invitee@postdot.local',
                role: 'member',
                projectId: project.id,
                projectRole: 'editor',
            })
            expect(invitation.status).toBe('pending')
            expect(sentEmails).toHaveLength(1)
            expect(sentEmails[0]?.projectId).toBe(project.id)

            const canceled = await serverActions.cancelOrganizationInvitation({
                invitationId: invitation.id,
            })
            expect(canceled.status).toBe('canceled')

            const orgMembers = await serverActions.listOrganizationMembers({
                organizationId: defaultWorkspace!.organizationId,
            })
            const orgMember = orgMembers.members.find(
                candidate => candidate.userId === member.user.id
            )
            expect(orgMember).toBeDefined()
            const promoted = await serverActions.updateOrganizationMemberRole({
                organizationId: defaultWorkspace!.organizationId,
                memberId: orgMember!.id,
                role: 'admin',
            })
            expect(promoted.role).toBe('admin')

            await serverActions.removeOrganizationMember({
                organizationId: defaultWorkspace!.organizationId,
                memberIdOrEmail: orgMember!.id,
            })
            const afterRemoval = await serverActions.listOrganizationMembers({
                organizationId: defaultWorkspace!.organizationId,
            })
            expect(
                afterRemoval.members.some(candidate => candidate.userId === member.user.id)
            ).toBe(false)

            const extraOrg = await auth.api.createOrganization({
                body: {
                    name: 'Ephemeral Workspace',
                    slug: 'ephemeral-workspace',
                    userId: admin.id,
                    metadata: { postdotResource: 'workspace' },
                },
            })
            await serverActions.deleteOrganization({ organizationId: extraOrg.id })
            expect(await access.getWorkspaceByOrganizationId(extraOrg.id)).toBeNull()
        } finally {
            await closeTestDatabase(database)
        }
    })
})
