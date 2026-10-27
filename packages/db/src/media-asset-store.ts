import { createHash } from 'node:crypto'

import {
    assertMediaAssetTransition,
    assertMediaRepresentationTransition,
    defaultMediaUploadContentTypes,
    defaultMediaInspectionLimits,
    DomainInvariantError,
    MediaInspectionRegistry,
    mediaFamilies,
    type MediaAsset,
    type MediaAssetState,
    type MediaFamily,
    type MediaInspectionLimits,
    type MediaInspection,
    type MediaRepresentation,
    type MediaRepresentationState,
    type MediaUploadPolicy,
    type MediaUploadIntent,
    type PublicationState,
} from '@postdot/core'
import { MediaStoreError, type MediaObjectMetadata, type MediaStore } from '@postdot/media'

import { createDatabaseTransaction, type PostdotDatabase } from './client'
import { createEventJournalStore } from './event-journal-store'
import {
    generateImagePreviews,
    imagePreviewProcessor,
    imagePreviewVersion,
    imagePreviewPresets,
    type ImagePreviewVariant,
} from './image-previews'
import { createMp4Inspection } from './mp4-inspection'

const DEFAULT_UPLOAD_INTENT_TTL_MS = 15 * 60 * 1_000
const DEFAULT_DELETION_GRACE_PERIOD_MS = 24 * 60 * 60 * 1_000
const DEFAULT_MEDIA_LIST_LIMIT = 24
const MAX_MEDIA_LIST_LIMIT = 100
const MAX_MEDIA_SEARCH_LENGTH = 255

export const mediaAssetListSorts = [
    'newest',
    'oldest',
    'name_asc',
    'name_desc',
    'largest',
    'smallest',
] as const
export type MediaAssetListSort = (typeof mediaAssetListSorts)[number]

export const mediaAssetDateFilters = [
    'all',
    'last_24_hours',
    'last_7_days',
    'last_30_days',
] as const
export type MediaAssetDateFilter = (typeof mediaAssetDateFilters)[number]

export type MediaAssetFamilyFilter = 'all' | MediaFamily

export interface MediaAssetStoreOptions {
    readonly videoPoster?: (objectKey: string) => Promise<Blob>
    readonly onVideoReady?: (projectId: string, assetId: string) => void
    readonly now?: () => number
    readonly createId?: () => string
    readonly uploadIntentTtlMs?: number
    readonly inspectionLimits?: MediaInspectionLimits
    readonly deletionGracePeriodMs?: number
}

export interface ReserveMediaUploadInput {
    readonly projectId: string
    readonly subjectId: string
    readonly originalFilename: string
    readonly defaultAccessibilityText?: string | null
    readonly expectedSize?: number
    readonly contentType?: string
}

export interface UploadMediaInput {
    readonly projectId: string
    readonly subjectId: string
    readonly intentId: string
    readonly source: ReadableStream<Uint8Array>
}

export interface FinalizeMediaUploadInput {
    readonly projectId: string
    readonly subjectId: string
    readonly intentId: string
}

export interface MediaAssetReference {
    readonly asset: MediaAsset
    readonly representations: readonly MediaRepresentation[]
}

export interface ListMediaAssetsInput {
    readonly projectId: string
    readonly subjectId: string
    readonly view?: 'library' | 'trash'
    readonly cursor?: string | null
    readonly limit?: number
    readonly search?: string | null
    readonly sort?: MediaAssetListSort | null
    readonly family?: MediaAssetFamilyFilter | null
    readonly date?: MediaAssetDateFilter | null
}

export interface MediaAssetListPage {
    readonly items: readonly MediaAssetReference[]
    readonly restorableAssetIds: readonly string[]
    readonly nextCursor: string | null
    readonly total: number
    readonly trashCount: number
    readonly retentionMs: number
}

export type MediaAssetUsageLocation = 'source' | 'draft' | 'target' | 'execution'

export interface MediaAssetUsageReference {
    readonly kind: 'post' | 'publication'
    readonly id: string
    readonly postId: string
    readonly publicationId: string | null
    readonly title: string | null
    readonly publicationState: PublicationState | null
    readonly scheduledAt: number | null
    readonly channelName: string | null
    readonly locations: readonly MediaAssetUsageLocation[]
}

export interface MediaAssetUsageSummary {
    readonly assetId: string
    readonly active: readonly MediaAssetUsageReference[]
    readonly history: readonly MediaAssetUsageReference[]
    readonly auditEventCount: number
}

export interface MediaAssetContent {
    readonly representation: MediaRepresentation
    readonly size: number
    readonly contentType: string
    readonly sha256: string
    readonly lastModified: Date
    readonly stream: ReadableStream<Uint8Array>
}

export interface MediaUploadReservation {
    readonly asset: MediaAsset
    readonly representation: MediaRepresentation
    readonly intent: MediaUploadIntent
    readonly upload: {
        readonly storeId: string
        readonly objectKey: string
        readonly maxBytes: number
        readonly expectedSize: number | null
        readonly contentType: string | null
    }
}

export type MediaUploadResult =
    | { readonly kind: 'uploaded'; readonly reservation: MediaUploadReservation }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'expired' }
    | { readonly kind: 'busy' }
    | { readonly kind: 'already_complete'; readonly reservation: MediaUploadReservation }

export type FinalizeMediaUploadResult =
    | { readonly kind: 'ready'; readonly reservation: MediaUploadReservation }
    | { readonly kind: 'failed'; readonly reservation: MediaUploadReservation }
    | { readonly kind: 'pending'; readonly reservation: MediaUploadReservation }
    | { readonly kind: 'not_found' }

export type RequestMediaDeletionResult =
    | { readonly kind: 'requested'; readonly media: MediaAssetReference }
    | { readonly kind: 'already_requested'; readonly media: MediaAssetReference }
    | { readonly kind: 'blocked'; readonly reason: 'referenced' }
    | { readonly kind: 'not_found' }

export type PurgeMediaAssetResult =
    | { readonly kind: 'deleted'; readonly media: MediaAssetReference }
    | { readonly kind: 'cleanup_pending'; readonly media: MediaAssetReference }
    | {
          readonly kind: 'blocked'
          readonly reason: 'grace_period' | 'referenced' | 'backup_in_progress'
      }
    | { readonly kind: 'not_found' }

export type RestoreMediaDeletionResult =
    | { readonly kind: 'restored'; readonly media: MediaAssetReference }
    | { readonly kind: 'expired' }
    | { readonly kind: 'not_restorable' }
    | { readonly kind: 'not_found' }

export interface ReconcileMediaResult {
    readonly expiredUploads: number
    readonly missingObjects: number
    readonly deletedAssets: number
}

interface MediaAssetRow {
    readonly id: string
    readonly projectId: string
    readonly originalFilename: string
    readonly defaultAccessibilityText: string | null
    readonly state: MediaAssetState
    readonly archivedAt: number | null
    readonly deletionRequestedAt: number | null
    readonly deletionRestoreState: MediaAssetState | null
    readonly deletionRestoreFailureCode: string | null
    readonly deletionRestoreFailureMessage: string | null
    readonly deletedAt: number | null
    readonly failureCode: string | null
    readonly failureMessage: string | null
    readonly createdByActorId: string
    readonly createdAt: number
    readonly updatedAt: number
}

interface MediaRepresentationRow {
    readonly id: string
    readonly projectId: string
    readonly assetId: string
    readonly kind: 'original' | 'derived'
    readonly sourceRepresentationId: string | null
    readonly state: MediaRepresentationState
    readonly deletionRestoreState: MediaRepresentationState | null
    readonly deletionRestoreFailureCode: string | null
    readonly deletionRestoreFailureMessage: string | null
    readonly storeId: string
    readonly objectKey: string
    readonly declaredContentType: string | null
    readonly detectedContentType: string | null
    readonly detectedFormat: string | null
    readonly family: 'image' | 'video' | 'audio' | 'document' | null
    readonly byteSize: number | null
    readonly sha256: string | null
    readonly width: number | null
    readonly height: number | null
    readonly durationMs: number | null
    readonly pageCount: number | null
    readonly isAnimated: number | null
    readonly processorId: string | null
    readonly processorVersion: string | null
    readonly recipeJson: string | null
    readonly failureCode: string | null
    readonly failureMessage: string | null
    readonly createdAt: number
    readonly updatedAt: number
}

interface MediaAssetUsageRow {
    readonly kind: 'post' | 'publication'
    readonly id: string
    readonly postId: string
    readonly publicationId: string | null
    readonly title: string | null
    readonly publicationState: PublicationState | null
    readonly scheduledAt: number | null
    readonly channelName: string | null
    readonly location: MediaAssetUsageLocation
}

interface MediaUploadIntentRow {
    readonly id: string
    readonly projectId: string
    readonly assetId: string
    readonly representationId: string
    readonly state: MediaUploadIntent['state']
    readonly expectedSize: number | null
    readonly maxBytes: number
    readonly contentTypeHint: string | null
    readonly expiresAt: number
    readonly uploadStartedAt: number | null
    readonly completedAt: number | null
    readonly failureCode: string | null
    readonly failureMessage: string | null
    readonly createdAt: number
    readonly updatedAt: number
}

interface ExpiredIntentRow extends MediaUploadIntentRow {
    readonly objectKey: string
}

interface MissingRepresentationRow extends MediaRepresentationRow {
    readonly assetState: MediaAssetState
}

type MediaListStatementParams = [
    projectId: string,
    search: string | null,
    family: string | null,
    createdAfter: number | null,
    cursorKey: string | number | null,
    cursorId: string | null,
    limit: number,
]

type MediaListCountStatementParams = [
    projectId: string,
    search: string | null,
    family: string | null,
    createdAfter: number | null,
]

type MediaTrashListStatementParams = [
    projectId: string,
    trashCutoff: number,
    search: string | null,
    cursorKey: number | null,
    cursorId: string | null,
    limit: number,
]

function mediaListStatementSql(sort: MediaAssetListSort): string {
    const cursorCondition = {
        newest: `
          and (
              ?5 is null
              or media_assets.created_at < ?5
              or (media_assets.created_at = ?5 and media_assets.id < ?6)
          )`,
        oldest: `
          and (
              ?5 is null
              or media_assets.created_at > ?5
              or (media_assets.created_at = ?5 and media_assets.id > ?6)
          )`,
        name_asc: `
          and (
              ?5 is null
              or lower(media_assets.original_filename) > ?5
              or (lower(media_assets.original_filename) = ?5 and media_assets.id > ?6)
          )`,
        name_desc: `
          and (
              ?5 is null
              or lower(media_assets.original_filename) < ?5
              or (lower(media_assets.original_filename) = ?5 and media_assets.id < ?6)
          )`,
        largest: `
          and (
              ?5 is null
              or coalesce(original_representation.byte_size, -1) < ?5
              or (
                  coalesce(original_representation.byte_size, -1) = ?5
                  and media_assets.id < ?6
              )
          )`,
        smallest: `
          and (
              ?5 is null
              or coalesce(original_representation.byte_size, -1) > ?5
              or (
                  coalesce(original_representation.byte_size, -1) = ?5
                  and media_assets.id > ?6
              )
          )`,
    }[sort]
    const orderBy = {
        newest: 'media_assets.created_at desc, media_assets.id desc',
        oldest: 'media_assets.created_at asc, media_assets.id asc',
        name_asc: 'lower(media_assets.original_filename) asc, media_assets.id asc',
        name_desc: 'lower(media_assets.original_filename) desc, media_assets.id desc',
        largest: 'coalesce(original_representation.byte_size, -1) desc, media_assets.id desc',
        smallest: 'coalesce(original_representation.byte_size, -1) asc, media_assets.id asc',
    }[sort]

    return `
        select ${mediaListAssetColumns}
        from media_assets
        left join media_representations as original_representation
            on original_representation.project_id = media_assets.project_id
           and original_representation.asset_id = media_assets.id
           and original_representation.kind = 'original'
        where media_assets.project_id = ?1
          and media_assets.state <> 'deleted'
          and media_assets.archived_at is null
          and (?2 is null or media_assets.original_filename like ?2 escape '\\')
          and (?3 is null or original_representation.family = ?3)
          and (?4 is null or media_assets.created_at >= ?4)
          ${cursorCondition}
        order by ${orderBy}
        limit ?7
    `
}

const assetColumns = `
    id,
    project_id as projectId,
    original_filename as originalFilename,
    default_accessibility_text as defaultAccessibilityText,
    state,
    archived_at as archivedAt,
    deletion_requested_at as deletionRequestedAt,
    deleted_at as deletedAt,
    failure_code as failureCode,
    failure_message as failureMessage,
    created_by_actor_id as createdByActorId,
    created_at as createdAt,
    updated_at as updatedAt
`

