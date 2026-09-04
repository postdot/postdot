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
    manualStore: ManualStore
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
            ({ user }) => ({ projects: manualStore.listProjects(user.id) })
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
            ({ authMethod, body, status, user }) => {
                if (authMethod !== 'session') {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'Human authentication is required to create a project',
                        },
                    })
                }

                const created = manualStore.createProject({
                    name: body.name,
                    subjectId: user.id,
                    displayName: user.name,
                    timeZone: body.timeZone,
                })
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
