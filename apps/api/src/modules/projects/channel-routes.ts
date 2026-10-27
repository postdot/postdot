import { ChannelProfileValidationError } from '@postdot/core'
import type { AccessStore } from '@postdot/db'
import { Type } from 'typebox'

import { canAccessProjectRole, forbiddenProjectMutation } from './authorization'
import { createChannelAccessPolicy } from './channel-access-policy'
import {
    attachChannelBody,
    attachedChannelParams,
    channelOccupancyQuery,
    channelOccupancyResponse,
    channelSharingConflictResponse,
    channelSharingMutationResponse,
    channelSharingResponse,
    transferChannelManagementBody,
    withdrawChannelBody,
    channelSchema,
    channelListItemSchema,
    channelDeletedSchema,
    channelLifecycleBody,
    channelLifecycleConflictResponse,
    createChannelBody,
    errorResponse,
    channelParams,
    projectParams,
    renameChannelBody,
    resolveChannelProfile,
} from './models'
import { profileDraftErrorResponse, profileValidationFeedback } from './profile-validation-feedback'
import type { AuthenticatedElysia, ManualStore } from './types'

type SharingResult = ReturnType<ManualStore['sharedChannels']['attach']>

type SharingOutcome =
    | { readonly kind: 'not_found' }
    | {
          readonly kind: 'conflict'
          readonly body: {
              readonly error: {
                  readonly code: 'stale_revision' | 'retirement_required'
                  readonly message: string
                  readonly revision: number
              }
          }
      }
    | {
          readonly kind: 'ok'
          readonly body: { readonly result: 'changed' | 'unchanged'; readonly revision: number }
      }

function sharingOutcome(result: SharingResult): SharingOutcome {
    switch (result.kind) {
        case 'not_found':
            return { kind: 'not_found' } as const
        case 'stale':
            return {
                kind: 'conflict',
                body: {
                    error: {
                        code: 'stale_revision',
                        message: 'The channel changed; reload it and retry',
                        revision: result.revision,
                    },
                },
            } as const
        case 'retirement_required':
            return {
                kind: 'conflict',
                body: {
                    error: {
                        code: 'retirement_required',
                        message: 'Withdrawing the last project requires archiving the channel',
                        revision: result.revision,
                    },
                },
            } as const
        case 'unchanged':
        case 'changed':
            return {
                kind: 'ok',
                body: { result: result.kind, revision: result.revision },
            } as const
    }
}

