import { Type } from 'typebox'
export const mastodonConnectionSchema = Type.Object({
    provider: Type.Literal('mastodon'),
    scopes: Type.Array(Type.String({ minLength: 1 })),
    authorizationUrl: Type.String({ minLength: 1 }),
})

export const mastodonConnectionBody = Type.Object({
    instanceUrl: Type.String({ minLength: 1, maxLength: 2_048 }),
})
