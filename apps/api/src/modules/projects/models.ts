import { createManualChannelProfile, sourceContentSchema } from '@herald/core'
import type { ChannelProfileDefinition } from '@herald/core'
import { auditEvents, channels, posts, projects, publications } from '@herald/db/schema'
import { linkedinTextChannelProfile } from '@herald/linkedin'
import type { Table } from 'drizzle-orm'
import { createSchemaFactory } from 'drizzle-typebox'
import { Type, type Static, type TProperties, type TSchema } from 'typebox'

const { createSelectSchema: createDrizzleSelectSchema } = createSchemaFactory({
    typeboxInstance: Type,
})

function createElysiaSelectSchema<const TableType extends Table>(table: TableType) {
    const generated = createDrizzleSelectSchema(table) as unknown as {
        properties: Record<string, TSchema>
    }
    const schema = Type.Object(generated.properties as TProperties)
    return Type.Unsafe<TableType['$inferSelect']>(schema)
}

export const projectSchema = createElysiaSelectSchema(projects)
export const channelSchema = Type.Intersect([
    createElysiaSelectSchema(channels),
    Type.Object({ profileId: Type.String({ minLength: 1 }) }),
])
export const postSchema = createElysiaSelectSchema(posts)
export const publicationSchema = createElysiaSelectSchema(publications)
export const auditEventSchema = createElysiaSelectSchema(auditEvents)

export const duePublicationSchema = Type.Intersect([
    publicationSchema,
    Type.Object({
        postTitle: Type.Union([Type.String(), Type.Null()]),
        channelName: Type.String(),
        targetContent: Type.Record(Type.String(), Type.Unknown()),
    }),
])

export type ProjectResponse = Static<typeof projectSchema>
export type ChannelResponse = Static<typeof channelSchema>
export type PostResponse = Static<typeof postSchema>
export type PublicationResponse = Static<typeof publicationSchema>
export type DuePublicationResponse = Static<typeof duePublicationSchema>
export type AuditEventResponse = Static<typeof auditEventSchema>

export const projectParams = Type.Object({
    projectId: Type.String({ minLength: 1 }),
})

export const publicationParams = Type.Object({
    projectId: Type.String({ minLength: 1 }),
    publicationId: Type.String({ minLength: 1 }),
})

export const channelParams = Type.Object({
    projectId: Type.String({ minLength: 1 }),
    channelId: Type.String({ minLength: 1 }),
})

export const createProjectBody = Type.Object({
    name: Type.String({ minLength: 1 }),
})

export const createChannelBody = Type.Object({
    name: Type.String({ minLength: 1 }),
    profile: Type.Optional(
        Type.Union([
            Type.Literal('manual-message'),
            Type.Literal('linkedin'),
            Type.Object({
                id: Type.String({ minLength: 1 }),
                version: Type.Integer({ minimum: 1 }),
                profileHash: Type.String({ minLength: 1 }),
                schemaHash: Type.String({ minLength: 1 }),
                origin: Type.Literal('custom'),
                contentSchema: Type.Unknown(),
                fieldBindings: Type.Unknown(),
                capabilities: Type.Unknown(),
                execution: Type.Unknown(),
            }),
        ])
    ),
})

export const createPostBody = Type.Object({
    title: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
    sourceContent: sourceContentSchema,
    publications: Type.Array(
        Type.Object({
            channelId: Type.String({ minLength: 1 }),
            targetContent: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
            deliveryMode: Type.Union([Type.Literal('manual'), Type.Literal('automatic')]),
            scheduledAt: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
        }),
        { minItems: 1 }
    ),
})

export function resolveChannelProfile(profile: unknown): ChannelProfileDefinition {
    if (profile === 'linkedin') return linkedinTextChannelProfile
    if (profile === undefined || profile === 'manual-message') {
        return createManualChannelProfile()
    }
    return profile as ChannelProfileDefinition
}

export const publishPublicationBody = Type.Object({
    externalId: Type.Optional(Type.String({ minLength: 1 })),
    externalUrl: Type.Optional(Type.String({ minLength: 1 })),
})

export const reconcilePublicationBody = Type.Object({
    resolution: Type.Union([Type.Literal('published'), Type.Literal('failed')]),
    externalId: Type.Optional(Type.String({ minLength: 1 })),
    externalUrl: Type.Optional(Type.String({ minLength: 1 })),
    errorMessage: Type.Optional(Type.String({ minLength: 1 })),
})

export const publisherConnectionSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    projectId: Type.String({ minLength: 1 }),
    publisherId: Type.String({ minLength: 1 }),
    channelId: Type.String({ minLength: 1 }),
    kind: Type.String({ minLength: 1 }),
    credentialId: Type.String({ minLength: 1 }),
    providerId: Type.String({ minLength: 1 }),
    externalAccountId: Type.String({ minLength: 1 }),
    externalAccountName: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    scopes: Type.Array(Type.String({ minLength: 1 })),
    state: Type.Union([
        Type.Literal('active'),
        Type.Literal('reconnect_required'),
        Type.Literal('revoked'),
    ]),
    connectedByActorId: Type.String({ minLength: 1 }),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})

export type PublisherConnectionResponse = Static<typeof publisherConnectionSchema>

export const linkedInConnectionSchema = Type.Object({
    provider: Type.Literal('linkedin'),
    scopes: Type.Array(Type.String({ minLength: 1 })),
    authorizationUrl: Type.String({ minLength: 1 }),
})

export const publisherConnectionsSchema = Type.Object({
    connections: Type.Array(publisherConnectionSchema),
})

export const publisherDisconnectedSchema = Type.Object({
    disconnected: Type.Literal(true),
})

export type PublisherConnectionsResponse = Static<typeof publisherConnectionsSchema>

export const errorResponse = Type.Object({
    error: Type.Object({
        code: Type.String(),
        message: Type.String(),
    }),
})