const mediaListAssetColumns = `
    media_assets.id,
    media_assets.project_id as projectId,
    media_assets.original_filename as originalFilename,
    media_assets.default_accessibility_text as defaultAccessibilityText,
    media_assets.state,
    media_assets.archived_at as archivedAt,
    media_assets.deletion_requested_at as deletionRequestedAt,
    media_assets.deletion_restore_state as deletionRestoreState,
    media_assets.deletion_restore_failure_code as deletionRestoreFailureCode,
    media_assets.deletion_restore_failure_message as deletionRestoreFailureMessage,
    media_assets.deleted_at as deletedAt,
    media_assets.failure_code as failureCode,
    media_assets.failure_message as failureMessage,
    media_assets.created_by_actor_id as createdByActorId,
    media_assets.created_at as createdAt,
    media_assets.updated_at as updatedAt
`

const representationColumns = `
    id,
    project_id as projectId,
    asset_id as assetId,
    kind,
    source_representation_id as sourceRepresentationId,
    state,
    deletion_restore_state as deletionRestoreState,
    deletion_restore_failure_code as deletionRestoreFailureCode,
    deletion_restore_failure_message as deletionRestoreFailureMessage,
    store_id as storeId,
    object_key as objectKey,
    declared_content_type as declaredContentType,
    detected_content_type as detectedContentType,
    detected_format as detectedFormat,
    family,
    byte_size as byteSize,
    sha256,
    width,
    height,
    duration_ms as durationMs,
    page_count as pageCount,
    is_animated as isAnimated,
    processor_id as processorId,
    processor_version as processorVersion,
    recipe_json as recipeJson,
    failure_code as failureCode,
    failure_message as failureMessage,
    created_at as createdAt,
    updated_at as updatedAt
`

const intentColumns = `
    id,
    project_id as projectId,
    asset_id as assetId,
    representation_id as representationId,
    state,
    expected_size as expectedSize,
    max_bytes as maxBytes,
    content_type_hint as contentTypeHint,
    expires_at as expiresAt,
    upload_started_at as uploadStartedAt,
    completed_at as completedAt,
    failure_code as failureCode,
    failure_message as failureMessage,
    created_at as createdAt,
    updated_at as updatedAt
`

