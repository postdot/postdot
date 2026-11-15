import type { OpenAPIV3 } from 'openapi-types'

import { errorResponse } from '../projects/models'
import type { AuthenticatedElysia } from '../projects/types'
import { type IdentityImageRoutesOptions, identityImageParams } from './shared'

export function registerDownloadIdentityRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    options: IdentityImageRoutesOptions
) {
    const { identityImages, access } = options
    return app.get(
        '/api/identity-images/:sha256',
        {
            auth: true,
            params: identityImageParams,
            detail: {
                operationId: 'getIdentityImage',
                summary: 'Read a processed identity image by content hash',
                tags: ['Media'],
                responses: {
                    200: {
                        description: 'Processed square WebP identity image',
                        content: {
                            'image/webp': {
                                schema: {
                                    type: 'string',
                                    format: 'binary',
                                } as OpenAPIV3.SchemaObject,
                            },
                        },
                    },
                    401: {
                        description: 'Authentication required',
                        content: { 'application/json': { schema: errorResponse } },
                    },
                    403: {
                        description: 'The API key does not allow this action',
                        content: { 'application/json': { schema: errorResponse } },
                    },
                    404: {
                        description: 'Identity image not found',
                        content: { 'application/json': { schema: errorResponse } },
                    },
                },
            },
        },
        async ({ params, status, user, authMethod, apiKeyProjectIds }) => {
            const references = await identityImages.references(params.sha256)
            let allowed = false
            for (const reference of references) {
                if (
                    reference.projectId &&
                    (authMethod !== 'user_api_key' ||
                        apiKeyProjectIds == null ||
                        apiKeyProjectIds.includes(reference.projectId)) &&
                    (await access.canAccessProject(reference.projectId, user.id))
                )
                    allowed = true
                if (
                    reference.workspaceId &&
                    (authMethod !== 'user_api_key' || apiKeyProjectIds == null) &&
                    (await (reference.channelId
                        ? access.canManageWorkspace(reference.workspaceId, user.id)
                        : access.canAccessWorkspace(reference.workspaceId, user.id)))
                )
                    allowed = true
                if (allowed) break
            }
            const stored = allowed ? await identityImages.open(params.sha256) : null
            if (stored === null) {
                return status(404, {
                    error: { code: 'not_found', message: 'Identity image not found' },
                })
            }
            return new Response(new Uint8Array(stored.bytes), {
                headers: {
                    'content-type': stored.contentType,
                    'cache-control': 'private, max-age=31536000, immutable',
                    vary: 'Cookie, Authorization',
                    'x-content-type-options': 'nosniff',
                    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
                },
            })
        }
    )
}
