import { mediaImportSourceDefinitions } from '@postbot/core'
import type { AccessStore, MediaAssetStore } from '@postbot/db'
import type { OpenAPIV3 } from 'openapi-types'
import { Type, type Static } from 'typebox'

import type { AuthenticatedElysia } from '../../plugins/auth'
import { canAccessProjectRole, forbiddenProjectMutation } from '../projects/authorization'
import { errorResponse } from '../projects/models'
import { parseMediaByteRange } from './byte-range'
import { MediaUrlImportError, type MediaUrlImporter } from './url-import'

const mediaProjectParams = Type.Object({
    projectId: Type.String({ minLength: 1 }),
})

const mediaListQuery = Type.Object({
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1_024 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    view: Type.Optional(Type.Union([Type.Literal('library'), Type.Literal('trash')])),
    search: Type.Optional(Type.String({ maxLength: 255 })),
    sort: Type.Optional(
        Type.Union([
            Type.Literal('newest'),
            Type.Literal('oldest'),
            Type.Literal('name_asc'),
            Type.Literal('name_desc'),
            Type.Literal('largest'),
            Type.Literal('smallest'),
        ])
    ),
    family: Type.Optional(
        Type.Union([
            Type.Literal('all'),
            Type.Literal('image'),
            Type.Literal('video'),
            Type.Literal('audio'),
            Type.Literal('document'),
        ])
    ),
    date: Type.Optional(
        Type.Union([
            Type.Literal('all'),
            Type.Literal('last_24_hours'),
            Type.Literal('last_7_days'),
            Type.Literal('last_30_days'),
        ])
    ),
})

const mediaAssetParams = Type.Object({
    projectId: Type.String({ minLength: 1 }),
    assetId: Type.String({ minLength: 1 }),
})

const mediaUploadParams = Type.Object({
    projectId: Type.String({ minLength: 1 }),
    intentId: Type.String({ minLength: 1 }),
})

const reserveMediaUploadBody = Type.Object({
    originalFilename: Type.String({ minLength: 1, maxLength: 255 }),
    defaultAccessibilityText: Type.Optional(
        Type.Union([Type.String({ minLength: 1, maxLength: 10_000 }), Type.Null()])
    ),
    expectedSize: Type.Optional(Type.Integer({ minimum: 0 })),
    contentType: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
})

const mediaAssetSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    projectId: Type.String({ minLength: 1 }),
    originalFilename: Type.String({ minLength: 1 }),
    defaultAccessibilityText: Type.Union([Type.String(), Type.Null()]),
    state: Type.Union([
        Type.Literal('reserved'),
        Type.Literal('stored'),
        Type.Literal('inspecting'),
        Type.Literal('ready'),
        Type.Literal('failed'),
        Type.Literal('deletion_requested'),
        Type.Literal('deleted'),
    ]),
    archivedAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    deletionRequestedAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    deletedAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    failureCode: Type.Union([Type.String(), Type.Null()]),
    failureMessage: Type.Union([Type.String(), Type.Null()]),
    createdByActorId: Type.String({ minLength: 1 }),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})

const mediaRepresentationSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    projectId: Type.String({ minLength: 1 }),
    assetId: Type.String({ minLength: 1 }),
    kind: Type.Union([Type.Literal('original'), Type.Literal('derived')]),
    state: Type.Union([
        Type.Literal('reserved'),
        Type.Literal('stored'),
        Type.Literal('inspecting'),
        Type.Literal('ready'),
        Type.Literal('failed'),
        Type.Literal('deletion_requested'),
        Type.Literal('deleted'),
    ]),
    declaredContentType: Type.Union([Type.String(), Type.Null()]),
    detectedContentType: Type.Union([Type.String(), Type.Null()]),
    detectedFormat: Type.Union([Type.String(), Type.Null()]),
    family: Type.Union([
        Type.Literal('image'),
        Type.Literal('video'),
        Type.Literal('audio'),
        Type.Literal('document'),
        Type.Null(),
    ]),
    byteSize: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    sha256: Type.Union([Type.String(), Type.Null()]),
    width: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    height: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    durationMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    pageCount: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    isAnimated: Type.Union([Type.Boolean(), Type.Null()]),
    processorId: Type.Union([Type.String(), Type.Null()]),
    processorVersion: Type.Union([Type.String(), Type.Null()]),
    recipeJson: Type.Union([Type.String(), Type.Null()]),
    failureCode: Type.Union([Type.String(), Type.Null()]),
    failureMessage: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})

const mediaIntentSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    projectId: Type.String({ minLength: 1 }),
    assetId: Type.String({ minLength: 1 }),
    representationId: Type.String({ minLength: 1 }),
    state: Type.Union([
        Type.Literal('pending'),
        Type.Literal('uploading'),
        Type.Literal('uploaded'),
        Type.Literal('consumed'),
        Type.Literal('expired'),
        Type.Literal('failed'),
    ]),
    expectedSize: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    maxBytes: Type.Integer({ minimum: 1 }),
    contentTypeHint: Type.Union([Type.String(), Type.Null()]),
    expiresAt: Type.Integer({ minimum: 0 }),
    uploadStartedAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    completedAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    failureCode: Type.Union([Type.String(), Type.Null()]),
    failureMessage: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})

const mediaReferenceSchema = Type.Object({
    asset: mediaAssetSchema,
    representations: Type.Array(mediaRepresentationSchema),
})

const mediaListPageSchema = Type.Object({
    media: Type.Array(mediaReferenceSchema),
    restorableAssetIds: Type.Array(Type.String({ minLength: 1 })),
    nextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    total: Type.Integer({ minimum: 0 }),
    trashCount: Type.Integer({ minimum: 0 }),
    retentionMs: Type.Integer({ minimum: 0 }),
})

const mediaUploadPolicySchema = Type.Object({
    allowedContentTypes: Type.Array(Type.String({ minLength: 1 })),
    maxFileSize: Type.Integer({ minimum: 1 }),
})

const mediaImportSourceSchema = Type.Object({
    id: Type.Union([Type.Literal('device'), Type.Literal('webcam'), Type.Literal('url')]),
    transfer: Type.Union([Type.Literal('browser'), Type.Literal('server')]),
    requiresAuthentication: Type.Boolean(),
})

const mediaImportSourcesSchema = Type.Object({
    sources: Type.Array(mediaImportSourceSchema, { minItems: 1 }),
})

const mediaUrlImportBody = Type.Object({
    url: Type.String({ minLength: 1, maxLength: 2_048 }),
})

const mediaReservationSchema = Type.Object({
    asset: mediaAssetSchema,
    representation: mediaRepresentationSchema,
    intent: mediaIntentSchema,
    upload: Type.Object({
        intentId: Type.String({ minLength: 1 }),
        storeId: Type.String({ minLength: 1 }),
        maxBytes: Type.Integer({ minimum: 1 }),
        expectedSize: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        contentType: Type.Union([Type.String(), Type.Null()]),
    }),
})

const uploadedResponse = Type.Object({
    status: Type.Union([Type.Literal('uploaded'), Type.Literal('already_complete')]),
    media: mediaReservationSchema,
})

const pendingResponse = Type.Object({
    status: Type.Literal('pending'),
    media: mediaReservationSchema,
})

const finalizedResponse = Type.Object({
    status: Type.Union([Type.Literal('ready'), Type.Literal('failed')]),
    media: mediaReferenceSchema,
})

const mediaUrlImportResponse = Type.Union([finalizedResponse, pendingResponse])

const deletionResponse = Type.Object({
    status: Type.Literal('deletion_requested'),
    media: mediaReferenceSchema,
})

const restorationResponse = Type.Object({
    status: Type.Literal('restored'),
    media: mediaReferenceSchema,
})

const mediaDeletionBatchBody = Type.Object({
    assetIds: Type.Array(Type.String({ minLength: 1, maxLength: 255 }), {
        minItems: 1,
        maxItems: 1_000,
    }),
})

const mediaDeletionBatchItemSchema = Type.Object({
    assetId: Type.String({ minLength: 1 }),
    status: Type.Union([
        Type.Literal('deletion_requested'),
        Type.Literal('already_requested'),
        Type.Literal('blocked'),
        Type.Literal('not_found'),
    ]),
})

const mediaDeletionBatchResponse = Type.Object({
    deletions: Type.Array(mediaDeletionBatchItemSchema, { minItems: 1 }),
})

const mediaUsageLocationSchema = Type.Union([
    Type.Literal('source'),
    Type.Literal('draft'),
    Type.Literal('target'),
    Type.Literal('execution'),
])