export function createMediaAssetStore(
    database: PostdotDatabase,
    mediaStore: MediaStore,
    options: MediaAssetStoreOptions = {}
) {
    const client = database.$client
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())
    const uploadIntentTtlMs = options.uploadIntentTtlMs ?? DEFAULT_UPLOAD_INTENT_TTL_MS
    const previewGeneration = new Map<string, Promise<void>>()
    const inspectionLimits = options.inspectionLimits ?? defaultMediaInspectionLimits
    const deletionGracePeriodMs = options.deletionGracePeriodMs ?? DEFAULT_DELETION_GRACE_PERIOD_MS
    const inspectors = new MediaInspectionRegistry()

    validateDuration(uploadIntentTtlMs, 'uploadIntentTtlMs', false)
    validateDuration(deletionGracePeriodMs, 'deletionGracePeriodMs', true)
    validateInspectionLimits(inspectionLimits, mediaStore.maxObjectBytes)

    const loadProjectActorStatement = client.query<{ id: string }, [string, string]>(`
        select id
        from actors
        where project_id = ?1
          and subject_id = ?2
          and kind in ('human', 'agent', 'api_token')
        limit 1
    `)
    const loadAssetStatement = client.query<MediaAssetRow, [string, string]>(`
        select ${mediaListAssetColumns}
        from media_assets
        where project_id = ?1
          and id = ?2
    `)
    const listAssetsStatements = {
        newest: client.query<MediaAssetRow, MediaListStatementParams>(
            mediaListStatementSql('newest')
        ),
        oldest: client.query<MediaAssetRow, MediaListStatementParams>(
            mediaListStatementSql('oldest')
        ),
        name_asc: client.query<MediaAssetRow, MediaListStatementParams>(
            mediaListStatementSql('name_asc')
        ),
        name_desc: client.query<MediaAssetRow, MediaListStatementParams>(
            mediaListStatementSql('name_desc')
        ),
        largest: client.query<MediaAssetRow, MediaListStatementParams>(
            mediaListStatementSql('largest')
        ),
        smallest: client.query<MediaAssetRow, MediaListStatementParams>(
            mediaListStatementSql('smallest')
        ),
    } satisfies Record<MediaAssetListSort, ReturnType<typeof client.query>>
    const countAssetsStatement = client.query<
        { readonly total: number },
        MediaListCountStatementParams
    >(`
        select count(distinct media_assets.id) as total
        from media_assets
        left join media_representations as original_representation
            on original_representation.project_id = media_assets.project_id
           and original_representation.asset_id = media_assets.id
           and original_representation.kind = 'original'
        where media_assets.project_id = ?1
          and media_assets.state <> 'deleted'
          and media_assets.archived_at is null
          and (?2 is null or media_assets.original_filename like ?2 escape '\\')
          and (?3 is null or original_representation.family = ?3)
          and (?4 is null or media_assets.created_at >= ?4)
    `)
    const listTrashAssetsStatement = client.query<MediaAssetRow, MediaTrashListStatementParams>(`
        select ${mediaListAssetColumns}
        from media_assets
        where media_assets.project_id = ?1
          and media_assets.state = 'deletion_requested'
          and media_assets.deletion_requested_at > ?2
          and (?3 is null or media_assets.original_filename like ?3 escape '\\')
          and (
              ?4 is null
              or media_assets.deletion_requested_at < ?4
              or (media_assets.deletion_requested_at = ?4 and media_assets.id < ?5)
          )
        order by media_assets.deletion_requested_at desc, media_assets.id desc
        limit ?6
    `)
    const countTrashAssetsStatement = client.query<
        { readonly total: number },
        [string, number, string | null]
    >(`
        select count(*) as total
        from media_assets
        where project_id = ?1
          and state = 'deletion_requested'
          and deletion_requested_at > ?2
          and (?3 is null or original_filename like ?3 escape '\\')
    `)
    const loadRepresentationStatement = client.query<MediaRepresentationRow, [string, string]>(`
        select ${representationColumns}
        from media_representations
        where project_id = ?1
          and id = ?2
    `)
    const listRepresentationsStatement = client.query<MediaRepresentationRow, [string, string]>(`
        select ${representationColumns}
        from media_representations
        where project_id = ?1
          and asset_id = ?2
        order by created_at, id
    `)
    const loadIntentStatement = client.query<MediaUploadIntentRow, [string, string]>(`
        select ${intentColumns}
        from media_upload_intents
        where project_id = ?1
          and id = ?2
    `)
    const loadReservationStatement = client.query<
        { readonly assetId: string; readonly representationId: string; readonly intentId: string },
        [string, string]
    >(`
        select media_upload_intents.asset_id as assetId,
               media_upload_intents.representation_id as representationId,
               media_upload_intents.id as intentId
        from media_upload_intents
        inner join media_assets
            on media_assets.project_id = media_upload_intents.project_id
           and media_assets.id = media_upload_intents.asset_id
        inner join media_representations
            on media_representations.project_id = media_upload_intents.project_id
           and media_representations.asset_id = media_upload_intents.asset_id
           and media_representations.id = media_upload_intents.representation_id
        where media_upload_intents.project_id = ?1
          and media_upload_intents.id = ?2
    `)
    const listExpiredIntentsStatement = client.query<ExpiredIntentRow, [number]>(`
        select media_upload_intents.id,
               media_upload_intents.project_id as projectId,
               media_upload_intents.asset_id as assetId,
               media_upload_intents.representation_id as representationId,
               media_upload_intents.state,
               media_upload_intents.expected_size as expectedSize,
               media_upload_intents.max_bytes as maxBytes,
               media_upload_intents.content_type_hint as contentTypeHint,
               media_upload_intents.expires_at as expiresAt,
               media_upload_intents.upload_started_at as uploadStartedAt,
               media_upload_intents.completed_at as completedAt,
               media_upload_intents.failure_code as failureCode,
               media_upload_intents.failure_message as failureMessage,
               media_upload_intents.created_at as createdAt,
               media_upload_intents.updated_at as updatedAt,
               media_representations.object_key as objectKey
        from media_upload_intents
        inner join media_representations
            on media_representations.project_id = media_upload_intents.project_id
           and media_representations.id = media_upload_intents.representation_id
        where media_upload_intents.state in ('pending', 'uploading', 'uploaded')
          and media_upload_intents.expires_at <= ?1
        order by media_upload_intents.expires_at, media_upload_intents.id
    `)
    const listMissingRepresentationsStatement = client.query<MissingRepresentationRow, []>(`
        select media_representations.id,
               media_representations.project_id as projectId,
               media_representations.asset_id as assetId,
               media_representations.kind,
               media_representations.source_representation_id as sourceRepresentationId,
               media_representations.state,
               media_representations.store_id as storeId,
               media_representations.object_key as objectKey,
               media_representations.declared_content_type as declaredContentType,
               media_representations.detected_content_type as detectedContentType,
               media_representations.detected_format as detectedFormat,
               media_representations.family,
               media_representations.byte_size as byteSize,
               media_representations.sha256,
               media_representations.width,
               media_representations.height,
               media_representations.duration_ms as durationMs,
               media_representations.page_count as pageCount,
               media_representations.is_animated as isAnimated,
               media_representations.processor_id as processorId,
               media_representations.processor_version as processorVersion,
               media_representations.recipe_json as recipeJson,
               media_representations.failure_code as failureCode,
               media_representations.failure_message as failureMessage,
               media_representations.created_at as createdAt,
               media_representations.updated_at as updatedAt,
               media_assets.state as assetState
        from media_representations
        inner join media_assets
            on media_assets.project_id = media_representations.project_id
           and media_assets.id = media_representations.asset_id
        where media_representations.state in ('stored', 'inspecting', 'ready')
    `)
    const listDeletionCandidatesStatement = client.query<MediaAssetRow, [number]>(`
        select ${assetColumns}
        from media_assets
        where (
            (state = 'deletion_requested' and deletion_requested_at <= ?1)
            or (state = 'deleted' and exists (
                select 1 from media_representations
                where media_representations.project_id = media_assets.project_id
                  and media_representations.asset_id = media_assets.id
                  and media_representations.state = 'deletion_requested'
            ))
        )
        order by deletion_requested_at, id
    `)
    const activeBackupFenceStatement = client.query<{ id: number }, [number]>(`
        select id
        from media_backup_fences
        where id = 1
          and expires_at > ?1
        limit 1
    `)
    const listSourceUsageStatement = client.query<MediaAssetUsageRow, [string, string]>(`
        select distinct
               'post' as kind,
               posts.id as id,
               posts.id as postId,
               null as publicationId,
               posts.title as title,
               null as publicationState,
               null as scheduledAt,
               null as channelName,
               'source' as location
        from posts, json_tree(posts.source_content) as content
        where posts.project_id = ?1
          and content.type = 'text'
          and content.value = ?2
    `)
    const listDraftUsageStatement = client.query<MediaAssetUsageRow, [string, string]>(`
        select distinct
               'publication' as kind,
               publications.id as id,
               publications.post_id as postId,
               publications.id as publicationId,
               posts.title as title,
               publications.state as publicationState,
               publications.scheduled_at as scheduledAt,
               channels.name as channelName,
               'draft' as location
        from (
            select project_id, publication_id, content_json from publication_working_drafts
            union all
            select project_id, publication_id, json_extract(snapshot_json, '$.content') from publication_draft_adoptions
            union all
            select project_id, publication_id, local_content_json from publication_draft_adoptions where local_content_json is not null
        ) as drafts
        inner join publications
            on publications.project_id = drafts.project_id
           and publications.id = drafts.publication_id
        inner join posts
            on posts.project_id = publications.project_id
           and posts.id = publications.post_id
        inner join project_channel_contexts as channels
            on channels.project_id = publications.project_id
           and channels.id = publications.channel_id
        , json_tree(drafts.content_json) as content
        where drafts.project_id = ?1
          and content.type = 'text'
          and content.value = ?2
    `)
    const listTargetUsageStatement = client.query<MediaAssetUsageRow, [string, string]>(`
        select distinct
               'publication' as kind,
               publications.id as id,
               publications.post_id as postId,
               publications.id as publicationId,
               posts.title as title,
               publications.state as publicationState,
               publications.scheduled_at as scheduledAt,
               channels.name as channelName,
               'target' as location
        from publication_revision_media as revision_media
        inner join publication_target_revisions as target_revisions
            on target_revisions.project_id = revision_media.project_id
           and target_revisions.id = revision_media.target_revision_id
        inner join publications
            on publications.project_id = target_revisions.project_id
           and publications.id = target_revisions.publication_id
        inner join posts
            on posts.project_id = publications.project_id
           and posts.id = publications.post_id
        inner join project_channel_contexts as channels
            on channels.project_id = publications.project_id
           and channels.id = publications.channel_id
        where revision_media.project_id = ?1
          and revision_media.asset_id = ?2
        union
        select distinct
               'publication' as kind,
               publications.id as id,
               publications.post_id as postId,
               publications.id as publicationId,
               posts.title as title,
               publications.state as publicationState,
               publications.scheduled_at as scheduledAt,
               channels.name as channelName,
               'target' as location
        from publication_target_revisions as target_revisions
        inner join publications
            on publications.project_id = target_revisions.project_id
           and publications.id = target_revisions.publication_id
        inner join posts
            on posts.project_id = publications.project_id
           and posts.id = publications.post_id
        inner join project_channel_contexts as channels
            on channels.project_id = publications.project_id
           and channels.id = publications.channel_id
        , json_tree(target_revisions.content_json) as content
        where target_revisions.project_id = ?1
          and content.type = 'text'
          and content.value = ?2
    `)
    const listExecutionUsageStatement = client.query<MediaAssetUsageRow, [string, string]>(`
        select distinct
               'publication' as kind,
               publications.id as id,
               publications.post_id as postId,
               publications.id as publicationId,
               posts.title as title,
               publications.state as publicationState,
               publications.scheduled_at as scheduledAt,
               channels.name as channelName,
               'execution' as location
        from publication_execution_revision_media as execution_media
        inner join publication_execution_revisions as execution_revisions
            on execution_revisions.project_id = execution_media.project_id
           and execution_revisions.id = execution_media.execution_revision_id
        inner join publications
            on publications.project_id = execution_revisions.project_id
           and publications.id = execution_revisions.publication_id
        inner join posts
            on posts.project_id = publications.project_id
           and posts.id = publications.post_id
        inner join project_channel_contexts as channels
            on channels.project_id = publications.project_id
           and channels.id = publications.channel_id
        where execution_media.project_id = ?1
          and execution_media.asset_id = ?2
        union
        select distinct
               'publication' as kind,
               publications.id as id,
               publications.post_id as postId,
               publications.id as publicationId,
               posts.title as title,
               publications.state as publicationState,
               publications.scheduled_at as scheduledAt,
               channels.name as channelName,
               'execution' as location
        from publication_execution_revisions as execution_revisions
        inner join publications
            on publications.project_id = execution_revisions.project_id
           and publications.id = execution_revisions.publication_id
        inner join posts
            on posts.project_id = publications.project_id
           and posts.id = publications.post_id
        inner join project_channel_contexts as channels
            on channels.project_id = publications.project_id
           and channels.id = publications.channel_id
        , json_tree(execution_revisions.content_json) as content
        where execution_revisions.project_id = ?1
          and content.type = 'text'
          and content.value = ?2
    `)
    const countAuditUsageStatement = client.query<{ count: number }, [string, string]>(`
        select count(*) as count
        from audit_events
        where project_id = ?1
          and entity_type = 'media_asset'
          and entity_id = ?2
    `)

    const insertAssetStatement = client.query<
        void,
        [string, string, string, string | null, string, number]
    >(`
        insert into media_assets (
            id, project_id, original_filename, default_accessibility_text,
            state, created_by_actor_id, created_at, updated_at
        ) values (?1, ?2, ?3, ?4, 'reserved', ?5, ?6, ?6)
    `)
    const insertRepresentationStatement = client.query<
        void,
        [string, string, string, string, string, string | null, number]
    >(`
        insert into media_representations (
            id, project_id, asset_id, kind, state, store_id, object_key,
            declared_content_type, created_at, updated_at
        ) values (?1, ?2, ?3, 'original', 'reserved', ?4, ?5, ?6, ?7, ?7)
    `)
    const insertIntentStatement = client.query<
        void,
        [string, string, string, string, number | null, number, string | null, number, number]
    >(`
        insert into media_upload_intents (
            id, project_id, asset_id, representation_id, state, expected_size,
            max_bytes, content_type_hint, expires_at, created_at, updated_at
        ) values (?1, ?2, ?3, ?4, 'pending', ?5, ?6, ?7, ?8, ?9, ?9)
    `)

    const markIntentUploadingStatement = client.query<
        { changes: number },
        [number, string, string]
    >(`
        update media_upload_intents
        set state = 'uploading', upload_started_at = ?1, updated_at = ?1
        where project_id = ?2 and id = ?3 and state = 'pending' and expires_at > ?1
    `)
    const markIntentUploadedStatement = client.query<
        { changes: number },
        [number, string, string]
    >(`
        update media_upload_intents
        set state = 'uploaded', upload_started_at = coalesce(upload_started_at, ?1), updated_at = ?1
        where project_id = ?2 and id = ?3 and state in ('pending', 'uploading')
          and expires_at > ?1
    `)
    const markRepresentationStoredStatement = client.query<
        { changes: number },
        [number, string, string]
    >(`
        update media_representations
        set state = 'stored', updated_at = ?1
        where project_id = ?2 and id = ?3 and state = 'reserved'
    `)
    const markAssetStoredStatement = client.query<{ changes: number }, [number, string, string]>(`
        update media_assets
        set state = 'stored', updated_at = ?1
        where project_id = ?2 and id = ?3 and state = 'reserved'
    `)
    const resetIntentStatement = client.query<void, [number, string, string]>(`
        update media_upload_intents
        set state = 'pending', upload_started_at = null, updated_at = ?1
        where project_id = ?2 and id = ?3 and state = 'uploading'
    `)
    const resetRepresentationStatement = client.query<void, [number, string, string]>(`
        update media_representations
        set state = 'reserved', updated_at = ?1
        where project_id = ?2 and id = ?3 and state = 'stored'
    `)
    const resetAssetStatement = client.query<void, [number, string, string]>(`
        update media_assets
        set state = 'reserved', updated_at = ?1
        where project_id = ?2 and id = ?3 and state = 'stored'
    `)
    const markIntentFailedStatement = client.query<void, [number, string, string, string, string]>(`
        update media_upload_intents
        set state = 'failed', completed_at = ?1, failure_code = ?2,
            failure_message = ?3, updated_at = ?1
        where project_id = ?4 and id = ?5 and state in ('pending', 'uploading', 'uploaded')
    `)
    const markRepresentationFailedStatement = client.query<
        void,
        [number, string, string, string, string]
    >(`
        update media_representations
        set state = 'failed', failure_code = ?2, failure_message = ?3, updated_at = ?1
        where project_id = ?4 and id = ?5 and state in ('reserved', 'stored', 'inspecting')
    `)
    const markAssetFailedStatement = client.query<void, [number, string, string, string, string]>(`
        update media_assets
        set state = 'failed', failure_code = ?2, failure_message = ?3, updated_at = ?1
        where project_id = ?4 and id = ?5 and state in ('reserved', 'stored', 'inspecting')
    `)
    const markRepresentationInspectingStatement = client.query<void, [number, string, string]>(`
        update media_representations
        set state = 'inspecting', updated_at = ?1
        where project_id = ?2 and id = ?3 and state in ('stored', 'inspecting')
    `)
    const markAssetInspectingStatement = client.query<void, [number, string, string]>(`
        update media_assets
        set state = 'inspecting', updated_at = ?1
        where project_id = ?2 and id = ?3 and state in ('stored', 'inspecting')
    `)
    const markIntentInspectedStatement = client.query<void, [number, string, string]>(`
        update media_upload_intents
        set updated_at = ?1
        where project_id = ?2 and id = ?3 and state = 'uploaded'
    `)
    const finalizeIntentStatement = client.query<void, [number, string, string]>(`
        update media_upload_intents
        set state = 'consumed', completed_at = ?1, updated_at = ?1
        where project_id = ?2 and id = ?3 and state = 'uploaded'
    `)
    const finalizeRepresentationStatement = client.query<
        void,
        [
            number,
            string,
            string,
            string,
            number,
            string,
            number | null,
            number | null,
            number | null,
            number | null,
            number | null,
            string,
            string,
        ]
    >(`
        update media_representations
        set state = 'ready', detected_content_type = ?2, detected_format = ?3,
            family = ?4, byte_size = ?5, sha256 = ?6, width = ?7, height = ?8,
            duration_ms = ?9, page_count = ?10, is_animated = ?11,
            failure_code = null, failure_message = null, updated_at = ?1
        where project_id = ?12 and id = ?13 and state = 'inspecting'
    `)
    const finalizeAssetStatement = client.query<void, [number, string, string]>(`
        update media_assets
        set state = 'ready', failure_code = null, failure_message = null, updated_at = ?1
        where project_id = ?2 and id = ?3 and state = 'inspecting'
    `)
    const expireIntentStatement = client.query<void, [number, string, string]>(`
        update media_upload_intents
        set state = 'expired', completed_at = ?1, updated_at = ?1
        where project_id = ?2 and id = ?3 and state in ('pending', 'uploading', 'uploaded')
    `)
    const requestDeletionAssetStatement = client.query<void, [number, string, string]>(`
        update media_assets
        set deletion_restore_state = state,
            deletion_restore_failure_code = failure_code,
            deletion_restore_failure_message = failure_message,
            state = 'deletion_requested', deletion_requested_at = ?1,
            archived_at = ?1,
            failure_code = null, failure_message = null, updated_at = ?1
        where project_id = ?2 and id = ?3 and state <> 'deleted'
    `)
    const requestDeletionRepresentationsStatement = client.query<void, [number, string, string]>(`
        update media_representations
        set deletion_restore_state = state,
            deletion_restore_failure_code = failure_code,
            deletion_restore_failure_message = failure_message,
            state = 'deletion_requested', failure_code = null,
            failure_message = null, updated_at = ?1
        where project_id = ?2 and asset_id = ?3 and state <> 'deleted'
    `)
    const readDeletionRestoreSnapshotStatement = client.query<
        {
            readonly state: MediaAssetState | null
            readonly failureCode: string | null
            readonly failureMessage: string | null
            readonly deletionRequestedAt: number | null
        },
        [string, string]
    >(`
        select deletion_restore_state as state,
               deletion_restore_failure_code as failureCode,
               deletion_restore_failure_message as failureMessage,
               deletion_requested_at as deletionRequestedAt
        from media_assets
        where project_id = ?1 and id = ?2 and state = 'deletion_requested'
    `)
    const readRepresentationRestoreSnapshotsStatement = client.query<
        {
            readonly id: string
            readonly kind: 'original' | 'derived'
            readonly state: MediaRepresentationState | null
            readonly failureCode: string | null
            readonly failureMessage: string | null
        },
        [string, string]
    >(`
        select id,
               kind,
               deletion_restore_state as state,
               deletion_restore_failure_code as failureCode,
               deletion_restore_failure_message as failureMessage
        from media_representations
        where project_id = ?1 and asset_id = ?2 and state = 'deletion_requested'
    `)
    const restoreAssetStatement = client.query<void, [number, string, string]>(`
        update media_assets
        set state = deletion_restore_state, archived_at = null,
            deletion_requested_at = null, deleted_at = null,
            failure_code = deletion_restore_failure_code,
            failure_message = deletion_restore_failure_message,
            deletion_restore_state = null, deletion_restore_failure_code = null,
            deletion_restore_failure_message = null, updated_at = ?1
        where project_id = ?2 and id = ?3 and state = 'deletion_requested'
          and deletion_restore_state is not null
    `)
    const restoreRepresentationsStatement = client.query<void, [number, string, string]>(`
        update media_representations
        set state = deletion_restore_state,
            failure_code = deletion_restore_failure_code,
            failure_message = deletion_restore_failure_message,
            deletion_restore_state = null, deletion_restore_failure_code = null,
            deletion_restore_failure_message = null, updated_at = ?1
        where project_id = ?2 and asset_id = ?3 and state = 'deletion_requested'
          and deletion_restore_state is not null
    `)
    const expireAssetIntentsStatement = client.query<void, [number, string, string]>(`
        update media_upload_intents
        set state = 'expired', completed_at = ?1, updated_at = ?1
        where project_id = ?2 and asset_id = ?3
          and state in ('pending', 'uploading', 'uploaded')
    `)
    const claimAssetPurgeStatement = client.query<void, [number, string, string]>(`
        update media_assets
        set state = 'deleted', deleted_at = ?1, updated_at = ?1,
            deletion_restore_state = null,
            deletion_restore_failure_code = null,
            deletion_restore_failure_message = null
        where project_id = ?2 and id = ?3 and state = 'deletion_requested'
    `)
    const finalizeDeletedRepresentationsStatement = client.query<void, [number, string, string]>(`
        update media_representations
        set state = 'deleted', updated_at = ?1,
            deletion_restore_state = null,
            deletion_restore_failure_code = null,
            deletion_restore_failure_message = null
        where project_id = ?2 and asset_id = ?3 and state = 'deletion_requested'
    `)
    const markMissingRepresentationStatement = client.query<void, [number, string, string]>(`
        update media_representations
        set state = 'failed', failure_code = 'storage_missing',
            failure_message = 'The stored media object is no longer available', updated_at = ?1
        where project_id = ?2 and id = ?3 and state in ('stored', 'inspecting', 'ready')
    `)
    const markMissingAssetStatement = client.query<void, [number, string, string, string]>(`
        update media_assets
        set state = 'failed', failure_code = 'storage_missing',
            failure_message = 'A stored media representation is no longer available', updated_at = ?1
        where project_id = ?2 and id = ?3 and state in ('stored', 'inspecting', 'ready')
          and not exists (
              select 1 from media_representations
              where project_id = ?2 and asset_id = ?3
                and id <> ?4 and state = 'ready' and kind = 'original'
          )
    `)

    const reserveTransaction = client.transaction(
        (input: {
            readonly projectId: string
            readonly actorId: string
            readonly originalFilename: string
            readonly defaultAccessibilityText: string | null
            readonly expectedSize: number | null
            readonly contentType: string | null
            readonly createdAt: number
            readonly expiresAt: number
        }): MediaUploadReservation => {
            const assetId = requireGeneratedId(createId(), 'asset id')
            const representationId = requireGeneratedId(createId(), 'representation id')
            const intentId = requireGeneratedId(createId(), 'upload intent id')
            const objectKey = `media/${assetId}/${representationId}/original`

            insertAssetStatement.run(
                assetId,
                input.projectId,
                input.originalFilename,
                input.defaultAccessibilityText,
                input.actorId,
                input.createdAt
            )
            insertRepresentationStatement.run(
                representationId,
                input.projectId,
                assetId,
                mediaStore.storeId,
                objectKey,
                input.contentType,
                input.createdAt
            )
            insertIntentStatement.run(
                intentId,
                input.projectId,
                assetId,
                representationId,
                input.expectedSize,
                mediaStore.maxObjectBytes,
                input.contentType,
                input.expiresAt,
                input.createdAt
            )

            return buildReservation(
                loadAsset(assetId, input.projectId),
                loadRepresentation(representationId, input.projectId),
                loadIntent(intentId, input.projectId),
                mediaStore.maxObjectBytes
            )
        }
    )

    const markUploadedTransaction = client.transaction(
        (input: {
            readonly at: number
            readonly projectId: string
            readonly reservation: MediaUploadReservation
        }) => {
            const intent = markIntentUploadedStatement.run(
                input.at,
                input.projectId,
                input.reservation.intent.id
            )
            if (intent.changes === 0) return false
            markRepresentationStoredStatement.run(
                input.at,
                input.projectId,
                input.reservation.representation.id
            )
            markAssetStoredStatement.run(input.at, input.projectId, input.reservation.asset.id)
            return true
        }
    )
    const resetUploadingTransaction = client.transaction(
        (input: {
            readonly at: number
            readonly projectId: string
            readonly reservation: MediaUploadReservation
        }) => {
            resetIntentStatement.run(input.at, input.projectId, input.reservation.intent.id)
            resetRepresentationStatement.run(
                input.at,
                input.projectId,
                input.reservation.representation.id
            )
            resetAssetStatement.run(input.at, input.projectId, input.reservation.asset.id)
        }
    )
    const failUploadTransaction = client.transaction(
        (input: {
            readonly at: number
            readonly projectId: string
            readonly reservation: MediaUploadReservation
            readonly code: string
            readonly message: string
        }) => {
            markIntentFailedStatement.run(
                input.at,
                input.code,
                input.message,
                input.projectId,
                input.reservation.intent.id
            )
            markRepresentationFailedStatement.run(
                input.at,
                input.code,
                input.message,
                input.projectId,
                input.reservation.representation.id
            )
            markAssetFailedStatement.run(
                input.at,
                input.code,
                input.message,
                input.projectId,
                input.reservation.asset.id
            )
        }
    )
    const markInspectingTransaction = client.transaction(
        (input: {
            readonly at: number
            readonly projectId: string
            readonly reservation: MediaUploadReservation
        }) => {
            markIntentInspectedStatement.run(input.at, input.projectId, input.reservation.intent.id)
            markRepresentationInspectingStatement.run(
                input.at,
                input.projectId,
                input.reservation.representation.id
            )
            markAssetInspectingStatement.run(input.at, input.projectId, input.reservation.asset.id)
        }
    )
    const finalizeReadyTransaction = client.transaction(
        (input: {
            readonly at: number
            readonly projectId: string
            readonly reservation: MediaUploadReservation
            readonly inspection: {
                readonly contentType: string
                readonly format: string
                readonly family: string
                readonly width: number | null
                readonly height: number | null
                readonly durationMs: number | null
                readonly pageCount: number | null
                readonly isAnimated: boolean | null
            }
            readonly byteSize: number
            readonly sha256: string
        }) => {
            finalizeIntentStatement.run(input.at, input.projectId, input.reservation.intent.id)
            finalizeRepresentationStatement.run(
                input.at,
                input.inspection.contentType,
                input.inspection.format,
                input.inspection.family,
                input.byteSize,
                input.sha256,
                input.inspection.width,
                input.inspection.height,
                input.inspection.durationMs,
                input.inspection.pageCount,
                input.inspection.isAnimated === null ? null : input.inspection.isAnimated ? 1 : 0,
                input.projectId,
                input.reservation.representation.id
            )
            finalizeAssetStatement.run(input.at, input.projectId, input.reservation.asset.id)
        }
    )
    const expireTransaction = client.transaction(
        (input: {
            readonly at: number
            readonly projectId: string
            readonly reservation: MediaUploadReservation
        }) => {
            expireIntentStatement.run(input.at, input.projectId, input.reservation.intent.id)
            markRepresentationFailedStatement.run(
                input.at,
                'upload_expired',
                'The media upload intent expired before finalization',
                input.projectId,
                input.reservation.representation.id
            )
            markAssetFailedStatement.run(
                input.at,
                'upload_expired',
                'The media upload intent expired before finalization',
                input.projectId,
                input.reservation.asset.id
            )
        }
    )
    const requestDeletionTransaction = client.transaction(
        (input: { readonly at: number; readonly projectId: string; readonly assetId: string }) => {
            requestDeletionAssetStatement.run(input.at, input.projectId, input.assetId)
            requestDeletionRepresentationsStatement.run(input.at, input.projectId, input.assetId)
            expireAssetIntentsStatement.run(input.at, input.projectId, input.assetId)
        }
    )
    const restoreDeletionTransaction = client.transaction(
        (input: {
            readonly at: number
            readonly projectId: string
            readonly assetId: string
        }): RestoreMediaDeletionResult => {
            const snapshot = readDeletionRestoreSnapshotStatement.get(
                input.projectId,
                input.assetId
            )
            if (snapshot === null) return { kind: 'not_found' }
            if (
                snapshot.deletionRequestedAt === null ||
                input.at >=
                    safeAdd(
                        snapshot.deletionRequestedAt,
                        deletionGracePeriodMs,
                        'deletion grace period'
                    )
            ) {
                return { kind: 'expired' }
            }
            if (snapshot.state !== 'ready') {
                return { kind: 'not_restorable' }
            }

            const representationSnapshots = readRepresentationRestoreSnapshotsStatement.all(
                input.projectId,
                input.assetId
            )
            if (
                representationSnapshots.length === 0 ||
                !representationSnapshots.some(
                    representation =>
                        representation.kind === 'original' && representation.state === 'ready'
                ) ||
                representationSnapshots.some(
                    representation =>
                        representation.state === null ||
                        representation.state === 'deletion_requested' ||
                        representation.state === 'deleted' ||
                        representation.state === 'reserved' ||
                        representation.state === 'stored' ||
                        representation.state === 'inspecting'
                )
            ) {
                return { kind: 'not_restorable' }
            }

            assertMediaAssetTransition('deletion_requested', snapshot.state)
            for (const representation of representationSnapshots) {
                assertMediaRepresentationTransition('deletion_requested', representation.state!)
            }

            const restoredRepresentations = restoreRepresentationsStatement.run(
                input.at,
                input.projectId,
                input.assetId
            )
            const restoredAsset = restoreAssetStatement.run(
                input.at,
                input.projectId,
                input.assetId
            )
            if (
                restoredAsset.changes !== 1 ||
                restoredRepresentations.changes !== representationSnapshots.length
            ) {
                throw new DomainInvariantError(
                    'invalid_transition',
                    'Media deletion could not be restored consistently'
                )
            }

            const media = readMedia(input.projectId, input.assetId)
            return media === null ? { kind: 'not_found' } : { kind: 'restored', media }
        }
    )
    const markMissingTransaction = client.transaction(
        (input: { readonly at: number; readonly representation: MissingRepresentationRow }) => {
            markMissingRepresentationStatement.run(
                input.at,
                input.representation.projectId,
                input.representation.id
            )
            markMissingAssetStatement.run(
                input.at,
                input.representation.projectId,
                input.representation.assetId,
                input.representation.id
            )
        }
    )

    function loadAsset(assetId: string, projectId: string): MediaAssetRow {
        const row = loadAssetStatement.get(projectId, assetId)
        if (row === null)
            throw new DomainInvariantError('invalid_input', 'Media asset was not persisted')
        return row
    }

    function loadRepresentation(
        representationId: string,
        projectId: string
    ): MediaRepresentationRow {
        const row = loadRepresentationStatement.get(projectId, representationId)
        if (row === null) {
            throw new DomainInvariantError(
                'invalid_input',
                'Media representation was not persisted'
            )
        }
        return row
    }

    function loadIntent(intentId: string, projectId: string): MediaUploadIntentRow {
        const row = loadIntentStatement.get(projectId, intentId)
        if (row === null)
            throw new DomainInvariantError('invalid_input', 'Media upload was not persisted')
        return row
    }

    function loadReservation(projectId: string, intentId: string): MediaUploadReservation | null {
        const relation = loadReservationStatement.get(projectId, intentId)
        if (relation === null) return null
        return buildReservation(
            loadAsset(relation.assetId, projectId),
            loadRepresentation(relation.representationId, projectId),
            loadIntent(relation.intentId, projectId),
            mediaStore.maxObjectBytes
        )
    }

    function hasProjectAccess(projectId: string, subjectId: string): boolean {
        return loadProjectActorStatement.get(projectId, subjectId) !== null
    }

    function readMedia(projectId: string, assetId: string): MediaAssetReference | null {
        const asset = loadAssetStatement.get(projectId, assetId)
        if (asset === null) return null
        return {
            asset: toMediaAsset(asset),
            representations: listRepresentationsStatement
                .all(projectId, assetId)
                .map(toMediaRepresentation),
        }
    }

    async function openRepresentationContent(
        media: MediaAssetReference,
        representationId: string,
        range?: { readonly start: number; readonly end: number }
    ): Promise<MediaAssetContent | null> {
        const representation = media.representations.find(
            candidate =>
                candidate.id === representationId &&
                ['ready', 'deletion_requested'].includes(candidate.state)
        )
        if (
            representation === undefined ||
            representation.storeId !== mediaStore.storeId ||
            representation.byteSize === null ||
            representation.detectedContentType === null ||
            representation.sha256 === null
        ) {
            return null
        }

        const opened = await mediaStore.open(representation.objectKey, {
            range,
            maxBytes: mediaStore.maxObjectBytes,
        })
        if (opened === null || opened.metadata.size !== representation.byteSize) return null

        return {
            representation,
            size: opened.metadata.size,
            contentType: representation.detectedContentType,
            sha256: representation.sha256,
            lastModified: opened.metadata.lastModified,
            stream: opened.stream,
        }
    }

    async function failFinalization(
        projectId: string,
        intentId: string,
        reservation: MediaUploadReservation,
        at: number,
        code: string,
        message: string
    ): Promise<FinalizeMediaUploadResult> {
        failUploadTransaction.immediate({
            at,
            projectId,
            reservation,
            code: normalizeFailureCode(code),
            message,
        })
        const failed = loadReservation(projectId, intentId)
        return failed === null ? { kind: 'not_found' } : { kind: 'failed', reservation: failed }
    }

    async function expireReservation(
        projectId: string,
        intentId: string,
        reservation: MediaUploadReservation,
        at: number
    ): Promise<void> {
        await mediaStore.delete(reservation.representation.objectKey)
        expireTransaction.immediate({ at, projectId, reservation })
    }

    async function missingImagePreviews(
        media: MediaAssetReference,
        repairMetadata = false
    ): Promise<ImagePreviewVariant[]> {
        const missing: ImagePreviewVariant[] = []
        for (const variant of Object.keys(imagePreviewPresets) as ImagePreviewVariant[]) {
            const candidates = media.representations.filter(
                item =>
                    item.kind === 'derived' &&
                    item.state === 'ready' &&
                    item.processorId === imagePreviewProcessor &&
                    item.processorVersion === imagePreviewVersion &&
                    item.recipeJson !== null &&
                    JSON.parse(item.recipeJson).variant === variant
            )
            let available = false
            for (const candidate of candidates) {
                if ((await mediaStore.stat(candidate.objectKey)) !== null) available = true
                else if (repairMetadata)
                    markMissingRepresentationStatement.run(
                        requireTimestamp(now(), 'now'),
                        media.asset.projectId,
                        candidate.id
                    )
            }
            if (!available) missing.push(variant)
        }
        return missing
    }

    async function ensureImagePreviews(
        projectId: string,
        assetId: string,
        source: MediaRepresentation,
        requiredState: 'inspecting' | 'ready',
        timestamp: number
    ): Promise<boolean> {
        await previewGeneration.get(assetId)
        const asset = readMedia(projectId, assetId)
        if (asset === null || asset.asset.state !== requiredState) return false
        const missing = await missingImagePreviews(asset, true)
        if (missing.length === 0) return true
        let releasePreview!: () => void
        previewGeneration.set(
            assetId,
            new Promise<void>(resolve => {
                releasePreview = resolve
            })
        )
        try {
            const poster =
                source.family === 'video'
                    ? await options.videoPoster?.(source.objectKey)
                    : undefined
            if (source.family === 'video' && !poster) throw new Error('Video poster unavailable')
            await generateImagePreviews(
                mediaStore,
                source.objectKey,
                async (variant, blob, width, height, placeholder) => {
                    if (readMedia(projectId, assetId)?.asset.state !== requiredState) {
                        throw new Error('Image import no longer active')
                    }
                    const id = crypto.randomUUID()
                    const objectKey = `previews/${projectId}/${assetId}/${id}.webp`
                    // Register ownership before storage writes, including partially failed writes.
                    client
                        .query(`insert into media_representations
                                (id, project_id, asset_id, kind, source_representation_id, state,
                                 store_id, object_key, processor_id, processor_version, recipe_json,
                                 created_at, updated_at)
                                values (?, ?, ?, 'derived', ?, 'reserved', ?, ?, ?, ?, ?, ?, ?)`)
                        .run(
                            id,
                            projectId,
                            assetId,
                            source.id,
                            mediaStore.storeId,
                            objectKey,
                            imagePreviewProcessor,
                            imagePreviewVersion,
                            JSON.stringify({ variant, placeholder }),
                            timestamp,
                            timestamp
                        )
                    try {
                        await mediaStore.put(objectKey, blob.stream(), {
                            expectedSize: blob.size,
                            contentType: 'image/webp',
                        })
                        const sha256 = createHash('sha256')
                            .update(new Uint8Array(await blob.arrayBuffer()))
                            .digest('hex')
                        createDatabaseTransaction(database, () => {
                            client
                                .query(`update media_representations set state = 'ready',
                                    declared_content_type = 'image/webp', detected_content_type = 'image/webp',
                                    detected_format = 'webp', family = 'image', byte_size = ?, sha256 = ?,
                                    width = ?, height = ?, is_animated = 0 where id = ? and state = 'reserved'`)
                                .run(blob.size, sha256, width, height, id)
                            if (
                                source.family === 'video' &&
                                variant === missing[missing.length - 1]
                            )
                                createEventJournalStore(database).append({
                                    projectId,
                                    actorId: asset.asset.createdByActorId,
                                    name: 'project.media_previews.updated',
                                    version: 1,
                                    subject: { type: 'project', id: projectId },
                                    payload: {},
                                    occurredAt: timestamp,
                                })
                        }).immediate()
                    } catch {
                        client
                            .query(`update media_representations set state = 'failed',
                                    failure_code = 'preview_generation_failed',
                                    failure_message = 'The image preview could not be generated' where id = ? and state = 'reserved'`)
                            .run(id)
                        throw new Error('Image preview storage failed')
                    }
                },
                missing,
                poster
            )
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') return false
            // Preview failure must not discard a verified original. Never expose codec errors.
            if (
                source.family === 'video' &&
                readMedia(projectId, assetId)?.asset.state === 'ready'
            ) {
                client
                    .query(`insert into media_representations
                    (id, project_id, asset_id, kind, source_representation_id, state, store_id,
                     object_key, processor_id, processor_version, recipe_json, failure_code, failure_message, created_at, updated_at)
                    values (?, ?, ?, 'derived', ?, 'failed', ?, ?, 'postdot-video-poster', '1', '{}',
                    'poster_generation_failed', 'Video preview unavailable', ?, ?)`)
                    .run(
                        crypto.randomUUID(),
                        projectId,
                        assetId,
                        source.id,
                        mediaStore.storeId,
                        `previews/${projectId}/${assetId}/${crypto.randomUUID()}.webp`,
                        timestamp,
                        timestamp
                    )
            }
            console.error('[postdot-media] Preview generation failed')
            return false
        } finally {
            previewGeneration.delete(assetId)
            releasePreview()
        }
        return true
    }

    async function inspectAndFinalize(
        projectId: string,
        intentId: string,
        initial: MediaUploadReservation
    ): Promise<FinalizeMediaUploadResult> {
        if (initial.intent.state === 'consumed' && initial.asset.state === 'ready') {
            return { kind: 'ready', reservation: initial }
        }
        if (initial.intent.state === 'expired' || initial.intent.state === 'failed') {
            return { kind: 'failed', reservation: initial }
        }
        if (initial.intent.state === 'uploading') {
            return { kind: 'pending', reservation: initial }
        }

        let reservation = initial
        const timestamp = requireTimestamp(now(), 'now')
        if (timestamp >= reservation.intent.expiresAt) {
            await expireReservation(projectId, intentId, reservation, timestamp)
            const expired = loadReservation(projectId, intentId)
            return expired === null
                ? { kind: 'not_found' }
                : { kind: 'failed', reservation: expired }
        }

        if (reservation.intent.state === 'pending') {
            if ((await mediaStore.stat(reservation.representation.objectKey)) === null) {
                return { kind: 'pending', reservation }
            }
            if (!markUploadedTransaction.immediate({ at: timestamp, projectId, reservation })) {
                throw new DomainInvariantError(
                    'write_conflict',
                    'The media upload changed while it was being finalized'
                )
            }
            reservation = loadReservation(projectId, intentId) ?? reservation
        }
        if (reservation.intent.state !== 'uploaded') {
            return { kind: 'pending', reservation }
        }

        markInspectingTransaction.immediate({ at: timestamp, projectId, reservation })
        const inspecting = loadReservation(projectId, intentId)
        if (inspecting === null) return { kind: 'not_found' }

        let opened: {
            readonly metadata: MediaObjectMetadata
            readonly stream: ReadableStream<Uint8Array>
        } | null
        try {
            opened = await mediaStore.open(inspecting.representation.objectKey, {
                maxBytes: mediaStore.maxObjectBytes,
            })
        } catch (error) {
            if (error instanceof MediaStoreError && isPermanentMediaStoreFailure(error)) {
                return failFinalization(
                    projectId,
                    intentId,
                    inspecting,
                    timestamp,
                    error.code,
                    publicMediaStoreFailureMessage(error)
                )
            }
            throw error
        }
        if (opened === null) {
            return failFinalization(
                projectId,
                intentId,
                inspecting,
                timestamp,
                'storage_missing',
                'The stored media object is no longer available'
            )
        }

        try {
            const scanned = await scanObject(opened, inspectionLimits)
            if (scanned.size !== opened.metadata.size) {
                return failFinalization(
                    projectId,
                    intentId,
                    inspecting,
                    timestamp,
                    'size_mismatch',
                    'The stored media size changed during verification'
                )
            }
            if (
                inspecting.intent.expectedSize !== null &&
                scanned.size !== inspecting.intent.expectedSize
            ) {
                return failFinalization(
                    projectId,
                    intentId,
                    inspecting,
                    timestamp,
                    'size_mismatch',
                    'The stored media does not match the expected upload size'
                )
            }

            const inspection = scanned.video ?? inspectors.inspect(scanned.header, inspectionLimits)
            if (inspection === null) {
                return failFinalization(
                    projectId,
                    intentId,
                    inspecting,
                    timestamp,
                    'unsupported_format',
                    'The stored bytes do not match a verified supported media format'
                )
            }

            if (
                inspection.family === 'image' &&
                inspection.isAnimated !== true &&
                ['image/jpeg', 'image/png', 'image/webp'].includes(inspection.contentType)
            ) {
                await ensureImagePreviews(
                    projectId,
                    inspecting.asset.id,
                    inspecting.representation,
                    'inspecting',
                    timestamp
                )
            }

            finalizeReadyTransaction.immediate({
                at: timestamp,
                projectId,
                reservation: inspecting,
                inspection,
                byteSize: scanned.size,
                sha256: scanned.sha256,
            })
            const ready = loadReservation(projectId, intentId)
            if (ready?.asset.state === 'ready' && inspection.family === 'video') {
                try {
                    options.onVideoReady?.(projectId, ready.asset.id)
                } catch {
                    console.error('[postdot-media] Poster wakeup failed')
                }
            }
            if (ready === null) return { kind: 'not_found' }
            return ready.asset.state === 'ready' && ready.representation.state === 'ready'
                ? { kind: 'ready', reservation: ready }
                : { kind: 'pending', reservation: ready }
        } catch (error) {
            if (error instanceof MediaStoreError && isPermanentMediaStoreFailure(error)) {
                return failFinalization(
                    projectId,
                    intentId,
                    inspecting,
                    timestamp,
                    error.code,
                    publicMediaStoreFailureMessage(error)
                )
            }
            throw error
        }
    }

    async function purgeInternal(
        projectId: string,
        assetId: string,
        at: number,
        gracePeriodMs: number
    ): Promise<PurgeMediaAssetResult> {
        // Finish writes before physical deletion; a delayed put must not recreate a purged file.
        await previewGeneration.get(assetId)
        if (activeBackupFenceStatement.get(at) !== null) {
            return { kind: 'blocked', reason: 'backup_in_progress' }
        }
        const media = readMedia(projectId, assetId)
        if (media === null) return { kind: 'not_found' }
        const purgeWasClaimed = media.asset.state === 'deleted'
        if (!purgeWasClaimed && media.asset.state !== 'deletion_requested') {
            return { kind: 'not_found' }
        }
        if (!purgeWasClaimed) {
            if (
                media.asset.deletionRequestedAt === null ||
                at <
                    safeAdd(media.asset.deletionRequestedAt, gracePeriodMs, 'deletion grace period')
            ) {
                return { kind: 'blocked', reason: 'grace_period' }
            }
            if (hasMediaReference(client, projectId, assetId)) {
                return { kind: 'blocked', reason: 'referenced' }
            }

            const claimed = claimAssetPurgeStatement.run(at, projectId, assetId)
            if (claimed.changes !== 1) return { kind: 'not_found' }
        } else if (!media.representations.some(item => item.state === 'deletion_requested')) {
            return { kind: 'not_found' }
        }

        for (const representation of media.representations) {
            if (representation.state === 'deletion_requested') {
                await mediaStore.delete(representation.objectKey)
            }
        }
        finalizeDeletedRepresentationsStatement.run(at, projectId, assetId)
        const deleted = readMedia(projectId, assetId)
        return deleted === null ? { kind: 'not_found' } : { kind: 'deleted', media: deleted }
    }

    return {
        listPendingVideoPreviews() {
            return client
                .query<{ projectId: string; id: string }, []>(`
                select a.project_id as projectId, a.id from media_assets a
                where a.state = 'ready' and a.archived_at is null
                and exists (select 1 from media_representations r where r.asset_id = a.id
                    and r.kind = 'original' and r.state = 'ready' and r.family = 'video')
                and not exists (select 1 from media_representations r where r.asset_id = a.id
                    and r.processor_id = 'postdot-video-poster' and r.processor_version = '1' and r.state = 'failed')
                and (select count(distinct json_extract(r.recipe_json, '$.variant')) from media_representations r
                    where r.asset_id = a.id and r.processor_id = 'postdot-image-preview'
                    and r.processor_version = '1' and r.state = 'ready') < 2
            `)
                .all()
        },
        async generateVideoPreviews(projectId: string, assetId: string) {
            const asset = readMedia(projectId, assetId)
            const source = asset?.representations.find(
                item =>
                    item.kind === 'original' && item.state === 'ready' && item.family === 'video'
            )
            if (!source || asset?.asset.state !== 'ready' || asset.asset.archivedAt !== null)
                return false
            return ensureImagePreviews(
                projectId,
                assetId,
                source,
                'ready',
                requireTimestamp(now(), 'now')
            )
        },
        /** Offline maintenance only; the caller must hold the database runtime lock. */
        async generateMissingImagePreviews(
            options: { readonly projectId?: string; readonly dryRun?: boolean } = {}
        ) {
            const report = { eligible: 0, generated: 0, alreadyReady: 0, failed: 0 }
            const rows = client
                .query<{ id: string; projectId: string }, [string | null]>(`
                select media_assets.id, media_assets.project_id as projectId from media_assets
                where media_assets.state = 'ready' and media_assets.archived_at is null
                  and (?1 is null or media_assets.project_id = ?1)
                  and exists (select 1 from media_representations r
                    where r.project_id = media_assets.project_id and r.asset_id = media_assets.id
                      and r.kind = 'original' and r.state = 'ready' and coalesce(r.is_animated, 0) = 0
                      and r.detected_content_type in ('image/jpeg', 'image/png', 'image/webp'))
                order by media_assets.id`)
                .all(options.projectId ?? null)
            for (const row of rows) {
                const asset = readMedia(row.projectId, row.id)!
                const source = asset.representations.find(
                    item => item.kind === 'original' && item.state === 'ready'
                )!
                report.eligible++
                if ((await missingImagePreviews(asset)).length === 0) {
                    report.alreadyReady++
                    continue
                }
                if (options.dryRun) continue
                if (
                    await ensureImagePreviews(
                        row.projectId,
                        row.id,
                        source,
                        'ready',
                        requireTimestamp(now(), 'now')
                    )
                )
                    report.generated++
                else report.failed++
            }
            return report
        },

        getUploadPolicy(projectId: string, subjectId: string): MediaUploadPolicy | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const normalizedSubjectId = requireNonBlank(subjectId, 'subjectId')
            if (!hasProjectAccess(normalizedProjectId, normalizedSubjectId)) return null

            return {
                allowedContentTypes: [...defaultMediaUploadContentTypes],
                maxFileSize: mediaStore.maxObjectBytes,
            }
        },

        reserveUpload(input: ReserveMediaUploadInput): MediaUploadReservation | null {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const actor = loadProjectActorStatement.get(projectId, subjectId)
            if (actor === null) return null

            const createdAt = requireTimestamp(now(), 'now')
            return reserveTransaction.immediate({
                projectId,
                actorId: actor.id,
                originalFilename: normalizeFilename(input.originalFilename),
                defaultAccessibilityText: normalizeOptionalText(
                    input.defaultAccessibilityText,
                    'defaultAccessibilityText'
                ),
                expectedSize: normalizeExpectedSize(input.expectedSize, mediaStore.maxObjectBytes),
                contentType: normalizeOptionalContentType(input.contentType),
                createdAt,
                expiresAt: safeAdd(createdAt, uploadIntentTtlMs, 'upload intent expiry'),
            })
        },

        async upload(input: UploadMediaInput): Promise<MediaUploadResult> {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const intentId = requireNonBlank(input.intentId, 'intentId')
            if (!hasProjectAccess(projectId, subjectId)) return { kind: 'not_found' }

            const reservation = loadReservation(projectId, intentId)
            if (reservation === null) return { kind: 'not_found' }
            if (reservation.intent.state === 'consumed') {
                return { kind: 'already_complete', reservation }
            }
            if (reservation.intent.state === 'expired' || reservation.intent.state === 'failed') {
                return { kind: 'expired' }
            }
            if (reservation.intent.state !== 'pending') return { kind: 'busy' }

            const timestamp = requireTimestamp(now(), 'now')
            if (timestamp >= reservation.intent.expiresAt) {
                await expireReservation(projectId, intentId, reservation, timestamp)
                return { kind: 'expired' }
            }
            if (markIntentUploadingStatement.run(timestamp, projectId, intentId).changes === 0) {
                return { kind: 'busy' }
            }

            try {
                await mediaStore.put(reservation.representation.objectKey, input.source, {
                    contentType: reservation.intent.contentTypeHint ?? undefined,
                    expectedSize: reservation.intent.expectedSize ?? undefined,
                    maxBytes: reservation.intent.maxBytes,
                })
            } catch (error) {
                let removed = false
                try {
                    await mediaStore.delete(reservation.representation.objectKey)
                    removed = true
                } catch {
                    // Reconciliation will revisit an uploading intent whose object could not be removed.
                }
                if (removed && isPermanentMediaStoreFailure(error)) {
                    failUploadTransaction.immediate({
                        at: requireTimestamp(now(), 'now'),
                        projectId,
                        reservation,
                        code: normalizeFailureCode(
                            error instanceof MediaStoreError ? error.code : 'upload_failed'
                        ),
                        message: publicMediaStoreFailureMessage(error),
                    })
                } else if (removed) {
                    resetUploadingTransaction.immediate({
                        at: requireTimestamp(now(), 'now'),
                        projectId,
                        reservation,
                    })
                }
                throw error
            }

            const uploadedAt = requireTimestamp(now(), 'now')
            if (!markUploadedTransaction.immediate({ at: uploadedAt, projectId, reservation })) {
                await mediaStore.delete(reservation.representation.objectKey)
                return { kind: 'expired' }
            }
            const uploaded = loadReservation(projectId, intentId)
            return uploaded === null
                ? { kind: 'not_found' }
                : { kind: 'uploaded', reservation: uploaded }
        },

        async finalizeUpload(input: FinalizeMediaUploadInput): Promise<FinalizeMediaUploadResult> {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const intentId = requireNonBlank(input.intentId, 'intentId')
            if (!hasProjectAccess(projectId, subjectId)) return { kind: 'not_found' }
            const reservation = loadReservation(projectId, intentId)
            return reservation === null
                ? { kind: 'not_found' }
                : inspectAndFinalize(projectId, intentId, reservation)
        },

        getAsset(
            projectId: string,
            assetId: string,
            subjectId: string
        ): MediaAssetReference | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            if (!hasProjectAccess(normalizedProjectId, requireNonBlank(subjectId, 'subjectId'))) {
                return null
            }
            const media = readMedia(normalizedProjectId, requireNonBlank(assetId, 'assetId'))
            return media === null || media.asset.archivedAt !== null ? null : media
        },

        getAssetUsage(
            projectId: string,
            assetId: string,
            subjectId: string
        ): MediaAssetUsageSummary | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const normalizedSubjectId = requireNonBlank(subjectId, 'subjectId')
            const normalizedAssetId = requireNonBlank(assetId, 'assetId')
            if (!hasProjectAccess(normalizedProjectId, normalizedSubjectId)) return null

            const media = readMedia(normalizedProjectId, normalizedAssetId)
            if (media === null || media.asset.archivedAt !== null) return null

            const usageRows = [
                ...listSourceUsageStatement.all(normalizedProjectId, normalizedAssetId),
                ...listDraftUsageStatement.all(normalizedProjectId, normalizedAssetId),
                ...listTargetUsageStatement.all(normalizedProjectId, normalizedAssetId),
                ...listExecutionUsageStatement.all(normalizedProjectId, normalizedAssetId),
            ]
            const auditEvents =
                countAuditUsageStatement.get(normalizedProjectId, normalizedAssetId)?.count ?? 0

            return buildMediaAssetUsage(normalizedAssetId, usageRows, auditEvents)
        },

        async openAssetContent(
            projectId: string,
            assetId: string,
            subjectId: string,
            range?: { readonly start: number; readonly end: number },
            variant?: ImagePreviewVariant
        ): Promise<MediaAssetContent | null> {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            if (!hasProjectAccess(normalizedProjectId, requireNonBlank(subjectId, 'subjectId'))) {
                return null
            }
            const media = readMedia(normalizedProjectId, requireNonBlank(assetId, 'assetId'))
            if (media === null || !['ready', 'deletion_requested'].includes(media.asset.state)) {
                return null
            }

            const preview =
                variant === undefined
                    ? undefined
                    : media.representations.find(
                          candidate =>
                              candidate.kind === 'derived' &&
                              candidate.processorId === imagePreviewProcessor &&
                              candidate.processorVersion === imagePreviewVersion &&
                              ['ready', 'deletion_requested'].includes(candidate.state) &&
                              candidate.recipeJson !== null &&
                              JSON.parse(candidate.recipeJson).variant === variant
                      )
            const representation =
                preview ??
                media.representations.find(
                    candidate =>
                        candidate.kind === 'original' &&
                        ['ready', 'deletion_requested'].includes(candidate.state)
                )
            return representation === undefined
                ? null
                : openRepresentationContent(media, representation.id, range)
        },

        async openRepresentationContent(
            projectId: string,
            assetId: string,
            representationId: string
        ): Promise<MediaAssetContent | null> {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const normalizedAssetId = requireNonBlank(assetId, 'assetId')
            const normalizedRepresentationId = requireNonBlank(representationId, 'representationId')
            const media = readMedia(normalizedProjectId, normalizedAssetId)
            if (media === null || !['ready', 'deletion_requested'].includes(media.asset.state)) {
                return null
            }
            const representation = media.representations.find(
                candidate =>
                    candidate.id === normalizedRepresentationId &&
                    ['ready', 'deletion_requested'].includes(candidate.state)
            )
            return representation === undefined
                ? null
                : openRepresentationContent(media, representation.id)
        },

        async openPublicRepresentationContent(
            projectId: string,
            assetId: string,
            representationId: string
        ): Promise<MediaAssetContent | null> {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const normalizedAssetId = requireNonBlank(assetId, 'assetId')
            const normalizedRepresentationId = requireNonBlank(representationId, 'representationId')
            const media = readMedia(normalizedProjectId, normalizedAssetId)
            if (media === null || !['ready', 'deletion_requested'].includes(media.asset.state)) {
                return null
            }

            const representation = media.representations.find(
                candidate =>
                    candidate.id === normalizedRepresentationId &&
                    ['ready', 'deletion_requested'].includes(candidate.state)
            )
            return representation === undefined
                ? null
                : openRepresentationContent(media, representation.id)
        },

        listAssetsPage(input: ListMediaAssetsInput): MediaAssetListPage | null {
            const normalizedProjectId = requireNonBlank(input.projectId, 'projectId')
            if (
                !hasProjectAccess(
                    normalizedProjectId,
                    requireNonBlank(input.subjectId, 'subjectId')
                )
            ) {
                return null
            }

            const limit = input.limit ?? DEFAULT_MEDIA_LIST_LIMIT
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_MEDIA_LIST_LIMIT) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `media list limit must be between 1 and ${MAX_MEDIA_LIST_LIMIT}`
                )
            }

            const search = normalizeMediaSearch(input.search)
            const searchPattern = search === null ? null : `%${escapeLikePattern(search)}%`
            const timestamp = requireTimestamp(now(), 'now')
            const trashCutoff = timestamp - deletionGracePeriodMs
            const trashCount =
                countTrashAssetsStatement.get(normalizedProjectId, trashCutoff, null)?.total ?? 0
            const view = input.view ?? 'library'

            if (view === 'trash') {
                const cursor = parseMediaAssetCursor(input.cursor, 'newest')
                const total =
                    search === null
                        ? trashCount
                        : (countTrashAssetsStatement.get(
                              normalizedProjectId,
                              trashCutoff,
                              searchPattern
                          )?.total ?? 0)
                const rows = listTrashAssetsStatement.all(
                    normalizedProjectId,
                    trashCutoff,
                    searchPattern,
                    cursor === null ? null : (cursor.key as number),
                    cursor?.id ?? null,
                    limit + 1
                )
                const hasMore = rows.length > limit
                const pageRows = rows.slice(0, limit)
                const pageData = pageRows.map(asset => ({
                    asset,
                    representations: listRepresentationsStatement.all(
                        normalizedProjectId,
                        asset.id
                    ),
                }))
                const items = pageData.map(({ asset, representations }) => ({
                    asset: toMediaAsset(asset),
                    representations: representations.map(toMediaRepresentation),
                }))
                const restorableAssetIds = pageData
                    .filter(({ asset, representations }) =>
                        hasRestorableMediaSnapshot(asset, representations)
                    )
                    .map(({ asset }) => asset.id)
                const last = hasMore ? items.at(-1) : undefined
                return {
                    items,
                    restorableAssetIds,
                    total,
                    trashCount,
                    retentionMs: deletionGracePeriodMs,
                    nextCursor:
                        last === undefined
                            ? null
                            : encodeMediaAssetCursor({
                                  sort: 'newest',
                                  key: last.asset.deletionRequestedAt!,
                                  id: last.asset.id,
                              }),
                }
            }

            const sort = normalizeMediaListSort(input.sort)
            const family = normalizeMediaFamilyFilter(input.family)
            const date = normalizeMediaDateFilter(input.date)
            const cursor = parseMediaAssetCursor(input.cursor, sort)
            const createdAfter = mediaDateFilterSince(date, timestamp)
            const cursorKey = cursor?.key ?? null
            const totalRow = countAssetsStatement.get(
                normalizedProjectId,
                searchPattern,
                family,
                createdAfter
            )
            const total = totalRow?.total ?? 0
            const rows = listAssetsStatements[sort].all(
                normalizedProjectId,
                searchPattern,
                family,
                createdAfter,
                cursorKey,
                cursor?.id ?? null,
                limit + 1
            )
            const hasMore = rows.length > limit
            const pageRows = rows.slice(0, limit)
            const items = pageRows.map(asset => ({
                asset: toMediaAsset(asset),
                representations: listRepresentationsStatement
                    .all(normalizedProjectId, asset.id)
                    .map(toMediaRepresentation),
            }))
            const last = hasMore ? items.at(-1) : undefined

            return {
                items,
                restorableAssetIds: [],
                total,
                trashCount,
                retentionMs: deletionGracePeriodMs,
                nextCursor:
                    last === undefined
                        ? null
                        : encodeMediaAssetCursor({
                              sort,
                              key: mediaAssetSortKey(last, sort),
                              id: last.asset.id,
                          }),
            }
        },

        requestDeletion(
            projectId: string,
            assetId: string,
            subjectId: string
        ): RequestMediaDeletionResult {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const normalizedAssetId = requireNonBlank(assetId, 'assetId')
            if (!hasProjectAccess(normalizedProjectId, requireNonBlank(subjectId, 'subjectId'))) {
                return { kind: 'not_found' }
            }
            const media = readMedia(normalizedProjectId, normalizedAssetId)
            if (media === null) return { kind: 'not_found' }
            if (media.asset.state === 'deletion_requested') {
                return { kind: 'already_requested', media }
            }
            if (media.asset.state === 'deleted') return { kind: 'not_found' }
            if (hasMediaReference(client, normalizedProjectId, normalizedAssetId)) {
                return { kind: 'blocked', reason: 'referenced' }
            }
            assertMediaAssetTransition(media.asset.state, 'deletion_requested')
            for (const representation of media.representations) {
                assertMediaRepresentationTransition(representation.state, 'deletion_requested')
            }
            requestDeletionTransaction.immediate({
                at: requireTimestamp(now(), 'now'),
                projectId: normalizedProjectId,
                assetId: normalizedAssetId,
            })
            const requested = readMedia(normalizedProjectId, normalizedAssetId)
            return requested === null
                ? { kind: 'not_found' }
                : { kind: 'requested', media: requested }
        },

        restoreDeletion(
            projectId: string,
            assetId: string,
            subjectId: string,
            at?: number
        ): RestoreMediaDeletionResult {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const normalizedAssetId = requireNonBlank(assetId, 'assetId')
            if (!hasProjectAccess(normalizedProjectId, requireNonBlank(subjectId, 'subjectId'))) {
                return { kind: 'not_found' }
            }
            return restoreDeletionTransaction.immediate({
                at: requireTimestamp(at ?? now(), 'at'),
                projectId: normalizedProjectId,
                assetId: normalizedAssetId,
            })
        },

        async purgeAsset(
            projectId: string,
            assetId: string,
            subjectId: string,
            at?: number,
            gracePeriodMs = deletionGracePeriodMs
        ): Promise<PurgeMediaAssetResult> {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const normalizedAssetId = requireNonBlank(assetId, 'assetId')
            if (!hasProjectAccess(normalizedProjectId, requireNonBlank(subjectId, 'subjectId'))) {
                return { kind: 'not_found' }
            }
            validateDuration(gracePeriodMs, 'gracePeriodMs', true)
            return purgeInternal(
                normalizedProjectId,
                normalizedAssetId,
                requireTimestamp(at ?? now(), 'at'),
                gracePeriodMs
            )
        },

        async permanentlyDeleteAsset(
            projectId: string,
            assetId: string,
            subjectId: string,
            at?: number
        ): Promise<PurgeMediaAssetResult> {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const normalizedAssetId = requireNonBlank(assetId, 'assetId')
            if (!hasProjectAccess(normalizedProjectId, requireNonBlank(subjectId, 'subjectId'))) {
                return { kind: 'not_found' }
            }
            try {
                return await purgeInternal(
                    normalizedProjectId,
                    normalizedAssetId,
                    requireTimestamp(at ?? now(), 'at'),
                    0
                )
            } catch (error) {
                const claimed = readMedia(normalizedProjectId, normalizedAssetId)
                if (claimed?.asset.state === 'deleted') {
                    return { kind: 'cleanup_pending', media: claimed }
                }
                throw error
            }
        },

        async reconcile(at?: number): Promise<ReconcileMediaResult> {
            const timestamp = requireTimestamp(at ?? now(), 'at')
            let expiredUploads = 0
            let missingObjects = 0
            let deletedAssets = 0

            for (const intent of listExpiredIntentsStatement.all(timestamp)) {
                const reservation = loadReservation(intent.projectId, intent.id)
                if (reservation === null) continue
                await mediaStore.delete(intent.objectKey)
                expireTransaction.immediate({
                    at: timestamp,
                    projectId: intent.projectId,
                    reservation,
                })
                expiredUploads += 1
            }

            for (const representation of listMissingRepresentationsStatement.all()) {
                if ((await mediaStore.stat(representation.objectKey)) !== null) continue
                markMissingTransaction.immediate({ at: timestamp, representation })
                missingObjects += 1
            }

            const deletionCutoff = timestamp - deletionGracePeriodMs
            if (deletionCutoff >= 0) {
                for (const asset of listDeletionCandidatesStatement.all(deletionCutoff)) {
                    const result = await purgeInternal(
                        asset.projectId,
                        asset.id,
                        timestamp,
                        deletionGracePeriodMs
                    )
                    if (result.kind === 'deleted') deletedAssets += 1
                }
            }

            return { expiredUploads, missingObjects, deletedAssets }
        },
    }
}

