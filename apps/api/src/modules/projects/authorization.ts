import type { AccessStore } from '@herald/db'

import type { HeraldAuthenticationMethod } from '../../plugins/auth'

export type ProjectRole = 'owner' | 'editor' | 'viewer'

interface ProjectRoleCheck {
    readonly access: AccessStore
    readonly authMethod: HeraldAuthenticationMethod
    readonly minimumRole: ProjectRole
    readonly projectId: string
    readonly userId: string
}

export function canAccessProjectRole({
    access,
    minimumRole,
    projectId,
    userId,
}: ProjectRoleCheck): boolean {
    return access.canAccessProject(projectId, userId, minimumRole)
}

export function forbiddenProjectMutation() {
    return {
        error: {
            code: 'forbidden',
            message: 'An editor project role is required for this operation',
        },
    } as const
}
