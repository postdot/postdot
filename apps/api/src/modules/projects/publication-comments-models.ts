import { Type, type Static } from 'typebox'

const nullableText = Type.Union([Type.String(), Type.Null()])
export const commentFailureSchema = Type.Union([
    Type.Literal('blocked'),
    Type.Literal('disabled'),
    Type.Literal('invalid_response'),
    Type.Literal('not_authorized'),
    Type.Literal('not_found'),
    Type.Literal('not_supported'),
    Type.Literal('partial_response'),
    Type.Literal('rate_limited'),
    Type.Literal('temporarily_unavailable'),
])
export const publicationCommentSnapshotSchema = Type.Object({
    fetchedAt: Type.Integer({ minimum: 0 }),
    rootUri: Type.String(),
    availability: Type.Union([Type.Literal('available'), commentFailureSchema]),
    truncated: Type.Boolean(),
    comments: Type.Array(
        Type.Object({
            id: Type.String(),
            parentUri: nullableText,
            depth: Type.Integer({ minimum: 0, maximum: 6 }),
            availability: Type.Union([
                Type.Literal('available'),
                Type.Literal('blocked'),
                Type.Literal('not_found'),
                Type.Literal('invalid_response'),
            ]),
            authorDid: nullableText,
            authorHandle: nullableText,
            text: nullableText,
            createdAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
            externalUrl: nullableText,
        }),
        { maxItems: 100 }
    ),
})
export const publicationCommentsResponseSchema = Type.Object({
    publicationId: Type.String(),
    provider: Type.Union([Type.Literal('bluesky'), Type.Literal('mastodon')]),
    snapshot: Type.Union([publicationCommentSnapshotSchema, Type.Null()]),
    lastAttemptAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    lastError: Type.Union([commentFailureSchema, Type.Null()]),
})
export type PublicationCommentsResponse = Static<typeof publicationCommentsResponseSchema>