export type MediaAssetStore = ReturnType<typeof createMediaAssetStore>

async function scanObject(
    object: { readonly metadata: MediaObjectMetadata; readonly stream: ReadableStream<Uint8Array> },
    limits: MediaInspectionLimits
): Promise<{
    readonly size: number
    readonly sha256: string
    readonly header: Uint8Array
    readonly video: MediaInspection | null
}> {
    const reader = object.stream.getReader()
    const hash = createHash('sha256')
    const header = new Uint8Array(Math.min(limits.maxHeaderBytes, object.metadata.size))
    const video = createMp4Inspection(object.metadata.size, limits)
    let headerSize = 0
    let size = 0

    try {
        while (true) {
            const result = await reader.read()
            if (result.done) break
            if (!(result.value instanceof Uint8Array)) {
                throw new MediaStoreError('invalid_source', 'Media storage yielded invalid bytes')
            }
            size += result.value.byteLength
            hash.update(result.value)
            video.push(result.value)
            if (headerSize < header.byteLength) {
                const amount = Math.min(header.byteLength - headerSize, result.value.byteLength)
                header.set(result.value.subarray(0, amount), headerSize)
                headerSize += amount
            }
        }
    } catch (error) {
        try {
            await reader.cancel(error)
        } catch {
            // Preserve the verification failure.
        }
        throw error
    } finally {
        reader.releaseLock()
    }

    return {
        size,
        sha256: hash.digest('hex'),
        header: header.subarray(0, headerSize),
        video: video.finish(),
    }
}

