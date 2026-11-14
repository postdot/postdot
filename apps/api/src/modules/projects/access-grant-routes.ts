import type { AccessProjectRole, AccessStore } from '@postdot/db'

import type { AuthenticatedElysia } from '../../plugins/auth'
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
            message: 'A project owner role is required to manage project access grants',
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

async function projectExists(projectId: string, access: AccessStore): Promise<boolean> {
    return (await access.getProjectWorkspaceId(projectId)) !== null
}

async function canManageProjectGrants(
    projectId: string,
    access: AccessStore,
    userId: string
): Promise<boolean> {
    if (await access.canAccessProject(projectId, userId, 'owner')) return true

    const workspaceId = await access.getProjectWorkspaceId(projectId)
    return workspaceId !== null && (await access.canManageWorkspace(workspaceId, userId))
}

async function canViewProjectGrants(
    projectId: string,
    access: AccessStore,
    userId: string
): Promise<boolean> {
    if (await access.canAccessProject(projectId, userId, 'viewer')) return true

    const workspaceId = await access.getProjectWorkspaceId(projectId)
    return workspaceId !== null && (await access.canManageWorkspace(workspaceId, userId))
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
                },
            },
            async ({ params, status, user }) => {
                if (!(await projectExists(params.projectId, access))) {
                    return status(404, projectNotFoundResponse())
                }
                if (!(await canViewProjectGrants(params.projectId, access, user.id))) {
                    return status(403, projectGrantReadForbiddenResponse())
                }
                return { grants: await access.listProjectUserGrants(params.projectId) }
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
                },
            },
            async ({ body, params, status, user }) => {
                if (!(await projectExists(params.projectId, access))) {
                    return status(404, projectNotFoundResponse())
                }
                if (!(await canManageProjectGrants(params.projectId, access, user.id))) {
                    return status(403, projectGrantForbiddenResponse())
                }
                const grant = await access.grantProjectUserAccess({
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
                },
            },
            async ({ body, params, status, user }) => {
                if (!(await projectExists(params.projectId, access))) {
                    return status(404, projectNotFoundResponse())
                }
                if (!(await canManageProjectGrants(params.projectId, access, user.id))) {
                    return status(403, projectGrantForbiddenResponse())
                }
                if (
                    (await access.listProjectUserGrants(params.projectId)).every(
                        grant => grant.userId !== params.userId
                    )
                ) {
                    return status(404, projectGrantInvalidResponse())
                }
                const grant = await access.grantProjectUserAccess({
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
                },
            },
            async ({ params, status, user }) => {
                if (!(await projectExists(params.projectId, access))) {
                    return status(404, projectNotFoundResponse())
                }
                if (!(await canManageProjectGrants(params.projectId, access, user.id))) {
                    return status(403, projectGrantForbiddenResponse())
                }
                if (
                    (await access.listProjectUserGrants(params.projectId)).every(
                        grant => grant.userId !== params.userId
                    )
                ) {
                    return status(404, projectGrantInvalidResponse())
                }
                if (!(await access.removeProjectUserAccess(params.projectId, params.userId))) {
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
                },
            },
            async ({ params, status, user }) => {
                if (!(await projectExists(params.projectId, access))) {
                    return status(404, projectNotFoundResponse())
                }
                if (!(await canViewProjectGrants(params.projectId, access, user.id))) {
                    return status(403, projectGrantReadForbiddenResponse())
                }
                return { grants: await access.listProjectTeamGrants(params.projectId) }
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
                },
            },
            async ({ body, params, status, user }) => {
                if (!(await projectExists(params.projectId, access))) {
                    return status(404, projectNotFoundResponse())
                }
                if (!(await canManageProjectGrants(params.projectId, access, user.id))) {
                    return status(403, projectGrantForbiddenResponse())
                }
                if ((await access.getProjectWorkspaceId(params.projectId)) === null) {
                    return status(409, projectGrantInvalidResponse())
                }

                const grant = await access.grantProjectTeamAccess({
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
                },
            },
            async ({ body, params, status, user }) => {
                if (!(await projectExists(params.projectId, access))) {
                    return status(404, projectNotFoundResponse())
                }
                if (!(await canManageProjectGrants(params.projectId, access, user.id))) {
                    return status(403, projectGrantForbiddenResponse())
                }
                if (
                    (await access.listProjectTeamGrants(params.projectId)).every(
                        grant => grant.teamId !== params.teamId
                    )
                ) {
                    return status(404, projectGrantInvalidResponse())
                }

                const grant = await access.grantProjectTeamAccess({
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
                },
            },
            async ({ params, status, user }) => {
                if (!(await projectExists(params.projectId, access))) {
                    return status(404, projectNotFoundResponse())
                }
                if (!(await canManageProjectGrants(params.projectId, access, user.id))) {
                    return status(403, projectGrantForbiddenResponse())
                }
                if (
                    (await access.listProjectTeamGrants(params.projectId)).every(
                        grant => grant.teamId !== params.teamId
                    )
                ) {
                    return status(404, projectGrantInvalidResponse())
                }
                await access.removeProjectTeamAccess(params.projectId, params.teamId)
                return { removed: true as const }
            }
        )
}
