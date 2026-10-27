import type { AccessStore } from '@postdot/db'
import { Type } from 'typebox'

import { createChannelAccessPolicy } from './channel-access-policy'
import {
    channelSharingResponse,
    channelSharingMutationResponse,
    errorResponse,
    attachChannelBody,
    transferChannelManagementBody,
    withdrawChannelBody,
} from './models'
import type { AuthenticatedElysia, ManualStore } from './types'

const params = Type.Object({ workspaceId: Type.String({ minLength: 1 }) })
const channelParams = Type.Object({
    ...params.properties,
    channelId: Type.String({ minLength: 1 }),
})
const managementSchema = channelSharingResponse.properties.channel.properties.management
const channelSchema = Type.Object({
    id: Type.String(),
    workspaceId: Type.String(),
    name: Type.String(),
    profileVersionId: Type.String(),
    profileId: Type.String(),
    state: Type.Union([Type.Literal('active'), Type.Literal('archived')]),
    archivedAt: Type.Union([Type.Integer(), Type.Null()]),
    revision: Type.Integer(),
    createdAt: Type.Integer(),
    updatedAt: Type.Integer(),
    shared: Type.Boolean(),
    canManage: Type.Boolean(),
    canShare: Type.Boolean(),
    management: managementSchema,
    usages: channelSharingResponse.properties.usages,
})
const cadenceSchema = Type.Object({
    channelId: Type.String(),
    revision: Type.Integer(),
    timeZone: Type.String(),
    dailyMax: Type.Union([Type.Integer(), Type.Null()]),
    weeklyMax: Type.Union([Type.Integer(), Type.Null()]),
    minimumIntervalMs: Type.Union([Type.Integer(), Type.Null()]),
})

