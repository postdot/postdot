import type {
    ProjectTag,
    ProjectMember,
    ProjectInvitation,
    ProjectMemberRole,
    ProjectInvitationStatus,
    ProjectUserGrant,
    ProjectTeamGrant,
    WorkspaceInvitation,
    WorkspaceListResponse,
    WorkspaceListItem,
    WorkspaceMember,
    WorkspaceTeam,
    WorkspaceRole,
    WorkspaceSummary,
    WorkspaceTeamMember,
} from '@postdot/client'

import type { api } from './api'

type Equal<Left, Right> =
    (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
        ? true
        : false

type Assert<Value extends true> = Value

/** Compile-time contracts: unknown, any or drifted tag responses must fail. */
export type InferredProjectTagResponses = [
    Assert<Equal<Awaited<ReturnType<typeof api.listProjectTags>>, { tags: ProjectTag[] }>>,
    Assert<Equal<Awaited<ReturnType<typeof api.createProjectTag>>, { tag: ProjectTag }>>,
    Assert<Equal<Awaited<ReturnType<typeof api.renameProjectTag>>, { tag: ProjectTag }>>,
    Assert<Equal<Awaited<ReturnType<typeof api.archiveProjectTag>>, { tag: ProjectTag }>>,
    Assert<Equal<Awaited<ReturnType<typeof api.restoreProjectTag>>, { tag: ProjectTag }>>,
]

/** Workspace reads use the server contract, including its open invitation status. */
export type InferredWorkspaceResponses = [
    Assert<Equal<Awaited<ReturnType<typeof api.listWorkspaces>>, WorkspaceListResponse>>,
    Assert<Equal<Awaited<ReturnType<typeof api.getWorkspace>>, WorkspaceSummary>>,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.listWorkspaceTeamMembers>>,
            { members: WorkspaceTeamMember[] }
        >
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.listWorkspaceInvitations>>,
            { invitations: WorkspaceInvitation[] }
        >
    >,
    Assert<Equal<WorkspaceRole, 'owner' | 'admin' | 'member'>>,
    Assert<Equal<WorkspaceInvitation['status'], string>>,
    Assert<Equal<WorkspaceTeamMember['id'], string>>,
    Assert<Equal<WorkspaceListResponse['canCreateWorkspace'], boolean>>,
]

/** Workspace writes preserve their existing role restrictions and server results. */
export type InferredWorkspaceMutations = [
    Assert<
        Equal<Awaited<ReturnType<typeof api.createWorkspace>>, { workspace: WorkspaceListItem }>
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.updateWorkspaceMemberRole>>,
            { member: WorkspaceMember }
        >
    >,
    Assert<Equal<Awaited<ReturnType<typeof api.removeWorkspaceMember>>, { removed: true }>>,
    Assert<Equal<Awaited<ReturnType<typeof api.createWorkspaceTeam>>, { team: WorkspaceTeam }>>,
    Assert<Equal<Awaited<ReturnType<typeof api.renameWorkspaceTeam>>, { team: WorkspaceTeam }>>,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.addWorkspaceTeamMember>>,
            { member: WorkspaceTeamMember }
        >
    >,
    Assert<Equal<Awaited<ReturnType<typeof api.removeWorkspaceTeamMember>>, { removed: true }>>,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.createWorkspaceInvitation>>,
            { invitation: WorkspaceInvitation }
        >
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.cancelWorkspaceInvitation>>,
            { invitation: WorkspaceInvitation }
        >
    >,
    Assert<Equal<Parameters<typeof api.updateWorkspaceMemberRole>[2], 'admin' | 'member'>>,
]

/** Project grant results follow the server; writes cannot elevate a role to owner. */
export type InferredProjectGrants = [
    Assert<
        Equal<Awaited<ReturnType<typeof api.listProjectUserGrants>>, { grants: ProjectUserGrant[] }>
    >,
    Assert<
        Equal<Awaited<ReturnType<typeof api.createProjectUserGrant>>, { grant: ProjectUserGrant }>
    >,
    Assert<
        Equal<Awaited<ReturnType<typeof api.updateProjectUserGrant>>, { grant: ProjectUserGrant }>
    >,
    Assert<Equal<Awaited<ReturnType<typeof api.removeProjectUserGrant>>, { removed: true }>>,
    Assert<
        Equal<Awaited<ReturnType<typeof api.listProjectTeamGrants>>, { grants: ProjectTeamGrant[] }>
    >,
    Assert<
        Equal<Awaited<ReturnType<typeof api.createProjectTeamGrant>>, { grant: ProjectTeamGrant }>
    >,
    Assert<
        Equal<Awaited<ReturnType<typeof api.updateProjectTeamGrant>>, { grant: ProjectTeamGrant }>
    >,
    Assert<Equal<Awaited<ReturnType<typeof api.removeProjectTeamGrant>>, { removed: true }>>,
    Assert<Equal<Parameters<typeof api.createProjectUserGrant>[2], 'editor' | 'viewer'>>,
    Assert<Equal<Parameters<typeof api.updateProjectUserGrant>[2], 'editor' | 'viewer'>>,
    Assert<Equal<Parameters<typeof api.createProjectTeamGrant>[2], 'editor' | 'viewer'>>,
    Assert<Equal<Parameters<typeof api.updateProjectTeamGrant>[2], 'editor' | 'viewer'>>,
]

/** Membership and invitation contracts retain their server-defined roles and states. */
export type InferredProjectMembershipContracts = [
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.listProjectMembers>>,
            { members: ProjectMember[]; total: number }
        >
    >,
    Assert<
        Equal<Awaited<ReturnType<typeof api.getProjectMembership>>, { membership: ProjectMember }>
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.listProjectInvitations>>,
            { invitations: ProjectInvitation[] }
        >
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.createProjectInvitation>>,
            { invitation: ProjectInvitation }
        >
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.cancelProjectInvitation>>,
            { invitation: ProjectInvitation }
        >
    >,
    Assert<
        Equal<
            Awaited<ReturnType<typeof api.resendProjectInvitation>>,
            { invitation: ProjectInvitation }
        >
    >,
    Assert<
        Equal<Awaited<ReturnType<typeof api.updateProjectMember>>, { membership: ProjectMember }>
    >,
    Assert<Equal<Awaited<ReturnType<typeof api.removeProjectMember>>, { removed: true }>>,
    Assert<Equal<Parameters<typeof api.createProjectInvitation>[2], 'editor' | 'viewer'>>,
    Assert<Equal<Parameters<typeof api.updateProjectMember>[2], 'editor' | 'viewer'>>,
    Assert<Equal<ProjectMemberRole, 'owner' | 'editor' | 'viewer'>>,
    Assert<Equal<ProjectInvitationStatus, 'pending' | 'accepted' | 'rejected' | 'canceled'>>,
    Assert<Equal<ProjectMember['state'], 'active'>>,
]
