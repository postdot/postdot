import { isCustomHttpAuthentication } from '@postdot/core'
import { CUSTOM_HTTP_PUBLISHER_KIND, normalizeCustomHttpEndpoint } from '@postdot/custom-http'
import type { createManualStore, AccessStore } from '@postdot/db'
import type { DevtoFetcher } from '@postdot/devto'
import type { DiscordFetcher } from '@postdot/discord'
import type { MastodonFetcher } from '@postdot/mastodon'
import type { TelegramFetcher } from '@postdot/telegram'
import type { Logger } from 'pino'
import { Type } from 'typebox'

import { type AuthenticatedElysia } from '../../plugins/auth'
import { registerProviderPublisherRoutes } from '../../providers/routes'
import type { PublisherRuntime } from '../publishers/runtime'
import { canAccessProjectRole, forbiddenProjectMutation } from './authorization'
import { createChannelAccessPolicy } from './channel-access-policy'
import {
    errorResponse,
    customHttpConnectionBody,
    customHttpConnectionResponse,
    projectParams,
    publisherConnectionsSchema,
    publisherDisconnectedSchema,
} from './models'

export function registerPublisherRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    publisher: PublisherRuntime,
    options: {
        readonly channels: Pick<
            ReturnType<typeof createManualStore>,
            'listChannels' | 'sharedChannels'
        >
        readonly access: AccessStore
        readonly logger?: Logger
        readonly onWorkScheduled?: () => void
        readonly mastodonFetcher?: MastodonFetcher
        readonly discordFetcher?: DiscordFetcher
        readonly telegramFetcher?: TelegramFetcher
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
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'listProjectPublishers',
                    summary: 'List connected publishers in a project',
                    tags: ['Channels'],
                },
            },
            async ({ params, status, user }) => {
                const connections = publisherStore.listPublisherConnections(
                    params.projectId,
                    user.id
                )
                if (connections === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }

                const readiness = async (resolve: () => Promise<unknown>) => {
                    try {
                        return (await resolve()) === undefined
                            ? ('not_configured' as const)
                            : ('ready' as const)
                    } catch {
                        return 'unavailable' as const
                    }
                }
                const [linkedin, bluesky, x, facebook, instagram] = await Promise.all([
                    readiness(() => publisher.resolveLinkedInApplication()),
                    readiness(() => publisher.resolveBlueskyApplication()),
                    readiness(() => publisher.resolveXApplication()),
                    readiness(() => publisher.resolveFacebookApplication()),
                    readiness(() => publisher.resolveInstagramApplication()),
                ])
                return {
                    connections,
                    oauthReadiness: { linkedin, bluesky, x, facebook, instagram },
                }
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
        canManageChannel: (projectId: string, channelId: string, userId: string) => {
            const ctx = options.channels.sharedChannels.contextFor({
                contextProjectId: projectId,
                subjectId: userId,
                authorization: createChannelAccessPolicy({
                    access: options.access,
                    userId,
                    authMethod: 'session',
                    apiKeyProjectIds: undefined,
                    apiKeyPermissions: undefined,
                }),
            })
            return (
                ctx !== null &&
                options.channels.sharedChannels.getCadence(ctx, channelId)?.canManage === true
            )
        },
        mastodonFetcher: options.mastodonFetcher ?? publisher.mastodon.fetcher,
    }

    return registerProviderPublisherRoutes(routes, publisher, providerOptions).delete(
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
