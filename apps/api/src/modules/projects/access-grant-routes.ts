import type { AccessProjectRole, AccessStore } from '@postdot/db'

import {
    sessionSecurity,
    type AuthenticatedElysia,
    type PostdotAuthenticationMethod,
} from '../../plugins/auth'
import {
    errorResponse,
    projectMemberRemovedSchema,
    projectParams,
    projectUserGrantBody,
    projectUserGrantParams,
    projectUserGrantResponseSchema,
    projectUserGrantsSchema,
    updateProjectUserGrantBody,
    projectTeamGrantBody,
    projectTeamGrantParams,
    projectTeamGrantResponseSchema,
    projectTeamGrantsSchema,
    updateProjectTeamGrantBody,
} from './models'

const projectNotFoundResponse = () =>
    ({
        error: { code: 'not_found', message: 'Project not found' },
    }) as const

const projectGrantForbiddenResponse = () =>
    ({
        error: {
            code: 'forbidden',
            message: 'A project owner session is required to manage project access grants',
        },
    }) as const

const projectGrantReadForbiddenResponse = () =>
    ({
        error: {
            code: 'forbidden',
            message: 'An active project membership is required to view project access grants',
        },
    }) as const

const projectGrantInvalidResponse = () =>
    ({
        error: {
            code: 'invalid_project_grant',
            message: 'The group must belong to the project workspace',
        },
    }) as const

function projectExists(projectId: string, access: AccessStore): boolean {
    return access.getProjectWorkspaceId(projectId) !== null
}

function canManageProjectGrants(
    projectId: string,
    access: AccessStore,
    authMethod: PostdotAuthenticationMethod,
    userId: string
): boolean {
    if (authMethod !== 'session') return false
    if (access.canAccessProject(projectId, userId, 'owner')) return true

    const workspaceId = access.getProjectWorkspaceId(projectId)
    return workspaceId !== null && access.canManageWorkspace(workspaceId, userId)
}

function canViewProjectGrants(
    projectId: string,
    access: AccessStore,
    authMethod: PostdotAuthenticationMethod,
    userId: string
): boolean {
    if (authMethod !== 'session') return false
    if (access.canAccessProject(projectId, userId, 'viewer')) return true

    const workspaceId = access.getProjectWorkspaceId(projectId)
    return workspaceId !== null && access.canManageWorkspace(workspaceId, userId)
}

