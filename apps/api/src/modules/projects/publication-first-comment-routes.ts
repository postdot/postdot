import type { AccessStore } from '@postbot/db'

import { canAccessProjectRole, forbiddenProjectMutation } from './authorization'
import { errorResponse, publicationParams } from './models'
import {
    publicationFirstCommentResponseSchema,
    publicationFirstCommentSaveSchema,
    publicationFirstCommentCancelSchema,
} from './publication-first-comment-models'
import type { PublicationFirstCommentService } from './publication-first-comment-service'
import type { AuthenticatedElysia } from './types'

export function registerPublicationFirstCommentRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    options: {
        firstComments: PublicationFirstCommentService
        access: AccessStore
        onWorkScheduled?: () => void
    }
) {
    const response = {
        200: publicationFirstCommentResponseSchema,
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        422: errorResponse,
    }
    return app
        .get(
            '/api/projects/:projectId/publications/:publicationId/first-comment',
            {
                auth: true,
                params: publicationParams,
                response,
                detail: {
                    operationId: 'getPublicationFirstComment',
                    summary: 'Read prepared first comment and its independent outcome',
                    tags: ['Publications'],
                },
            },
            ({ params, user, status }) =>
                options.firstComments.get(params.projectId, params.publicationId, user.id) ??
                status(404, { error: { code: 'not_found', message: 'Publication not found' } })
        )
        .put(
            '/api/projects/:projectId/publications/:publicationId/first-comment',
            {
                auth: true,
                params: publicationParams,
                body: publicationFirstCommentSaveSchema,
                response,
                detail: {
                    operationId: 'savePublicationFirstComment',
                    summary: 'Save and enable a prepared first comment',
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
                const result = options.firstComments.save({
                    ...body,
                    ...params,
                    subjectId: user.id,
                })
                if (result.kind === 'not_found')
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                if (result.kind === 'conflict')
                    return status(409, {
                        error: {
                            code: 'conflict',
                            message: 'The first comment changed or is no longer configurable',
                        },
                    })
                options.onWorkScheduled?.()
                return (
                    options.firstComments.get(params.projectId, params.publicationId, user.id) ??
                    status(404, { error: { code: 'not_found', message: 'Publication not found' } })
                )
            }
        )
        .post(
            '/api/projects/:projectId/publications/:publicationId/first-comment/cancel',
            {
                auth: true,
                params: publicationParams,
                body: publicationFirstCommentCancelSchema,
                response,
                detail: {
                    operationId: 'cancelPublicationFirstComment',
                    summary: 'Cancel an unclaimed prepared first comment',
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
                const result = options.firstComments.cancel({
                    ...body,
                    ...params,
                    subjectId: user.id,
                })
                if (result.kind === 'not_found')
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                if (result.kind === 'conflict')
                    return status(409, {
                        error: {
                            code: 'conflict',
                            message: 'The first comment changed or can no longer be cancelled',
                        },
                    })
                options.onWorkScheduled?.()
                return (
                    options.firstComments.get(params.projectId, params.publicationId, user.id) ??
                    status(404, { error: { code: 'not_found', message: 'Publication not found' } })
                )
            }
        )
}
