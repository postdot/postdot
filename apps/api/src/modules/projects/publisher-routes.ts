import type { HeraldAuth } from '@herald/auth'
import type { HTTPHeaders } from 'elysia'
import { Type } from 'typebox'

import {
    channelParams,
    createPublisherBody,
    errorResponse,
    linkedInConnectionSchema,
    projectParams,
    publisherConnectionSchema,
    publisherConnectionsSchema,
    publisherDisconnectedSchema,
} from './models'
import type { AuthenticatedElysia, PublisherStore } from './types'

const linkedInRequiredScopes = ['w_member_social'] as const

function forwardAuthResponseHeaders(source: Headers, target: HTTPHeaders) {
    for (const [name, value] of source.entries()) {
        if (name !== 'set-cookie') target[name] = value
    }

    const headersWithCookies = source as Headers & {
        readonly getSetCookie?: () => string[]
    }
    const cookies = headersWithCookies.getSetCookie?.() ?? []
    const cookieHeader = source.get('set-cookie')

    if (cookies.length > 0) {
        target['set-cookie'] = cookies
    } else if (cookieHeader !== null) {
        target['set-cookie'] = cookieHeader
    }
}

export function registerPublisherRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    auth: HeraldAuth,
    publisherStore: PublisherStore,
    options: {
        readonly webOrigin?: string
        readonly onWorkScheduled?: () => void
    } = {}
) {
    return app
        .get(
            '/api/projects/:projectId/publishers',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: publisherConnectionsSchema,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'listProjectPublishers',
                    summary: 'List connected publishers in a project',
                    tags: ['Channels'],
                },
            },
            ({ params, status, user }) => {
                const connections = publisherStore.listPublisherConnections(
                    params.projectId,
                    user.id
                )
                if (connections === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }

                return { connections }
            }
        )
        .post(
            '/api/projects/:projectId/channels/:channelId/publisher/linkedin/connect',
            {
                auth: true,
                params: channelParams,
                response: {
                    200: linkedInConnectionSchema,
                    404: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'startLinkedInPublisherConnection',
                    summary: 'Start the LinkedIn publisher account connection flow',
                    tags: ['Channels'],
                },
            },
            async ({ params, request, set, status, user }) => {
                if (!publisherStore.hasChannelAccess(params.projectId, params.channelId, user.id)) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }

                try {
                    const authorization = await auth.api.linkSocialAccount({
                        body: {
                            provider: 'linkedin',
                            scopes: [...linkedInRequiredScopes],
                            callbackURL:
                                options.webOrigin === undefined
                                    ? undefined
                                    : new URL('/dashboard', options.webOrigin).toString(),
                            disableRedirect: true,
                        },
                        headers: request.headers,
                        returnHeaders: true,
                    })

                    forwardAuthResponseHeaders(authorization.headers, set.headers)

                    return {
                        provider: 'linkedin' as const,
                        scopes: [...linkedInRequiredScopes],
                        authorizationUrl: authorization.response.url,
                    }
                } catch {
                    return status(503, {
                        error: {
                            code: 'provider_unavailable',
                            message: 'LinkedIn publisher connection is not available',
                        },
                    })
                }
            }
        )
        .post(
            '/api/projects/:projectId/channels/:channelId/publisher',
            {
                auth: true,
                body: createPublisherBody,
                params: channelParams,
                response: {
                    201: Type.Object({ connection: publisherConnectionSchema }),
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'connectProjectPublisher',
                    summary: 'Bind a linked account to a project channel publisher',
                    tags: ['Channels'],
                },
            },
            ({ body, params, status, user }) => {
                const result = publisherStore.createPublisherConnection({
                    projectId: params.projectId,
                    channelId: params.channelId,
                    subjectId: user.id,
                    kind: body.provider,
                    accountId: body.accountId,
                    requiredScopes: [...linkedInRequiredScopes],
                })

                if (result.kind === 'not_found') {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project or channel not found' },
                    })
                }

                if (result.kind === 'invalid_account') {
                    return status(422, {
                        error: {
                            code: 'invalid_publisher_account',
                            message: 'The account is not available for this publisher',
                        },
                    })
                }

                if (result.kind === 'missing_scopes') {
                    return status(422, {
                        error: {
                            code: 'missing_publisher_scopes',
                            message:
                                'The linked account is missing required publishing permissions',
                        },
                    })
                }

                if (result.kind === 'publisher_exists') {
                    return status(409, {
                        error: {
                            code: 'publisher_exists',
                            message: 'This channel already has a publisher',
                        },
                    })
                }

                options.onWorkScheduled?.()
                return status(201, { connection: result.connection })
            }
        )
        .delete(
            '/api/projects/:projectId/channels/:channelId/publisher',
            {
                auth: true,
                params: channelParams,
                response: {
                    200: publisherDisconnectedSchema,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'disconnectProjectPublisher',
                    summary: 'Disconnect the publisher from a project channel',
                    tags: ['Channels'],
                },
            },
            ({ params, status, user }) => {
                const result = publisherStore.disconnectPublisherConnection({
                    projectId: params.projectId,
                    channelId: params.channelId,
                    subjectId: user.id,
                })

                if (result.kind === 'not_found') {
                    return status(404, {
                        error: { code: 'not_found', message: 'Publisher not found' },
                    })
                }

                if (result.kind === 'active_work') {
                    return status(409, {
                        error: {
                            code: 'publisher_has_active_work',
                            message: 'The publisher cannot be disconnected while work is active',
                        },
                    })
                }

                return { disconnected: true as const }
            }
        )
}
