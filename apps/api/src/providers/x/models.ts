import { Type } from 'typebox'
export const xConnectionSchema = Type.Object({
    provider: Type.Literal('x'),
    scopes: Type.Array(Type.String({ minLength: 1 })),
    authorizationUrl: Type.String({ minLength: 1 }),
})

export const xConnectionBody = Type.Object({
    providerApplicationId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
})
