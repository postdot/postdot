import { Type } from 'typebox'

/**
 * API schemas of persisted rows. They were generated from the Drizzle tables;
 * Postdot now owns its schema as SQL migrations (ADR-097 §6), so they are written
 * out here. Keep them in step with `packages/db/migrations`.
 */

const safeInteger = Type.Integer({
    minimum: Number.MIN_SAFE_INTEGER,
    maximum: Number.MAX_SAFE_INTEGER,
})
const jsonValue = Type.Union([
    Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]),
    Type.Array(Type.Any()),
    Type.Record(Type.String({ pattern: '^(.*)$' }), Type.Any()),
])

export const projectRowSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    timeZone: Type.String(),
    workspaceId: Type.Union([Type.String(), Type.Null()]),
    primaryCategoryId: Type.Union([Type.String(), Type.Null()]),
    createdAt: safeInteger,
    updatedAt: safeInteger,
})

export const channelRowSchema = Type.Object({
    id: Type.String(),
    workspaceId: Type.String(),
    name: Type.String(),
    destinationRevision: safeInteger,
    destinationIdentityJson: Type.Union([jsonValue, Type.Null()]),
    profileVersionId: Type.String(),
    state: Type.Enum(['active', 'archived']),
    archivedAt: Type.Union([safeInteger, Type.Null()]),
    revision: safeInteger,
    createdAt: safeInteger,
    updatedAt: safeInteger,
})

export const postRowSchema = Type.Object({
    id: Type.String(),
    projectId: Type.String(),
    title: Type.Union([Type.String(), Type.Null()]),
    sourceContent: jsonValue,
    sourceRevision: safeInteger,
    createdByActorId: Type.String(),
    createdAt: safeInteger,
    updatedAt: safeInteger,
})

export const publicationRowSchema = Type.Object({
    id: Type.String(),
    projectId: Type.String(),
    postId: Type.String(),
    channelId: Type.String(),
    confirmedDestinationRevision: safeInteger,
    targetRevisionId: Type.Union([Type.String(), Type.Null()]),
    deliveryMode: Type.Enum(['manual', 'automatic']),
    reviewState: Type.Enum(['compatible', 'review_required']),
    state: Type.Enum([
        'draft',
        'scheduled',
        'ready',
        'publishing',
        'published',
        'failed',
        'ambiguous',
        'cancelled',
    ]),
    scheduledAt: Type.Union([safeInteger, Type.Null()]),
    publishedAt: Type.Union([safeInteger, Type.Null()]),
    externalId: Type.Union([Type.String(), Type.Null()]),
    externalUrl: Type.Union([Type.String(), Type.Null()]),
    errorMessage: Type.Union([Type.String(), Type.Null()]),
    createdByActorId: Type.String(),
    scheduledByActorId: Type.Union([Type.String(), Type.Null()]),
    stateChangedByActorId: Type.String(),
    publishedByActorId: Type.Union([Type.String(), Type.Null()]),
    lastAssessedProfileVersionId: Type.Union([Type.String(), Type.Null()]),
    profileAssessmentIssuesJson: jsonValue,
    createdAt: safeInteger,
    updatedAt: safeInteger,
})

export const publicationApprovalRequestRowSchema = Type.Object({
    id: Type.String(),
    projectId: Type.String(),
    publicationId: Type.String(),
    targetRevisionId: Type.String(),
    draftRevision: safeInteger,
    proposedScheduledAt: safeInteger,
    state: Type.Enum(['pending', 'approved', 'rejected', 'superseded']),
    requestedByActorId: Type.String(),
    decidedByActorId: Type.Union([Type.String(), Type.Null()]),
    decidedAt: Type.Union([safeInteger, Type.Null()]),
    scheduledAt: Type.Union([safeInteger, Type.Null()]),
    rejectionReason: Type.Union([Type.String(), Type.Null()]),
    createdAt: safeInteger,
    updatedAt: safeInteger,
})

export const auditEventRowSchema = Type.Object({
    sequence: safeInteger,
    id: Type.String(),
    projectId: Type.Union([Type.String(), Type.Null()]),
    workspaceId: Type.Union([Type.String(), Type.Null()]),
    actorId: Type.String(),
    action: Type.String(),
    entityType: Type.String(),
    entityId: Type.String(),
    metadataJson: Type.Union([Type.String(), Type.Null()]),
    eventVersion: safeInteger,
    correlationId: Type.Union([Type.String(), Type.Null()]),
    causationId: Type.Union([Type.String(), Type.Null()]),
    createdAt: safeInteger,
})
