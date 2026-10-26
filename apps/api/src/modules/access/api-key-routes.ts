import {
    postbotUserApiKeyConfigId,
    type PostbotApiKeyRecord,
    type PostbotAuth,
} from '@postdot/auth'
import type { AccessStore } from '@postdot/db'
import { Type } from 'typebox'

import { sessionSecurity, type AuthenticatedElysia } from '../../plugins/auth'
import {
    capabilitiesForPermissions,
    permissionsForCapabilities,
    type PostbotApiKeyCapability,
} from '../projects/api-key-permissions'

const errorResponse = Type.Object({
    error: Type.Object({
        code: Type.String({ minLength: 1 }),
        message: Type.String({ minLength: 1 }),
    }),
})

const userApiKeyProjectAccessSchema = Type.Union([
    Type.Literal('all'),
    Type.Array(Type.String({ minLength: 1 })),
])
const userApiKeyCapabilitySchema = Type.Union([
    Type.Literal('project:read'),
    Type.Literal('project:manage'),
    Type.Literal('project:permanently_delete'),
    Type.Literal('publication:manage'),
    Type.Literal('publication:dispatch'),
    Type.Literal('channel:manage'),
    Type.Literal('media:manage'),
    Type.Literal('analytics:refresh'),
    Type.Literal('media:permanently_delete'),
])
const userApiKeyActionAccessSchema = Type.Union([
    Type.Literal('all'),
    Type.Array(userApiKeyCapabilitySchema),
])
const userApiKeySchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    tokenPrefix: Type.String({ minLength: 1 }),
    projectAccess: userApiKeyProjectAccessSchema,
    actionAccess: userApiKeyActionAccessSchema,
    expiresAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})
const userApiKeysSchema = Type.Object({ keys: Type.Array(userApiKeySchema) })
const createUserApiKeyBody = Type.Object({
    name: Type.Optional(Type.String({ maxLength: 100 })),
    projectIds: Type.Optional(
        Type.Union([Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }), Type.Null()])
    ),
    actionAccess: Type.Optional(
        Type.Union([Type.Array(userApiKeyCapabilitySchema, { minItems: 1 }), Type.Null()])
    ),
    expiresAt: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
})
const updateUserApiKeyBody = Type.Object(
    {
        name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
        projectIds: Type.Optional(
            Type.Union([Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }), Type.Null()])
        ),
        actionAccess: Type.Optional(
            Type.Union([Type.Array(userApiKeyCapabilitySchema, { minItems: 1 }), Type.Null()])
        ),
        expiresAt: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
    },
    { minProperties: 1 }
)
const userApiKeyParams = Type.Object({ keyId: Type.String({ minLength: 1 }) })
const createdUserApiKeySchema = Type.Object({
    key: userApiKeySchema,
    token: Type.String({
        minLength: 1,
        description: 'The plaintext API key. It is returned only once when the key is created.',
    }),
})

export interface UserApiKeyMetadata {
    readonly postbotApiKeyVersion: 2
    readonly postbotProjectAccess: 'all' | 'selected'
    readonly postbotProjectIds?: readonly string[]
}

export function readUserApiKeyMetadata(value: unknown): UserApiKeyMetadata | null {
    if (typeof value !== 'object' || value === null) return null
    const metadata = value as {
        readonly postbotApiKeyVersion?: unknown
        readonly postbotProjectAccess?: unknown
        readonly postbotProjectIds?: unknown
    }
    if (metadata.postbotApiKeyVersion !== 2) return null
    if (metadata.postbotProjectAccess === 'all') {
        return {
            postbotApiKeyVersion: 2,
            postbotProjectAccess: 'all',
        }
    }
    if (
        metadata.postbotProjectAccess !== 'selected' ||
        !Array.isArray(metadata.postbotProjectIds) ||
        metadata.postbotProjectIds.length === 0 ||
        metadata.postbotProjectIds.some(
            projectId => typeof projectId !== 'string' || projectId.length === 0
        )
    ) {
        return null
    }
    return {
        postbotApiKeyVersion: 2,
        postbotProjectAccess: 'selected',
        postbotProjectIds: [...new Set(metadata.postbotProjectIds as string[])],
    }
}

