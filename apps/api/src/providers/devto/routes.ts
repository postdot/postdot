import type { AccessStore } from '@postdot/db'
import {
    DEVTO_PROVIDER,
    createDevtoPublisher,
    normalizeDevtoApiKey,
    type DevtoFetcher,
} from '@postdot/devto'
import type { Logger } from 'pino'
import { Type } from 'typebox'

import {
    canAccessProjectRole,
    forbiddenProjectMutation,
} from '../../modules/projects/authorization'
import { errorResponse } from '../../modules/projects/models'
import type { PublisherRuntime } from '../../modules/publishers/runtime'
import { sessionSecurity, type AuthenticatedElysia } from '../../plugins/auth'
import { devtoConnectionBody, devtoConnectionResponse } from './models'

export function registerDevtoPublisherRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    publisher: PublisherRuntime,
    options: {
        readonly access: AccessStore
        readonly logger?: Logger
        readonly onWorkScheduled?: () => void
        readonly devtoFetcher?: DevtoFetcher
    }
) {
    const { credentialStore, publisherStore } = publisher

    return app.post(
        '/api/projects/:projectId/channels/:channelId/publisher/devto/connect',
        {
            auth: true,
            params: Type.Object({
                projectId: Type.String({ minLength: 1 }),
                channelId: Type.String({ minLength: 1 }),
            }),
            body: devtoConnectionBody,
            response: {
                200: devtoConnectionResponse,
                400: errorResponse,
                401: errorResponse,
                403: errorResponse,
                404: errorResponse,
                409: errorResponse,
                503: errorResponse,
            },
            detail: {
                operationId: 'createDevtoPublisherConnection',
                summary: 'Create a DEV.to publisher connection',
                tags: ['Channels'],
                security: sessionSecurity,
            },
        },
        async ({ authMethod, body, params, status, user }) => {
            if (authMethod !== 'session') {
                return status(403, {
                    error: {
                        code: 'forbidden',
                        message: 'Human authentication is required to connect DEV.to',
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

            let apiKey: string
            try {
                apiKey = normalizeDevtoApiKey(body.apiKey)
            } catch {
                return status(400, {
                    error: {
                        code: 'invalid_api_key',
                        message: 'The DEV.to API key is invalid',
                    },
                })
            }

            const actorId = publisherStore.getProjectActorId(params.projectId, user.id)
            if (actorId === null) {
                return status(404, {
                    error: { code: 'not_found', message: 'Project not found' },
                })
            }

            const devto = createDevtoPublisher(
                options.devtoFetcher === undefined ? {} : { fetcher: options.devtoFetcher }
            )
            const account = await devto.getMe(apiKey)
            if (account.kind === 'failure') {
                options.logger?.warn(
                    {
                        channelId: params.channelId,
                        projectId: params.projectId,
                        stage: 'account_verification',
                        outcome: account.outcome.type,
                    },
                    'DEV.to publisher connection verification failed'
                )
                if (
                    account.outcome.type === 'permanent_failure' &&
                    (account.outcome.code === 'authentication_required' ||
                        account.outcome.code === 'forbidden' ||
                        account.outcome.code === 'invalid_input' ||
                        account.outcome.code === 'invalid_request')
                ) {
                    return status(400, {
                        error: {
                            code: 'invalid_api_key',
                            message: 'The DEV.to API key could not be verified',
                        },
                    })
                }
                return status(503, {
                    error: {
                        code: 'provider_unavailable',
                        message: 'DEV.to could not verify the API key',
                    },
                })
            }

            const savedCredential = await credentialStore.createPublisherCredential({
                projectId: params.projectId,
                connectedByActorId: actorId,
                providerId: DEVTO_PROVIDER,
                externalAccountId: account.value.id,
                externalAccountName: account.value.username,
                scopes: [],
                accessToken: apiKey,
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
                    accessToken: apiKey,
                    refreshToken: null,
                    expiresAt: null,
                })
                if (replaced.kind !== 'updated') {
                    return status(409, {
                        error: {
                            code: 'credential_exists',
                            message: 'The DEV.to credential could not be updated',
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
                kind: DEVTO_PROVIDER,
                credentialId,
                replaceNonActiveConnection,
                destination: {
                    type: 'account',
                    id: account.value.id,
                    name: account.value.name,
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
                              message: 'The DEV.to connection could not be created',
                          },
                      })
            }

            options.onWorkScheduled?.()
            return { connection: connection.connection }
        }
    )
}
