import { Type } from 'typebox'

export const workspaceSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    slug: Type.String({ minLength: 1 }),
    isDefault: Type.Boolean(),
    websiteUrl: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    imageUrl: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    imageSource: Type.Union([
        Type.Literal('upload'),
        Type.Literal('url'),
        Type.Literal('favicon'),
        Type.Null(),
    ]),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})
