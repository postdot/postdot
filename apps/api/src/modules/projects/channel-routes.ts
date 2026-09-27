import type { AccessStore } from '@herald/db'
import { Type } from 'typebox'

import { canAccessProjectRole, forbiddenProjectMutation } from './authorization'
import {
    channelSchema,
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
import type { AuthenticatedElysia, ManualStore } from './types'

export function registerChannelRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    manualStore: ManualStore,
    access: AccessStore
) {
    return app
        .get(
            '/api/projects/:projectId/channels',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: Type.Object({ channels: Type.Array(channelSchema) }),
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
                const channel = manualStore.createChannel({
                    projectId: params.projectId,
                    subjectId: user.id,
                    name: body.name,
                    profile: resolveChannelProfile(body.profile),
                })
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
}
