import {
    createPublicationTagFilter,
    publicationTagFilterMaximumIds,
    sourceContentSchema,
    taxonomyLabelMaximumLength,
} from '@postdot/core'
import type {
    Channel,
    ChannelProfilePreset,
    ChannelProfileDefinition,
    Publication,
    PublicationApprovalRequest,
} from '@postdot/core'
import type { ChannelProfileImpactAssessment } from '@postdot/core'
import type {
    ChannelProfileActivationResult,
    ChannelProfileState,
    ChannelProfileVersion,
    AuditEvent,
    PublicationEditorState,
    PublicationComposerDraft,
    PublicationSummary,
    PublicationTargetRevision,
    PublicationWorkingDraft,
} from '@postdot/db'
import {
    auditEvents,
    channels,
    posts,
    projects,
    publications,
    publicationApprovalRequests,
} from '@postdot/db/schema'
import type { Table } from 'drizzle-orm'
import { createSchemaFactory } from 'drizzle-typebox'
import { Type, type Static, type TProperties, type TSchema } from 'typebox'

import { serverProviders } from '../../providers/registry'
import { resolveBuiltInChannelProfile } from './channel-profile-presets'

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
const taxonomyStateSchema = Type.Union([Type.Literal('active'), Type.Literal('archived')])
export const projectCategorySchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: taxonomyLabelMaximumLength }),
    normalizedName: Type.String({ minLength: 1, maxLength: taxonomyLabelMaximumLength }),
    state: taxonomyStateSchema,
    archivedAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})
export const projectTagSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    projectId: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: taxonomyLabelMaximumLength }),
    normalizedName: Type.String({ minLength: 1, maxLength: taxonomyLabelMaximumLength }),
    state: taxonomyStateSchema,
    archivedAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})
export const projectCategoriesSchema = Type.Object({
    categories: Type.Array(projectCategorySchema),
})
export const projectTagsSchema = Type.Object({
    tags: Type.Array(projectTagSchema),
})
export type ProjectCategoryResponse = Static<typeof projectCategorySchema>
export type ProjectTagResponse = Static<typeof projectTagSchema>
export const channelSchema = Type.Unsafe<Channel>(
    Type.Intersect([
        Type.Omit(createElysiaSelectSchema(channels), [
            'workspaceId',
            'destinationRevision',
            'destinationIdentityJson',
        ]),
        // The project is the attachment context, not the owner (the workspace is).
        Type.Object({
            projectId: Type.String({ minLength: 1 }),
            profileId: Type.String({ minLength: 1 }),
        }),
    ])
)
export const channelListItemSchema = Type.Intersect([
    channelSchema,
    Type.Object({
        execution: Type.Union([
            Type.Object({ kind: Type.Literal('manual') }),
            Type.Object({ kind: Type.Literal('declarative_http') }),
            Type.Object({
                kind: Type.Literal('built_in'),
                contractId: Type.String({ minLength: 1 }),
            }),
        ]),
    }),
])
export const postSchema = createElysiaSelectSchema(posts)
const publicationPersistenceSchema = createElysiaSelectSchema(publications)
export const publicationSchema = Type.Unsafe<Publication>(
    Type.Intersect([
        Type.Omit(publicationPersistenceSchema, [
            'profileAssessmentIssuesJson',
            'confirmedDestinationRevision',
        ]),
        Type.Object({
            profileAssessmentIssues: Type.Unsafe<readonly Record<string, unknown>[]>(
                Type.Array(Type.Record(Type.String(), Type.Unknown()))
            ),
        }),
    ])
)
export const publicationApprovalRequestSchema = Type.Unsafe<PublicationApprovalRequest>(
    createElysiaSelectSchema(publicationApprovalRequests)
)
export const publicationApprovalRequestsResponseSchema = Type.Object({
    requests: Type.Array(publicationApprovalRequestSchema),
})
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

export const projectMemberSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    projectId: Type.String({ minLength: 1 }),
    userId: Type.String({ minLength: 1 }),
    email: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    image: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    role: Type.Union([Type.Literal('owner'), Type.Literal('editor'), Type.Literal('viewer')]),
    state: Type.Literal('active'),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})

