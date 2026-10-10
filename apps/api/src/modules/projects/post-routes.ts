import { sourceContentSchema } from '@herald/core'
import type { AccessStore } from '@herald/db'
import { Type } from 'typebox'

import { apiKeyHasCapability } from './api-key-permissions'
import { canAccessProjectRole, forbiddenProjectMutation } from './authorization'
import {
    createPostBody,
    errorResponse,
    postSchema,
    projectParams,
    publicationSchema,
} from './models'
import type { AuthenticatedElysia, ManualStore } from './types'

export interface PostRouteOptions {
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
            ({ params, user, status }) => {
                const post = manualStore.getPost(params.projectId, params.postId, user.id)
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
            ({ params, body, authMethod, user, status }) => {
                if (
                    !canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                )
                    return status(403, forbiddenProjectMutation())
                const post = manualStore.savePostSource({ ...params, ...body, subjectId: user.id })
                return post === null
                    ? status(404, { error: { code: 'not_found', message: 'Post not found' } })
                    : { post }
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
            ({ params, body, authMethod, user, status }) => {
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
                const result = manualStore.addPostDestinations({
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
                },
            },
            ({ apiKeyPermissions, authMethod, body, params, status, user }) => {
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
                const created = manualStore.createPost({
                    projectId: params.projectId,
                    subjectId: user.id,
                    title: body.title,
                    sourceContent: body.sourceContent,
                    publications: body.publications,
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
