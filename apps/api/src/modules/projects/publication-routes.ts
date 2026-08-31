import { DomainInvariantError } from '@herald/core'
import { Type } from 'typebox'

import {
    duePublicationSchema,
    errorResponse,
    projectParams,
    publicationParams,
    publicationEditorStateSchema,
    publicationSchema,
    publicationSummarySchema,
    publishPublicationBody,
    reconcilePublicationBody,
    promotePublicationDraftBody,
    savePublicationDraftBody,
} from './models'
import type { AuthenticatedElysia, ManualStore } from './types'

export function registerPublicationRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    manualStore: ManualStore
) {
    return app
        .get(
            '/api/projects/:projectId/publications',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: Type.Object({ publications: Type.Array(publicationSummarySchema) }),
                    404: errorResponse,
                },
                detail: {
                    operationId: 'listPublicationSummaries',
                    summary: 'List recent publications and draft status',
                    tags: ['Publications'],
                },
            },
            ({ params, status, user }) => {
                const publications = manualStore.listPublicationSummaries(params.projectId, user.id)
                if (publications === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                return { publications }
            }
        )
        .get(
            '/api/projects/:projectId/publications/due',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: Type.Object({ publications: Type.Array(duePublicationSchema) }),
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
        .get(
            '/api/projects/:projectId/publications/:publicationId/editor',
            {
                auth: true,
                params: publicationParams,
                response: {
                    200: Type.Object({ editor: publicationEditorStateSchema }),
                    400: errorResponse,
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
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'savePublicationDraft',
                    summary: 'Persist a publication draft without changing its selected target',
                    tags: ['Publications'],
                },
            },
            ({ body, params, status, user }) => {
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
            '/api/projects/:projectId/publications/:publicationId/draft/promote',
            {
                auth: true,
                body: promotePublicationDraftBody,
                params: publicationParams,
                response: {
                    200: Type.Object({ editor: publicationEditorStateSchema }),
                    400: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'promotePublicationDraft',
                    summary: 'Promote the current draft to an immutable target revision',
                    tags: ['Publications'],
                },
            },
            ({ body, params, status, user }) => {
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
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'publishManualPublication',
                    summary: 'Record that a manual publication was completed',
                    tags: ['Publications'],
                },
            },
            ({ body, params, status, user }) => {
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
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'reconcileAmbiguousPublication',
                    summary: 'Resolve a publication whose external outcome is unknown',
                    tags: ['Publications'],
                },
            },
            ({ body, params, status, user }) => {
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