export const projectInvitationSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    email: Type.String({ minLength: 1 }),
    role: Type.Union([Type.Literal('owner'), Type.Literal('editor'), Type.Literal('viewer')]),
    organizationId: Type.String({ minLength: 1 }),
    inviterId: Type.String({ minLength: 1 }),
    status: Type.Union([
        Type.Literal('pending'),
        Type.Literal('accepted'),
        Type.Literal('rejected'),
        Type.Literal('canceled'),
    ]),
    expiresAt: Type.Integer({ minimum: 0 }),
    createdAt: Type.Integer({ minimum: 0 }),
})

export const projectMembersSchema = Type.Object({
    members: Type.Array(projectMemberSchema),
    total: Type.Integer({ minimum: 0 }),
})

export const projectMembershipResponseSchema = Type.Object({
    membership: projectMemberSchema,
})

export const projectInvitationsSchema = Type.Object({
    invitations: Type.Array(projectInvitationSchema),
})

export const projectInvitationResponseSchema = Type.Object({
    invitation: projectInvitationSchema,
})

export const projectMemberResponseSchema = Type.Object({
    membership: projectMemberSchema,
})

export const projectMemberRemovedSchema = Type.Object({
    removed: Type.Literal(true),
})

export const projectTeamGrantSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    projectId: Type.String({ minLength: 1 }),
    teamId: Type.String({ minLength: 1 }),
    teamName: Type.String({ minLength: 1 }),
    role: Type.Union([Type.Literal('owner'), Type.Literal('editor'), Type.Literal('viewer')]),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})

export const projectTeamGrantsSchema = Type.Object({
    grants: Type.Array(projectTeamGrantSchema),
})

export const projectTeamGrantResponseSchema = Type.Object({
    grant: projectTeamGrantSchema,
})

export const projectTeamGrantParams = Type.Object({
    projectId: Type.String({ minLength: 1 }),
    teamId: Type.String({ minLength: 1 }),
})

export const projectTeamGrantBody = Type.Object({
    teamId: Type.String({ minLength: 1 }),
    role: Type.Union([Type.Literal('editor'), Type.Literal('viewer')]),
})

export const updateProjectTeamGrantBody = Type.Object({
    role: Type.Union([Type.Literal('editor'), Type.Literal('viewer')]),
})

export const projectUserGrantSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    projectId: Type.String({ minLength: 1 }),
    userId: Type.String({ minLength: 1 }),
    role: Type.Union([Type.Literal('owner'), Type.Literal('editor'), Type.Literal('viewer')]),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})

export const projectUserGrantsSchema = Type.Object({
    grants: Type.Array(projectUserGrantSchema),
})

export const projectUserGrantResponseSchema = Type.Object({
    grant: projectUserGrantSchema,
})

export const projectUserGrantBody = Type.Object({
    userId: Type.String({ minLength: 1 }),
    role: Type.Union([Type.Literal('editor'), Type.Literal('viewer')]),
})

export const updateProjectUserGrantBody = Type.Object({
    role: Type.Union([Type.Literal('editor'), Type.Literal('viewer')]),
})

export const projectUserGrantParams = Type.Object({
    projectId: Type.String({ minLength: 1 }),
    userId: Type.String({ minLength: 1 }),
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

export const channelProfilePresetSchema = Type.Unsafe<ChannelProfilePreset>(
    Type.Object({
        id: Type.String({ minLength: 1 }),
        version: Type.Integer({ minimum: 1 }),
        profile: Type.Record(Type.String(), Type.Unknown()),
    })
)

export const channelProfilePresetsSchema = Type.Object({
    presets: Type.Array(channelProfilePresetSchema),
})

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
    Type.Literal('shared'),
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
        adoptionCount: Type.Optional(Type.Integer({ minimum: 0 })),
        selectedTargetProfile: Type.Optional(
            Type.Union([channelProfileVersionSchema, Type.Null()])
        ),
        selectedTarget: Type.Union([publicationTargetRevisionSchema, Type.Null()]),
    })
)

