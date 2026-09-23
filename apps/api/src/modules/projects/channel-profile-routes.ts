import type { AccessStore } from '@herald/db'
import { Type } from 'typebox'

import { canAccessProjectRole, forbiddenProjectMutation } from './authorization'
import {
    activateChannelProfileBody,
    channelProfileActivationSchema,
    channelProfileAssessmentSchema,
    channelProfileStateSchema,
    channelProfileVersionParams,
    channelProfileVersionSchema,
    channelParams,
    errorResponse,
    resolveChannelProfile,
    saveChannelProfileDraftBody,
} from './models'
import type { AuthenticatedElysia, ManualStore } from './types'

export function registerChannelProfileRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    manualStore: ManualStore,
    access: AccessStore
) {
    return app
        .get(
            '/api/projects/:projectId/channels/:channelId/profile',
            {
                auth: true,
                params: channelParams,
                response: {
                    200: channelProfileStateSchema,
                    401: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'getChannelProfileState',
                    summary: 'Get the active and draft profile for a channel',
                    tags: ['Channels'],
                },
            },
            ({ params, status, user }) => {
                const profile = manualStore.getChannelProfileState(
                    params.projectId,
                    params.channelId,
                    user.id
                )
                if (profile === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                return profile
            }
        )
        .post(
            '/api/projects/:projectId/channels/:channelId/profile-drafts',
            {
                auth: true,
                body: saveChannelProfileDraftBody,
                params: channelParams,
                response: {
                    200: Type.Object({ profile: channelProfileVersionSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'saveChannelProfileDraft',
                    summary: 'Create or update a channel profile draft',
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
                const profile = manualStore.createChannelProfileDraft({
                    projectId: params.projectId,
                    channelId: params.channelId,
                    subjectId: user.id,
                    profile: resolveChannelProfile(body.profile),
                    expectedRevision: body.expectedRevision,
                })
                if (profile === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                return { profile }
            }
        )
        .post(
            '/api/projects/:projectId/channels/:channelId/profile-drafts/:profileVersionId/preview',
            {
                auth: true,
                params: channelProfileVersionParams,
                response: {
                    200: Type.Object({ assessment: channelProfileAssessmentSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'previewChannelProfileActivation',
                    summary: 'Preview the impact of activating a channel profile draft',
                    tags: ['Channels'],
                },
            },
            ({ authMethod, params, status, user }) => {
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
                const assessment = manualStore.previewChannelProfileActivation({
                    projectId: params.projectId,
                    channelId: params.channelId,
                    profileVersionId: params.profileVersionId,
                    subjectId: user.id,
                })
                if (assessment === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                return { assessment }
            }
        )
        .post(
            '/api/projects/:projectId/channels/:channelId/profile-drafts/:profileVersionId/activate',
            {
                auth: true,
                body: activateChannelProfileBody,
                params: channelProfileVersionParams,
                response: {
                    200: channelProfileActivationSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'activateChannelProfile',
                    summary: 'Activate a channel profile draft',
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
                const result = manualStore.activateChannelProfile({
                    projectId: params.projectId,
                    channelId: params.channelId,
                    profileVersionId: params.profileVersionId,
                    subjectId: user.id,
                    expectedRevision: body.expectedRevision,
                })
                if (result === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                return result
            }
        )
}