const publicationStateSchema = Type.Union([
    Type.Literal('draft'),
    Type.Literal('scheduled'),
    Type.Literal('ready'),
    Type.Literal('publishing'),
    Type.Literal('published'),
    Type.Literal('failed'),
    Type.Literal('ambiguous'),
    Type.Literal('cancelled'),
])

const mediaUsageReferenceSchema = Type.Object({
    kind: Type.Union([Type.Literal('post'), Type.Literal('publication')]),
    id: Type.String({ minLength: 1 }),
    postId: Type.String({ minLength: 1 }),
    publicationId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    title: Type.Union([Type.String(), Type.Null()]),
    publicationState: Type.Union([publicationStateSchema, Type.Null()]),
    scheduledAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    channelName: Type.Union([Type.String(), Type.Null()]),
    locations: Type.Array(mediaUsageLocationSchema, { minItems: 1 }),
})

const mediaUsageSchema = Type.Object({
    assetId: Type.String({ minLength: 1 }),
    active: Type.Array(mediaUsageReferenceSchema),
    history: Type.Array(mediaUsageReferenceSchema),
    auditEventCount: Type.Integer({ minimum: 0 }),
})

export type MediaAssetResponse = Static<typeof mediaAssetSchema>
export type MediaRepresentationResponse = Static<typeof mediaRepresentationSchema>
export type MediaIntentResponse = Static<typeof mediaIntentSchema>
export type MediaReferenceResponse = Static<typeof mediaReferenceSchema>
export type MediaReservationResponse = Static<typeof mediaReservationSchema>
export type MediaUploadResponse = Static<typeof uploadedResponse>
export type MediaPendingResponse = Static<typeof pendingResponse>
export type MediaFinalizeResponse = Static<typeof finalizedResponse>
export type MediaDeletionResponse = Static<typeof deletionResponse>
export type MediaDeletionBatchResponse = Static<typeof mediaDeletionBatchResponse>
export type MediaAssetUsageResponse = Static<typeof mediaUsageSchema>
export type MediaUploadPolicyResponse = Static<typeof mediaUploadPolicySchema>
export type MediaImportSourceResponse = Static<typeof mediaImportSourceSchema>
export type MediaImportSourcesResponse = Static<typeof mediaImportSourcesSchema>
export type MediaUrlImportResponse = Static<typeof mediaUrlImportResponse>

export interface MediaRouteOptions {
    readonly urlImporter?: MediaUrlImporter
}

