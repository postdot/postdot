import {
    createPostdotAuthServerActions,
    postdotUserApiKeyConfigId,
    type PostdotApiKeyRecord,
    type PostdotAuth,
} from '@postdot/auth'
import type { AccessStore } from '@postdot/db'
import { everySequential } from '@postdot/db'
import { Type } from 'typebox'

import {
    type AuthenticatedElysia,
    type PostdotAuthenticatedApiKeyPermissions,
    type PostdotAuthenticationMethod,
} from '../../plugins/auth'
import {
    apiKeyHasCapability,
    capabilitiesForPermissions,
    permissionsForCapabilities,
    type PostdotApiKeyCapability,
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
export const userApiKeyCapabilitySchema = Type.Union([
    Type.Literal('project:read'),
    Type.Literal('project:manage'),
    Type.Literal('project:permanently_delete'),
    Type.Literal('publication:manage'),
    Type.Literal('publication:dispatch'),
    Type.Literal('channel:manage'),
    Type.Literal('channel:share'),
    Type.Literal('media:manage'),
    Type.Literal('analytics:refresh'),
    Type.Literal('media:permanently_delete'),
    Type.Literal('project:access_manage'),
    Type.Literal('publication:approve'),
    Type.Literal('workspace:manage'),
    Type.Literal('api_key:manage'),
    Type.Literal('instance:admin'),
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
export const createUserApiKeyBody = Type.Object({
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
export const createdUserApiKeySchema = Type.Object({
    key: userApiKeySchema,
    token: Type.String({
        minLength: 1,
        description: 'The plaintext API key. It is returned only once when the key is created.',
    }),
})

export interface UserApiKeyMetadata {
    readonly postdotApiKeyVersion: 2
    readonly postdotProjectAccess: 'all' | 'selected'
    readonly postdotProjectIds?: readonly string[]
}

export function readUserApiKeyMetadata(value: unknown): UserApiKeyMetadata | null {
    if (typeof value !== 'object' || value === null) return null
    const metadata = value as {
        readonly postdotApiKeyVersion?: unknown
        readonly postdotProjectAccess?: unknown
        readonly postdotProjectIds?: unknown
    }
    if (metadata.postdotApiKeyVersion !== 2) return null
    if (metadata.postdotProjectAccess === 'all') {
        return {
            postdotApiKeyVersion: 2,
            postdotProjectAccess: 'all',
        }
    }
    if (
        metadata.postdotProjectAccess !== 'selected' ||
        !Array.isArray(metadata.postdotProjectIds) ||
        metadata.postdotProjectIds.length === 0 ||
        metadata.postdotProjectIds.some(
            projectId => typeof projectId !== 'string' || projectId.length === 0
        )
    ) {
        return null
    }
    return {
        postdotApiKeyVersion: 2,
        postdotProjectAccess: 'selected',
        postdotProjectIds: [...new Set(metadata.postdotProjectIds as string[])],
    }
}

export function metadataForProjectAccess(projectIds: readonly string[] | null): UserApiKeyMetadata {
    if (projectIds === null) {
        return {
            postdotApiKeyVersion: 2,
            postdotProjectAccess: 'all',
        }
    }
    return {
        postdotApiKeyVersion: 2,
        postdotProjectAccess: 'selected',
        postdotProjectIds: [...new Set(projectIds)],
    }
}

function projectAccessFromMetadata(metadata: unknown): 'all' | string[] {
    const parsed = readUserApiKeyMetadata(metadata)
    return parsed?.postdotProjectAccess === 'all' ? 'all' : [...(parsed?.postdotProjectIds ?? [])]
}

export function toUserApiKey(key: PostdotApiKeyRecord) {
    return {
        id: key.id,
        name: key.name ?? 'Unnamed API key',
        tokenPrefix: key.prefix ?? 'postdot_pat_',
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

export function generatedUserApiKeyName() {
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

export function apiKeyEscalationDeniedResponse() {
    return {
        error: {
            code: 'api_key_escalation_denied',
            message:
                'An API key cannot grant or modify permissions or projects beyond its own scope',
        },
    }
}

export function canApiKeyGrantScope(input: {
    readonly authMethod: PostdotAuthenticationMethod
    readonly callerProjectIds: readonly string[] | null | undefined
    readonly callerPermissions: PostdotAuthenticatedApiKeyPermissions | undefined
    readonly targetProjectIds: readonly string[] | null | undefined
    readonly targetActionAccess: 'all' | readonly PostdotApiKeyCapability[] | null | undefined
}): boolean {
    if (input.authMethod !== 'user_api_key') return true

    if (input.callerProjectIds != null && input.targetProjectIds !== undefined) {
        if (input.targetProjectIds === null) return false
        const allowed = new Set(input.callerProjectIds)
        if (input.targetProjectIds.some(projectId => !allowed.has(projectId))) return false
    }

    if (input.callerPermissions != null && input.targetActionAccess !== undefined) {
        if (input.targetActionAccess === null || input.targetActionAccess === 'all') return false
        if (
            input.targetActionAccess.some(
                capability => !apiKeyHasCapability(input.callerPermissions ?? null, capability)
            )
        ) {
            return false
        }
    }

    return true
}

function existingKeyExceedsCaller(input: {
    readonly authMethod: PostdotAuthenticationMethod
    readonly callerProjectIds: readonly string[] | null | undefined
    readonly callerPermissions: PostdotAuthenticatedApiKeyPermissions | undefined
    readonly existing: PostdotApiKeyRecord
}): boolean {
    const mapped = toUserApiKey(input.existing)
    return !canApiKeyGrantScope({
        authMethod: input.authMethod,
        callerProjectIds: input.callerProjectIds,
        callerPermissions: input.callerPermissions,
        targetProjectIds: mapped.projectAccess === 'all' ? null : mapped.projectAccess,
        targetActionAccess: mapped.actionAccess,
    })
}

export function expiresInFrom(
    expiresAt: number | null | undefined,
    now: number
): number | undefined {
    if (expiresAt === undefined || expiresAt === null) return undefined
    const expiresIn = Math.ceil((expiresAt - now) / 1_000)
    return expiresIn < 24 * 60 * 60 ? -1 : expiresIn
}

async function projectIdsForRequest(
    projectIds: readonly string[] | null | undefined,
    access: AccessStore,
    userId: string
): Promise<readonly string[] | null | undefined> {
    if (projectIds === undefined || projectIds === null) return null
    const uniqueProjectIds = [...new Set(projectIds)]
    return (await everySequential(uniqueProjectIds, projectId =>
        access.canAccessProject(projectId, userId)
    ))
        ? uniqueProjectIds
        : undefined
}

export function registerUserApiKeyRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    auth: PostdotAuth,
    access: AccessStore,
    now: () => number = Date.now
) {
    const serverActions = createPostdotAuthServerActions(auth)

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
                },
            },
            async ({ user }) => {
                const listed = await serverActions.listUserApiKeys({
                    userId: user.id,
                    configId: postdotUserApiKeyConfigId,
                })
                return {
                    keys: listed
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
                },
            },
            async ({ apiKeyPermissions, apiKeyProjectIds, authMethod, body, status, user }) => {
                const projectIds = await projectIdsForRequest(body.projectIds, access, user.id)
                if (projectIds === undefined) return status(400, invalidProjectAccessResponse())
                if (
                    !canApiKeyGrantScope({
                        authMethod,
                        callerProjectIds: apiKeyProjectIds,
                        callerPermissions: apiKeyPermissions,
                        targetProjectIds: projectIds,
                        targetActionAccess: body.actionAccess ?? null,
                    })
                ) {
                    return status(403, apiKeyEscalationDeniedResponse())
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
                const created = await auth.api.createApiKey({
                    body: {
                        configId: postdotUserApiKeyConfigId,
                        name: body.name?.trim() || generatedUserApiKeyName(),
                        userId: user.id,
                        metadata: metadataForProjectAccess(projectIds),
                        ...(body.actionAccess === undefined || body.actionAccess === null
                            ? {}
                            : {
                                  permissions: permissionsForCapabilities(
                                      body.actionAccess as readonly PostdotApiKeyCapability[]
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
                },
            },
            async ({
                apiKeyPermissions,
                apiKeyProjectIds,
                authMethod,
                body,
                params,
                status,
                user,
            }) => {
                const projectIds =
                    body.projectIds === undefined
                        ? undefined
                        : await projectIdsForRequest(body.projectIds, access, user.id)
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
                const existing = await serverActions.listUserApiKeys({
                    userId: user.id,
                    configId: postdotUserApiKeyConfigId,
                })
                const current = existing.find(key => key.id === params.keyId)
                if (current === undefined) {
                    return status(404, {
                        error: { code: 'not_found', message: 'API key not found' },
                    })
                }
                if (
                    existingKeyExceedsCaller({
                        authMethod,
                        callerProjectIds: apiKeyProjectIds,
                        callerPermissions: apiKeyPermissions,
                        existing: current,
                    }) ||
                    !canApiKeyGrantScope({
                        authMethod,
                        callerProjectIds: apiKeyProjectIds,
                        callerPermissions: apiKeyPermissions,
                        targetProjectIds: body.projectIds === undefined ? undefined : projectIds,
                        targetActionAccess: body.actionAccess,
                    })
                ) {
                    return status(403, apiKeyEscalationDeniedResponse())
                }
                const updated = await auth.api.updateApiKey({
                    body: {
                        configId: postdotUserApiKeyConfigId,
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
                                                body.actionAccess as readonly PostdotApiKeyCapability[]
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
                },
            },
            async ({ apiKeyPermissions, apiKeyProjectIds, authMethod, params, status, user }) => {
                const existing = await serverActions.listUserApiKeys({
                    userId: user.id,
                    configId: postdotUserApiKeyConfigId,
                })
                const current = existing.find(key => key.id === params.keyId)
                if (current === undefined) {
                    return status(404, {
                        error: { code: 'not_found', message: 'API key not found' },
                    })
                }
                if (
                    existingKeyExceedsCaller({
                        authMethod,
                        callerProjectIds: apiKeyProjectIds,
                        callerPermissions: apiKeyPermissions,
                        existing: current,
                    })
                ) {
                    return status(403, apiKeyEscalationDeniedResponse())
                }
                try {
                    await serverActions.deleteUserApiKey({
                        userId: user.id,
                        keyId: params.keyId,
                        configId: postdotUserApiKeyConfigId,
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
