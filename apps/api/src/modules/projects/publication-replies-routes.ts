import type { AccessStore } from '@postbot/db'
import { Type, type Static } from 'typebox'

import { canAccessProjectRole, forbiddenProjectMutation } from './authorization'
import { errorResponse, publicationParams } from './models'
import type { PublicationRepliesService } from './publication-replies-service'
import type { AuthenticatedElysia } from './types'

const nullableText = Type.Union([Type.String(), Type.Null()])
export const publicationRepliesResponseSchema = Type.Object({
    replies: Type.Array(
        Type.Object({
            id: Type.String(),
            parentUri: Type.String(),
            text: Type.String(),
            state: Type.Union([
                Type.Literal('pending'),
                Type.Literal('running'),
                Type.Literal('sent'),
                Type.Literal('failed'),
                Type.Literal('ambiguous'),
            ]),
            authorName: Type.String(),
            createdAt: Type.Integer(),
            updatedAt: Type.Integer(),
            externalUrl: nullableText,
            lastError: nullableText,
        })
    ),
    nextBefore: nullableText,
    canReply: Type.Boolean(),
    accountName: nullableText,
    provider: Type.Union([Type.Literal('bluesky'), Type.Literal('mastodon')]),
    textLimit: Type.Integer(),
    instanceOrigin: nullableText,
})
export function registerPublicationRepliesRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    options: {
        replies: PublicationRepliesService
        access: AccessStore
        onWorkScheduled?: () => void
    }
) {
    const response = {
        200: publicationRepliesResponseSchema,
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        422: errorResponse,
    }
    return app
        .get(
            '/api/projects/:projectId/publications/:publicationId/comments/replies',
            {
                auth: true,
                params: publicationParams,
                query: Type.Object({ before: Type.Optional(Type.String({ format: 'uuid' })) }),
                response,
                detail: {
                    operationId: 'getPublicationReplies',
                    summary: 'Read outgoing conversation reply history',
                    tags: ['Publications'],
                },
            },
            ({ params, query, user, status }) =>
                options.replies.list(
                    params.projectId,
                    params.publicationId,
                    user.id,
                    query.before
                ) ??
                status(404, { error: { code: 'not_found', message: 'Conversation not found' } })
        )
        .post(
            '/api/projects/:projectId/publications/:publicationId/comments/replies',
            {
                auth: true,
                params: publicationParams,
                body: Type.Object({
                    requestId: Type.String({ format: 'uuid' }),
                    parentUri: Type.String({ maxLength: 2048 }),
                    text: Type.String({ minLength: 1, maxLength: 3000 }),
                }),
                response,
                detail: {
                    operationId: 'sendPublicationReply',
                    summary: 'Request a text reply to a stored public comment',
                    tags: ['Publications'],
                },
            },
            ({ params, body, user, authMethod, status }) => {
                if (
                    !canAccessProjectRole({
                        access: options.access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                )
                    return status(403, forbiddenProjectMutation())
                const result = options.replies.create({
                    projectId: params.projectId,
                    publicationId: params.publicationId,
                    requestId: body.requestId,
                    parentUri: body.parentUri,
                    text: body.text,
                    subjectId: user.id,
                })
                if (!result)
                    return status(409, {
                        error: {
                            code: 'conflict',
                            message: 'The reply, account or conversation is no longer eligible',
                        },
                    })
                options.onWorkScheduled?.()
                return (
                    options.replies.list(params.projectId, params.publicationId, user.id) ??
                    status(404, { error: { code: 'not_found', message: 'Conversation not found' } })
                )
            }
        )
}

export type PublicationRepliesResponse = Static<typeof publicationRepliesResponseSchema>
