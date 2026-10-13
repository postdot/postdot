import type { AccessStore } from '@postbot/db'
import {
    DISCORD_PROVIDER,
    DISCORD_TEXT_CHANNEL_TYPES,
    createDiscordPublisher,
    normalizeDiscordBotToken,
    normalizeDiscordChannelId,
    type DiscordFetcher,
} from '@postbot/discord'
import type { Logger } from 'pino'
import { Type } from 'typebox'

import type { AuthenticatedElysia } from '../../../plugins/auth'
import type { PublisherRuntime } from '../../publishers/runtime'
import { canAccessProjectRole, forbiddenProjectMutation } from '../authorization'
import { discordConnectionBody, discordConnectionResponse, errorResponse } from '../models'

export function registerDiscordPublisherRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    publisher: PublisherRuntime,
    options: {
        readonly access: AccessStore
        readonly logger?: Logger
        readonly onWorkScheduled?: () => void
        readonly discordFetcher?: DiscordFetcher
    }
) {
    const { credentialStore, publisherStore } = publisher

    return app.post(
        '/api/projects/:projectId/channels/:channelId/publisher/discord/connect',
        {
            auth: true,
            params: Type.Object({
                projectId: Type.String({ minLength: 1 }),
                channelId: Type.String({ minLength: 1 }),
            }),
            body: discordConnectionBody,
            response: {
                200: discordConnectionResponse,
                400: errorResponse,
                401: errorResponse,
                403: errorResponse,
                404: errorResponse,
                409: errorResponse,
                503: errorResponse,
            },
            detail: {
                operationId: 'createDiscordPublisherConnection',
                summary: 'Create a Discord publisher connection',
                tags: ['Channels'],
            },
        },
        async ({ authMethod, body, params, status, user }) => {
            if (authMethod !== 'session') {
                return status(403, {
                    error: {
                        code: 'forbidden',
                        message: 'Human authentication is required to connect Discord',
                    },
                })
            }
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

            const actorId = publisherStore.getProjectActorId(params.projectId, user.id)
            if (actorId === null) {
                return status(404, {
                    error: { code: 'not_found', message: 'Project not found' },
                })
            }

            let channelId: string
            try {
                channelId = normalizeDiscordChannelId(body.channelId)
            } catch {
                return status(400, {
                    error: {
                        code: 'invalid_destination',
                        message: 'The Discord channel ID must be a 17 to 20 digit snowflake',
                    },
                })
            }

            let botToken: string
            try {
                botToken = normalizeDiscordBotToken(body.botToken)
            } catch {
                return status(400, {
                    error: {
                        code: 'invalid_connection',
                        message: 'The Discord Bot token is invalid',
                    },
                })
            }

            const discord = createDiscordPublisher(
                options.discordFetcher === undefined ? {} : { fetcher: options.discordFetcher }
            )
            const botUser = await discord.getBotUser(botToken)
            if (botUser.kind === 'failure') {
                logDiscordFlowError(options.logger, {
                    channelId: params.channelId,
                    projectId: params.projectId,
                    stage: 'bot_verification',
                })
                if (
                    botUser.outcome.code === 'authentication_required' ||
                    botUser.outcome.code === 'forbidden' ||
                    botUser.outcome.code === 'invalid_input' ||
                    botUser.outcome.code === 'invalid_request'
                ) {
                    return status(400, {
                        error: {
                            code: 'invalid_token',
                            message: 'The Discord Bot token could not be verified',
                        },
                    })
                }
                return status(503, {
                    error: {
                        code: 'provider_unavailable',
                        message: 'Discord could not verify the Bot token',
                    },
                })
            }

            const channel = await discord.getChannel(botToken, channelId)
            if (channel.kind === 'failure') {
                logDiscordFlowError(options.logger, {
                    channelId: params.channelId,
                    projectId: params.projectId,
                    stage: 'channel_verification',
                })
                if (channel.outcome.code === 'invalid_request') {
                    return status(400, {
                        error: {
                            code: 'unknown_channel',
                            message: 'The Discord channel was not found',
                        },
                    })
                }
                if (channel.outcome.code === 'forbidden') {
                    return status(403, {
                        error: {
                            code: 'insufficient_permissions',
                            message: 'The Discord bot cannot access this channel',
                        },
                    })
                }
                if (
                    channel.outcome.code === 'authentication_required' ||
                    channel.outcome.code === 'invalid_input'
                ) {
                    return status(400, {
                        error: {
                            code: 'invalid_token',
                            message: 'The Discord Bot token could not be verified',
                        },
                    })
                }
                return status(503, {
                    error: {
                        code: 'provider_unavailable',
                        message: 'Discord could not verify the channel',
                    },
                })
            }

            if (!(DISCORD_TEXT_CHANNEL_TYPES as readonly number[]).includes(channel.value.type)) {
                return status(400, {
                    error: {
                        code: 'unsupported_channel',
                        message: 'Discord publishing supports guild text channels only',
                    },
                })
            }

            // The connection verifies the Bot token and the channel existence only.
            // The Send Messages permission cannot be derived from channel metadata,
            // so it is enforced at publication time: Discord answers 403 and the
            // worker records a permanent failure without marking reconnect.

            const savedCredential = await credentialStore.createPublisherCredential({
                projectId: params.projectId,
                connectedByActorId: actorId,
                providerId: DISCORD_PROVIDER,
                externalAccountId: botUser.value.id,
                externalAccountName: botUser.value.username,
                scopes: [],
                accessToken: botToken,
                expiresAt: null,
            })
            let credentialId: string
            const shouldRevokeCredentialOnFailure = savedCredential.kind === 'created'
            if (savedCredential.kind === 'created') {
                credentialId = savedCredential.credential.id
            } else if (savedCredential.kind === 'already_exists') {
                const replaced = await credentialStore.replacePublisherCredentialTokens({
                    projectId: params.projectId,
                    credentialId: savedCredential.credential.id,
                    accessToken: botToken,
                    refreshToken: null,
                    expiresAt: null,
                })
                if (replaced.kind !== 'updated') {
                    return status(409, {
                        error: {
                            code: 'credential_exists',
                            message: 'The Discord credential could not be updated',
                        },
                    })
                }
                credentialId = replaced.credential.id
            } else {
                return status(404, {
                    error: {
                        code: 'not_found',
                        message: 'Project not found',
                    },
                })
            }

            const connection = publisherStore.createPublisherConnection({
                projectId: params.projectId,
                channelId: params.channelId,
                subjectId: user.id,
                kind: DISCORD_PROVIDER,
                credentialId,
                replaceNonActiveConnection,
                destination: {
                    type: 'channel',
                    id: channel.value.id,
                    name: channel.value.name,
                },
            })
            if (connection.kind !== 'created') {
                if (shouldRevokeCredentialOnFailure) {
                    credentialStore.revokePublisherCredential(params.projectId, credentialId)
                }
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
                              message: 'The Discord connection could not be created',
                          },
                      })
            }

            options.onWorkScheduled?.()
            return { connection: connection.connection }
        }
    )
}

function logDiscordFlowError(
    logger: Logger | undefined,
    fields: { readonly channelId: string; readonly projectId: string; readonly stage: string }
) {
    logger?.error({ ...fields, provider: DISCORD_PROVIDER }, 'Discord publisher flow failed')
}
