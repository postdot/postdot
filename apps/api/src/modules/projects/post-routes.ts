import { sourceContentSchema } from '@postdot/core'
import { PostCompositionConflictError, type AccessStore } from '@postdot/db'
import { Type } from 'typebox'

import { apiKeyHasCapability } from './api-key-permissions'
import { accountChanged, canAccessProjectRole, forbiddenProjectMutation } from './authorization'
import {
    createPostBody,
    errorResponse,
    postSchema,
    projectParams,
    publicationSchema,
    publicationEditorStateSchema,
} from './models'
import type { ProjectRealtimeHub } from './realtime-runtime'
import type { AuthenticatedElysia, ManualStore } from './types'

export interface PostRouteOptions {
    readonly projectChanges?: ProjectRealtimeHub
    readonly onWorkScheduled?: () => void
}

export function registerPostRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    manualStore: ManualStore,
    access: AccessStore,
    options: PostRouteOptions = {}
) {
    return app
        .get(
            '/api/projects/:projectId/posts/:postId',
            {
                auth: true,
                detail: {
                    operationId: 'getSourcePost',
                    summary: 'Read the current source post revision',
                    tags: ['Posts'],
                },
                params: Type.Object({
                    projectId: Type.String({ minLength: 1 }),
                    postId: Type.String({ minLength: 1 }),
                }),
                response: {
                    200: Type.Object({ post: postSchema }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
            },
            async ({ params, user, status }) => {
                const post = await manualStore.getPost(params.projectId, params.postId, user.id)
                return post === null
                    ? status(404, { error: { code: 'not_found', message: 'Post not found' } })
                    : { post }
            }
        )
        .patch(
            '/api/projects/:projectId/posts/:postId',
            {
                auth: true,
                detail: {
                    operationId: 'savePostSource',
                    summary: 'Save the shared source without modifying destinations',
                    tags: ['Posts'],
                },
                params: Type.Object({
                    projectId: Type.String({ minLength: 1 }),
                    postId: Type.String({ minLength: 1 }),
                }),
                body: Type.Object({
                    expectedSourceRevision: Type.Integer({ minimum: 1 }),
                    sourceContent: sourceContentSchema,
                }),
                response: {
                    200: Type.Object({ post: postSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
            },
            async ({ params, body, authMethod, user, status }) => {
                if (
                    !(await canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    }))
                )
                    return status(403, forbiddenProjectMutation())
                const post = await manualStore.savePostSource({
                    ...params,
                    ...body,
                    subjectId: user.id,
                })
                return post === null
                    ? status(404, { error: { code: 'not_found', message: 'Post not found' } })
                    : { post }
            }
        )
        .put(
            '/api/projects/:projectId/posts/:postId/composition',
            {
                auth: true,
                detail: {
                    operationId: 'savePostComposition',
                    summary: 'Save post text and channel drafts in one transaction',
                    tags: ['Posts'],
                    description:
                        'Requires editor access and publication:manage. Saves each listed draft against the resulting source revision without promoting content. Omitted targetContent preserves the current draft content. Revision conflicts return error.conflictingPublicationIds (all listed IDs for a source conflict). Delivery mode is stored on the publication and selected immutable target, not the draft; a different mode requires the destination move workflow. scheduledAt is applied publication state: a changed non-null time only reschedules an already scheduled publication, using existing future-time, running-job and cadence guards, and requires publication:dispatch. Scheduling a draft requires promotion; removing a schedule requires the existing lifecycle workflow. Omitted settings remain unchanged. Pending approval requests are superseded exactly as for individual draft saves.',
                },
                params: Type.Object({
                    projectId: Type.String({ minLength: 1 }),
                    postId: Type.String({ minLength: 1 }),
                }),
                body: Type.Object({
                    expectedSourceRevision: Type.Integer({ minimum: 1 }),
                    sourceContent: Type.Optional(sourceContentSchema),
                    publications: Type.Array(
                        Type.Object({
                            publicationId: Type.String({ minLength: 1 }),
                            expectedRevision: Type.Integer({ minimum: 1 }),
                            targetContent: Type.Optional(
                                Type.Record(Type.String(), Type.Unknown())
                            ),
                            deliveryMode: Type.Optional(
                                Type.Union([Type.Literal('manual'), Type.Literal('automatic')])
                            ),
                            scheduledAt: Type.Optional(
                                Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])
                            ),
                        }),
                        { maxItems: 100 }
                    ),
                }),
                response: {
                    200: Type.Object({
                        post: postSchema,
                        publications: Type.Array(publicationEditorStateSchema),
                    }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: Type.Object({
                        error: Type.Object({
                            code: Type.String(),
                            message: Type.String(),
                            conflictingPublicationIds: Type.Optional(Type.Array(Type.String())),
                        }),
                    }),
                    422: errorResponse,
                },
            },
            async ({ params, body, authMethod, apiKeyPermissions, user, status }) => {
                if (
                    !(await canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    }))
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                if (
                    authMethod === 'user_api_key' &&
                    body.publications.some(item => item.scheduledAt != null) &&
                    !apiKeyHasCapability(
                        apiKeyPermissions === undefined ? {} : apiKeyPermissions,
                        'publication:dispatch'
                    )
                ) {
                    return status(403, {
                        error: {
                            code: 'insufficient_api_key_permissions',
                            message: 'Rescheduling a publication requires publication:dispatch',
                        },
                    })
                }
                try {
                    const result = await manualStore.savePostComposition({
                        ...params,
                        ...body,
                        subjectId: user.id,
                    })
                    if (result === null)
                        return status(404, {
                            error: { code: 'not_found', message: 'Post not found' },
                        })
                    for (const editor of result.publications) {
                        options.projectChanges?.publishDraftChange?.({
                            projectId: params.projectId,
                            postId: params.postId,
                            publicationId: editor.publication.id,
                            sourceChanged: result.sourceChanged,
                        })
                    }
                    if (body.publications.some(item => item.scheduledAt != null))
                        options.onWorkScheduled?.()
                    return { post: result.post, publications: result.publications }
                } catch (error) {
                    if (error instanceof PostCompositionConflictError) {
                        return status(409, {
                            error: {
                                code: error.code,
                                message: error.message,
                                conflictingPublicationIds: [...error.conflictingPublicationIds],
                            },
                        })
                    }
                    throw error
                }
            }
        )
        .post(
            '/api/projects/:projectId/posts/:postId/destinations',
            {
                auth: true,
                detail: {
                    operationId: 'addPostDestinationDrafts',
                    summary: 'Add unscheduled destination drafts to an existing source post',
                    tags: ['Posts'],
                },
                params: Type.Object({
                    projectId: Type.String({ minLength: 1 }),
                    postId: Type.String({ minLength: 1 }),
                }),
                body: Type.Object({
                    expectedSourceRevision: Type.Integer({ minimum: 1 }),
                    confirmExistingChannels: Type.Optional(Type.Boolean()),
                    publications: Type.Array(
                        Type.Object({
                            channelId: Type.String({ minLength: 1 }),
                            deliveryMode: Type.Union([
                                Type.Literal('manual'),
                                Type.Literal('automatic'),
                            ]),
                        }),
                        { minItems: 1, maxItems: 100 }
                    ),
                }),
                response: {
                    201: Type.Object({
                        post: postSchema,
                        publications: Type.Array(publicationSchema),
                    }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
            },
            async ({ params, body, authMethod, user, status }) => {
                if (
                    !(await canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    }))
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const result = await manualStore.addPostDestinations({
                    ...params,
                    ...body,
                    subjectId: user.id,
                })
                return result === null
                    ? status(404, { error: { code: 'not_found', message: 'Post not found' } })
                    : status(201, { post: result.post, publications: [...result.publications] })
            }
        )
        .post(
            '/api/projects/:projectId/posts',
            {
                auth: true,
                body: createPostBody,
                params: projectParams,
                response: {
                    201: Type.Object({
                        post: postSchema,
                        publications: Type.Array(publicationSchema),
                    }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'createPost',
                    summary: 'Create a source post and its publications',
                    tags: ['Posts'],
                    description:
                        'Omitting scheduledAt creates unscheduled destination drafts. API keys need publication:manage; supplying scheduledAt also requires publication:dispatch. Target content must match the chosen channel profile. The examples use placeholder channel IDs that must be replaced.',
                },
            },
            async ({ apiKeyPermissions, authMethod, body, params, status, user }) => {
                if (
                    !(await canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    }))
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                if (body.expectedUserId !== undefined && body.expectedUserId !== user.id) {
                    return status(409, accountChanged())
                }

                if (
                    authMethod === 'user_api_key' &&
                    body.publications.some(publication => publication.scheduledAt != null) &&
                    !apiKeyHasCapability(
                        apiKeyPermissions === undefined ? {} : apiKeyPermissions,
                        'publication:dispatch'
                    )
                ) {
                    return status(403, {
                        error: {
                            code: 'insufficient_api_key_permissions',
                            message: 'Scheduling a publication requires publication:dispatch',
                        },
                    })
                }
                const created = await manualStore.createPost({
                    projectId: params.projectId,
                    subjectId: user.id,
                    title: body.title,
                    sourceContent: body.sourceContent,
                    publications: body.publications,
                    cadenceConfirmation: body.cadenceConfirmation,
                })
                if (created === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                options.onWorkScheduled?.()
                return status(201, {
                    post: created.post,
                    publications: [...created.publications],
                })
            }
        )
}
