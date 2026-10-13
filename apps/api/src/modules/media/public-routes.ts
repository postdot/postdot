import type { MediaAssetStore } from '@postbot/db'
import { MediaStoreError } from '@postbot/media'
import { Elysia } from 'elysia'
import type { OpenAPIV3 } from 'openapi-types'
import { Type } from 'typebox'

import { errorResponse } from '../projects/models'
import type { MediaPublicDelivery } from './public-delivery'

const publicMediaParams = Type.Object({
    token: Type.String({ minLength: 1 }),
})

export function createPublicMediaRoutes(media: MediaAssetStore, delivery: MediaPublicDelivery) {
    return new Elysia({ name: 'postbot-public-media' }).get(
        '/api/media/public/:token',
        {
            params: publicMediaParams,
            detail: {
                operationId: 'streamPublicMedia',
                summary: 'Stream media through a short-lived signed URL',
                tags: ['Media'],
                security: [],
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
                        description: 'The signed media URL is invalid or unavailable',
                        content: {
                            'application/json': {
                                schema: errorResponse,
                            },
                        },
                    },
                    503: {
                        description: 'Media storage is temporarily unavailable',
                        content: {
                            'application/json': {
                                schema: errorResponse,
                            },
                        },
                    },
                },
            },
        },
        async ({ params, status }) => {
            const claims = delivery.resolve(params.token)
            if (claims === null) return publicMediaNotFound(status)

            try {
                const content = await media.openPublicRepresentationContent(
                    claims.projectId,
                    claims.assetId,
                    claims.representationId
                )
                if (content === null) return publicMediaNotFound(status)

                return new Response(content.stream, {
                    headers: {
                        'cache-control': 'private, no-store',
                        'content-length': String(content.size),
                        'content-type': content.contentType,
                        etag: `"${content.sha256}"`,
                        'last-modified': content.lastModified.toUTCString(),
                        'referrer-policy': 'no-referrer',
                        'x-content-type-options': 'nosniff',
                    },
                })
            } catch (error) {
                if (error instanceof MediaStoreError) {
                    return status(503, {
                        error: {
                            code: 'media_storage_unavailable',
                            message: 'Media storage is temporarily unavailable',
                        },
                    })
                }
                throw error
            }
        }
    )
}

function publicMediaNotFound(
    status: (
        code: 404,
        response: { readonly error: { readonly code: string; readonly message: string } }
    ) => unknown
) {
    return status(404, {
        error: {
            code: 'not_found',
            message: 'Media content not found',
        },
    })
}
