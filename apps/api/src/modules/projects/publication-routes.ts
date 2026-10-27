import { DomainInvariantError } from '@postdot/core'
import type { AccessStore, PublicationDestinationState } from '@postdot/db'
import { Type } from 'typebox'

import { sessionSecurity } from '../../plugins/auth'
import { apiKeyHasCapability } from './api-key-permissions'
import { canAccessProjectRole, forbiddenProjectMutation } from './authorization'
import {
    duePublicationSchema,
    errorResponse,
    projectParams,
    publicationParams,
    publicationEditorStateSchema,
    publicationListQuery,
    publicationComposerDraftResponseSchema,
    publicationComposerDraftSchema,
    publicationSchema,
    publicationSummaryPageSchema,
    parsePublicationTagFilter,
    publishPublicationBody,
    reconcilePublicationBody,
    promotePublicationDraftBody,
    adoptPublicationDraftProfileBody,
    publicationWorkingDraftSchema,
    rebasePublicationDraftBody,
    cancelPublicationsBody,
    deleteDraftPublicationResponseSchema,
    duplicateDraftPublicationResponseSchema,
    reschedulePublicationsBody,
    savePublicationDraftBody,
    savePublicationComposerDraftBody,
    publicationApprovalRequestSchema,
    publicationApprovalRequestsResponseSchema,
    submitPublicationForApprovalBody,
    approvePublicationRequestBody,
    rejectPublicationRequestBody,
} from './models'
import type { ProjectRealtimeHub } from './realtime-runtime'
import type { AuthenticatedElysia, ManualStore } from './types'

const destinationStateSchema = Type.Unsafe<PublicationDestinationState>(
    Type.Object({
        revision: Type.Integer({ minimum: 0 }),
        confirmedRevision: Type.Integer({ minimum: 0 }),
        requiresConfirmation: Type.Boolean(),
        connected: Type.Boolean(),
        current: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
        history: Type.Array(
            Type.Object({
                id: Type.String(),
                createdAt: Type.Integer(),
                destination: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
            })
        ),
    })
)

export interface PublicationRouteOptions {
    readonly projectChanges?: ProjectRealtimeHub
    readonly onWorkScheduled?: () => void
}

