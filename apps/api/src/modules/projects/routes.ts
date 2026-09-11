import { randomUUID } from 'node:crypto'

import type { HeraldAuth } from '@herald/auth'
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
    access: AccessStore,
    auth: HeraldAuth
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
            ({ authMethod, projectTokenProjectId, user }) => {
                const projects = manualStore
                    .listProjects(user.id)
                    .filter(
                        project =>
                            projectTokenProjectId === undefined ||
                            project.id === projectTokenProjectId
                    )

                if (authMethod !== 'session') return { projects }

                return {
                    projects: projects.filter(project => {
                        return (
                            access.getProjectOrganizationId(project.id) !== null &&
                            access.canAccessProject(project.id, user.id)
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
            async ({ authMethod, body, request, status, user }) => {
                if (authMethod !== 'session') {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'Human authentication is required to create a project',
                        },
                    })
                }

                if (access.getInstanceMembership(user.id)?.state !== 'enabled') {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message:
                                'An enabled instance membership is required to create a project',
                        },
                    })
                }

                // Better Auth owns the organization and member records used by
                // invitations, project-scoped API keys, and access control. The
                // Herald project keeps the generated organization id as its
                // durable bridge; the organization endpoint is called server-side
                // so users cannot create unrelated organizations directly.
                const organization = await auth.api.createOrganization({
                    body: {
                        name: body.name,
                        slug: `herald-${randomUUID()}`,
                        userId: user.id,
                        metadata: { heraldResource: 'project' },
                    },
                })

                try {
                    const created = manualStore.createProject({
                        name: body.name,
                        subjectId: user.id,
                        displayName: user.name,
                        organizationId: organization.id,
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
                } catch (error) {
                    // Do not leave an organization behind when the domain
                    // transaction or its Better Auth owner membership fails.
                    await auth.api
                        .deleteOrganization({
                            body: { organizationId: organization.id },
                            headers: request.headers,
                        })
                        .catch(() => undefined)
                    throw error
                }
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
