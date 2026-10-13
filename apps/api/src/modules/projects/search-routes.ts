import type { AccessStore } from '@postbot/db'
import { Type, type Static } from 'typebox'

import { errorResponse } from './models'
import type { AuthenticatedElysia, ManualStore } from './types'

const searchResult = Type.Object({
    kind: Type.Union([
        Type.Literal('post'),
        Type.Literal('channel'),
        Type.Literal('project'),
        Type.Literal('media'),
    ]),
    id: Type.String(),
    projectId: Type.String(),
    projectName: Type.String(),
    title: Type.String(),
    description: Type.String(),
    contentType: Type.Optional(Type.Union([Type.String(), Type.Null()])),
})

export const searchResponseSchema = Type.Object({ results: Type.Array(searchResult) })
export type SearchResponse = Static<typeof searchResponseSchema>

export function registerSearchRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    manualStore: ManualStore,
    access: AccessStore
) {
    return app.get(
        '/api/search',
        {
            auth: true,
            query: Type.Object({
                q: Type.String({ minLength: 2, maxLength: 200 }),
                projectId: Type.Optional(Type.String({ minLength: 1 })),
            }),
            response: {
                200: searchResponseSchema,
                401: errorResponse,
                403: errorResponse,
                422: errorResponse,
            },
            detail: {
                operationId: 'searchPostbot',
                summary: 'Search current source posts, channels, media and accessible projects',
                tags: ['Search'],
            },
        },
        ({ user, authMethod, query, status }) => {
            if (authMethod !== 'session')
                return status(403, {
                    error: {
                        code: 'forbidden',
                        message: 'Human authentication is required for dashboard search',
                    },
                })
            const candidates = new Map(
                manualStore.listProjects(user.id).map(project => [project.id, project])
            )
            for (const workspace of access.listWorkspacesForUser(user.id)) {
                for (const project of manualStore.listProjectsForWorkspace(workspace.id))
                    candidates.set(project.id, project)
            }
            const projectIds = [...candidates.values()]
                .filter(
                    project =>
                        access.canAccessProject(project.id, user.id) &&
                        (query.projectId === undefined || project.id === query.projectId)
                )
                .map(project => project.id)
            return { results: manualStore.search(projectIds, query.q) }
        }
    )
}