interface MediaAssetCursor {
    readonly sort: MediaAssetListSort
    readonly key: string | number
    readonly id: string
}

const mediaAssetCursorPrefix = 'media-v2:'
const legacyMediaAssetCursorPrefix = 'media-v1:'

function encodeMediaAssetCursor(cursor: MediaAssetCursor): string {
    return `${mediaAssetCursorPrefix}${encodeURIComponent(JSON.stringify(cursor))}`
}

function parseMediaAssetCursor(
    cursor: string | null | undefined,
    expectedSort: MediaAssetListSort
): MediaAssetCursor | null {
    if (cursor === null || cursor === undefined) return null

    if (cursor.startsWith(legacyMediaAssetCursorPrefix)) {
        if (expectedSort !== 'newest') throw invalidMediaCursor()
        const separator = cursor.indexOf(':', legacyMediaAssetCursorPrefix.length)
        if (separator < 0) throw invalidMediaCursor()

        const createdAt = Number(cursor.slice(legacyMediaAssetCursorPrefix.length, separator))
        let id: string
        try {
            id = decodeURIComponent(cursor.slice(separator + 1))
        } catch {
            throw invalidMediaCursor()
        }

        if (
            !Number.isSafeInteger(createdAt) ||
            createdAt < 0 ||
            id.length === 0 ||
            `${legacyMediaAssetCursorPrefix}${createdAt}:${encodeURIComponent(id)}` !== cursor
        ) {
            throw invalidMediaCursor()
        }
        return { sort: 'newest', key: createdAt, id }
    }

    if (!cursor.startsWith(mediaAssetCursorPrefix)) throw invalidMediaCursor()

    let parsed: unknown
    try {
        parsed = JSON.parse(decodeURIComponent(cursor.slice(mediaAssetCursorPrefix.length)))
    } catch {
        throw invalidMediaCursor()
    }

    if (!isMediaAssetCursor(parsed) || parsed.sort !== expectedSort) {
        throw invalidMediaCursor()
    }
    if (encodeMediaAssetCursor(parsed) !== cursor) throw invalidMediaCursor()
    return parsed
}

