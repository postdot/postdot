import type { AccessStore } from '@herald/db'
import { Type } from 'typebox'

import { sessionSecurity } from '../../plugins/auth'
import {
    createProjectBody,
    errorResponse,
    projectParams,
    projectSchema,
    updateProjectBody,
} from './models'
import type { AuthenticatedElysia } from './types'
import type { ManualStore } from './types'

export function registerProjectRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    manualStore: ManualStore,
    access: AccessStore
) {
    return app
        .get(
            '/api/projects',
            {
                auth: true,
                response: {
                    200: Type.Object({ projects: Type.Array(projectSchema) }),
                    401: errorResponse,
                },
                detail: {
                    operationId: 'listProjects',
                    summary: 'List projects available to the current user',
                    tags: ['Projects'],
                },
            },
            ({ apiKeyProjectIds, user }) => {
                const isAllowedByApiKeyScope = (projectId: string) =>
                    apiKeyProjectIds === undefined ||
                    apiKeyProjectIds === null ||
                    apiKeyProjectIds.includes(projectId)
                const actorProjects = manualStore
                    .listProjects(user.id)
                    .filter(project => isAllowedByApiKeyScope(project.id))

                const projectsById = new Map(actorProjects.map(project => [project.id, project]))
                for (const workspace of access.listWorkspacesForUser(user.id)) {
                    if (workspace.role !== 'owner' && workspace.role !== 'admin') continue
                    for (const project of manualStore.listProjectsForWorkspace(workspace.id)) {
                        if (isAllowedByApiKeyScope(project.id)) {
                            projectsById.set(project.id, project)
                        }
                    }
                }

                return {
                    projects: [...projectsById.values()].filter(project => {
                        const workspaceId = access.getProjectWorkspaceId(project.id)
                        return (
                            workspaceId !== null &&
                            (access.canAccessProject(project.id, user.id) ||
                                (workspaceId !== null &&
                                    access.canManageWorkspace(workspaceId, user.id)))
                        )
                    }),
                }
            }
        )
        .post(
            '/api/projects',
            {
                auth: true,
                body: createProjectBody,
                response: {
                    201: Type.Object({ project: projectSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'createProject',
                    summary: 'Create a project',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, body, status, user }) => {
                if (authMethod !== 'session') {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'Human authentication is required to create a project',
                        },
                    })
                }

                const workspace =
                    body.workspaceId === undefined
                        ? access.getDefaultWorkspaceForUser(user.id)
                        : access.getWorkspace(body.workspaceId)
                if (workspace === null || !access.canManageWorkspace(workspace.id, user.id)) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message:
                                'A workspace owner or administrator is required to create a project',
                        },
                    })
                }

                const created = manualStore.createProject({
                    name: body.name,
                    subjectId: user.id,
                    displayName: user.name,
                    workspaceId: workspace.id,
                    timeZone: body.timeZone,
                })
                const ownerMembership = access.ensureProjectOwnerMembership({
                    projectId: created.project.id,
                    userId: user.id,
                })
                if (ownerMembership === null) {
                    throw new Error('The project owner membership could not be created')
                }
                return status(201, { project: created.project })
            }
        )
        .patch(
            '/api/projects/:projectId',
            {
                auth: true,
                body: updateProjectBody,
                params: projectParams,
                response: {
                    200: projectSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'updateProjectTimeZone',
                    summary: 'Update the project scheduling timezone',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (authMethod !== 'session') {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'Human authentication is required to update project settings',
                        },
                    })
                }

                if (!access.canAccessProject(params.projectId, user.id, 'editor')) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message:
                                'An active project editor membership is required to update project settings',
                        },
                    })
                }

                const project = manualStore.updateProjectTimeZone({
                    projectId: params.projectId,
                    subjectId: user.id,
                    timeZone: body.timeZone,
                })
                if (project === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }

                return project
            }
        )
}
