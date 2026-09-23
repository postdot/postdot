import { DomainInvariantError } from '@herald/core'
import type { AccessStore } from '@herald/db'
import { Type } from 'typebox'

import { canAccessProjectRole, forbiddenProjectMutation } from './authorization'
import {
    duePublicationSchema,
    errorResponse,
    projectParams,
    publicationParams,
    publicationEditorStateSchema,
    publicationListQuery,
    publicationSchema,
    publicationSummaryPageSchema,
    parsePublicationTagFilter,
    publishPublicationBody,
    reconcilePublicationBody,
    promotePublicationDraftBody,
    rebasePublicationDraftBody,
    cancelPublicationsBody,
    reschedulePublicationsBody,
    savePublicationDraftBody,
} from './models'
import type { AuthenticatedElysia, ManualStore } from './types'

export interface PublicationRouteOptions {
    readonly onWorkScheduled?: () => void
}

export function registerPublicationRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    manualStore: ManualStore,
    access: AccessStore,
    options: PublicationRouteOptions = {}
) {
    return app
        .get(
            '/api/projects/:projectId/publications',
            {
                auth: true,
                params: projectParams,
                query: publicationListQuery,
                response: {
                    200: publicationSummaryPageSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'listPublicationSummaries',
                    summary: 'List recent publications and draft status',
                    tags: ['Publications'],
                },
            },
            ({ params, query, status, user }) => {
                const page = manualStore.listPublicationSummaryPage(params.projectId, user.id, {
                    cursor: query.cursor,
                    filter: parsePublicationTagFilter(query.tagIds),
                    from: query.from,
                    limit: query.limit,
                    to: query.to,
                })
                if (page === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                return page
            }
        )
        .get(
            '/api/projects/:projectId/publications/due',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: Type.Object({ publications: Type.Array(duePublicationSchema) }),
                    401: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'listDueManualPublications',
                    summary: 'List due publications requiring a manual action',
                    tags: ['Publications'],
                },
            },
            ({ params, status, user }) => {
                const publications = manualStore.listDueManualPublications(
                    params.projectId,
                    user.id
                )
                if (publications === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                return { publications }
            }
        )
        .patch(
            '/api/projects/:projectId/publications/schedule',
            {
                auth: true,
                body: reschedulePublicationsBody,
                params: projectParams,
                response: {
                    200: Type.Object({ publications: Type.Array(publicationSchema) }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'reschedulePublications',
                    summary: 'Reschedule a group of queued publications',
                    tags: ['Publications'],
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

                const publications = manualStore.reschedulePublications({
                    projectId: params.projectId,
                    publicationIds: body.publicationIds,
                    scheduledAt: body.scheduledAt,
                    subjectId: user.id,
                })
                if (publications === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                }

                options.onWorkScheduled?.()
                return { publications }
            }
        )
        .patch(
            '/api/projects/:projectId/publications/cancel',
            {
                auth: true,
                body: cancelPublicationsBody,
                params: projectParams,
                response: {
                    200: Type.Object({ publications: Type.Array(publicationSchema) }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'cancelPublications',
                    summary: 'Cancel a group of queued publications',
                    tags: ['Publications'],
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

                const publications = manualStore.cancelPublications({
                    projectId: params.projectId,
                    publicationIds: body.publicationIds,
                    subjectId: user.id,
                })
                if (publications === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                }

                options.onWorkScheduled?.()
                return { publications }
            }
        )
        .get(
            '/api/projects/:projectId/publications/:publicationId/editor',
            {
                auth: true,
                params: publicationParams,
                response: {
                    200: Type.Object({ editor: publicationEditorStateSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'getPublicationEditor',
                    summary: 'Read publication source, draft, profile, and selected target',
                    tags: ['Publications'],
                },
            },
            ({ params, status, user }) => {
                const editor = manualStore.getPublicationEditorState(
                    params.projectId,
                    params.publicationId,
                    user.id
                )
                if (editor === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                }
                return { editor }
            }
        )
        .patch(
            '/api/projects/:projectId/publications/:publicationId/draft',
            {
                auth: true,
                body: savePublicationDraftBody,
                params: publicationParams,
                response: {
                    200: Type.Object({ editor: publicationEditorStateSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'savePublicationDraft',
                    summary: 'Persist a publication draft without changing its selected target',
                    tags: ['Publications'],
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
                if (body.sourceContent === undefined && body.targetContent === undefined) {
                    throw new DomainInvariantError(
                        'invalid_input',
                        'A publication draft must include sourceContent or targetContent'
                    )
                }

                const draft = manualStore.savePublicationDraft({
                    projectId: params.projectId,
                    publicationId: params.publicationId,
                    subjectId: user.id,
                    expectedRevision: body.expectedRevision,
                    sourceContent: body.sourceContent,
                    targetContent: body.targetContent,
                })
                if (draft === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                }

                const editor = manualStore.getPublicationEditorState(
                    params.projectId,
                    params.publicationId,
                    user.id
                )
                if (editor === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                }
                return { editor }
            }
        )
        .post(
            '/api/projects/:projectId/publications/:publicationId/draft/rebase',
            {
                auth: true,
                body: rebasePublicationDraftBody,
                params: publicationParams,
                response: {
                    200: Type.Object({ editor: publicationEditorStateSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'rebasePublicationDraft',
                    summary: 'Rebase a stale publication draft onto the current source',
                    tags: ['Publications'],
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
                const draft = manualStore.rebasePublicationDraft({
                    projectId: params.projectId,
                    publicationId: params.publicationId,
                    subjectId: user.id,
                    expectedRevision: body.expectedRevision,
                })
                if (draft === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                }

                const editor = manualStore.getPublicationEditorState(
                    params.projectId,
                    params.publicationId,
                    user.id
                )
                if (editor === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                }
                return { editor }
            }
        )
        .post(
            '/api/projects/:projectId/publications/:publicationId/draft/promote',
            {
                auth: true,
                body: promotePublicationDraftBody,
                params: publicationParams,
                response: {
                    200: Type.Object({ editor: publicationEditorStateSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'promotePublicationDraft',
                    summary: 'Promote the current draft to an immutable target revision',
                    tags: ['Publications'],
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
                const publication = manualStore.promotePublicationDraft({
                    projectId: params.projectId,
                    publicationId: params.publicationId,
                    subjectId: user.id,
                    expectedRevision: body.expectedRevision,
                    scheduledAt: body.scheduledAt,
                })
                if (publication === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                }

                const editor = manualStore.getPublicationEditorState(
                    params.projectId,
                    params.publicationId,
                    user.id
                )
                if (editor === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                }
                // Promotion can create, reschedule, or cancel a worker job. Wake the
                // scheduler so a changed run time is applied immediately.
                options.onWorkScheduled?.()
                return { editor }
            }
        )
        .post(
            '/api/projects/:projectId/publications/:publicationId/publish',
            {
                auth: true,
                body: publishPublicationBody,
                params: publicationParams,
                response: {
                    200: Type.Object({ publication: publicationSchema }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'publishManualPublication',
                    summary: 'Record that a manual publication was completed',
                    tags: ['Publications'],
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
                const publication = manualStore.publishManualPublication({
                    projectId: params.projectId,
                    publicationId: params.publicationId,
                    subjectId: user.id,
                    externalId: body.externalId,
                    externalUrl: body.externalUrl,
                })
                if (publication === null) {
                    return status(404, {
                        error: {
                            code: 'not_found',
                            message: 'Due manual publication not found',
                        },
                    })
                }
                return { publication }
            }
        )
        .post(
            '/api/projects/:projectId/publications/:publicationId/reconcile',
            {
                auth: true,
                body: reconcilePublicationBody,
                params: publicationParams,
                response: {
                    200: Type.Object({ publication: publicationSchema }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'reconcileAmbiguousPublication',
                    summary: 'Resolve a publication whose external outcome is unknown',
                    tags: ['Publications'],
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
                const result = manualStore.reconcileAmbiguousPublication({
                    projectId: params.projectId,
                    publicationId: params.publicationId,
                    subjectId: user.id,
                    resolution: body.resolution,
                    externalId: body.externalId,
                    externalUrl: body.externalUrl,
                    errorMessage: body.errorMessage,
                })
                if (result.kind === 'not_found') {
                    return status(404, {
                        error: {
                            code: 'not_found',
                            message: 'Publication not found',
                        },
                    })
                }
                if (result.kind === 'not_ambiguous') {
                    return status(409, {
                        error: {
                            code: 'invalid_transition',
                            message: 'Only an ambiguous publication can be reconciled',
                        },
                    })
                }
                return { publication: result.publication }
            }
        )
}
