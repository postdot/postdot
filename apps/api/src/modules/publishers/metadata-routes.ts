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
    const app = new Elysia({ name: 'herald-bluesky-client-metadata' })
    const bluesky = publisher.bluesky
    if (bluesky === undefined) return app

    return app.get(
        '/oauth/bluesky/client-metadata.json',
        {
            response: blueskyClientMetadataSchema,
            detail: {
                operationId: 'getBlueskyClientMetadata',
                summary: 'Get the public Bluesky OAuth client metadata',
                tags: ['Channels'],
                security: [],
            },
        },
        () => bluesky.clientMetadata as Static<typeof blueskyClientMetadataSchema>
    )
}
