import { Type } from 'typebox'
export const linkedInConnectionSchema = Type.Object({
    provider: Type.Literal('linkedin'),
    scopes: Type.Array(Type.String({ minLength: 1 })),
    authorizationUrl: Type.String({ minLength: 1 }),
})

export const linkedInConnectionBody = Type.Object({
    providerApplicationId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    destination: Type.Optional(
        Type.Union([
            Type.Object({ type: Type.Literal('member') }),
            Type.Object({
                type: Type.Literal('organization'),
                id: Type.String({ minLength: 1, maxLength: 64 }),
            }),
        ])
    ),
})
