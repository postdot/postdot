import type { MediaAssetStore } from '@herald/db'
import type { OpenAPIV3 } from 'openapi-types'
import { Type } from 'typebox'

import type { AuthenticatedElysia } from '../../plugins/auth'
import { errorResponse } from '../projects/models'

const mediaProjectParams = Type.Object({
    projectId: Type.String({ minLength: 1 }),
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

const deletionResponse = Type.Object({
    status: Type.Literal('deletion_requested'),
    media: mediaReferenceSchema,
})

export function registerMediaRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    media: MediaAssetStore
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
                    404: errorResponse,
                },
                detail: {
                    operationId: 'reserveMediaUpload',
                    summary: 'Reserve a project media upload',
                    tags: ['Media'],
                },
            },
            ({ body, params, status, user }) => {
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
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'uploadMedia',
                    summary: 'Stream bytes into a reserved media upload',
                    tags: ['Media'],
                },
            },
            async ({ params, request, status, user }) => {
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
                    404: errorResponse,
                },
                detail: {
                    operationId: 'finalizeMediaUpload',
                    summary: 'Verify and finalize a project media upload',
                    tags: ['Media'],
                },
            },
            async ({ params, status, user }) => {
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
        .get(
            '/api/projects/:projectId/media',
            {
                auth: true,
                params: mediaProjectParams,
                response: {
                    200: Type.Object({ media: Type.Array(mediaReferenceSchema) }),
                    404: errorResponse,
                },
                detail: {
                    operationId: 'listProjectMedia',
                    summary: 'List project media assets',
                    tags: ['Media'],
                },
            },
            ({ params, status, user }) => {
                const mediaAssets = media.listAssets(params.projectId, user.id)
                if (mediaAssets === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                return { media: mediaAssets.map(toMediaReferenceResponse) }
            }
        )
        .get(
            '/api/projects/:projectId/media/:assetId/content',
            {
                auth: true,
                params: mediaAssetParams,
                detail: {
                    operationId: 'streamProjectMedia',
                    summary: 'Stream verified media bytes for a project asset',
                    tags: ['Media'],
                    responses: {
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
                        404: {
                            description: 'Media content not found',
                            content: {
                                'application/json': {
                                    schema: errorResponse,
                                },
                            },
                        },
                    },
                },
            },
            async ({ params, status, user }) => {
                const content = await media.openAssetContent(
                    params.projectId,
                    params.assetId,
                    user.id
                )
                if (content === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Media content not found' },
                    })
                }

                return new Response(content.stream, {
                    headers: {
                        'cache-control': 'private, no-store',
                        'content-length': String(content.size),
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
                    404: errorResponse,
                },
                detail: {
                    operationId: 'getProjectMedia',
                    summary: 'Get project media metadata',
                    tags: ['Media'],
                },
            },
            ({ params, status, user }) => {
                const mediaAsset = media.getAsset(params.projectId, params.assetId, user.id)
                if (mediaAsset === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Media asset not found' },
                    })
                }
                return toMediaReferenceResponse(mediaAsset)
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
                    404: errorResponse,
                },
                detail: {
                    operationId: 'requestMediaDeletion',
                    summary: 'Archive a project media asset for deletion',
                    tags: ['Media'],
                },
            },
            ({ params, status, user }) => {
                const result = media.requestDeletion(params.projectId, params.assetId, user.id)
                if (result.kind === 'not_found') {
                    return status(404, {
                        error: { code: 'not_found', message: 'Media asset not found' },
                    })
                }
                const response = {
                    status: 'deletion_requested' as const,
                    media: toMediaReferenceResponse(result.media),
                }
                return result.kind === 'requested' ? status(202, response) : response
            }
        )
}

type MediaReservation = NonNullable<ReturnType<MediaAssetStore['reserveUpload']>>
type MediaReference = NonNullable<ReturnType<MediaAssetStore['getAsset']>>

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