export function registerWorkspaceChannelRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    manual: ManualStore,
    access: AccessStore,
    onWorkScheduled?: () => void
) {
    const context = (
        input: Omit<Parameters<typeof createChannelAccessPolicy>[0], 'access'> & {
            workspaceId: string
            displayName: string
        }
    ) => {
        const authorization = createChannelAccessPolicy({ ...input, access })
        // Membership alone reveals no channels: every returned row and project uses the policy.
        if (!access.canAccessWorkspace(input.workspaceId, input.userId)) return null
        return manual.sharedChannels.workspaceContextFor({
            ...input,
            displayName: access.getInstanceMembership(input.userId)?.name ?? input.displayName,
            subjectId: input.userId,
            authorization,
        })
    }
    const notFound = { error: { code: 'not_found', message: 'Channel or workspace not found' } }
    const mutation = (result: ReturnType<ManualStore['sharedChannels']['attach']>) => {
        if (result.kind === 'stale')
            return {
                error: {
                    code: 'stale_revision',
                    message: 'The channel changed; reload it and retry',
                },
            }
        if (result.kind === 'retirement_required')
            return {
                error: {
                    code: 'retirement_required',
                    message: 'Withdrawing the last project requires archiving the channel',
                },
            }
        if (result.kind === 'not_found') return notFound
        return { result: result.kind, revision: result.revision }
    }
    const conflict = errorResponse
    const routeOptions = {
        auth: true as const,
        params: channelParams,
        response: {
            200: channelSharingMutationResponse,
            401: errorResponse,
            403: errorResponse,
            404: errorResponse,
            409: conflict,
        },
    }
    return app
        .get(
            '/api/workspaces/:workspaceId/channels',
            {
                auth: true,
                params,
                query: Type.Object({ includeArchived: Type.Optional(Type.Boolean()) }),
                response: {
                    200: Type.Object({
                        channels: Type.Array(channelSchema),
                        projects: Type.Array(
                            Type.Object({
                                id: Type.String(),
                                name: Type.String(),
                                timeZone: Type.String(),
                                canCreate: Type.Boolean(),
                                canAttach: Type.Boolean(),
                            })
                        ),
                    }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'listWorkspaceChannels',
                    summary: 'List authorized workspace channels and visible project usage',
                    tags: ['Channels'],
                },
            },
            ({ params, query, user, authMethod, apiKeyPermissions, apiKeyProjectIds, status }) => {
                if (!access.canAccessWorkspace(params.workspaceId, user.id))
                    return status(404, notFound)
                const authorization = createChannelAccessPolicy({
                    access,
                    userId: user.id,
                    authMethod,
                    apiKeyPermissions,
                    apiKeyProjectIds,
                })
                const ctx = context({
                    ...params,
                    userId: user.id,
                    displayName: user.name,
                    authMethod,
                    apiKeyPermissions,
                    apiKeyProjectIds,
                })
                const projects = manual
                    .listProjectsForWorkspace(params.workspaceId)
                    .filter(p => authorization.authorizeProject(p.id, 'read_channels'))
                    .map(p => ({
                        id: p.id,
                        name: p.name,
                        timeZone: p.timeZone,
                        canCreate: authorization.authorizeProject(p.id, 'create_channels'),
                        canAttach: authorization.authorizeProject(p.id, 'attach_channels'),
                    }))
                if (authMethod === 'user_api_key' && !ctx) return status(404, notFound)
                return {
                    projects,
                    channels: ctx
                        ? manual.sharedChannels
                              .listWorkspace(ctx, params.workspaceId, query.includeArchived)
                              .map(channel => ({
                                  ...channel,
                                  usages: (
                                      manual.sharedChannels.listProjectUsages(
                                          ctx,
                                          channel.id,
                                          true
                                      ) ?? []
                                  ).map(usage => ({
                                      ...usage,
                                      canAcceptManagement: authorization.authorizeProject(
                                          usage.projectId,
                                          'accept_channel_management'
                                      ),
                                  })),
                              }))
                        : [],
                }
            }
        )
        .post(
            '/api/workspaces/:workspaceId/channels/:channelId/attachments',
            {
                ...routeOptions,
                body: attachChannelBody,
                detail: {
                    operationId: 'attachWorkspaceChannel',
                    summary: 'Attach a workspace channel to an authorized project',
                    tags: ['Channels'],
                },
            },
            ({ params, body, user, authMethod, apiKeyPermissions, apiKeyProjectIds, status }) => {
                const ctx = context({
                    ...params,
                    userId: user.id,
                    displayName: user.name,
                    authMethod,
                    apiKeyPermissions,
                    apiKeyProjectIds,
                })
                if (
                    !ctx ||
                    !manual.sharedChannels.isWorkspaceChannel(
                        ctx,
                        params.workspaceId,
                        params.channelId
                    )
                )
                    return status(404, notFound)
                const result = mutation(
                    manual.sharedChannels.attach(ctx, { ...body, channelId: params.channelId })
                )
                return 'error' in result
                    ? status(result.error.code === 'not_found' ? 404 : 409, result)
                    : result
            }
        )
        .post(
            '/api/workspaces/:workspaceId/channels/:channelId/withdraw',
            {
                ...routeOptions,
                body: Type.Object({
                    ...withdrawChannelBody.properties,
                    projectId: Type.String({ minLength: 1 }),
                }),
                detail: {
                    operationId: 'withdrawWorkspaceChannel',
                    summary: 'Withdraw a project from a workspace channel',
                    tags: ['Channels'],
                },
            },
            ({ params, body, user, authMethod, apiKeyPermissions, apiKeyProjectIds, status }) => {
                const ctx = context({
                    ...params,
                    userId: user.id,
                    displayName: user.name,
                    authMethod,
                    apiKeyPermissions,
                    apiKeyProjectIds,
                })
                if (
                    !ctx ||
                    !manual.sharedChannels.isWorkspaceChannel(
                        ctx,
                        params.workspaceId,
                        params.channelId
                    )
                )
                    return status(404, notFound)
                const result = mutation(
                    manual.sharedChannels.detach(ctx, { ...body, channelId: params.channelId })
                )
                return 'error' in result
                    ? status(result.error.code === 'not_found' ? 404 : 409, result)
                    : result
            }
        )
        .post(
            '/api/workspaces/:workspaceId/channels/:channelId/management',
            {
                ...routeOptions,
                body: transferChannelManagementBody,
                detail: {
                    operationId: 'transferWorkspaceChannelManagement',
                    summary: 'Explicitly transfer or recover channel management',
                    tags: ['Channels'],
                },
            },
            ({ params, body, user, authMethod, apiKeyPermissions, apiKeyProjectIds, status }) => {
                const ctx = context({
                    ...params,
                    userId: user.id,
                    displayName: user.name,
                    authMethod,
                    apiKeyPermissions,
                    apiKeyProjectIds,
                })
                if (
                    !ctx ||
                    !manual.sharedChannels.isWorkspaceChannel(
                        ctx,
                        params.workspaceId,
                        params.channelId
                    )
                )
                    return status(404, notFound)
                const result = mutation(
                    manual.sharedChannels.transferManagement(ctx, {
                        ...body,
                        channelId: params.channelId,
                    })
                )
                return 'error' in result
                    ? status(result.error.code === 'not_found' ? 404 : 409, result)
                    : result
            }
        )
        .get(
            '/api/workspaces/:workspaceId/channels/:channelId/cadence',
            {
                auth: true,
                params: channelParams,
                response: {
                    200: Type.Object({
                        rules: Type.Union([cadenceSchema, Type.Null()]),
                        canManage: Type.Boolean(),
                    }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'getWorkspaceChannelCadence',
                    summary: 'Read workspace channel cadence',
                    tags: ['Channels'],
                },
            },
            ({ params, user, authMethod, apiKeyPermissions, apiKeyProjectIds, status }) => {
                const ctx = context({
                    ...params,
                    userId: user.id,
                    displayName: user.name,
                    authMethod,
                    apiKeyPermissions,
                    apiKeyProjectIds,
                })
                if (
                    !ctx ||
                    !manual.sharedChannels.isWorkspaceChannel(
                        ctx,
                        params.workspaceId,
                        params.channelId
                    )
                )
                    return status(404, notFound)
                return (
                    manual.sharedChannels.getCadence(ctx, params.channelId) ?? status(404, notFound)
                )
            }
        )
        .put(
            '/api/workspaces/:workspaceId/channels/:channelId/cadence',
            {
                auth: true,
                params: channelParams,
                body: Type.Object({
                    expectedRevision: Type.Integer({ minimum: 0 }),
                    timeZone: Type.Optional(Type.String()),
                    dailyMax: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
                    weeklyMax: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
                    minimumIntervalMs: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
                }),
                response: {
                    200: cadenceSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'configureWorkspaceChannelCadence',
                    summary: 'Configure workspace channel cadence',
                    tags: ['Channels'],
                },
            },
            ({ params, body, user, authMethod, apiKeyPermissions, apiKeyProjectIds, status }) => {
                const ctx = context({
                    ...params,
                    userId: user.id,
                    displayName: user.name,
                    authMethod,
                    apiKeyPermissions,
                    apiKeyProjectIds,
                })
                if (
                    !ctx ||
                    !manual.sharedChannels.isWorkspaceChannel(
                        ctx,
                        params.workspaceId,
                        params.channelId
                    )
                )
                    return status(404, notFound)
                const result = manual.sharedChannels.configureCadence(ctx, {
                    ...body,
                    channelId: params.channelId,
                })
                if (result) onWorkScheduled?.()
                return result ?? status(404, notFound)
            }
        )
}
