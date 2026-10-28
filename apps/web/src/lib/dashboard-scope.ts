export interface DashboardScope {
    readonly workspaceId: string | null
    readonly projectId: string | null
}

interface ProjectScope {
    readonly id: string
    readonly workspaceId: string | null
}

interface WorkspaceScope {
    readonly id: string
    readonly isDefault: boolean
}

export function readDashboardScope(userId: string): DashboardScope | undefined {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(`postdot:scope:${userId}`) ?? 'null')
        if (value === null || typeof value !== 'object') return undefined
        if (!('workspaceId' in value) || !('projectId' in value)) return undefined
        if (typeof value.workspaceId !== 'string' && value.workspaceId !== null) return undefined
        if (typeof value.projectId !== 'string' && value.projectId !== null) return undefined
        return { workspaceId: value.workspaceId, projectId: value.projectId }
    } catch {
        return undefined
    }
}

export function rememberDashboardScope(userId: string, scope: DashboardScope) {
    try {
        localStorage.setItem(`postdot:scope:${userId}`, JSON.stringify(scope))
    } catch {
        // Navigation still works when browser storage is unavailable.
    }
}

/** Explicit links win; remembered identities are checked against current access. */
export function resolveDashboardScope({
    workspaceId,
    projectId,
    remembered,
    projects,
    workspaces,
}: {
    readonly workspaceId?: string
    readonly projectId?: string
    readonly remembered?: DashboardScope
    readonly projects: readonly ProjectScope[]
    readonly workspaces: readonly WorkspaceScope[]
}): DashboardScope {
    const explicitProject = projects.find(project => project.id === projectId)
    const selectedWorkspace =
        workspaces.find(workspace => workspace.id === workspaceId) ??
        workspaces.find(workspace => workspace.id === explicitProject?.workspaceId) ??
        workspaces.find(workspace => workspace.id === remembered?.workspaceId) ??
        workspaces.find(workspace => workspace.isDefault) ??
        workspaces[0]
    const selectedProject =
        projectId === 'none'
            ? undefined
            : projects.find(
                  project =>
                      project.workspaceId === selectedWorkspace?.id &&
                      project.id === (projectId ?? remembered?.projectId)
              )
    return {
        workspaceId: selectedWorkspace?.id ?? null,
        projectId: selectedProject?.id ?? null,
    }
}
