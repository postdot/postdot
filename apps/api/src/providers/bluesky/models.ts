import { Type } from 'typebox'
export const blueskyConnectionSchema = Type.Object({
    provider: Type.Literal('bluesky'),
    scopes: Type.Array(Type.String({ minLength: 1 })),
    authorizationUrl: Type.String({ minLength: 1 }),
})

export const blueskyConnectionBody = Type.Object({
    handle: Type.String({ minLength: 1, maxLength: 253 }),
    providerApplicationId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
})