export const publicationSummarySchema = Type.Unsafe<PublicationSummary>(
    Type.Intersect([
        publicationSchema,
        Type.Object({
            postTitle: Type.Union([Type.String(), Type.Null()]),
            sourceExcerpt: Type.Union([Type.String(), Type.Null()]),
            mediaAssetIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 3 }),
            mediaCount: Type.Integer({ minimum: 0 }),
            lastEditedAt: Type.Integer({ minimum: 0 }),
            channelName: Type.String(),
            draftRevision: Type.Integer({ minimum: 1 }),
            draftReviewState: Type.Union([
                Type.Literal('compatible'),
                Type.Literal('review_required'),
            ]),
            draftDiffersFromTarget: Type.Boolean(),
            tagIds: Type.Array(Type.String({ minLength: 1 })),
        }),
    ])
)

export const publicationSummaryPageSchema = Type.Object({
    publications: Type.Array(publicationSummarySchema),
    nextCursor: Type.Union([Type.String({ minLength: 1, maxLength: 1_024 }), Type.Null()]),
    summary: Type.Object({
        total: Type.Integer({ minimum: 0 }),
        manual: Type.Integer({ minimum: 0 }),
        automatic: Type.Integer({ minimum: 0 }),
        scheduled: Type.Integer({ minimum: 0 }),
        draft: Type.Integer({ minimum: 0 }),
    }),
})

export const deleteDraftPublicationResponseSchema = Type.Object({
    deleted: Type.Literal(true),
    postDeleted: Type.Boolean(),
})

export const duplicateDraftPublicationResponseSchema = Type.Object({
    post: postSchema,
    publication: publicationSchema,
})

const publicationComposerMediaSelectionSchema = Type.Object({
    assetId: Type.String({ minLength: 1 }),
    accessibilityText: Type.Optional(Type.String()),
})

const publicationComposerTargetSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    channelId: Type.String(),
    content: Type.String(),
    deliveryMode: Type.Union([Type.Literal('manual'), Type.Literal('automatic')]),
    scheduledAt: Type.String(),
})

export const publicationComposerDraftContentSchema = Type.Object({
    postTitle: Type.String(),
    postContent: Type.String(),
    sourceMedia: Type.Array(publicationComposerMediaSelectionSchema),
    publicationTargets: Type.Array(publicationComposerTargetSchema),
    publicationTagIds: Type.Array(Type.String()),
    defaultDeliveryMode: Type.Union([Type.Literal('manual'), Type.Literal('automatic')]),
    defaultScheduledAt: Type.String(),
    customizedTargetIds: Type.Array(Type.String()),
    customizedContentTargetIds: Type.Array(Type.String()),
    activePublicationTabId: Type.String(),
    activeContentScopeId: Type.Optional(Type.String()),
})

export const publicationComposerDraftSchema = Type.Unsafe<PublicationComposerDraft>(
    Type.Object({
        id: Type.String({ minLength: 1 }),
        projectId: Type.String({ minLength: 1 }),
        content: publicationComposerDraftContentSchema,
        revision: Type.Integer({ minimum: 1 }),
        createdAt: Type.Integer({ minimum: 0 }),
        updatedAt: Type.Integer({ minimum: 0 }),
    })
)

export const publicationComposerDraftResponseSchema = Type.Object({
    draft: Type.Union([publicationComposerDraftSchema, Type.Null()]),
})

export type ProjectResponse = Static<typeof projectSchema>
export type ChannelListItemResponse = Static<typeof channelListItemSchema>
export type ChannelResponse = Static<typeof channelSchema>
export type ChannelProfileVersionResponse = Static<typeof channelProfileVersionSchema>
export type ChannelProfilePresetResponse = Static<typeof channelProfilePresetSchema>
export type ChannelProfilePresetsResponse = Static<typeof channelProfilePresetsSchema>
export type ChannelProfileStateResponse = Static<typeof channelProfileStateSchema>
export type ChannelProfileAssessmentResponse = Static<typeof channelProfileAssessmentSchema>
export type ChannelProfileActivationResponse = Static<typeof channelProfileActivationSchema>
export type PostResponse = Static<typeof postSchema>
export type PublicationResponse = Static<typeof publicationSchema>
export type PublicationApprovalRequestResponse = Static<typeof publicationApprovalRequestSchema>
export type DuePublicationResponse = Static<typeof duePublicationSchema>
export type PublicationEditorStateResponse = Static<typeof publicationEditorStateSchema>
export type PublicationSummaryResponse = Static<typeof publicationSummarySchema>
export type PublicationSummaryPageResponse = Static<typeof publicationSummaryPageSchema>
export type AuditEventResponse = Static<typeof auditEventSchema>
export type ProjectMemberResponse = Static<typeof projectMemberSchema>
export type ProjectInvitationResponse = Static<typeof projectInvitationSchema>