function isMediaAssetCursor(value: unknown): value is MediaAssetCursor {
    if (typeof value !== 'object' || value === null) return false
    if (!('sort' in value) || !('key' in value) || !('id' in value)) return false

    const candidate = value as { sort: unknown; key: unknown; id: unknown }
    if (
        typeof candidate.sort !== 'string' ||
        !(mediaAssetListSorts as readonly string[]).includes(candidate.sort) ||
        typeof candidate.id !== 'string' ||
        candidate.id.length === 0
    ) {
        return false
    }

    const numericKeySorts: readonly MediaAssetListSort[] = [
        'newest',
        'oldest',
        'largest',
        'smallest',
    ]
    if (numericKeySorts.includes(candidate.sort as MediaAssetListSort)) {
        return typeof candidate.key === 'number' && Number.isSafeInteger(candidate.key)
    }
    return typeof candidate.key === 'string' && candidate.key.length > 0
}

function invalidMediaCursor(): DomainInvariantError {
    return new DomainInvariantError('invalid_input', 'media cursor is invalid')
}

function normalizeMediaListSort(value: MediaAssetListSort | null | undefined): MediaAssetListSort {
    const candidate = value ?? 'newest'
    if (!(mediaAssetListSorts as readonly string[]).includes(candidate)) {
        throw new DomainInvariantError('invalid_input', 'media sort is invalid')
    }
    return candidate
}

