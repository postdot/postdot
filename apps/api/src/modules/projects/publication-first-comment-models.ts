import { Type, type Static } from 'typebox'

import { providerCommentIds } from '../../providers/registry'

const nullableText = Type.Union([Type.String(), Type.Null()])
const nullableTime = Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])
export const publicationFirstCommentItemSchema = Type.Object({
    id: Type.String(),
    text: Type.String(),
    delaySeconds: Type.Integer({ minimum: 0, maximum: 604800 }),
    state: Type.Union([
        Type.Literal('waiting'),
        Type.Literal('pending'),
        Type.Literal('running'),
        Type.Literal('suspended'),
        Type.Literal('sent'),
        Type.Literal('failed'),
        Type.Literal('ambiguous'),
        Type.Literal('cancelled'),
    ]),
    revision: Type.Integer({ minimum: 1 }),
    dueAt: nullableTime,
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
    externalUrl: nullableText,
    lastError: nullableText,
    authorName: Type.String(),
})
export const publicationFirstCommentResponseSchema = Type.Object({
    providerId: Type.Enum(providerCommentIds),
    textLimit: Type.Integer({ minimum: 1, maximum: 3000 }),
    instanceOrigin: nullableText,
    firstComment: Type.Union([publicationFirstCommentItemSchema, Type.Null()]),
    canConfigure: Type.Boolean(),
    canManage: Type.Boolean(),
})
export const publicationFirstCommentSaveSchema = Type.Object({
    text: Type.String({ minLength: 1, maxLength: 3000 }),
    delaySeconds: Type.Integer({ minimum: 0, maximum: 604800 }),
    expectedRevision: Type.Integer({ minimum: 0 }),
})
export const publicationFirstCommentCancelSchema = Type.Object({
    expectedRevision: Type.Integer({ minimum: 1 }),
})
export type PublicationFirstCommentResponse = Static<typeof publicationFirstCommentResponseSchema>
export type PublicationFirstCommentItem = Static<typeof publicationFirstCommentItemSchema>
export type PublicationFirstCommentSave = Static<typeof publicationFirstCommentSaveSchema>
