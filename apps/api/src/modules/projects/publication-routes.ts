import { Type } from 'typebox'

import {
    duePublicationSchema,
    errorResponse,
    projectParams,
    publicationParams,
    publicationSchema,
    publishPublicationBody,
    reconcilePublicationBody,
} from './models'
import type { AuthenticatedElysia, ManualStore } from './types'

export function registerPublicationRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    manualStore: ManualStore
) {
    return app
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