function normalizeMediaFamilyFilter(
    value: MediaAssetFamilyFilter | null | undefined
): MediaFamily | null {
    if (value === null || value === undefined || value === 'all') return null
    if (!(mediaFamilies as readonly string[]).includes(value)) {
        throw new DomainInvariantError('invalid_input', 'media family filter is invalid')
    }
    return value
}

function normalizeMediaDateFilter(
    value: MediaAssetDateFilter | null | undefined
): MediaAssetDateFilter {
    const candidate = value ?? 'all'
    if (!(mediaAssetDateFilters as readonly string[]).includes(candidate)) {
        throw new DomainInvariantError('invalid_input', 'media date filter is invalid')
    }
    return candidate
}

function mediaDateFilterSince(filter: MediaAssetDateFilter, currentTime: number): number | null {
    if (filter === 'all') return null
    const duration = {
        last_24_hours: 24 * 60 * 60 * 1_000,
        last_7_days: 7 * 24 * 60 * 60 * 1_000,
        last_30_days: 30 * 24 * 60 * 60 * 1_000,
    }[filter]
    return currentTime - duration
}

function mediaAssetSortKey(asset: MediaAssetReference, sort: MediaAssetListSort): string | number {
    switch (sort) {
        case 'newest':
        case 'oldest':
            return asset.asset.createdAt
        case 'name_asc':
        case 'name_desc':
            return asset.asset.originalFilename.toLowerCase()
        case 'largest':
        case 'smallest':
            return (
                asset.representations.find(representation => representation.kind === 'original')
                    ?.byteSize ?? -1
            )
    }
}