function metadataForProjectAccess(projectIds: readonly string[] | null): UserApiKeyMetadata {
    if (projectIds === null) {
        return {
            postbotApiKeyVersion: 2,
            postbotProjectAccess: 'all',
        }
    }
    return {
        postbotApiKeyVersion: 2,
        postbotProjectAccess: 'selected',
        postbotProjectIds: [...new Set(projectIds)],
    }
}

function projectAccessFromMetadata(metadata: unknown): 'all' | string[] {
    const parsed = readUserApiKeyMetadata(metadata)
    return parsed?.postbotProjectAccess === 'all' ? 'all' : [...(parsed?.postbotProjectIds ?? [])]
}

function toUserApiKey(key: PostbotApiKeyRecord) {
    return {
        id: key.id,
        name: key.name ?? 'Unnamed API key',
        tokenPrefix: key.prefix ?? 'postbot_pat_',
        projectAccess: projectAccessFromMetadata(key.metadata),
        actionAccess: capabilitiesForPermissions(key.permissions),
        expiresAt: key.expiresAt?.getTime() ?? null,
        createdAt: key.createdAt.getTime(),
        updatedAt: key.updatedAt.getTime(),
    }
}

const apiKeyNameAdjectives = [
    'Amber',
    'Bright',
    'Calm',
    'Clever',
    'Golden',
    'Gentle',
    'Noble',
    'Quiet',
    'Silver',
    'Sunny',
    'Swift',
    'Warm',
] as const
const apiKeyNameNouns = [
    'Cedar',
    'Comet',
    'Fox',
    'Horizon',
    'Maple',
    'Meadow',
    'Orbit',
    'Pine',
    'River',
    'Sparrow',
    'Stone',
    'Willow',
] as const

function generatedUserApiKeyName() {
    const entropy = crypto.randomUUID().replaceAll('-', '')
    const adjective =
        apiKeyNameAdjectives[Number.parseInt(entropy.slice(0, 8), 16) % apiKeyNameAdjectives.length]
    const noun = apiKeyNameNouns[Number.parseInt(entropy.slice(8, 16), 16) % apiKeyNameNouns.length]
    return `Postdot ${adjective} ${noun} ${entropy.slice(-6).toUpperCase()}`
}

function invalidProjectAccessResponse() {
    return {
        error: {
            code: 'invalid_project_access',
            message: 'Every selected project must be accessible to the current user',
        },
    }
}

function expiresInFrom(expiresAt: number | null | undefined, now: number): number | undefined {
    if (expiresAt === undefined || expiresAt === null) return undefined
    const expiresIn = Math.ceil((expiresAt - now) / 1_000)
    return expiresIn < 24 * 60 * 60 ? -1 : expiresIn
}

function projectIdsForRequest(
    projectIds: readonly string[] | null | undefined,
    access: AccessStore,
    userId: string
): readonly string[] | null | undefined {
    if (projectIds === undefined || projectIds === null) return null
    const uniqueProjectIds = [...new Set(projectIds)]
    return uniqueProjectIds.every(projectId => access.canAccessProject(projectId, userId))
        ? uniqueProjectIds
        : undefined
}

