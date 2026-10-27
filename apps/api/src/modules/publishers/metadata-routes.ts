import { Elysia } from 'elysia'
import { Type, type Static } from 'typebox'

import type { PublisherRuntime } from './runtime'

const blueskyClientMetadataSchema = Type.Object({
    client_id: Type.String({ minLength: 1 }),
    client_name: Type.String({ minLength: 1 }),
    client_uri: Type.String({ minLength: 1 }),
    redirect_uris: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    scope: Type.String({ minLength: 1 }),
    grant_types: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    response_types: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    token_endpoint_auth_method: Type.Literal('none'),
    application_type: Type.Literal('web'),
    dpop_bound_access_tokens: Type.Literal(true),
})

export function createBlueskyMetadataRoutes(publisher: PublisherRuntime) {
    const app = new Elysia({ name: 'postdot-bluesky-client-metadata' })

    return app.get(
        '/oauth/bluesky/client-metadata.json',
        {
            response: {
                200: blueskyClientMetadataSchema,
                404: Type.Object({
                    error: Type.Object({
                        code: Type.Literal('not_found'),
                        message: Type.String({ minLength: 1 }),
                    }),
                }),
            },
            detail: {
                operationId: 'getBlueskyClientMetadata',
                summary: 'Get the public Bluesky OAuth client metadata',
                tags: ['Channels'],
                security: [],
            },
        },
        async ({ status }) => {
            try {
                const bluesky = await publisher.resolveBlueskyApplication()
                if (bluesky === undefined) {
                    return status(404, {
                        error: {
                            code: 'not_found',
                            message: 'Bluesky provider application is not configured',
                        },
                    })
                }
                if (bluesky.oauthMode === 'loopback') {
                    return status(404, {
                        error: {
                            code: 'not_found',
                            message:
                                'The configured Bluesky application uses local loopback OAuth and has no public metadata document',
                        },
                    })
                }
                return bluesky.clientMetadata as Static<typeof blueskyClientMetadataSchema>
            } catch {
                return status(404, {
                    error: {
                        code: 'not_found',
                        message: 'Bluesky provider application is not configured',
                    },
                })
            }
        }
    )
}
