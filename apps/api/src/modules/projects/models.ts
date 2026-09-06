import { blueskyChannelProfile } from '@herald/bluesky'
import { createManualChannelProfile, sourceContentSchema } from '@herald/core'
import type { ChannelProfileDefinition, Publication } from '@herald/core'
import type { ChannelProfileImpactAssessment } from '@herald/core'
import type {
    ChannelProfileActivationResult,
    ChannelProfileState,
    ChannelProfileVersion,
    AuditEvent,
    PublicationEditorState,
    PublicationSummary,
    PublicationTargetRevision,
    PublicationWorkingDraft,
} from '@herald/db'
import { auditEvents, channels, posts, projects, publications } from '@herald/db/schema'
import { discordChannelProfile } from '@herald/discord'
import { linkedinChannelProfile } from '@herald/linkedin'
import { mastodonChannelProfile } from '@herald/mastodon'
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
const auditEventPersistenceSchema = createElysiaSelectSchema(auditEvents)
export const auditEventSchema = Type.Unsafe<AuditEvent>(
    Type.Pick(auditEventPersistenceSchema, [
        'id',
        'projectId',
        'actorId',
        'action',
        'entityType',
        'entityId',
        'metadataJson',
        'createdAt',
    ])
)

export const projectAccessTokenSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    projectId: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    tokenPrefix: Type.String({ minLength: 1 }),
    expiresAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    revokedAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})

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

const channelLifecycleBlockerSchema = Type.Union([
    Type.Literal('active_work'),
    Type.Literal('pending_authorization'),
    Type.Literal('publications'),
    Type.Literal('publisher'),
    Type.Literal('must_be_archived'),
])

export const channelLifecycleConflictResponse = Type.Object({
    error: Type.Object({
        code: Type.Literal('channel_lifecycle_conflict'),
        message: Type.String(),
        blockers: Type.Array(channelLifecycleBlockerSchema),
    }),
})

export const channelLifecycleBody = Type.Object({
    expectedRevision: Type.Integer({ minimum: 1 }),
})

export const renameChannelBody = Type.Object({
    name: Type.String({ minLength: 1 }),
    expectedRevision: Type.Integer({ minimum: 1 }),
})

export const channelDeletedSchema = Type.Object({ deleted: Type.Literal(true) })

export const duePublicationSchema = Type.Intersect([
    publicationSchema,
    Type.Object({
        postTitle: Type.Union([Type.String(), Type.Null()]),
        channelName: Type.String(),
        targetContent: Type.Record(Type.String(), Type.Unknown()),
    }),
])

export const publicationWorkingDraftSchema = Type.Unsafe<PublicationWorkingDraft>(
    Type.Object({
        id: Type.String({ minLength: 1 }),
        projectId: Type.String({ minLength: 1 }),
        publicationId: Type.String({ minLength: 1 }),
        profileVersionId: Type.String({ minLength: 1 }),
        sourceRevision: Type.Integer({ minimum: 1 }),
        baseSourceContent: sourceContentSchema,
        content: Type.Record(Type.String(), Type.Unknown()),
        reviewState: Type.Union([Type.Literal('compatible'), Type.Literal('review_required')]),
        validationIssues: Type.Array(Type.Record(Type.String(), Type.Unknown())),
        lastAssessedProfileVersionId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
        revision: Type.Integer({ minimum: 1 }),
        updatedByActorId: Type.String({ minLength: 1 }),
        createdAt: Type.Integer({ minimum: 0 }),
        updatedAt: Type.Integer({ minimum: 0 }),
    })
)

export const publicationTargetRevisionSchema = Type.Unsafe<PublicationTargetRevision>(
    Type.Object({
        id: Type.String({ minLength: 1 }),
        projectId: Type.String({ minLength: 1 }),
        publicationId: Type.String({ minLength: 1 }),
        sequence: Type.Integer({ minimum: 1 }),
        profileVersionId: Type.String({ minLength: 1 }),
        sourceRevision: Type.Integer({ minimum: 1 }),
        deliveryMode: Type.Union([Type.Literal('manual'), Type.Literal('automatic')]),
        mediaReferenceCount: Type.Integer({ minimum: 0 }),
        content: Type.Record(Type.String(), Type.Unknown()),
        contentHash: Type.String({ minLength: 1 }),
        profileHash: Type.String({ minLength: 1 }),
        schemaHash: Type.String({ minLength: 1 }),
        validationIssues: Type.Array(Type.Record(Type.String(), Type.Unknown())),
        createdByActorId: Type.String({ minLength: 1 }),
        createdAt: Type.Integer({ minimum: 0 }),
    })
)

export const publicationEditorStateSchema = Type.Unsafe<PublicationEditorState>(
    Type.Object({
        publication: publicationSchema,
        post: postSchema,
        channel: channelSchema,
        profile: channelProfileVersionSchema,
        draft: publicationWorkingDraftSchema,
        selectedTarget: Type.Union([publicationTargetRevisionSchema, Type.Null()]),
    })
)

