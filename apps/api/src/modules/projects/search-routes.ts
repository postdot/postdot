import type { AccessStore } from '@postdot/db'
import { filterSequential } from '@postdot/db'
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
                operationId: 'searchPostdot',
                summary: 'Search current source posts, channels, media and accessible projects',
                tags: ['Search'],
            },
        },
        async ({ user, authMethod, apiKeyProjectIds, query }) => {
            const candidates = new Map(
                (await manualStore.listProjects(user.id)).map(project => [project.id, project])
            )
            for (const workspace of await access.listWorkspacesForUser(user.id)) {
                for (const project of await manualStore.listProjectsForWorkspace(workspace.id))
                    candidates.set(project.id, project)
            }
            const allowedProjectIds =
                authMethod === 'user_api_key' && apiKeyProjectIds != null
                    ? new Set(apiKeyProjectIds)
                    : null
            const projectIds = (
                await filterSequential(
                    [...candidates.values()],
                    async project =>
                        (allowedProjectIds === null || allowedProjectIds.has(project.id)) &&
                        (await access.canAccessProject(project.id, user.id)) &&
                        (query.projectId === undefined || project.id === query.projectId)
                )
            ).map(project => project.id)
            return { results: await manualStore.search(projectIds, query.q) }
        }
    )
}