export function registerProjectAccessGrantRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    access: AccessStore
) {
    return app
        .get(
            '/api/projects/:projectId/user-grants',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: projectUserGrantsSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'listProjectUserGrants',
                    summary: 'List direct user grants for a project',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, status, user }) => {
                if (!projectExists(params.projectId, access)) {
                    return status(404, projectNotFoundResponse())
                }
                if (!canViewProjectGrants(params.projectId, access, authMethod, user.id)) {
                    return status(403, projectGrantReadForbiddenResponse())
                }
                return { grants: access.listProjectUserGrants(params.projectId) }
            }
        )
        .post(
            '/api/projects/:projectId/user-grants',
            {
                auth: true,
                body: projectUserGrantBody,
                params: projectParams,
                response: {
                    201: projectUserGrantResponseSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'createProjectUserGrant',
                    summary: 'Grant a Postdot user access to a project',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (!projectExists(params.projectId, access)) {
                    return status(404, projectNotFoundResponse())
                }
                if (!canManageProjectGrants(params.projectId, access, authMethod, user.id)) {
                    return status(403, projectGrantForbiddenResponse())
                }
                const grant = access.grantProjectUserAccess({
                    projectId: params.projectId,
                    userId: body.userId,
                    role: body.role,
                })
                if (grant === null) return status(409, projectGrantInvalidResponse())
                return status(201, { grant })
            }
        )
        .patch(
            '/api/projects/:projectId/user-grants/:userId',
            {
                auth: true,
                body: updateProjectUserGrantBody,
                params: projectUserGrantParams,
                response: {
                    200: projectUserGrantResponseSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'updateProjectUserGrant',
                    summary: 'Update a direct project user grant',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (!projectExists(params.projectId, access)) {
                    return status(404, projectNotFoundResponse())
                }
                if (!canManageProjectGrants(params.projectId, access, authMethod, user.id)) {
                    return status(403, projectGrantForbiddenResponse())
                }
                if (
                    access
                        .listProjectUserGrants(params.projectId)
                        .every(grant => grant.userId !== params.userId)
                ) {
                    return status(404, projectGrantInvalidResponse())
                }
                const grant = access.grantProjectUserAccess({
                    projectId: params.projectId,
                    userId: params.userId,
                    role: body.role,
                })
                if (grant === null) return status(409, projectGrantInvalidResponse())
                return { grant }
            }
        )
        .delete(
            '/api/projects/:projectId/user-grants/:userId',
            {
                auth: true,
                params: projectUserGrantParams,
                response: {
                    200: projectMemberRemovedSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'removeProjectUserGrant',
                    summary: 'Remove a direct user grant from a project',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, status, user }) => {
                if (!projectExists(params.projectId, access)) {
                    return status(404, projectNotFoundResponse())
                }
                if (!canManageProjectGrants(params.projectId, access, authMethod, user.id)) {
                    return status(403, projectGrantForbiddenResponse())
                }
                if (
                    access
                        .listProjectUserGrants(params.projectId)
                        .every(grant => grant.userId !== params.userId)
                ) {
                    return status(404, projectGrantInvalidResponse())
                }
                if (!access.removeProjectUserAccess(params.projectId, params.userId)) {
                    return status(409, projectGrantInvalidResponse())
                }
                return { removed: true as const }
            }
        )
        .get(
            '/api/projects/:projectId/team-grants',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: projectTeamGrantsSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'listProjectTeamGrants',
                    summary: 'List workspace groups granted access to a project',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, status, user }) => {
                if (!projectExists(params.projectId, access)) {
                    return status(404, projectNotFoundResponse())
                }
                if (!canViewProjectGrants(params.projectId, access, authMethod, user.id)) {
                    return status(403, projectGrantReadForbiddenResponse())
                }
                return { grants: access.listProjectTeamGrants(params.projectId) }
            }
        )
        .post(
            '/api/projects/:projectId/team-grants',
            {
                auth: true,
                body: projectTeamGrantBody,
                params: projectParams,
                response: {
                    201: projectTeamGrantResponseSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'createProjectTeamGrant',
                    summary: 'Grant a workspace group access to a project',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (!projectExists(params.projectId, access)) {
                    return status(404, projectNotFoundResponse())
                }
                if (!canManageProjectGrants(params.projectId, access, authMethod, user.id)) {
                    return status(403, projectGrantForbiddenResponse())
                }
                if (access.getProjectWorkspaceId(params.projectId) === null) {
                    return status(409, projectGrantInvalidResponse())
                }

                const grant = access.grantProjectTeamAccess({
                    projectId: params.projectId,
                    teamId: body.teamId,
                    role: body.role as AccessProjectRole,
                })
                if (grant === null) return status(409, projectGrantInvalidResponse())
                return status(201, { grant })
            }
        )
        .patch(
            '/api/projects/:projectId/team-grants/:teamId',
            {
                auth: true,
                body: updateProjectTeamGrantBody,
                params: projectTeamGrantParams,
                response: {
                    200: projectTeamGrantResponseSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'updateProjectTeamGrant',
                    summary: 'Update a project group access grant',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (!projectExists(params.projectId, access)) {
                    return status(404, projectNotFoundResponse())
                }
                if (!canManageProjectGrants(params.projectId, access, authMethod, user.id)) {
                    return status(403, projectGrantForbiddenResponse())
                }
                if (
                    access
                        .listProjectTeamGrants(params.projectId)
                        .every(grant => grant.teamId !== params.teamId)
                ) {
                    return status(404, projectGrantInvalidResponse())
                }

                const grant = access.grantProjectTeamAccess({
                    projectId: params.projectId,
                    teamId: params.teamId,
                    role: body.role as AccessProjectRole,
                })
                if (grant === null) return status(409, projectGrantInvalidResponse())
                return { grant }
            }
        )
        .delete(
            '/api/projects/:projectId/team-grants/:teamId',
            {
                auth: true,
                params: projectTeamGrantParams,
                response: {
                    200: projectMemberRemovedSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'removeProjectTeamGrant',
                    summary: 'Remove a workspace group from a project',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, status, user }) => {
                if (!projectExists(params.projectId, access)) {
                    return status(404, projectNotFoundResponse())
                }
                if (!canManageProjectGrants(params.projectId, access, authMethod, user.id)) {
                    return status(403, projectGrantForbiddenResponse())
                }
                if (
                    access
                        .listProjectTeamGrants(params.projectId)
                        .every(grant => grant.teamId !== params.teamId)
                ) {
                    return status(404, projectGrantInvalidResponse())
                }
                access.removeProjectTeamAccess(params.projectId, params.teamId)
                return { removed: true as const }
            }
        )
}
