import { Type } from 'typebox'

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
    options: PostRouteOptions = {}
) {
    return app.post(
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
        ({ body, params, status, user }) => {
            const created = manualStore.createPost({
                projectId: params.projectId,
                subjectId: user.id,
                title: body.title,
                content: body.content,
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