export function registerMediaRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    media: MediaAssetStore | undefined,
    access: AccessStore,
    options: MediaRouteOptions = {}
) {
    return app
        .post(
            '/api/projects/:projectId/media/uploads',
            {
                auth: true,
                params: mediaProjectParams,
                body: reserveMediaUploadBody,
                response: {
                    201: mediaReservationSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'reserveMediaUpload',
                    summary: 'Reserve a project media upload',
                    tags: ['Media'],
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (media === undefined) return status(503, mediaUnavailableError())
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
                const reservation = media.reserveUpload({
                    projectId: params.projectId,
                    subjectId: user.id,
                    originalFilename: body.originalFilename,
                    defaultAccessibilityText: body.defaultAccessibilityText,
                    expectedSize: body.expectedSize,
                    contentType: body.contentType,
                })
                if (reservation === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                return status(201, toReservationResponse(reservation))
            }
        )
        .put(
            '/api/projects/:projectId/media/uploads/:intentId',
            {
                auth: true,
                params: mediaUploadParams,
                response: {
                    200: uploadedResponse,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'uploadMedia',
                    summary: 'Stream bytes into a reserved media upload',
                    tags: ['Media'],
                },
            },
            async ({ authMethod, params, request, status, user }) => {
                if (media === undefined) return status(503, mediaUnavailableError())
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
                if (request.body === null) {
                    return status(400, {
                        error: {
                            code: 'invalid_input',
                            message: 'A media request body is required',
                        },
                    })
                }
                const result = await media.upload({
                    projectId: params.projectId,
                    subjectId: user.id,
                    intentId: params.intentId,
                    source: request.body as ReadableStream<Uint8Array>,
                })
                if (result.kind === 'not_found') {
                    return status(404, {
                        error: { code: 'not_found', message: 'Media upload not found' },
                    })
                }
                if (result.kind === 'expired') {
                    return status(409, {
                        error: {
                            code: 'upload_expired',
                            message: 'Media upload is no longer active',
                        },
                    })
                }
                if (result.kind === 'busy') {
                    return status(409, {
                        error: {
                            code: 'write_conflict',
                            message: 'Media upload is already in progress',
                        },
                    })
                }
                return {
                    status: result.kind,
                    media: toReservationResponse(result.reservation),
                }
            }
        )
        .post(
            '/api/projects/:projectId/media/uploads/:intentId/finalize',
            {
                auth: true,
                params: mediaUploadParams,
                response: {
                    200: finalizedResponse,
                    202: pendingResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'finalizeMediaUpload',
                    summary: 'Verify and finalize a project media upload',
                    tags: ['Media'],
                },
            },
            async ({ authMethod, params, status, user }) => {
                if (media === undefined) return status(503, mediaUnavailableError())
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
                const result = await media.finalizeUpload({
                    projectId: params.projectId,
                    subjectId: user.id,
                    intentId: params.intentId,
                })
                if (result.kind === 'not_found') {
                    return status(404, {
                        error: { code: 'not_found', message: 'Media upload not found' },
                    })
                }
                const mediaResponse = toMediaReferenceResponse(result.reservation)
                if (result.kind === 'pending') {
                    return status(202, {
                        status: 'pending',
                        media: toReservationResponse(result.reservation),
                    })
                }
                return { status: result.kind, media: mediaResponse }
            }
        )
        .post(
            '/api/projects/:projectId/media/imports/url',
            {
                auth: true,
                params: mediaProjectParams,
                body: mediaUrlImportBody,
                response: {
                    201: finalizedResponse,
                    202: pendingResponse,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    413: errorResponse,
                    415: errorResponse,
                    422: errorResponse,
                    502: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'importMediaFromUrl',
                    summary: 'Import a project media asset from a URL',
                    tags: ['Media'],
                },
            },
            async ({ authMethod, body, params, status, user }) => {
                if (media === undefined) return status(503, mediaUnavailableError())
                if (options.urlImporter === undefined) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Media URL import is not enabled' },
                    })
                }
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

                try {
                    const result = await options.urlImporter.importUrl({
                        projectId: params.projectId,
                        subjectId: user.id,
                        url: body.url,
                    })
                    if (result.kind === 'pending') {
                        return status(202, {
                            status: 'pending',
                            media: toReservationResponse(result.reservation),
                        })
                    }
                    if (result.kind === 'failed') {
                        return status(422, {
                            error: {
                                code:
                                    result.reservation.asset.failureCode ??
                                    'media_verification_failed',
                                message:
                                    result.reservation.asset.failureMessage ??
                                    'The imported media could not be verified',
                            },
                        })
                    }
                    return status(201, {
                        status: 'ready',
                        media: toMediaReferenceResponse(result.reservation),
                    })
                } catch (error) {
                    if (!(error instanceof MediaUrlImportError)) throw error
                    return status(error.status, {
                        error: { code: error.code, message: error.message },
                    })
                }
            }
        )
        .get(
            '/api/projects/:projectId/media/upload-policy',
            {
                auth: true,
                params: mediaProjectParams,
                response: {
                    200: mediaUploadPolicySchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'getProjectMediaUploadPolicy',
                    summary: 'Describe the project media upload policy',
                    tags: ['Media'],
                },
            },
            ({ params, status, user }) => {
                if (media === undefined) return status(503, mediaUnavailableError())
                const policy = media.getUploadPolicy(params.projectId, user.id)
                if (policy === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                return {
                    allowedContentTypes: [...policy.allowedContentTypes],
                    maxFileSize: policy.maxFileSize,
                }
            }
        )
        .get(
            '/api/projects/:projectId/media/sources',
            {
                auth: true,
                params: mediaProjectParams,
                response: {
                    200: mediaImportSourcesSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'getProjectMediaImportSources',
                    summary: 'List configured project media import sources',
                    tags: ['Media'],
                },
            },
            ({ params, status, user }) => {
                if (media === undefined) return status(503, mediaUnavailableError())
                if (media.getUploadPolicy(params.projectId, user.id) === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                const sources = Object.values(mediaImportSourceDefinitions).filter(
                    source => source.id !== 'url' || options.urlImporter !== undefined
                )
                return {
                    sources: sources.map(source => ({ ...source })),
                }
            }
        )
        .get(
            '/api/projects/:projectId/media',
            {
                auth: true,
                params: mediaProjectParams,
                query: mediaListQuery,
                response: {
                    200: mediaListPageSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'listProjectMedia',
                    summary: 'List project media assets',
                    tags: ['Media'],
                },
            },
            ({ params, query, status, user }) => {
                if (media === undefined) return status(503, mediaUnavailableError())
                const page = media.listAssetsPage({
                    projectId: params.projectId,
                    subjectId: user.id,
                    view: query.view,
                    cursor: query.cursor,
                    limit: query.limit,
                    search: query.search,
                    sort: query.sort,
                    family: query.family,
                    date: query.date,
                })
                if (page === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                return {
                    media: page.items.map(toMediaReferenceResponse),
                    restorableAssetIds: [...page.restorableAssetIds],
                    nextCursor: page.nextCursor,
                    total: page.total,
                    trashCount: page.trashCount,
                    retentionMs: page.retentionMs,
                }
            }
        )
        .get(
            '/api/projects/:projectId/media/:assetId/usage',
            {
                auth: true,
                params: mediaAssetParams,
                response: {
                    200: mediaUsageSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'getProjectMediaUsage',
                    summary: 'Describe project media usage',
                    tags: ['Media'],
                },
            },
            ({ params, status, user }) => {
                if (media === undefined) return status(503, mediaUnavailableError())
                const usage = media.getAssetUsage(params.projectId, params.assetId, user.id)
                if (usage === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Media asset not found' },
                    })
                }
                return toMediaUsageResponse(usage)
            }
        )
        .get(
            '/api/projects/:projectId/media/:assetId/content',
            {
                auth: true,
                params: mediaAssetParams,
                query: Type.Object({
                    variant: Type.Optional(
                        Type.Union([Type.Literal('thumbnail'), Type.Literal('preview')])
                    ),
                }),
                detail: {
                    operationId: 'streamProjectMedia',
                    summary: 'Stream verified media bytes for a project asset',
                    tags: ['Media'],
                    responses: {
                        206: { description: 'Authenticated byte range of media content' },
                        416: { description: 'The requested media byte range is not satisfiable' },
                        200: {
                            description: 'The verified media bytes',
                            content: {
                                'application/octet-stream': {
                                    schema: {
                                        type: 'string',
                                        format: 'binary',
                                    } as OpenAPIV3.SchemaObject,
                                },
                            },
                        },
                        401: {
                            description: 'Authentication required',
                            content: {
                                'application/json': {
                                    schema: errorResponse,
                                },
                            },
                        },
                        403: {
                            description: 'The API key does not allow this action',
                            content: {
                                'application/json': {
                                    schema: errorResponse,
                                },
                            },
                        },
                        404: {
                            description: 'Media content not found',
                            content: {
                                'application/json': {
                                    schema: errorResponse,
                                },
                            },
                        },
                        503: {
                            description: 'Media storage is not configured',
                            content: {
                                'application/json': {
                                    schema: errorResponse,
                                },
                            },
                        },
                    },
                },
            },
            async ({ params, status, user, request, query }) => {
                if (media === undefined) return status(503, mediaUnavailableError())
                const rangeHeader = request.headers.get('range')
                const reference = rangeHeader
                    ? media.getAsset(params.projectId, params.assetId, user.id)
                    : null
                const representation =
                    reference?.representations.find(
                        item =>
                            query.variant !== undefined &&
                            item.kind === 'derived' &&
                            item.processorId === 'postbot-image-preview' &&
                            item.processorVersion === '1' &&
                            ['ready', 'deletion_requested'].includes(item.state) &&
                            item.recipeJson !== null &&
                            JSON.parse(item.recipeJson).variant === query.variant
                    ) ??
                    reference?.representations.find(
                        item =>
                            item.kind === 'original' &&
                            ['ready', 'deletion_requested'].includes(item.state)
                    )
                const range =
                    rangeHeader &&
                    representation?.byteSize !== null &&
                    representation?.byteSize !== undefined
                        ? parseMediaByteRange(rangeHeader, representation.byteSize)
                        : undefined
                if (range === null)
                    return new Response(null, {
                        status: 416,
                        headers: {
                            'content-range': `bytes */${representation!.byteSize}`,
                            'cache-control': 'private, no-store',
                        },
                    })
                const content = await media.openAssetContent(
                    params.projectId,
                    params.assetId,
                    user.id,
                    range ?? undefined,
                    query.variant
                )
                if (content === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Media content not found' },
                    })
                }

                return new Response(content.stream, {
                    status: range ? 206 : 200,
                    headers: {
                        'cache-control': 'private, no-store',
                        'content-length': String(range ? range.end - range.start : content.size),
                        'accept-ranges': 'bytes',
                        ...(range
                            ? {
                                  'content-range': `bytes ${range.start}-${range.end - 1}/${content.size}`,
                              }
                            : {}),
                        'content-type': content.contentType,
                        etag: `"${content.sha256}"`,
                        'last-modified': content.lastModified.toUTCString(),
                    },
                })
            }
        )
        .get(
            '/api/projects/:projectId/media/:assetId',
            {
                auth: true,
                params: mediaAssetParams,
                response: {
                    200: mediaReferenceSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'getProjectMedia',
                    summary: 'Get project media metadata',
                    tags: ['Media'],
                },
            },
            ({ params, status, user }) => {
                if (media === undefined) return status(503, mediaUnavailableError())
                const mediaAsset = media.getAsset(params.projectId, params.assetId, user.id)
                if (mediaAsset === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Media asset not found' },
                    })
                }
                return toMediaReferenceResponse(mediaAsset)
            }
        )
        .post(
            '/api/projects/:projectId/media/deletion-requests',
            {
                auth: true,
                params: mediaProjectParams,
                body: mediaDeletionBatchBody,
                response: {
                    200: mediaDeletionBatchResponse,
                    401: errorResponse,
                    403: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'requestMediaDeletions',
                    summary: 'Archive project media assets for deletion',
                    tags: ['Media'],
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (media === undefined) return status(503, mediaUnavailableError())
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

                const deletions: MediaDeletionBatchResponse['deletions'] = []
                for (const assetId of new Set(body.assetIds)) {
                    const result = media.requestDeletion(params.projectId, assetId, user.id)
                    deletions.push({
                        assetId,
                        status: result.kind === 'requested' ? 'deletion_requested' : result.kind,
                    })
                }
                return { deletions }
            }
        )
        .delete(
            '/api/projects/:projectId/media/:assetId',
            {
                auth: true,
                params: mediaAssetParams,
                response: {
                    200: deletionResponse,
                    202: deletionResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'requestMediaDeletion',
                    summary: 'Archive a project media asset for deletion',
                    tags: ['Media'],
                },
            },
            ({ authMethod, params, status, user }) => {
                if (media === undefined) return status(503, mediaUnavailableError())
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
                const result = media.requestDeletion(params.projectId, params.assetId, user.id)
                if (result.kind === 'not_found') {
                    return status(404, {
                        error: { code: 'not_found', message: 'Media asset not found' },
                    })
                }
                if (result.kind === 'blocked') {
                    return status(409, {
                        error: {
                            code: 'media_in_use',
                            message: 'Media asset is still referenced by project content',
                        },
                    })
                }
                const response = {
                    status: 'deletion_requested' as const,
                    media: toMediaReferenceResponse(result.media),
                }
                return result.kind === 'requested' ? status(202, response) : response
            }
        )
        .post(
            '/api/projects/:projectId/media/:assetId/permanent',
            {
                auth: true,
                params: mediaAssetParams,
                response: {
                    200: Type.Object({ status: Type.Literal('deleted') }),
                    202: Type.Object({ status: Type.Literal('cleanup_pending') }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'permanentlyDeleteProjectMedia',
                    summary: 'Permanently delete a trashed project media asset',
                    tags: ['Media'],
                },
            },
            async ({ authMethod, params, status, user }) => {
                if (media === undefined) return status(503, mediaUnavailableError())
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

                const result = await media.permanentlyDeleteAsset(
                    params.projectId,
                    params.assetId,
                    user.id
                )
                if (result.kind === 'not_found') {
                    return status(404, {
                        error: {
                            code: 'not_found',
                            message: 'Media asset not found in the trash',
                        },
                    })
                }
                if (result.kind === 'blocked') {
                    const backupInProgress = result.reason === 'backup_in_progress'
                    return status(409, {
                        error: {
                            code: backupInProgress ? 'media_backup_in_progress' : 'media_in_use',
                            message: backupInProgress
                                ? 'Media cannot be permanently deleted while a backup is running'
                                : 'Media asset is still referenced by project content',
                        },
                    })
                }
                if (result.kind === 'cleanup_pending') {
                    return status(202, { status: 'cleanup_pending' as const })
                }
                return { status: 'deleted' as const }
            }
        )
        .post(
            '/api/projects/:projectId/media/:assetId/restore',
            {
                auth: true,
                params: mediaAssetParams,
                response: {
                    200: restorationResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    410: errorResponse,
                    503: errorResponse,
                },
                detail: {
                    operationId: 'restoreProjectMedia',
                    summary: 'Restore a project media asset from the trash',
                    tags: ['Media'],
                },
            },
            ({ authMethod, params, status, user }) => {
                if (media === undefined) return status(503, mediaUnavailableError())
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

                const result = media.restoreDeletion(params.projectId, params.assetId, user.id)
                if (result.kind === 'not_found') {
                    return status(404, {
                        error: { code: 'not_found', message: 'Media asset not found in the trash' },
                    })
                }
                if (result.kind === 'expired') {
                    return status(410, {
                        error: {
                            code: 'media_deletion_expired',
                            message: 'The media retention period has expired',
                        },
                    })
                }
                if (result.kind === 'not_restorable') {
                    return status(409, {
                        error: {
                            code: 'media_not_restorable',
                            message: 'This media asset cannot be restored',
                        },
                    })
                }
                return {
                    status: 'restored' as const,
                    media: toMediaReferenceResponse(result.media),
                }
            }
        )
}

function mediaUnavailableError() {
    return {
        error: {
            code: 'media_unavailable',
            message: 'Media storage is not configured for this instance',
        },
    } as const
}

type MediaReservation = NonNullable<ReturnType<MediaAssetStore['reserveUpload']>>
type MediaReference = NonNullable<ReturnType<MediaAssetStore['getAsset']>>
type MediaAssetUsage = NonNullable<ReturnType<MediaAssetStore['getAssetUsage']>>

function toMediaUsageResponse(usage: MediaAssetUsage): MediaAssetUsageResponse {
    return {
        assetId: usage.assetId,
        active: usage.active.map(reference => ({
            ...reference,
            locations: [...reference.locations],
        })),
        history: usage.history.map(reference => ({
            ...reference,
            locations: [...reference.locations],
        })),
        auditEventCount: usage.auditEventCount,
    }
}

function toReservationResponse(reservation: MediaReservation) {
    return {
        asset: reservation.asset,
        representation: toRepresentationResponse(reservation.representation),
        intent: reservation.intent,
        upload: {
            intentId: reservation.intent.id,
            storeId: reservation.upload.storeId,
            maxBytes: reservation.upload.maxBytes,
            expectedSize: reservation.upload.expectedSize,
            contentType: reservation.upload.contentType,
        },
    }
}

function toMediaReferenceResponse(reservation: MediaReference | MediaReservation) {
    const representations =
        'representations' in reservation
            ? reservation.representations
            : [reservation.representation]
    return {
        asset: reservation.asset,
        representations: representations.map(toRepresentationResponse),
    }
}

function toRepresentationResponse(
    representation: MediaReservation['representation']
): Omit<MediaReservation['representation'], 'objectKey'> {
    return {
        id: representation.id,
        projectId: representation.projectId,
        assetId: representation.assetId,
        kind: representation.kind,
        sourceRepresentationId: representation.sourceRepresentationId,
        state: representation.state,
        storeId: representation.storeId,
        declaredContentType: representation.declaredContentType,
        detectedContentType: representation.detectedContentType,
        detectedFormat: representation.detectedFormat,
        family: representation.family,
        byteSize: representation.byteSize,
        sha256: representation.sha256,
        width: representation.width,
        height: representation.height,
        durationMs: representation.durationMs,
        pageCount: representation.pageCount,
        isAnimated: representation.isAnimated,
        processorId: representation.processorId,
        processorVersion: representation.processorVersion,
        recipeJson: representation.recipeJson,
        failureCode: representation.failureCode,
        failureMessage: representation.failureMessage,
        createdAt: representation.createdAt,
        updatedAt: representation.updatedAt,
    }
}