export const projectParams = Type.Object({
    projectId: Type.String({ minLength: 1 }),
})

export const categoryParams = Type.Object({
    categoryId: Type.String({ minLength: 1 }),
})

export const tagParams = Type.Object({
    projectId: Type.String({ minLength: 1 }),
    tagId: Type.String({ minLength: 1 }),
})

export const projectMemberParams = Type.Object({
    projectId: Type.String({ minLength: 1 }),
    memberId: Type.String({ minLength: 1 }),
})

export const projectInvitationParams = Type.Object({
    projectId: Type.String({ minLength: 1 }),
    invitationId: Type.String({ minLength: 1 }),
})

export const publicationParams = Type.Object({
    projectId: Type.String({ minLength: 1 }),
    publicationId: Type.String({ minLength: 1 }),
})

export const publicationTagParams = publicationParams

export const taxonomyListQuery = Type.Object({
    includeArchived: Type.Optional(Type.Boolean()),
})

export const publicationListQuery = Type.Object({
    /** Accepts both ?tagIds=a&tagIds=b and ?tagIds=a,b. */
    tagIds: Type.Optional(
        Type.Union([
            Type.String({ minLength: 1 }),
            Type.Array(Type.String({ minLength: 1 }), {
                maxItems: publicationTagFilterMaximumIds,
            }),
        ])
    ),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1_024 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    state: Type.Optional(Type.Union([Type.Literal('draft'), Type.Literal('scheduled')])),
    sort: Type.Optional(
        Type.Union([
            Type.Literal('queue'),
            Type.Literal('updated_desc'),
            Type.Literal('updated_asc'),
            Type.Literal('created_desc'),
            Type.Literal('created_asc'),
            Type.Literal('scheduled_desc'),
            Type.Literal('scheduled_asc'),
        ])
    ),
    from: Type.Optional(Type.Integer({ minimum: 0 })),
    to: Type.Optional(Type.Integer({ minimum: 0 })),
})

export type PublicationListQuery = Static<typeof publicationListQuery>

export function parsePublicationTagFilter(value: PublicationListQuery['tagIds']) {
    const values = value === undefined ? [] : Array.isArray(value) ? value : [value]
    return createPublicationTagFilter(values.flatMap(item => item.split(',')))
}

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
    workspaceId: Type.Optional(Type.String({ minLength: 1 })),
})

export const updateProjectBody = Type.Object({
    timeZone: Type.String({ minLength: 1 }),
})

export const createProjectCategoryBody = Type.Object({
    name: Type.String({ minLength: 1, maxLength: taxonomyLabelMaximumLength }),
})

export const renameProjectCategoryBody = createProjectCategoryBody

export const setProjectPrimaryCategoryBody = Type.Object({
    categoryId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
})

export const createProjectTagBody = Type.Object({
    name: Type.String({ minLength: 1, maxLength: taxonomyLabelMaximumLength }),
})

export const renameProjectTagBody = createProjectTagBody

export const replacePublicationTagsBody = Type.Object({
    tagIds: Type.Array(Type.String({ minLength: 1 })),
})

export const createProjectInvitationBody = Type.Object({
    email: Type.String({ minLength: 1, maxLength: 320 }),
    role: Type.Union([Type.Literal('editor'), Type.Literal('viewer')]),
})

export const updateProjectMemberBody = Type.Object({
    role: Type.Union([Type.Literal('editor'), Type.Literal('viewer')]),
})