export function registerPublicationRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    manualStore: ManualStore,
    access: AccessStore,
    options: PublicationRouteOptions = {}
) {
    const timingSchema = Type.Object({
        scheduledAt: Type.Integer(),
        eligibleAt: Type.Integer(),
        reason: Type.Union([Type.Literal('minimum_interval'), Type.Null()]),
        confirmation: Type.String(),
    })
    return app
        .post(
            '/api/projects/:projectId/publications/:publicationId/move',
            {
                auth: true,
                params: publicationParams,
                body: Type.Object({
                    targetChannelId: Type.String({ minLength: 1 }),
                    deliveryMode: Type.Union([Type.Literal('manual'), Type.Literal('automatic')]),
                    expectedPublicationUpdatedAt: Type.Integer({ minimum: 0 }),
                    expectedDraftRevision: Type.Integer({ minimum: 1 }),
                    expectedSourceRevision: Type.Integer({ minimum: 1 }),
                    expectedTargetRevisionId: Type.Union([
                        Type.String({ minLength: 1 }),
                        Type.Null(),
                    ]),
                    expectedScheduledAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
                    expectedTargetProfileVersionId: Type.String({ minLength: 1 }),
                    cadenceConfirmation: Type.Optional(
                        Type.String({ minLength: 64, maxLength: 64 })
                    ),
                }),
                response: {
                    201: Type.Object({ editor: publicationEditorStateSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'movePublication',
                    summary:
                        'Explicitly move future work to another channel without rewriting history',
                    tags: ['Publications'],
                },
            },
            ({ params, body, user, status, authMethod, apiKeyPermissions }) => {
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
                const current = manualStore.getPublicationEditorState(
                    params.projectId,
                    params.publicationId,
                    user.id
                )
                if (!current)
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                if (
                    authMethod === 'user_api_key' &&
                    current.publication.scheduledAt !== null &&
                    !apiKeyHasCapability(apiKeyPermissions ?? null, 'publication:dispatch')
                )
                    return status(403, {
                        error: {
                            code: 'insufficient_api_key_permissions',
                            message:
                                'Moving scheduled work requires publication dispatch permission',
                        },
                    })
                const editor = manualStore.movePublication({
                    ...params,
                    ...body,
                    subjectId: user.id,
                })
                if (!editor)
                    return status(404, {
                        error: {
                            code: 'not_found',
                            message: 'Publication or destination not found',
                        },
                    })
                options.onWorkScheduled?.()
                return status(201, { editor })
            }
        )
        .get(
            '/api/projects/:projectId/publications/:publicationId/cadence',
            {
                auth: true,
                params: publicationParams,
                response: {
                    200: Type.Union([timingSchema, Type.Null()]),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'getPublicationCadence',
                    summary: 'Read publication dispatch timing',
                    tags: ['Publications'],
                },
            },
            ({ params, user }) =>
                manualStore.getPublicationCadence({ ...params, subjectId: user.id })
        )
        .post(
            '/api/projects/:projectId/publications/:publicationId/cadence-override',
            {
                auth: true,
                params: publicationParams,
                body: Type.Object({ confirmation: Type.String({ minLength: 64, maxLength: 64 }) }),
                response: {
                    200: Type.Union([timingSchema, Type.Null()]),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'overridePublicationCadence',
                    summary: 'Explicitly override one minimum interval',
                    tags: ['Publications'],
                },
            },
            ({ params, body, user, authMethod, status }) => {
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
                const result = manualStore.overridePublicationCadence({
                    ...params,
                    ...body,
                    subjectId: user.id,
                })
                options.onWorkScheduled?.()
                return result
            }
        )
        .get(
            '/api/projects/:projectId/publications/:publicationId/destination',
            {
                auth: true,
                params: publicationParams,
                response: {
                    200: Type.Object({ destination: destinationStateSchema }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'getPublicationDestination',
                    summary:
                        'Read current destination confirmation and captured execution identities',
                    tags: ['Publications'],
                },
            },
            ({ authMethod, params, status, user }) => {
                if (
                    !canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'viewer',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                )
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                const destination = manualStore.getPublicationDestination(
                    params.projectId,
                    params.publicationId,
                    user.id
                )
                if (destination === null)
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                return { destination }
            }
        )
        .post(
            '/api/projects/:projectId/publications/:publicationId/confirm-destination',
            {
                auth: true,
                params: publicationParams,
                body: Type.Object({
                    expectedRevision: Type.Integer({ minimum: 0 }),
                    expectedTargetRevisionId: Type.Union([
                        Type.String({ minLength: 1 }),
                        Type.Null(),
                    ]),
                }),
                response: {
                    200: Type.Object({ destination: destinationStateSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'confirmPublicationDestination',
                    summary:
                        'Explicitly accept the current destination for an existing selected target',
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
                )
                    return status(403, forbiddenProjectMutation())
                const destination = manualStore.confirmPublicationDestination({
                    ...body,
                    ...params,
                    subjectId: user.id,
                })
                if (destination === null)
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                options.onWorkScheduled?.()
                return { destination }
            }
        )
        .get(
            '/api/projects/:projectId/publication-composer-draft',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: publicationComposerDraftResponseSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'getPublicationComposerDraft',
                    summary: 'Read the current durable recovery point for a new publication',
                    tags: ['Publications'],
                },
            },
            ({ authMethod, params, status, user }) => {
                if (
                    !canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'viewer',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                ) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                return { draft: manualStore.getPublicationComposerDraft(params.projectId, user.id) }
            }
        )
        .put(
            '/api/projects/:projectId/publication-composer-draft',
            {
                auth: true,
                body: savePublicationComposerDraftBody,
                params: projectParams,
                response: {
                    200: Type.Object({ draft: publicationComposerDraftSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'savePublicationComposerDraft',
                    summary: 'Persist the new-publication composer recovery point',
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

                const draft = manualStore.savePublicationComposerDraft({
                    projectId: params.projectId,
                    subjectId: user.id,
                    expectedRevision: body.expectedRevision,
                    content: body.content,
                })
                if (draft === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                return { draft }
            }
        )
        .delete(
            '/api/projects/:projectId/publication-composer-draft',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: Type.Object({ deleted: Type.Boolean() }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'deletePublicationComposerDraft',
                    summary: 'Discard the new-publication composer recovery point',
                    tags: ['Publications'],
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
                const deleted = manualStore.deletePublicationComposerDraft({
                    projectId: params.projectId,
                    subjectId: user.id,
                })
                return { deleted }
            }
        )
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
                    sort: query.sort,
                    state: query.state,
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
                    403: errorResponse,
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
            '/api/projects/:projectId/publications/approval-requests',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: publicationApprovalRequestsResponseSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'listPublicationApprovalRequests',
                    summary: 'List publications awaiting human approval',
                    tags: ['Publications'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, status, user }) => {
                if (
                    authMethod !== 'session' ||
                    !canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                ) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'Human project editor access is required',
                        },
                    })
                }
                const requests = manualStore.listPendingPublicationApprovalRequests(
                    params.projectId,
                    user.id
                )
                if (requests === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                return { requests }
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
                    cadenceConfirmation: body.cadenceConfirmation,
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
        .delete(
            '/api/projects/:projectId/publications/:publicationId',
            {
                auth: true,
                params: publicationParams,
                response: {
                    200: deleteDraftPublicationResponseSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'deleteDraftPublication',
                    summary: 'Delete a publication that is still a draft',
                    tags: ['Publications'],
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

                const result = manualStore.deleteDraftPublication({
                    projectId: params.projectId,
                    publicationId: params.publicationId,
                    subjectId: user.id,
                })
                if (result.kind === 'not_found') {
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                }
                if (result.kind === 'not_draft') {
                    return status(409, {
                        error: {
                            code: 'invalid_transition',
                            message: 'Only draft publications can be deleted',
                        },
                    })
                }
                return { deleted: true, postDeleted: result.postDeleted }
            }
        )
        .post(
            '/api/projects/:projectId/publications/:publicationId/duplicate',
            {
                auth: true,
                params: publicationParams,
                response: {
                    201: duplicateDraftPublicationResponseSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'duplicateDraftPublication',
                    summary: 'Create an independent copy of a draft publication',
                    tags: ['Publications'],
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

                const result = manualStore.duplicateDraftPublication({
                    projectId: params.projectId,
                    publicationId: params.publicationId,
                    subjectId: user.id,
                })
                if (result.kind === 'not_found') {
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                }
                if (result.kind === 'not_draft') {
                    return status(409, {
                        error: {
                            code: 'invalid_transition',
                            message: 'Only draft publications can be duplicated',
                        },
                    })
                }
                return status(201, { post: result.post, publication: result.publication })
            }
        )
        .post(
            '/api/projects/:projectId/publications/:publicationId/approval-request',
            {
                auth: true,
                body: submitPublicationForApprovalBody,
                params: publicationParams,
                response: {
                    201: Type.Object({ request: publicationApprovalRequestSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'submitPublicationForApproval',
                    summary: 'Submit a proposed publication schedule for human approval',
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
                const request = manualStore.submitPublicationForApproval({
                    projectId: params.projectId,
                    publicationId: params.publicationId,
                    subjectId: user.id,
                    expectedDraftRevision: body.expectedDraftRevision,
                    proposedScheduledAt: body.proposedScheduledAt,
                })
                if (request === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                }
                return status(201, { request })
            }
        )
        .post(
            '/api/projects/:projectId/publications/:publicationId/approval-request/approve',
            {
                auth: true,
                body: approvePublicationRequestBody,
                params: publicationParams,
                response: {
                    200: Type.Object({ publication: publicationSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'approvePublicationRequest',
                    summary: 'Approve a publication and schedule the reviewed revision',
                    tags: ['Publications'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (
                    authMethod !== 'session' ||
                    !canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                ) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'Human project editor access is required to approve',
                        },
                    })
                }
                const requests = manualStore.listPendingPublicationApprovalRequests(
                    params.projectId,
                    user.id
                )
                const request = requests?.find(item => item.publicationId === params.publicationId)
                if (requests === null || request === undefined) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Approval request not found' },
                    })
                }
                const publication = manualStore.approvePublicationApprovalRequest({
                    projectId: params.projectId,
                    publicationId: params.publicationId,
                    requestId: request.id,
                    subjectId: user.id,
                    scheduledAt: body.scheduledAt,
                    cadenceConfirmation: body.cadenceConfirmation,
                    publishNow: body.publishNow,
                })
                if (publication === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Approval request not found' },
                    })
                }
                options.onWorkScheduled?.()
                return { publication }
            }
        )
        .post(
            '/api/projects/:projectId/publications/:publicationId/approval-request/reject',
            {
                auth: true,
                body: rejectPublicationRequestBody,
                params: publicationParams,
                response: {
                    200: Type.Object({ request: publicationApprovalRequestSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'rejectPublicationRequest',
                    summary: 'Reject a publication approval request',
                    tags: ['Publications'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (
                    authMethod !== 'session' ||
                    !canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                ) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'Human project editor access is required to reject',
                        },
                    })
                }
                const requests = manualStore.listPendingPublicationApprovalRequests(
                    params.projectId,
                    user.id
                )
                const request = requests?.find(item => item.publicationId === params.publicationId)
                if (requests === null || request === undefined) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Approval request not found' },
                    })
                }
                const rejected = manualStore.rejectPublicationApprovalRequest({
                    projectId: params.projectId,
                    publicationId: params.publicationId,
                    requestId: request.id,
                    subjectId: user.id,
                    rejectionReason: body.rejectionReason,
                })
                if (rejected === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Approval request not found' },
                    })
                }
                return { request: rejected }
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

                const previous = manualStore.getPublicationEditorState(
                    params.projectId,
                    params.publicationId,
                    user.id
                )
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
                options.projectChanges?.publishDraftChange?.({
                    projectId: params.projectId,
                    postId: editor.post.id,
                    publicationId: params.publicationId,
                    sourceChanged: previous?.post.sourceRevision !== editor.post.sourceRevision,
                })
                return { editor }
            }
        )
        .get(
            '/api/projects/:projectId/publications/:publicationId/draft/adoptions',
            {
                auth: true,
                params: publicationParams,
                response: {
                    200: Type.Object({
                        adoptions: Type.Array(
                            Type.Object({
                                id: Type.String(),
                                draft: publicationWorkingDraftSchema,
                                localContent: Type.Union([
                                    Type.Record(Type.String(), Type.Unknown()),
                                    Type.Null(),
                                ]),
                                adoptedProfileVersionId: Type.String(),
                                targetRevisionId: Type.String(),
                                createdAt: Type.Integer(),
                            })
                        ),
                    }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: { operationId: 'listPublicationDraftAdoptions', tags: ['Publications'] },
            },
            ({ params, user, status }) => {
                const adoptions = manualStore.listPublicationDraftAdoptions(
                    params.projectId,
                    params.publicationId,
                    user.id
                )
                return adoptions === null
                    ? status(404, {
                          error: { code: 'not_found', message: 'Publication not found' },
                      })
                    : { adoptions }
            }
        )
        .post(
            '/api/projects/:projectId/publications/:publicationId/draft/assess-adoption',
            {
                auth: true,
                params: publicationParams,
                body: adoptPublicationDraftProfileBody,
                response: {
                    200: Type.Object({
                        valid: Type.Boolean(),
                        issues: Type.Array(Type.Record(Type.String(), Type.Unknown())),
                    }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: { operationId: 'assessPublicationDraftAdoption', tags: ['Publications'] },
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
                )
                    return status(403, forbiddenProjectMutation())
                const assessment = manualStore.assessPublicationDraftAdoption({
                    ...body,
                    projectId: params.projectId,
                    publicationId: params.publicationId,
                    subjectId: user.id,
                })
                return assessment === null
                    ? status(404, {
                          error: { code: 'not_found', message: 'Publication not found' },
                      })
                    : assessment
            }
        )
        .post(
            '/api/projects/:projectId/publications/:publicationId/draft/adopt-profile',
            {
                auth: true,
                params: publicationParams,
                body: adoptPublicationDraftProfileBody,
                response: {
                    200: Type.Object({ editor: publicationEditorStateSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: { operationId: 'adoptPublicationDraftProfile', tags: ['Publications'] },
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
                const draft = manualStore.adoptPublicationDraftProfile({
                    ...body,
                    projectId: params.projectId,
                    publicationId: params.publicationId,
                    subjectId: user.id,
                })
                if (draft === null)
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                const editor = manualStore.getPublicationEditorState(
                    params.projectId,
                    params.publicationId,
                    user.id
                )
                if (editor === null)
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                options.projectChanges?.publishDraftChange?.({
                    projectId: params.projectId,
                    postId: editor.post.id,
                    publicationId: params.publicationId,
                    sourceChanged: false,
                })
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
                    ...(body.expectedSourceRevision === undefined
                        ? {}
                        : { expectedSourceRevision: body.expectedSourceRevision }),
                    ...(body.replaceContent === undefined
                        ? {}
                        : { replaceContent: body.replaceContent }),
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
                    cadenceConfirmation: body.cadenceConfirmation,
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
            '/api/projects/:projectId/publications/:publicationId/retry',
            {
                auth: true,
                body: Type.Optional(
                    Type.Object({
                        cadenceConfirmation: Type.Optional(
                            Type.String({ minLength: 64, maxLength: 64 })
                        ),
                    })
                ),
                params: publicationParams,
                response: {
                    200: Type.Object({ publication: publicationSchema }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'retryFailedPublication',
                    summary: 'Requeue a failed automatic publication using its current target',
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

                const result = manualStore.retryFailedPublication({
                    cadenceConfirmation: body?.cadenceConfirmation,
                    projectId: params.projectId,
                    publicationId: params.publicationId,
                    subjectId: user.id,
                })
                if (result.kind === 'not_found') {
                    return status(404, {
                        error: {
                            code: 'not_found',
                            message: 'Publication not found',
                        },
                    })
                }
                if (result.kind === 'not_retryable') {
                    return status(409, {
                        error: {
                            code: 'invalid_transition',
                            message:
                                'Only a failed automatic publication with a failed delivery job can be retried',
                        },
                    })
                }

                options.onWorkScheduled?.()
                return { publication: result.publication }
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
