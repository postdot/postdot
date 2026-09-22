import { isCustomHttpAuthentication } from '@herald/core'
import { CUSTOM_HTTP_PUBLISHER_KIND, normalizeCustomHttpEndpoint } from '@herald/custom-http'
import type { AccessStore } from '@herald/db'
import type { DevtoFetcher } from '@herald/devto'
import type { DiscordFetcher } from '@herald/discord'
import type { MastodonFetcher } from '@herald/mastodon'
import type { Logger } from 'pino'
import { Type } from 'typebox'

import { type AuthenticatedElysia } from '../../plugins/auth'
import type { PublisherRuntime } from '../publishers/runtime'
import { canAccessProjectRole, forbiddenProjectMutation } from './authorization'
import {
    errorResponse,
    customHttpConnectionBody,
    customHttpConnectionResponse,
    projectParams,
    publisherConnectionsSchema,
    publisherDisconnectedSchema,
} from './models'
import { registerBlueskyPublisherRoutes } from './publisher-providers/bluesky-routes'
import { registerDevtoPublisherRoutes } from './publisher-providers/devto-routes'
import { registerDiscordPublisherRoutes } from './publisher-providers/discord-routes'
import { registerLinkedInPublisherRoutes } from './publisher-providers/linkedin-routes'
import { registerMastodonPublisherRoutes } from './publisher-providers/mastodon-routes'
import { registerXPublisherRoutes } from './publisher-providers/x-routes'

export function registerPublisherRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    publisher: PublisherRuntime,
    options: {
        readonly access: AccessStore
        readonly logger?: Logger
        readonly onWorkScheduled?: () => void
        readonly mastodonFetcher?: MastodonFetcher
        readonly discordFetcher?: DiscordFetcher
        readonly devtoFetcher?: DevtoFetcher
    }
) {
    const { publisherStore } = publisher
    const routes = app
        .get(
            '/api/projects/:projectId/publishers',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: publisherConnectionsSchema,
                    401: errorResponse,
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
            '/api/projects/:projectId/channels/:channelId/publisher/custom-http/connect',
            {
                auth: true,
                params: Type.Object({
                    projectId: Type.String({ minLength: 1 }),
                    channelId: Type.String({ minLength: 1 }),
                }),
                body: customHttpConnectionBody,
                response: {
                    200: customHttpConnectionResponse,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'createCustomHttpPublisherConnection',
                    summary: 'Create a custom HTTP publisher connection',
                    tags: ['Channels'],
                },
            },
            async ({ authMethod, body, params, status, user }) => {
                if (
                    !canAccessProjectRole({
                        access: options.access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                if (!publisherStore.hasChannelAccess(params.projectId, params.channelId, user.id)) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }

                const existingConnection = publisherStore.getPublisherConnection(
                    params.projectId,
                    params.channelId,
                    user.id
                )
                if (existingConnection?.state === 'active') {
                    return status(409, {
                        error: {
                            code: 'publisher_exists',
                            message: 'This channel already has a publisher',
                        },
                    })
                }
                const replaceNonActiveConnection =
                    existingConnection === null
                        ? undefined
                        : { id: existingConnection.id, state: existingConnection.state }

                let endpoint: ReturnType<typeof normalizeCustomHttpEndpoint>
                try {
                    endpoint = normalizeCustomHttpEndpoint(body.endpointUrl)
                } catch {
                    return status(400, {
                        error: {
                            code: 'invalid_connection',
                            message:
                                'The custom HTTP endpoint must be a valid origin-only HTTP URL',
                        },
                    })
                }
                if (!isCustomHttpAuthentication(body.authentication)) {
                    return status(400, {
                        error: {
                            code: 'invalid_connection',
                            message: 'The custom HTTP authentication configuration is invalid',
                        },
                    })
                }

                const actorId = publisherStore.getProjectActorId(params.projectId, user.id)
                if (actorId === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }

                const credential = await publisher.credentialStore.createPublisherCredential({
                    projectId: params.projectId,
                    connectedByActorId: actorId,
                    providerId: CUSTOM_HTTP_PUBLISHER_KIND,
                    externalAccountId: crypto.randomUUID(),
                    externalAccountName: body.externalAccountName ?? endpoint.hostname,
                    scopes: [],
                    accessToken: body.secret,
                    expiresAt: null,
                })
                if (credential.kind !== 'created') {
                    return status(409, {
                        error: {
                            code: 'credential_exists',
                            message: 'The custom HTTP credential could not be created',
                        },
                    })
                }

                const connection = publisherStore.createPublisherConnection({
                    projectId: params.projectId,
                    channelId: params.channelId,
                    subjectId: user.id,
                    kind: CUSTOM_HTTP_PUBLISHER_KIND,
                    credentialId: credential.credential.id,
                    endpointUrl: endpoint.url.origin,
                    authentication: body.authentication,
                    replaceNonActiveConnection,
                })
                if (connection.kind !== 'created') {
                    publisher.credentialStore.revokePublisherCredential(
                        params.projectId,
                        credential.credential.id
                    )
                    return connection.kind === 'publisher_exists'
                        ? status(409, {
                              error: {
                                  code: 'publisher_exists',
                                  message: 'This channel already has a publisher',
                              },
                          })
                        : status(400, {
                              error: {
                                  code: 'invalid_connection',
                                  message: 'The custom HTTP connection could not be created',
                              },
                          })
                }

                options.onWorkScheduled?.()
                return { connection: connection.connection }
            }
        )

    const providerOptions = {
        ...options,
        mastodonFetcher: options.mastodonFetcher ?? publisher.mastodon.fetcher,
    }

    return registerXPublisherRoutes(
        registerMastodonPublisherRoutes(
            registerDiscordPublisherRoutes(
                registerDevtoPublisherRoutes(
                    registerBlueskyPublisherRoutes(
                        registerLinkedInPublisherRoutes(routes, publisher, providerOptions),
                        publisher,
                        providerOptions
                    ),
                    publisher,
                    providerOptions
                ),
                publisher,
                providerOptions
            ),
            publisher,
            providerOptions
        ),
        publisher,
        providerOptions
    ).delete(
        '/api/projects/:projectId/channels/:channelId/publisher',
        {
            auth: true,
            params: Type.Object({
                projectId: Type.String({ minLength: 1 }),
                channelId: Type.String({ minLength: 1 }),
            }),
            response: {
                200: publisherDisconnectedSchema,
                401: errorResponse,
                403: errorResponse,
                404: errorResponse,
                409: errorResponse,
            },
            detail: {
                operationId: 'disconnectProjectPublisher',
                summary: 'Disconnect the publisher from a project channel',
                tags: ['Channels'],
            },
        },
        ({ authMethod, params, status, user }) => {
            if (
                !canAccessProjectRole({
                    access: options.access,
                    authMethod,
                    minimumRole: 'editor',
                    projectId: params.projectId,
                    userId: user.id,
                })
            ) {
                return status(403, forbiddenProjectMutation())
            }
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
