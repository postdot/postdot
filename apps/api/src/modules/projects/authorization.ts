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

/**
 * Project API keys are scoped to one project. They represent a machine actor
 * rather than a Better Auth project member, so the key scope grants ordinary
 * project operations but never instance or membership-owner operations.
 * Human sessions continue to use the project's explicit role.
 */
export function canAccessProjectRole({
    access,
    authMethod,
    minimumRole,
    projectId,
    userId,
}: ProjectRoleCheck): boolean {
    if (authMethod === 'project_token') return minimumRole !== 'owner'
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