function normalizeMediaSearch(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null
    const normalized = value.trim()
    if (normalized.length === 0) return null
    if (normalized.length > MAX_MEDIA_SEARCH_LENGTH) {
        throw new DomainInvariantError(
            'invalid_input',
            `media search must not exceed ${MAX_MEDIA_SEARCH_LENGTH} characters`
        )
    }
    return normalized
}

function escapeLikePattern(value: string): string {
    return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function buildReservation(
    asset: MediaAssetRow,
    representation: MediaRepresentationRow,
    intent: MediaUploadIntentRow,
    maxBytes: number
): MediaUploadReservation {
    return {
        asset: toMediaAsset(asset),
        representation: toMediaRepresentation(representation),
        intent: toMediaUploadIntent(intent),
        upload: {
            storeId: representation.storeId,
            objectKey: representation.objectKey,
            maxBytes,
            expectedSize: intent.expectedSize,
            contentType: intent.contentTypeHint,
        },
    }
}

function toMediaAsset(row: MediaAssetRow): MediaAsset {
    return {
        id: row.id,
        projectId: row.projectId,
        originalFilename: row.originalFilename,
        defaultAccessibilityText: row.defaultAccessibilityText,
        state: row.state,
        archivedAt: row.archivedAt,
        deletionRequestedAt: row.deletionRequestedAt,
        deletedAt: row.deletedAt,
        failureCode: row.failureCode,
        failureMessage: row.failureMessage,
        createdByActorId: row.createdByActorId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function hasRestorableMediaSnapshot(
    asset: MediaAssetRow,
    representations: readonly MediaRepresentationRow[]
): boolean {
    return (
        asset.deletionRestoreState === 'ready' &&
        representations.some(
            representation =>
                representation.kind === 'original' &&
                representation.deletionRestoreState === 'ready'
        ) &&
        representations.every(
            representation =>
                representation.deletionRestoreState === 'ready' ||
                representation.deletionRestoreState === 'failed'
        )
    )
}

function toMediaRepresentation(row: MediaRepresentationRow): MediaRepresentation {
    return {
        id: row.id,
        projectId: row.projectId,
        assetId: row.assetId,
        kind: row.kind,
        sourceRepresentationId: row.sourceRepresentationId,
        state: row.state,
        storeId: row.storeId,
        objectKey: row.objectKey,
        declaredContentType: row.declaredContentType,
        detectedContentType: row.detectedContentType,
        detectedFormat: row.detectedFormat,
        family: row.family,
        byteSize: row.byteSize,
        sha256: row.sha256,
        width: row.width,
        height: row.height,
        durationMs: row.durationMs,
        pageCount: row.pageCount,
        isAnimated: row.isAnimated === null ? null : row.isAnimated !== 0,
        processorId: row.processorId,
        processorVersion: row.processorVersion,
        recipeJson: row.recipeJson,
        failureCode: row.failureCode,
        failureMessage: row.failureMessage,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toMediaUploadIntent(row: MediaUploadIntentRow): MediaUploadIntent {
    return {
        id: row.id,
        projectId: row.projectId,
        assetId: row.assetId,
        representationId: row.representationId,
        state: row.state,
        expectedSize: row.expectedSize,
        maxBytes: row.maxBytes,
        contentTypeHint: row.contentTypeHint,
        expiresAt: row.expiresAt,
        uploadStartedAt: row.uploadStartedAt,
        completedAt: row.completedAt,
        failureCode: row.failureCode,
        failureMessage: row.failureMessage,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function buildMediaAssetUsage(
    assetId: string,
    rows: readonly MediaAssetUsageRow[],
    auditEventCount: number
): MediaAssetUsageSummary {
    const active = new Map<string, MutableMediaAssetUsageReference>()
    const history = new Map<string, MutableMediaAssetUsageReference>()

    for (const row of rows) {
        const bucket =
            row.kind === 'post' || isActivePublicationState(row.publicationState) ? active : history
        const key = `${row.kind}:${row.id}`
        const existing = bucket.get(key)
        if (existing === undefined) {
            bucket.set(key, {
                kind: row.kind,
                id: row.id,
                postId: row.postId,
                publicationId: row.publicationId,
                title: row.title,
                publicationState: row.publicationState,
                scheduledAt: row.scheduledAt,
                channelName: row.channelName,
                locations: new Set([row.location]),
            })
        } else {
            existing.locations.add(row.location)
        }
    }

    return {
        assetId,
        active: finalizeMediaAssetUsage(active),
        history: finalizeMediaAssetUsage(history),
        auditEventCount,
    }
}

type MutableMediaAssetUsageReference = Omit<MediaAssetUsageReference, 'locations'> & {
    readonly locations: Set<MediaAssetUsageLocation>
}

function finalizeMediaAssetUsage(
    references: Map<string, MutableMediaAssetUsageReference>
): readonly MediaAssetUsageReference[] {
    return [...references.values()]
        .map(reference => ({
            ...reference,
            locations: [...reference.locations].sort(
                (left, right) =>
                    mediaAssetUsageLocationOrder.indexOf(left) -
                    mediaAssetUsageLocationOrder.indexOf(right)
            ),
        }))
        .sort(compareMediaAssetUsageReferences)
}

const mediaAssetUsageLocationOrder: readonly MediaAssetUsageLocation[] = [
    'source',
    'draft',
    'target',
    'execution',
]

function compareMediaAssetUsageReferences(
    left: MediaAssetUsageReference,
    right: MediaAssetUsageReference
): number {
    const kindOrder = Number(left.kind !== 'post') - Number(right.kind !== 'post')
    if (kindOrder !== 0) return kindOrder

    const leftScheduledAt = left.scheduledAt ?? Number.MAX_SAFE_INTEGER
    const rightScheduledAt = right.scheduledAt ?? Number.MAX_SAFE_INTEGER
    if (leftScheduledAt !== rightScheduledAt) return leftScheduledAt - rightScheduledAt
    return left.id.localeCompare(right.id)
}

function isActivePublicationState(state: PublicationState | null): boolean {
    return state === 'draft' || state === 'scheduled' || state === 'ready' || state === 'publishing'
}

function hasMediaReference(
    database: PostdotDatabase['$client'],
    projectId: string,
    assetId: string
): boolean {
    const queries = [
        `select 1 as found from publication_draft_adoptions, json_tree(publication_draft_adoptions.snapshot_json)
         where publication_draft_adoptions.project_id = ?1 and json_tree.type = 'text' and json_tree.value = ?2 limit 1`,
        `select 1 as found from publication_draft_adoptions, json_tree(publication_draft_adoptions.local_content_json)
         where publication_draft_adoptions.project_id = ?1 and json_tree.type = 'text' and json_tree.value = ?2 limit 1`,
        `select 1 as found from posts, json_tree(posts.source_content)
         where posts.project_id = ?1 and json_tree.type = 'text' and json_tree.value = ?2 limit 1`,
        `select 1 as found from publication_working_drafts, json_tree(publication_working_drafts.content_json)
         where publication_working_drafts.project_id = ?1 and json_tree.type = 'text' and json_tree.value = ?2 limit 1`,
        `select 1 as found from publication_target_revisions, json_tree(publication_target_revisions.content_json)
         where publication_target_revisions.project_id = ?1 and json_tree.type = 'text' and json_tree.value = ?2 limit 1`,
        `select 1 as found from publication_execution_revisions, json_tree(publication_execution_revisions.content_json)
         where publication_execution_revisions.project_id = ?1 and json_tree.type = 'text' and json_tree.value = ?2 limit 1`,
        `select 1 as found from publication_revision_media
         where publication_revision_media.project_id = ?1
           and publication_revision_media.asset_id = ?2 limit 1`,
        `select 1 as found from publication_execution_revision_media
         where publication_execution_revision_media.project_id = ?1
           and publication_execution_revision_media.asset_id = ?2 limit 1`,
        `select 1 as found from audit_events
         where audit_events.project_id = ?1 and audit_events.entity_type = 'media_asset'
           and audit_events.entity_id = ?2 limit 1`,
    ]
    return queries.some(
        query =>
            database.query<{ found: number }, [string, string]>(query).get(projectId, assetId) !==
            null
    )
}

function normalizeFilename(value: string): string {
    const normalized = requireNonBlank(value, 'originalFilename')
    if (
        normalized.length > 255 ||
        [...normalized].some(character => character.charCodeAt(0) < 0x20)
    ) {
        throw new DomainInvariantError('invalid_input', 'originalFilename is not valid')
    }
    return normalized
}

function normalizeOptionalText(value: string | null | undefined, field: string): string | null {
    if (value === null || value === undefined) return null
    const normalized = requireNonBlank(value, field)
    if (normalized.length > 10_000) {
        throw new DomainInvariantError('invalid_input', `${field} is too long`)
    }
    return normalized
}

function normalizeOptionalContentType(value: string | undefined): string | null {
    if (value === undefined) return null
    const normalized = requireNonBlank(value, 'contentType')
    if (normalized.length > 255) {
        throw new DomainInvariantError('invalid_input', 'contentType is too long')
    }
    return normalized
}

function normalizeExpectedSize(value: number | undefined, maxBytes: number): number | null {
    if (value === undefined) return null
    if (!Number.isSafeInteger(value) || value < 0 || value > maxBytes) {
        throw new DomainInvariantError(
            'invalid_input',
            `expectedSize must be between 0 and ${maxBytes}`
        )
    }
    return value
}

function validateInspectionLimits(limits: MediaInspectionLimits, maxObjectBytes: number): void {
    if (
        !Number.isSafeInteger(limits.maxHeaderBytes) ||
        limits.maxHeaderBytes <= 0 ||
        limits.maxHeaderBytes > maxObjectBytes
    ) {
        throw new DomainInvariantError('invalid_input', 'Media header limit is not valid')
    }
    if (!Number.isSafeInteger(limits.maxPixels) || limits.maxPixels <= 0) {
        throw new DomainInvariantError('invalid_input', 'Media pixel limit is not valid')
    }
}

function requireGeneratedId(value: string, field: string): string {
    return requireNonBlank(value, field)
}

function requireNonBlank(value: string, field: string): string {
    const normalized = value.trim()
    if (normalized.length === 0) {
        throw new DomainInvariantError('blank_value', `${field} must not be blank`)
    }
    return normalized
}

function requireTimestamp(value: number, field: string): number {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new DomainInvariantError('invalid_time', `${field} must be a non-negative timestamp`)
    }
    return value
}

function safeAdd(value: number, increment: number, label: string): number {
    const result = value + increment
    if (!Number.isSafeInteger(result)) {
        throw new DomainInvariantError('invalid_time', `${label} exceeds the safe timestamp range`)
    }
    return result
}

function validateDuration(value: number, field: string, allowZero: boolean): void {
    if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) {
        throw new DomainInvariantError(
            'invalid_input',
            `${field} must be a ${allowZero ? 'non-negative' : 'positive'} safe integer`
        )
    }
}

function normalizeFailureCode(value: string): string {
    return value.replaceAll(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120) || 'media_failure'
}

function isPermanentMediaStoreFailure(error: unknown): boolean {
    return !(error instanceof MediaStoreError) || error.code !== 'storage_failure'
}

function publicMediaStoreFailureMessage(error: unknown): string {
    if (error instanceof MediaStoreError) {
        switch (error.code) {
            case 'size_mismatch':
                return 'The uploaded media size does not match the declared size'
            case 'write_limit_exceeded':
                return 'The uploaded media exceeds the configured size limit'
            case 'invalid_source':
                return 'The uploaded media stream is not valid'
            default:
                return 'The uploaded media could not be stored'
        }
    }
    return 'The uploaded media could not be stored'
}
