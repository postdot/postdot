import type { HeraldAuth } from '@herald/auth'
import type { AccessStore, ProjectApiKeyActorStore } from '@herald/db'
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

const projectOwnerForbiddenResponse = () => ({
    error: {
        code: 'forbidden',
        message: 'A project owner session is required to manage project access tokens',
    },
})

export function registerProjectAccessTokenRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    auth: HeraldAuth,
    access: AccessStore,
    apiKeyActors: ProjectApiKeyActorStore,
    now: () => number = Date.now
) {
    const toProjectAccessToken = (
        projectId: string,
        key: {
            readonly id: string
            readonly name: string | null
            readonly prefix: string | null
            readonly expiresAt: Date | null
            readonly createdAt: Date
            readonly updatedAt: Date
        },
        revokedAt: number | null = null
    ) => ({
        id: key.id,
        projectId,
        name: key.name ?? 'Unnamed API key',
        tokenPrefix: key.prefix ?? 'herald_pat_',
        expiresAt: key.expiresAt?.getTime() ?? null,
        revokedAt,
        createdAt: key.createdAt.getTime(),
        updatedAt: key.updatedAt.getTime(),
    })

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
                },
                detail: {
                    operationId: 'listProjectAccessTokens',
                    summary: 'List project access token metadata',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, request, status, user }) => {
                if (authMethod !== 'session') return status(403, forbiddenResponse())
                const organizationId = access.getProjectOrganizationId(params.projectId)
                if (organizationId === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                if (!access.canAccessProject(params.projectId, user.id, 'owner')) {
                    return status(403, projectOwnerForbiddenResponse())
                }

                try {
                    const listed = await auth.api.listApiKeys({
                        query: { organizationId },
                        headers: request.headers,
                    })
                    return {
                        accessTokens: listed.apiKeys.map(key =>
                            toProjectAccessToken(params.projectId, key)
                        ),
                    }
                } catch {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
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
                },
                detail: {
                    operationId: 'createProjectAccessToken',
                    summary: 'Create a project-scoped machine access token',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, body, params, request, status, user }) => {
                if (authMethod !== 'session') return status(403, forbiddenResponse())
                const organizationId = access.getProjectOrganizationId(params.projectId)
                if (organizationId === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                if (!access.canAccessProject(params.projectId, user.id, 'owner')) {
                    return status(403, projectOwnerForbiddenResponse())
                }

                const expiresIn =
                    body.expiresAt === undefined || body.expiresAt === null
                        ? undefined
                        : Math.ceil((body.expiresAt - now()) / 1_000)
                if (expiresIn !== undefined && expiresIn < 24 * 60 * 60) {
                    return status(400, {
                        error: {
                            code: 'invalid_time',
                            message: 'expiresAt must be at least one day in the future',
                        },
                    })
                }

                const created = await auth.api.createApiKey({
                    body: {
                        name: body.name,
                        organizationId,
                        userId: user.id,
                        metadata: { heraldProjectId: params.projectId },
                        ...(expiresIn === undefined ? {} : { expiresIn }),
                    },
                    headers: request.headers,
                })
                let actor
                try {
                    actor = apiKeyActors.create({
                        projectId: params.projectId,
                        keyId: created.id,
                        name: body.name,
                        now: now(),
                    })
                } catch (error) {
                    // The Better Auth key has already been committed. Remove it
                    // before surfacing the actor-projection failure so a key that
                    // cannot be attributed to Herald never remains usable.
                    await auth.api
                        .deleteApiKey({
                            body: { keyId: created.id },
                            headers: request.headers,
                        })
                        .catch(() => undefined)
                    throw error
                }
                if (actor === null) {
                    await auth.api
                        .deleteApiKey({
                            body: { keyId: created.id },
                            headers: request.headers,
                        })
                        .catch(() => undefined)
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                return status(201, {
                    accessToken: toProjectAccessToken(params.projectId, created),
                    token: created.key,
                })
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
                },
                detail: {
                    operationId: 'revokeProjectAccessToken',
                    summary: 'Revoke a project access token',
                    tags: ['Projects'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, request, status, user }) => {
                if (authMethod !== 'session') return status(403, forbiddenResponse())
                const organizationId = access.getProjectOrganizationId(params.projectId)
                if (organizationId === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                if (!access.canAccessProject(params.projectId, user.id, 'owner')) {
                    return status(403, projectOwnerForbiddenResponse())
                }

                let existing
                try {
                    const listed = await auth.api.listApiKeys({
                        query: { organizationId },
                        headers: request.headers,
                    })
                    existing = listed.apiKeys.find(key => key.id === params.tokenId)
                } catch {
                    existing = undefined
                }
                if (existing === undefined) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Access token not found' },
                    })
                }

                await auth.api.deleteApiKey({
                    body: { keyId: params.tokenId },
                    headers: request.headers,
                })
                return {
                    accessToken: toProjectAccessToken(params.projectId, existing, now()),
                }
            }
        )
}
