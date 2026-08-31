import { createManualChannelProfile, sourceContentSchema } from '@herald/core'
import type { ChannelProfileDefinition, Publication } from '@herald/core'
import type { ChannelProfileImpactAssessment } from '@herald/core'
import type {
    ChannelProfileActivationResult,
    ChannelProfileState,
    ChannelProfileVersion,
} from '@herald/db'
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
const publicationPersistenceSchema = createElysiaSelectSchema(publications)
export const publicationSchema = Type.Unsafe<Publication>(
    Type.Intersect([
        Type.Omit(publicationPersistenceSchema, ['profileAssessmentIssuesJson']),
        Type.Object({
            profileAssessmentIssues: Type.Unsafe<readonly Record<string, unknown>[]>(
                Type.Array(Type.Record(Type.String(), Type.Unknown()))
            ),
        }),
    ])
)
export const auditEventSchema = createElysiaSelectSchema(auditEvents)

const profileVersionStateSchema = Type.Union([
    Type.Literal('draft'),
    Type.Literal('active'),
    Type.Literal('superseded'),
    Type.Literal('disabled'),
])

const validationIssueSchema = Type.Object({
    path: Type.String(),
    code: Type.String(),
    message: Type.String(),
    severity: Type.Union([Type.Literal('error'), Type.Literal('warning')]),
    source: Type.Union([
        Type.Literal('schema'),
        Type.Literal('schema_policy'),
        Type.Literal('field_binding'),
        Type.Literal('capability'),
        Type.Literal('domain'),
        Type.Literal('module'),
    ]),
})

export const channelProfileVersionSchema = Type.Unsafe<ChannelProfileVersion>(
    Type.Object({
        id: Type.String({ minLength: 1 }),
        projectId: Type.String({ minLength: 1 }),
        channelId: Type.String({ minLength: 1 }),
        profileId: Type.String({ minLength: 1 }),
        version: Type.Integer({ minimum: 1 }),
        origin: Type.Union([Type.Literal('built_in'), Type.Literal('custom')]),
        state: profileVersionStateSchema,
        revision: Type.Integer({ minimum: 1 }),
        profile: Type.Record(Type.String(), Type.Unknown()),
        createdByActorId: Type.String({ minLength: 1 }),
        createdAt: Type.Integer({ minimum: 0 }),
        updatedAt: Type.Integer({ minimum: 0 }),
    })
)

const channelProfileImpactSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    kind: Type.Union([Type.Literal('working_draft'), Type.Literal('pending_target')]),
    state: Type.Union([Type.Literal('compatible'), Type.Literal('review_required')]),
    issues: Type.Array(validationIssueSchema),
})

export const channelProfileAssessmentSchema = Type.Unsafe<ChannelProfileImpactAssessment>(
    Type.Object({
        currentProfileVersion: Type.Integer({ minimum: 1 }),
        proposedProfileVersion: Type.Integer({ minimum: 1 }),
        changes: Type.Array(
            Type.Object({
                kind: Type.Union([
                    Type.Literal('schema'),
                    Type.Literal('binding'),
                    Type.Literal('capability'),
                    Type.Literal('execution'),
                ]),
                path: Type.String(),
                code: Type.String(),
                message: Type.String(),
            })
        ),
        workingDrafts: Type.Array(channelProfileImpactSchema),
        pendingTargets: Type.Array(channelProfileImpactSchema),
        hasReviewRequired: Type.Boolean(),
    })
)

export const channelProfileStateSchema = Type.Unsafe<ChannelProfileState>(
    Type.Object({
        channel: channelSchema,
        active: channelProfileVersionSchema,
        draft: Type.Union([channelProfileVersionSchema, Type.Null()]),
    })
)

export const channelProfileActivationSchema = Type.Unsafe<ChannelProfileActivationResult>(
    Type.Object({
        channel: channelSchema,
        profile: channelProfileVersionSchema,
        assessment: channelProfileAssessmentSchema,
    })
)

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
export type ChannelProfileVersionResponse = Static<typeof channelProfileVersionSchema>
export type ChannelProfileStateResponse = Static<typeof channelProfileStateSchema>
export type ChannelProfileAssessmentResponse = Static<typeof channelProfileAssessmentSchema>
export type ChannelProfileActivationResponse = Static<typeof channelProfileActivationSchema>
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

export const channelProfileVersionParams = Type.Object({
    projectId: Type.String({ minLength: 1 }),
    channelId: Type.String({ minLength: 1 }),
    profileVersionId: Type.String({ minLength: 1 }),
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

export const saveChannelProfileDraftBody = Type.Object({
    profile: Type.Record(Type.String(), Type.Unknown()),
    expectedRevision: Type.Optional(Type.Integer({ minimum: 0 })),
})

export const activateChannelProfileBody = Type.Object({
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
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
    endpointUrl: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    authentication: Type.Union([
        Type.Object({ kind: Type.Literal('none') }),
        Type.Object({ kind: Type.Literal('bearer') }),
        Type.Object({
            kind: Type.Literal('header'),
            headerName: Type.String({ minLength: 1 }),
        }),
        Type.Null(),
    ]),
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

export const customHttpConnectionBody = Type.Object({
    endpointUrl: Type.String({ minLength: 1, maxLength: 2_048 }),
    authentication: Type.Union([
        Type.Object({ kind: Type.Literal('none') }),
        Type.Object({ kind: Type.Literal('bearer') }),
        Type.Object({
            kind: Type.Literal('header'),
            headerName: Type.String({ minLength: 1, maxLength: 128 }),
        }),
    ]),
    externalAccountName: Type.Optional(
        Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()])
    ),
    secret: Type.String({ minLength: 32, maxLength: 4_096, writeOnly: true }),
})

export const customHttpConnectionResponse = Type.Object({
    connection: publisherConnectionSchema,
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
