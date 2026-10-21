import {
    DomainInvariantError,
    type Actor,
    type Post,
    type Publication,
    type Publisher,
} from '@postdot/core'

import type {
    AuditEvent,
    ChannelProfileVersion,
    PublicationSummary,
    PublicationTargetRevision,
    PublicationWorkingDraft,
} from '../manual-store'
import {
    parseJsonArray,
    parseJsonObject,
    parseJsonStringArray,
    parseProfile,
    parseSourceContent,
} from './content-codec'
import type {
    ActorRow,
    AuditEventRow,
    PostRow,
    ProfileRow,
    PublicationChannelRow,
    PublicationRow,
    PublicationSummaryRow,
    TargetRevisionRow,
    WorkingDraftRow,
} from './rows'

export function toActor(row: ActorRow): Actor {
    return {
        id: row.id,
        projectId: row.projectId,
        kind: row.kind,
        subjectId: row.subjectId,
        displayName: row.displayName,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

export function toProfileVersion(row: ProfileRow): ChannelProfileVersion {
    const profile = parseProfile(row.profileJson)
    if (
        profile.id !== row.profileId ||
        profile.version !== row.version ||
        profile.origin !== row.origin ||
        profile.profileHash !== row.profileHash ||
        profile.schemaHash !== row.schemaHash
    ) {
        throw new DomainInvariantError(
            'invalid_content',
            `Stored channel profile ${row.id} metadata does not match its definition`
        )
    }

    return {
        id: row.id,
        projectId: row.projectId,
        channelId: row.channelId,
        profileId: row.profileId,
        version: row.version,
        origin: row.origin,
        state: row.state,
        revision: row.revision,
        profile,
        createdByActorId: row.createdByActorId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

export function toPublisher(row: PublicationChannelRow): Publisher {
    if (
        row.publisherId === null ||
        row.publisherKind === null ||
        row.publisherCreatedAt === null ||
        row.publisherUpdatedAt === null
    ) {
        throw new DomainInvariantError(
            'invalid_input',
            'A publisher row is incomplete for an automated publication'
        )
    }

    return {
        id: row.publisherId,
        projectId: row.projectId,
        channelId: row.id,
        kind: row.publisherKind,
        createdAt: row.publisherCreatedAt,
        updatedAt: row.publisherUpdatedAt,
    }
}

export function toPublication(row: PublicationRow): Publication {
    return {
        id: row.id,
        projectId: row.projectId,
        postId: row.postId,
        channelId: row.channelId,
        targetRevisionId: row.targetRevisionId,
        deliveryMode: row.deliveryMode,
        reviewState: row.reviewState,
        state: row.state,
        scheduledAt: row.scheduledAt,
        publishedAt: row.publishedAt,
        externalId: row.externalId,
        externalUrl: row.externalUrl,
        errorMessage: row.errorMessage,
        createdByActorId: row.createdByActorId,
        scheduledByActorId: row.scheduledByActorId,
        stateChangedByActorId: row.stateChangedByActorId,
        publishedByActorId: row.publishedByActorId,
        lastAssessedProfileVersionId: row.lastAssessedProfileVersionId,
        profileAssessmentIssues: [
            ...parseJsonArray(
                row.profileAssessmentIssuesJson,
                'publication profile assessment issues'
            ),
        ],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

export function toPost(row: PostRow): Post {
    return {
        id: row.id,
        projectId: row.projectId,
        title: row.title,
        sourceContent: parseSourceContent(row.sourceContentJson),
        sourceRevision: row.sourceRevision,
        createdByActorId: row.createdByActorId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

export function toTargetRevision(row: TargetRevisionRow): PublicationTargetRevision {
    return {
        id: row.id,
        projectId: row.projectId,
        publicationId: row.publicationId,
        sequence: row.sequence,
        profileVersionId: row.profileVersionId,
        sourceRevision: row.sourceRevision,
        deliveryMode: row.deliveryMode,
        mediaReferenceCount: row.mediaReferenceCount,
        content: parseJsonObject(row.contentJson, 'publication target content'),
        contentHash: row.contentHash,
        profileHash: row.profileHash,
        schemaHash: row.schemaHash,
        validationIssues: parseJsonArray(
            row.validationIssuesJson,
            'publication target validation issues'
        ),
        createdByActorId: row.createdByActorId,
        createdAt: row.createdAt,
    }
}

export function toPublicationSummary(row: PublicationSummaryRow): PublicationSummary {
    const sourceContent = parseSourceContent(row.sourceContentJson)
    const sourceExcerpt = summarizeSourceExcerpt(sourceContent)
    const mediaAssetIds = sourceContent.media.slice(0, 3).map(media => media.assetId)

    return {
        ...toPublication(row),
        postTitle: row.postTitle,
        sourceExcerpt,
        mediaAssetIds,
        mediaCount: sourceContent.media.length,
        lastEditedAt: Math.max(row.updatedAt, row.postUpdatedAt, row.draftUpdatedAt),
        channelName: row.channelName,
        draftRevision: row.draftRevision,
        draftReviewState: row.draftReviewState,
        draftDiffersFromTarget:
            row.targetContentJson === null ||
            row.draftSourceRevision !== row.targetSourceRevision ||
            row.draftContentJson !== row.targetContentJson,
        tagIds: parseJsonStringArray(row.tagIdsJson, 'publication tag IDs'),
    }
}

function summarizeSourceExcerpt(sourceContent: ReturnType<typeof parseSourceContent>) {
    const candidate = sourceContent.body?.text.trim() || sourceContent.headline?.trim() || ''
    if (candidate === '') return null

    const normalized = candidate.replace(/\s+/g, ' ')
    return normalized.length > 96 ? `${normalized.slice(0, 93)}…` : normalized
}

export function toWorkingDraft(row: WorkingDraftRow): PublicationWorkingDraft {
    return {
        id: row.id,
        projectId: row.projectId,
        publicationId: row.publicationId,
        profileVersionId: row.profileVersionId,
        sourceRevision: row.sourceRevision,
        baseSourceContent: parseSourceContent(row.baseSourceContentJson),
        content: parseJsonObject(row.contentJson, 'publication draft content'),
        reviewState: row.reviewState,
        validationIssues: parseJsonArray(row.validationIssuesJson, 'publication validation issues'),
        lastAssessedProfileVersionId: row.lastAssessedProfileVersionId,
        revision: row.revision,
        updatedByActorId: row.updatedByActorId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

export function toAuditEvent(row: AuditEventRow): AuditEvent {
    return {
        id: row.id,
        projectId: row.projectId,
        actorId: row.actorId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        metadataJson: row.metadataJson,
        createdAt: row.createdAt,
    }
}