export function registerChannelRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    manualStore: ManualStore,
    access: AccessStore,
    onWorkScheduled?: () => void
) {
    const sharingContext = (input: {
        readonly apiKeyPermissions: Parameters<
            typeof createChannelAccessPolicy
        >[0]['apiKeyPermissions']
        readonly apiKeyProjectIds: Parameters<
            typeof createChannelAccessPolicy
        >[0]['apiKeyProjectIds']
        readonly authMethod: Parameters<typeof createChannelAccessPolicy>[0]['authMethod']
        readonly projectId: string
        readonly userId: string
    }) =>
        manualStore.sharedChannels.contextFor({
            subjectId: input.userId,
            contextProjectId: input.projectId,
            authorization: createChannelAccessPolicy({
                access,
                userId: input.userId,
                authMethod: input.authMethod,
                apiKeyProjectIds: input.apiKeyProjectIds,
                apiKeyPermissions: input.apiKeyPermissions,
            }),
        })

    const cadenceSchema = Type.Object({
        channelId: Type.String(),
        revision: Type.Integer(),
        timeZone: Type.String(),
        dailyMax: Type.Union([Type.Integer(), Type.Null()]),
        weeklyMax: Type.Union([Type.Integer(), Type.Null()]),
        minimumIntervalMs: Type.Union([Type.Integer(), Type.Null()]),
    })
    return app
        .get(
            '/api/projects/:projectId/channels/:channelId/cadence',
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
                    operationId: 'getChannelCadence',
                    summary: 'Read optional channel cadence',
                    tags: ['Channels'],
                },
            },
            ({ params, status, user, authMethod, apiKeyPermissions, apiKeyProjectIds }) => {
                const ctx = sharingContext({
                    projectId: params.projectId,
                    userId: user.id,
                    authMethod,
                    apiKeyPermissions,
                    apiKeyProjectIds,
                })
                const result = ctx
                    ? manualStore.sharedChannels.getCadence(ctx, params.channelId)
                    : null
                return (
                    result ??
                    status(404, { error: { code: 'not_found', message: 'Channel not found' } })
                )
            }
        )
        .put(
            '/api/projects/:projectId/channels/:channelId/cadence',
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
                    operationId: 'configureChannelCadence',
                    summary: 'Configure optional channel cadence',
                    tags: ['Channels'],
                },
            },
            ({ params, body, status, user, authMethod, apiKeyPermissions, apiKeyProjectIds }) => {
                const ctx = sharingContext({
                    projectId: params.projectId,
                    userId: user.id,
                    authMethod,
                    apiKeyPermissions,
                    apiKeyProjectIds,
                })
                const result = ctx
                    ? manualStore.sharedChannels.configureCadence(ctx, {
                          ...body,
                          channelId: params.channelId,
                      })
                    : null
                if (result) onWorkScheduled?.()
                return (
                    result ??
                    status(404, { error: { code: 'not_found', message: 'Channel not found' } })
                )
            }
        )
        .get(
            '/api/projects/:projectId/channels',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: Type.Object({ channels: Type.Array(channelListItemSchema) }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'listProjectChannels',
                    summary: 'List channels in a project',
                    tags: ['Channels'],
                },
            },
            ({ params, status, user }) => {
                const channels = manualStore.listChannels(params.projectId, user.id)
                if (channels === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                return { channels }
            }
        )
        .post(
            '/api/projects/:projectId/channels',
            {
                auth: true,
                body: createChannelBody,
                params: projectParams,
                response: {
                    201: Type.Object({ channel: channelSchema }),
                    400: profileDraftErrorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'createProjectChannel',
                    summary: 'Create a channel in a project',
                    tags: ['Channels'],
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (
                    !canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                let channel
                try {
                    channel = manualStore.createChannel({
                        projectId: params.projectId,
                        subjectId: user.id,
                        name: body.name,
                        profile: resolveChannelProfile(body.profile),
                    })
                } catch (error) {
                    if (error instanceof ChannelProfileValidationError) {
                        return status(400, profileValidationFeedback(error))
                    }
                    throw error
                }
                if (channel === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                return status(201, { channel })
            }
        )
        .patch(
            '/api/projects/:projectId/channels/:channelId',
            {
                auth: true,
                body: renameChannelBody,
                params: channelParams,
                response: {
                    200: Type.Object({ channel: channelSchema }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'renameProjectChannel',
                    summary: 'Rename a channel in a project',
                    tags: ['Channels'],
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (
                    !canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const channel = manualStore.renameChannel({
                    projectId: params.projectId,
                    channelId: params.channelId,
                    subjectId: user.id,
                    name: body.name,
                    expectedRevision: body.expectedRevision,
                })
                if (channel === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                return { channel }
            }
        )
        .post(
            '/api/projects/:projectId/channels/:channelId/archive',
            {
                auth: true,
                body: channelLifecycleBody,
                params: channelParams,
                response: {
                    200: Type.Object({ channel: channelSchema }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: Type.Union([channelLifecycleConflictResponse, errorResponse]),
                },
                detail: {
                    operationId: 'archiveProjectChannel',
                    summary: 'Archive a channel in a project',
                    tags: ['Channels'],
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (
                    !canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const result = manualStore.archiveChannel({
                    projectId: params.projectId,
                    channelId: params.channelId,
                    subjectId: user.id,
                    expectedRevision: body.expectedRevision,
                })
                if (result === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                if (result.kind === 'blocked') {
                    return status(409, {
                        error: {
                            code: 'channel_lifecycle_conflict',
                            message: 'The channel cannot be archived while these blockers exist',
                            blockers: result.blockers,
                        },
                    })
                }
                return { channel: result.channel }
            }
        )
        .post(
            '/api/projects/:projectId/channels/:channelId/restore',
            {
                auth: true,
                body: channelLifecycleBody,
                params: channelParams,
                response: {
                    200: Type.Object({ channel: channelSchema }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'restoreProjectChannel',
                    summary: 'Restore an archived channel in a project',
                    tags: ['Channels'],
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (
                    !canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const result = manualStore.restoreChannel({
                    projectId: params.projectId,
                    channelId: params.channelId,
                    subjectId: user.id,
                    expectedRevision: body.expectedRevision,
                })
                if (result === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                if (result.kind === 'blocked') {
                    return status(409, {
                        error: {
                            code: 'channel_lifecycle_conflict',
                            message: 'The channel cannot be restored while these blockers exist',
                            blockers: result.blockers,
                        },
                    })
                }
                return { channel: result.channel }
            }
        )
        .delete(
            '/api/projects/:projectId/channels/:channelId',
            {
                auth: true,
                body: channelLifecycleBody,
                params: channelParams,
                response: {
                    200: channelDeletedSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: Type.Union([channelLifecycleConflictResponse, errorResponse]),
                },
                detail: {
                    operationId: 'deleteProjectChannel',
                    summary: 'Delete an empty archived channel',
                    tags: ['Channels'],
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (
                    !canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const result = manualStore.deleteChannel({
                    projectId: params.projectId,
                    channelId: params.channelId,
                    subjectId: user.id,
                    expectedRevision: body.expectedRevision,
                })
                if (result === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                if (result.kind === 'blocked') {
                    return status(409, {
                        error: {
                            code: 'channel_lifecycle_conflict',
                            message: 'The channel cannot be deleted while these blockers exist',
                            blockers: result.blockers,
                        },
                    })
                }
                return { deleted: true }
            }
        )
        .get(
            '/api/projects/:projectId/channel-occupancy',
            {
                auth: true,
                params: projectParams,
                query: channelOccupancyQuery,
                response: {
                    200: channelOccupancyResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'listProjectChannelOccupancy',
                    summary: 'List time taken on shared channels by other projects',
                    description:
                        'Projects the caller can read are described in full; every other project is anonymous. Drafts, cancelled and failed work are never reported.',
                    tags: ['Channels'],
                },
            },
            ({ apiKeyPermissions, apiKeyProjectIds, authMethod, params, query, status, user }) => {
                if (query.to <= query.from) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                const ctx = sharingContext({
                    apiKeyPermissions,
                    apiKeyProjectIds,
                    authMethod,
                    projectId: params.projectId,
                    userId: user.id,
                })
                const occupancy = ctx
                    ? manualStore.sharedChannels.occupancy(ctx, params.projectId, query)
                    : null
                if (occupancy === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                return { occupancy: [...occupancy] }
            }
        )
        .get(
            '/api/projects/:projectId/channels/:channelId/sharing',
            {
                auth: true,
                params: channelParams,
                response: {
                    200: channelSharingResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'getProjectChannelSharing',
                    summary: 'Read how a channel is shared with other projects',
                    description:
                        'Lists only projects the caller can read; unreadable projects are neither named nor counted.',
                    tags: ['Channels'],
                },
            },
            ({ apiKeyPermissions, apiKeyProjectIds, authMethod, params, status, user }) => {
                const ctx = sharingContext({
                    apiKeyPermissions,
                    apiKeyProjectIds,
                    authMethod,
                    projectId: params.projectId,
                    userId: user.id,
                })
                const view = ctx
                    ? manualStore.sharedChannels
                          .listProject(ctx, params.projectId, true)
                          ?.find(channel => channel.id === params.channelId)
                    : undefined
                const usages = ctx
                    ? manualStore.sharedChannels.listProjectUsages(ctx, params.channelId, true)
                    : null
                if (!view || usages === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                return {
                    channel: {
                        id: view.id,
                        revision: view.revision,
                        shared: view.shared,
                        attachmentState: view.attachmentState,
                        attachmentRevision: view.attachmentRevision,
                        canManage: view.canManage,
                        canShare: view.canShare,
                        canWithdraw: view.canWithdraw,
                        management: view.management,
                    },
                    usages: [...usages],
                }
            }
        )
        .post(
            '/api/projects/:projectId/channels/:channelId/attachments',
            {
                auth: true,
                params: channelParams,
                body: attachChannelBody,
                response: {
                    200: channelSharingMutationResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: channelSharingConflictResponse,
                },
                detail: {
                    operationId: 'attachProjectChannel',
                    summary: 'Let another project use a channel',
                    description:
                        'The target project gains publication use, not connection management. Occupied times become visible, anonymously, across attached projects.',
                    tags: ['Channels'],
                },
            },
            ({ apiKeyPermissions, apiKeyProjectIds, authMethod, body, params, status, user }) => {
                const ctx = sharingContext({
                    apiKeyPermissions,
                    apiKeyProjectIds,
                    authMethod,
                    projectId: params.projectId,
                    userId: user.id,
                })
                if (!ctx) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                const outcome = sharingOutcome(
                    manualStore.sharedChannels.attach(ctx, {
                        channelId: params.channelId,
                        projectId: body.projectId,
                        expectedRevision: body.expectedRevision,
                    })
                )
                if (outcome.kind === 'not_found') {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                if (outcome.kind === 'conflict') return status(409, outcome.body)
                return outcome.body
            }
        )
        .post(
            '/api/projects/:projectId/channels/:channelId/attachments/:attachedProjectId/withdraw',
            {
                auth: true,
                params: attachedChannelParams,
                body: withdrawChannelBody,
                response: {
                    200: channelSharingMutationResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: channelSharingConflictResponse,
                },
                detail: {
                    operationId: 'withdrawProjectChannel',
                    summary: 'Withdraw a project from a channel',
                    description:
                        'Closes new use and preserves history and started effects. Withdrawing the last project requires lastAttachment: archive.',
                    tags: ['Channels'],
                },
            },
            ({ apiKeyPermissions, apiKeyProjectIds, authMethod, body, params, status, user }) => {
                const ctx = sharingContext({
                    apiKeyPermissions,
                    apiKeyProjectIds,
                    authMethod,
                    projectId: params.projectId,
                    userId: user.id,
                })
                if (!ctx) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                const outcome = sharingOutcome(
                    manualStore.sharedChannels.detach(ctx, {
                        channelId: params.channelId,
                        projectId: params.attachedProjectId,
                        expectedRevision: body.expectedRevision,
                        lastAttachment: body.lastAttachment,
                    })
                )
                if (outcome.kind === 'not_found') {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                if (outcome.kind === 'conflict') return status(409, outcome.body)
                return outcome.body
            }
        )
        .post(
            '/api/projects/:projectId/channels/:channelId/management',
            {
                auth: true,
                params: channelParams,
                body: transferChannelManagementBody,
                response: {
                    200: channelSharingMutationResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: channelSharingConflictResponse,
                },
                detail: {
                    operationId: 'transferProjectChannelManagement',
                    summary: 'Change the project that manages a channel',
                    tags: ['Channels'],
                },
            },
            ({ apiKeyPermissions, apiKeyProjectIds, authMethod, body, params, status, user }) => {
                const ctx = sharingContext({
                    apiKeyPermissions,
                    apiKeyProjectIds,
                    authMethod,
                    projectId: params.projectId,
                    userId: user.id,
                })
                if (!ctx) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                const outcome = sharingOutcome(
                    manualStore.sharedChannels.transferManagement(ctx, {
                        channelId: params.channelId,
                        projectId: body.projectId,
                        expectedRevision: body.expectedRevision,
                    })
                )
                if (outcome.kind === 'not_found') {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                if (outcome.kind === 'conflict') return status(409, outcome.body)
                return outcome.body
            }
        )
}