export const createChannelBody = Type.Object({
    name: Type.String({ minLength: 1 }),
    profile: Type.Optional(
        Type.Union([
            Type.Enum(['manual-message' as const, ...serverProviders.map(provider => provider.id)]),
            Type.Object({
                id: Type.String({ minLength: 1 }),
                version: Type.Integer({ minimum: 1 }),
                profileHash: Type.Optional(Type.String({ minLength: 1 })),
                schemaHash: Type.Optional(Type.String({ minLength: 1 })),
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

export const createPostBody = Type.Object(
    {
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
    },
    {
        example: {
            title: 'Friday collection announcement',
            sourceContent: {
                body: { text: 'Our new collection arrives on Friday.', format: 'plain_text' },
                media: [],
            },
            publications: [
                {
                    channelId: 'REPLACE_WITH_MANUAL_CHANNEL_ID',
                    deliveryMode: 'manual',
                    targetContent: { body: 'Our new collection arrives on Friday.', media: [] },
                },
            ],
        },
    }
)

export const savePublicationComposerDraftBody = Type.Object({
    expectedRevision: Type.Integer({ minimum: 0 }),
    content: publicationComposerDraftContentSchema,
})

export const savePublicationDraftBody = Type.Object({
    expectedRevision: Type.Integer({ minimum: 1 }),
    sourceContent: Type.Optional(sourceContentSchema),
    targetContent: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

export const adoptPublicationDraftProfileBody = Type.Object({
    expectedRevision: Type.Integer({ minimum: 1 }),
    expectedSourceRevision: Type.Integer({ minimum: 1 }),
    expectedProfileVersionId: Type.String({ minLength: 1 }),
    activeProfileVersionId: Type.String({ minLength: 1 }),
    targetContent: Type.Record(Type.String(), Type.Unknown()),
    previousLocalContent: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

export const rebasePublicationDraftBody = Type.Object({
    expectedSourceRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    replaceContent: Type.Optional(Type.Boolean()),
    expectedRevision: Type.Integer({ minimum: 1 }),
})

export const promotePublicationDraftBody = Type.Object({
    expectedRevision: Type.Integer({ minimum: 1 }),
    scheduledAt: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
})

export const submitPublicationForApprovalBody = Type.Object({
    expectedDraftRevision: Type.Integer({ minimum: 1 }),
    proposedScheduledAt: Type.Integer({ minimum: 0 }),
})

export const approvePublicationRequestBody = Type.Object({
    scheduledAt: Type.Optional(Type.Integer({ minimum: 0 })),
    publishNow: Type.Optional(Type.Boolean()),
})

export const rejectPublicationRequestBody = Type.Object({
    rejectionReason: Type.Optional(Type.String({ maxLength: 500 })),
})

export const reschedulePublicationsBody = Type.Object({
    publicationIds: Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        maxItems: 100,
        uniqueItems: true,
    }),
    scheduledAt: Type.Integer({ minimum: 0 }),
})

export const cancelPublicationsBody = Type.Object({
    publicationIds: Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        maxItems: 100,
        uniqueItems: true,
    }),
})

export function resolveChannelProfile(profile: unknown): ChannelProfileDefinition {
    if (typeof profile === 'string') {
        const resolved = resolveBuiltInChannelProfile(profile)
        if (resolved !== undefined) return resolved
    }
    if (profile === undefined || profile === 'manual-message') {
        const manualProfile = resolveBuiltInChannelProfile('manual-message')
        if (manualProfile === undefined) {
            throw new Error('The manual channel profile preset is not registered')
        }
        return manualProfile
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
        Type.Object({ kind: Type.Literal('path') }),
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

export const customHttpConnectionBody = Type.Object({
    endpointUrl: Type.String({ minLength: 1, maxLength: 2_048 }),
    authentication: Type.Union([
        Type.Object({ kind: Type.Literal('none') }),
        Type.Object({ kind: Type.Literal('bearer') }),
        Type.Object({
            kind: Type.Literal('header'),
            headerName: Type.String({ minLength: 1, maxLength: 128 }),
        }),
        Type.Object({ kind: Type.Literal('path') }),
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
    oauthReadiness: Type.Object({
        instagram: Type.Union([
            Type.Literal('ready'),
            Type.Literal('not_configured'),
            Type.Literal('unavailable'),
        ]),
        facebook: Type.Union([
            Type.Literal('ready'),
            Type.Literal('not_configured'),
            Type.Literal('unavailable'),
        ]),
        linkedin: Type.Union([
            Type.Literal('ready'),
            Type.Literal('not_configured'),
            Type.Literal('unavailable'),
        ]),
        bluesky: Type.Union([
            Type.Literal('ready'),
            Type.Literal('not_configured'),
            Type.Literal('unavailable'),
        ]),
        x: Type.Union([
            Type.Literal('ready'),
            Type.Literal('not_configured'),
            Type.Literal('unavailable'),
        ]),
    }),
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