export function registerUserApiKeyRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    auth: PostbotAuth,
    access: AccessStore,
    now: () => number = Date.now
) {
    return app
        .get(
            '/api/api-keys',
            {
                auth: true,
                response: {
                    200: userApiKeysSchema,
                    401: errorResponse,
                    403: errorResponse,
                },
                detail: {
                    operationId: 'listUserApiKeys',
                    summary: 'List API keys owned by the current user',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, request, status }) => {
                if (authMethod !== 'session') {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'A human session is required to manage API keys',
                        },
                    })
                }
                const listed = await auth.api.listApiKeys({
                    query: { configId: postbotUserApiKeyConfigId },
                    headers: request.headers,
                })
                return {
                    keys: listed.apiKeys
                        .map(toUserApiKey)
                        .filter(key => key.projectAccess === 'all' || key.projectAccess.length > 0),
                }
            }
        )
        .post(
            '/api/api-keys',
            {
                auth: true,
                body: createUserApiKeyBody,
                response: {
                    201: createdUserApiKeySchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                },
                detail: {
                    operationId: 'createUserApiKey',
                    summary: 'Create a user-owned Postdot API key',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, body, status, user }) => {
                if (authMethod !== 'session') {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'A human session is required to manage API keys',
                        },
                    })
                }
                const projectIds = projectIdsForRequest(body.projectIds, access, user.id)
                if (projectIds === undefined) return status(400, invalidProjectAccessResponse())
                const expiresIn = expiresInFrom(body.expiresAt, now())
                if (expiresIn === -1) {
                    return status(400, {
                        error: {
                            code: 'invalid_time',
                            message: 'expiresAt must be at least one day in the future',
                        },
                    })
                }
                const created = await auth.api.createApiKey({
                    body: {
                        configId: postbotUserApiKeyConfigId,
                        name: body.name?.trim() || generatedUserApiKeyName(),
                        userId: user.id,
                        metadata: metadataForProjectAccess(projectIds),
                        ...(body.actionAccess === undefined || body.actionAccess === null
                            ? {}
                            : {
                                  permissions: permissionsForCapabilities(
                                      body.actionAccess as readonly PostbotApiKeyCapability[]
                                  ),
                              }),
                        ...(expiresIn === undefined ? {} : { expiresIn }),
                    },
                })
                return status(201, { key: toUserApiKey(created), token: created.key })
            }
        )
        .patch(
            '/api/api-keys/:keyId',
            {
                auth: true,
                body: updateUserApiKeyBody,
                params: userApiKeyParams,
                response: {
                    200: Type.Object({ key: userApiKeySchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'updateUserApiKey',
                    summary: 'Update a user-owned Postdot API key',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, body, params, request, status, user }) => {
                if (authMethod !== 'session') {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'A human session is required to manage API keys',
                        },
                    })
                }
                const projectIds =
                    body.projectIds === undefined
                        ? undefined
                        : projectIdsForRequest(body.projectIds, access, user.id)
                if (projectIds === undefined && body.projectIds !== undefined) {
                    return status(400, invalidProjectAccessResponse())
                }
                const expiresIn = expiresInFrom(body.expiresAt, now())
                if (expiresIn === -1) {
                    return status(400, {
                        error: {
                            code: 'invalid_time',
                            message: 'expiresAt must be at least one day in the future',
                        },
                    })
                }
                const existing = await auth.api.listApiKeys({
                    query: { configId: postbotUserApiKeyConfigId },
                    headers: request.headers,
                })
                const current = existing.apiKeys.find(key => key.id === params.keyId)
                if (current === undefined) {
                    return status(404, {
                        error: { code: 'not_found', message: 'API key not found' },
                    })
                }
                const updated = await auth.api.updateApiKey({
                    body: {
                        configId: postbotUserApiKeyConfigId,
                        keyId: params.keyId,
                        userId: user.id,
                        ...(body.name === undefined ? {} : { name: body.name }),
                        ...(body.projectIds === undefined
                            ? {}
                            : { metadata: metadataForProjectAccess(projectIds ?? null) }),
                        ...(body.actionAccess === undefined
                            ? {}
                            : {
                                  permissions:
                                      body.actionAccess === null
                                          ? null
                                          : permissionsForCapabilities(
                                                body.actionAccess as readonly PostbotApiKeyCapability[]
                                            ),
                              }),
                        ...(body.expiresAt === undefined ? {} : { expiresIn }),
                    },
                })
                return { key: toUserApiKey(updated) }
            }
        )
        .delete(
            '/api/api-keys/:keyId',
            {
                auth: true,
                params: userApiKeyParams,
                response: {
                    200: Type.Object({ deleted: Type.Literal(true) }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'deleteUserApiKey',
                    summary: 'Delete a user-owned Postdot API key',
                    tags: ['Access'],
                    security: sessionSecurity,
                },
            },
            async ({ authMethod, params, request, status }) => {
                if (authMethod !== 'session') {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'A human session is required to manage API keys',
                        },
                    })
                }
                try {
                    await auth.api.deleteApiKey({
                        body: { configId: postbotUserApiKeyConfigId, keyId: params.keyId },
                        headers: request.headers,
                    })
                } catch {
                    return status(404, {
                        error: { code: 'not_found', message: 'API key not found' },
                    })
                }
                return { deleted: true as const }
            }
        )
}
