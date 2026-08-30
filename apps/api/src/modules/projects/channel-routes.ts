import { Type } from 'typebox'

import {
    channelSchema,
    createChannelBody,
    errorResponse,
    projectParams,
    resolveChannelProfile,
} from './models'
import type { AuthenticatedElysia, ManualStore } from './types'

export function registerChannelRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    manualStore: ManualStore
) {
    return app
        .get(
            '/api/projects/:projectId/channels',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: Type.Object({ channels: Type.Array(channelSchema) }),
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
                    404: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'createProjectChannel',
                    summary: 'Create a channel in a project',
                    tags: ['Channels'],
                },
            },
            ({ body, params, status, user }) => {
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
}
