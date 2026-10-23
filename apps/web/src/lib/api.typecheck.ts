import type {
    ProjectTag,
    WorkspaceInvitation,
    WorkspaceListResponse,
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
