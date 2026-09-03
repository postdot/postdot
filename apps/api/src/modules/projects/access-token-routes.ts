import type { ProjectAccessTokenStore } from '@herald/db'
import { Type } from 'typebox'

import { sessionSecurity, type AuthenticatedElysia } from '../../plugins/auth'
import {
    createProjectAccessTokenBody,
    createdProjectAccessTokenSchema,
    errorResponse,
    projectAccessTokenParams,
    projectAccessTokenSchema,
    projectParams,
    projectAccessTokensSchema,
} from './models'

const forbiddenResponse = () => ({
    error: {
        code: 'forbidden',
        message: 'Human authentication is required to manage project access tokens',
    },
})

const unavailableResponse = () => ({
    error: {
        code: 'access_tokens_unavailable',
        message: 'Project access tokens are not available',
    },
})

export function registerProjectAccessTokenRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    accessTokens: ProjectAccessTokenStore | undefined
) {
    return app
        .get(
            '/api/projects/:projectId/access-tokens',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: projectAccessTokensSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    422: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'listProjectAccessTokens',
                    summary: 'List project access token metadata',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, status, user }) => {
                if (authMethod !== 'session') return status(403, forbiddenResponse())
                if (accessTokens === undefined) return status(503, unavailableResponse())

                const projectAccessTokens = accessTokens.list(params.projectId, user.id)
                if (projectAccessTokens === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                return { accessTokens: [...projectAccessTokens] }
            }
        )
        .post(
            '/api/projects/:projectId/access-tokens',
            {
                auth: true,
                body: createProjectAccessTokenBody,
                params: projectParams,
                response: {
                    201: createdProjectAccessTokenSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    422: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'createProjectAccessToken',
                    summary: 'Create a project-scoped machine access token',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (authMethod !== 'session') return status(403, forbiddenResponse())
                if (accessTokens === undefined) return status(503, unavailableResponse())

                const created = accessTokens.create({
                    projectId: params.projectId,
                    subjectId: user.id,
                    name: body.name,
                    expiresAt: body.expiresAt,
                })
                if (created === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                return status(201, created)
            }
        )
        .delete(
            '/api/projects/:projectId/access-tokens/:tokenId',
            {
                auth: true,
                params: projectAccessTokenParams,
                response: {
                    200: Type.Object({ accessToken: projectAccessTokenSchema }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    422: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'revokeProjectAccessToken',
                    summary: 'Revoke a project access token',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, status, user }) => {
                if (authMethod !== 'session') return status(403, forbiddenResponse())
                if (accessTokens === undefined) return status(503, unavailableResponse())

                const accessToken = accessTokens.revoke({
                    projectId: params.projectId,
                    subjectId: user.id,
                    tokenId: params.tokenId,
                })
                if (accessToken === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Access token not found' },
                    })
                }
                return { accessToken }
            }
        )
}
