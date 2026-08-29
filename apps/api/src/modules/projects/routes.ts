import { Type } from 'typebox'

import { createProjectBody, errorResponse, projectSchema } from './models'
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
                response: Type.Object({ projects: Type.Array(projectSchema) }),
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
                    422: errorResponse,
                },
                detail: {
                    operationId: 'createProject',
                    summary: 'Create a project',
                    tags: ['Projects'],
                },
            },
            ({ body, status, user }) => {
                const created = manualStore.createProject({
                    name: body.name,
                    subjectId: user.id,
                    displayName: user.name,
                })
                return status(201, { project: created.project })
            }
        )
}