export const publicationSummarySchema = Type.Unsafe<PublicationSummary>(
    Type.Intersect([
        publicationSchema,
        Type.Object({
            postTitle: Type.Union([Type.String(), Type.Null()]),
            channelName: Type.String(),
            draftRevision: Type.Integer({ minimum: 1 }),
            draftReviewState: Type.Union([
                Type.Literal('compatible'),
                Type.Literal('review_required'),
            ]),
            draftDiffersFromTarget: Type.Boolean(),
        }),
    ])
)

export type ProjectResponse = Static<typeof projectSchema>
export type ChannelResponse = Static<typeof channelSchema>
export type ChannelProfileVersionResponse = Static<typeof channelProfileVersionSchema>
export type ChannelProfileStateResponse = Static<typeof channelProfileStateSchema>
export type ChannelProfileAssessmentResponse = Static<typeof channelProfileAssessmentSchema>
export type ChannelProfileActivationResponse = Static<typeof channelProfileActivationSchema>
export type PostResponse = Static<typeof postSchema>
export type PublicationResponse = Static<typeof publicationSchema>
export type DuePublicationResponse = Static<typeof duePublicationSchema>
export type PublicationEditorStateResponse = Static<typeof publicationEditorStateSchema>
export type PublicationSummaryResponse = Static<typeof publicationSummarySchema>
export type AuditEventResponse = Static<typeof auditEventSchema>
export type ProjectAccessTokenResponse = Static<typeof projectAccessTokenSchema>

export const projectParams = Type.Object({
    projectId: Type.String({ minLength: 1 }),
})

export const projectAccessTokenParams = Type.Object({
    projectId: Type.String({ minLength: 1 }),
    tokenId: Type.String({ minLength: 1 }),
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
    timeZone: Type.Optional(Type.String({ minLength: 1 })),
})

export const updateProjectBody = Type.Object({
    timeZone: Type.String({ minLength: 1 }),
})

export const createProjectAccessTokenBody = Type.Object({
    name: Type.String({ minLength: 1, maxLength: 100 }),
    expiresAt: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
})

export const createdProjectAccessTokenSchema = Type.Object({
    accessToken: projectAccessTokenSchema,
    token: Type.String({
        minLength: 1,
        description: 'The plaintext token. It is returned only once when the token is created.',
    }),
})

export const projectAccessTokensSchema = Type.Object({
    accessTokens: Type.Array(projectAccessTokenSchema),
})

export type CreatedProjectAccessTokenResponse = Static<typeof createdProjectAccessTokenSchema>
export type ProjectAccessTokensResponse = Static<typeof projectAccessTokensSchema>

export const createChannelBody = Type.Object({
    name: Type.String({ minLength: 1 }),
    profile: Type.Optional(
        Type.Union([
            Type.Literal('manual-message'),
            Type.Literal('linkedin'),
            Type.Literal('bluesky'),
            Type.Literal('mastodon'),
            Type.Literal('discord'),
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

export const savePublicationDraftBody = Type.Object({
    expectedRevision: Type.Integer({ minimum: 1 }),
    sourceContent: Type.Optional(sourceContentSchema),
    targetContent: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

export const rebasePublicationDraftBody = Type.Object({
    expectedRevision: Type.Integer({ minimum: 1 }),
})

export const promotePublicationDraftBody = Type.Object({
    expectedRevision: Type.Integer({ minimum: 1 }),
    scheduledAt: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
})

export function resolveChannelProfile(profile: unknown): ChannelProfileDefinition {
    if (profile === 'linkedin') return linkedinChannelProfile
    if (profile === 'bluesky') return blueskyChannelProfile
    if (profile === 'mastodon') return mastodonChannelProfile
    if (profile === 'discord') return discordChannelProfile
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
    destination: Type.Union([
        Type.Object({
            type: Type.Union([
                Type.Literal('account'),
                Type.Literal('member'),
                Type.Literal('organization'),
                Type.Literal('channel'),
            ]),
            id: Type.String({ minLength: 1 }),
            name: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
        }),
        Type.Null(),
    ]),
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

export const linkedInConnectionBody = Type.Object({
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

export const blueskyConnectionSchema = Type.Object({
    provider: Type.Literal('bluesky'),
    scopes: Type.Array(Type.String({ minLength: 1 })),
    authorizationUrl: Type.String({ minLength: 1 }),
})

export const blueskyConnectionBody = Type.Object({
    handle: Type.String({ minLength: 1, maxLength: 253 }),
})

export const mastodonConnectionSchema = Type.Object({
    provider: Type.Literal('mastodon'),
    scopes: Type.Array(Type.String({ minLength: 1 })),
    authorizationUrl: Type.String({ minLength: 1 }),
})

export const mastodonConnectionBody = Type.Object({
    instanceUrl: Type.String({ minLength: 1, maxLength: 2_048 }),
})

export const discordConnectionBody = Type.Object({
    botToken: Type.String({ minLength: 32, maxLength: 4_096, writeOnly: true }),
    channelId: Type.String({ minLength: 17, maxLength: 20 }),
})

export const discordConnectionResponse = Type.Object({
    connection: publisherConnectionSchema,
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
