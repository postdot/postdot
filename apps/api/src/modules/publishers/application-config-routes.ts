import {
    type ProviderApplicationConfiguration,
    providerApplicationOAuthModes,
    type ProviderApplicationProvider,
    type ProviderApplicationState,
    type AccessStore,
} from '@postbot/db'
import { Type } from 'typebox'

import { sessionSecurity, type AuthenticatedElysia } from '../../plugins/auth'
import type { PublisherRuntime } from './runtime'

const providerIdSchema = Type.Union([
    Type.Literal('linkedin'),
    Type.Literal('bluesky'),
    Type.Literal('x'),
    Type.Literal('facebook'),
])
const stateSchema = Type.Union([Type.Literal('active'), Type.Literal('disabled')])

const applicationSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    providerId: providerIdSchema,
    name: Type.String({ minLength: 1 }),
    clientId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    clientMetadataUrl: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    handleResolver: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    oauthMode: Type.Union([
        Type.Literal(providerApplicationOAuthModes[0]),
        Type.Literal(providerApplicationOAuthModes[1]),
        Type.Null(),
    ]),
    state: stateSchema,
    isDefault: Type.Boolean(),
    createdByUserId: Type.String({ minLength: 1 }),
    hasClientSecret: Type.Boolean(),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})

const applicationBody = Type.Object({
    providerId: providerIdSchema,
    name: Type.String({ minLength: 1, maxLength: 200 }),
    clientId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
    clientMetadataUrl: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
    handleResolver: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
    clientSecret: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
    state: Type.Optional(stateSchema),
    isDefault: Type.Optional(Type.Boolean()),
})

const updateBody = Type.Partial(
    Type.Object({
        name: Type.String({ minLength: 1, maxLength: 200 }),
        clientId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
        clientMetadataUrl: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
        handleResolver: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
        clientSecret: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
        state: stateSchema,
        isDefault: Type.Boolean(),
    })
)

const errorSchema = Type.Object({
    error: Type.Object({
        code: Type.String({ minLength: 1 }),
        message: Type.String({ minLength: 1 }),
    }),
})

const applicationListSchema = Type.Object({
    applications: Type.Array(applicationSchema),
    xCallbackUri: Type.String({ minLength: 1 }),
    facebookCallbackUri: Type.String({ minLength: 1 }),
})
const applicationResponseSchema = Type.Object({ application: applicationSchema })

/**
 * Provider applications are instance-level configuration, not project data.
 * Only enabled instance administrators may manage these settings; user API keys
 * are never accepted for this instance-scoped surface.
 */
export function registerProviderApplicationRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    publisher: PublisherRuntime,
    access: AccessStore
) {
    return app
        .get(
            '/api/settings/provider-applications',
            {
                auth: true,
                response: {
                    200: applicationListSchema,
                    401: errorSchema,
                    403: errorSchema,
                },
                detail: {
                    operationId: 'listProviderApplicationConfigurations',
                    summary: 'List runtime provider application configurations',
                    tags: ['Settings'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, status, user }) => {
                if (authMethod !== 'session' || !access.isInstanceAdmin(user.id)) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message:
                                'An instance administrator session is required to manage provider applications',
                        },
                    })
                }
                return {
                    applications:
                        publisher.providerApplicationStore.listProviderApplicationConfigurations(),
                    xCallbackUri: publisher.xCallbackUri,
                    facebookCallbackUri: publisher.facebookCallbackUri,
                }
            }
        )
        .post(
            '/api/settings/provider-applications',
            {
                auth: true,
                body: applicationBody,
                response: {
                    201: applicationResponseSchema,
                    400: errorSchema,
                    401: errorSchema,
                    403: errorSchema,
                    409: errorSchema,
                },
                detail: {
                    operationId: 'createProviderApplicationConfiguration',
                    summary: 'Create a runtime provider application configuration',
                    tags: ['Settings'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, body, status, user }) => {
                if (authMethod !== 'session' || !access.isInstanceAdmin(user.id)) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message:
                                'An instance administrator session is required to manage provider applications',
                        },
                    })
                }

                try {
                    const result =
                        await publisher.providerApplicationStore.createProviderApplication({
                            ...body,
                            createdByUserId: user.id,
                        })
                    if (result.kind === 'conflict') {
                        return status(409, {
                            error: {
                                code: 'conflict',
                                message:
                                    'Provider application configuration conflicts with existing data',
                            },
                        })
                    }
                    return status(201, { application: result.configuration })
                } catch (error) {
                    return status(400, {
                        error: {
                            code: 'invalid_provider_application',
                            message: safeConfigurationError(error),
                        },
                    })
                }
            }
        )
        .patch(
            '/api/settings/provider-applications/:applicationId',
            {
                auth: true,
                params: Type.Object({ applicationId: Type.String({ minLength: 1 }) }),
                body: updateBody,
                response: {
                    200: applicationResponseSchema,
                    400: errorSchema,
                    401: errorSchema,
                    403: errorSchema,
                    404: errorSchema,
                    409: errorSchema,
                },
                detail: {
                    operationId: 'updateProviderApplicationConfiguration',
                    summary: 'Update or disable a runtime provider application configuration',
                    tags: ['Settings'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, body, params, status, user }) => {
                if (authMethod !== 'session' || !access.isInstanceAdmin(user.id)) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message:
                                'An instance administrator session is required to manage provider applications',
                        },
                    })
                }

                try {
                    const result =
                        await publisher.providerApplicationStore.updateProviderApplication({
                            id: params.applicationId,
                            ...body,
                        })
                    if (result.kind === 'not_found') {
                        return status(404, {
                            error: {
                                code: 'not_found',
                                message: 'Provider application configuration not found',
                            },
                        })
                    }
                    if (result.kind === 'conflict') {
                        return status(409, {
                            error: {
                                code: 'conflict',
                                message:
                                    'Provider application configuration conflicts with existing data',
                            },
                        })
                    }
                    return { application: result.configuration }
                } catch (error) {
                    return status(400, {
                        error: {
                            code: 'invalid_provider_application',
                            message: safeConfigurationError(error),
                        },
                    })
                }
            }
        )
}

function safeConfigurationError(error: unknown): string {
    if (!(error instanceof Error)) return 'Provider application configuration is invalid'
    const message = error.message.trim()
    if (message.length === 0 || message.length > 180) {
        return 'Provider application configuration is invalid'
    }
    if (/(?:ciphertext|nonce|encryption|secret value|token value)/i.test(message)) {
        return 'Provider application configuration is invalid'
    }
    return message
}

export type ProviderApplicationResponse = ProviderApplicationConfiguration
export type ProviderApplicationRouteProvider = ProviderApplicationProvider
export type ProviderApplicationRouteState = ProviderApplicationState
