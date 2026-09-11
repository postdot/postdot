import type {
    Actor,
    ChannelProfileDefinition,
    ChannelProfileVersionState,
    DeliveryMode,
    Publication,
    PublicationReviewState,
    MediaRepresentation,
    TargetMediaReference,
} from '@herald/core'

export interface ProjectRow {
    readonly id: string
    readonly name: string
    readonly timeZone: string
    readonly organizationId: string | null
    readonly primaryCategoryId: string | null
    readonly createdAt: number
    readonly updatedAt: number
}

export interface ActorRow {
    readonly id: string
    readonly projectId: string
    readonly kind: Actor['kind']
    readonly subjectId: string | null
    readonly displayName: string
    readonly createdAt: number
    readonly updatedAt: number
}

export interface ChannelRow {
    readonly id: string
    readonly projectId: string
    readonly name: string
    readonly profileId: string
    readonly profileVersionId: string
    readonly state: 'active' | 'archived'
    readonly archivedAt: number | null
    readonly revision: number
    readonly createdAt: number
    readonly updatedAt: number
}

export interface PublicationChannelRow extends ChannelRow {
    readonly publisherId: string | null
    readonly publisherKind: string | null
    readonly publisherCreatedAt: number | null
    readonly publisherUpdatedAt: number | null
}

export interface PublicationRow {
    readonly id: string
    readonly projectId: string
    readonly postId: string
    readonly channelId: string
    readonly targetRevisionId: string | null
    readonly deliveryMode: DeliveryMode
    readonly reviewState: PublicationReviewState
    readonly state: Publication['state']
    readonly scheduledAt: number | null
    readonly publishedAt: number | null
    readonly externalId: string | null
    readonly externalUrl: string | null
    readonly errorMessage: string | null
    readonly createdByActorId: string
    readonly scheduledByActorId: string | null
    readonly stateChangedByActorId: string
    readonly publishedByActorId: string | null
    readonly lastAssessedProfileVersionId: string | null
    readonly profileAssessmentIssuesJson: string
    readonly createdAt: number
    readonly updatedAt: number
}

export interface ProfileRow {
    readonly id: string
    readonly projectId: string
    readonly channelId: string
    readonly profileId: string
    readonly version: number
    readonly origin: ChannelProfileDefinition['origin']
    readonly state: ChannelProfileVersionState
    readonly revision: number
    readonly profileJson: string
    readonly profileHash: string
    readonly schemaHash: string
    readonly createdByActorId: string
    readonly createdAt: number
    readonly updatedAt: number
}

export interface PostSourceRow {
    readonly id: string
    readonly projectId: string
    readonly sourceContentJson: string
    readonly sourceRevision: number
}

export interface PostRow extends PostSourceRow {
    readonly title: string | null
    readonly createdByActorId: string
    readonly createdAt: number
    readonly updatedAt: number
}

export interface WorkingDraftRow {
    readonly id: string
    readonly projectId: string
    readonly publicationId: string
    readonly profileVersionId: string
    readonly sourceRevision: number
    readonly baseSourceContentJson: string
    readonly contentJson: string
    readonly reviewState: PublicationReviewState
    readonly validationIssuesJson: string
    readonly lastAssessedProfileVersionId: string | null
    readonly revision: number
    readonly updatedByActorId: string
    readonly createdAt: number
    readonly updatedAt: number
}

export interface ProfileImpactWorkingDraftRow {
    readonly id: string
    readonly publicationId: string
    readonly contentJson: string
    readonly deliveryMode: DeliveryMode
    readonly revision: number
}

export interface ProfileImpactTargetRow {
    readonly id: string
    readonly publicationId: string
    readonly targetRevisionId: string
    readonly contentJson: string
    readonly deliveryMode: DeliveryMode
    readonly scheduledAt: number | null
    readonly state: Publication['state']
}

export interface TargetRevisionMediaRow {
    readonly id: string
    readonly projectId: string
    readonly targetRevisionId: string
    readonly assetId: string
    readonly representationId: string
    readonly position: number
    readonly contentPath: string
    readonly role: string | null
    readonly accessibilityText: string | null
}

export interface TargetRevisionRow {
    readonly id: string
    readonly projectId: string
    readonly publicationId: string
    readonly sequence: number
    readonly profileVersionId: string
    readonly sourceRevision: number
    readonly deliveryMode: DeliveryMode
    readonly mediaReferenceCount: number
    readonly contentJson: string
    readonly contentHash: string
    readonly profileHash: string
    readonly schemaHash: string
    readonly validationIssuesJson: string
    readonly createdByActorId: string
    readonly createdAt: number
}

export interface DuePublicationRow extends PublicationRow {
    readonly postTitle: string | null
    readonly channelName: string
    readonly targetContentJson: string
}

export interface PublicationSummaryRow extends PublicationRow {
    readonly postTitle: string | null
    readonly channelName: string
    readonly draftRevision: number
    readonly draftReviewState: PublicationReviewState
    readonly draftSourceRevision: number
    readonly draftContentJson: string
    readonly targetSourceRevision: number | null
    readonly targetContentJson: string | null
    readonly tagIdsJson: string
}

export interface ResolvedTargetMedia {
    readonly reference: TargetMediaReference
    readonly representation: MediaRepresentation
    readonly accessibilityText: string | null
}

export interface AuditEventRow {
    readonly id: string
    readonly projectId: string
    readonly actorId: string
    readonly action: string
    readonly entityType: string
    readonly entityId: string
    readonly metadataJson: string | null
    readonly createdAt: number
}
