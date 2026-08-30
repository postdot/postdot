import { createHash } from 'node:crypto'

import {
    assertMediaAssetTransition,
    assertMediaRepresentationTransition,
    defaultMediaInspectionLimits,
    DomainInvariantError,
    MediaInspectionRegistry,
    type MediaAsset,
    type MediaAssetState,
    type MediaInspectionLimits,
    type MediaRepresentation,
    type MediaRepresentationState,
    type MediaUploadIntent,
} from '@herald/core'
import { MediaStoreError, type MediaObjectMetadata, type MediaStore } from '@herald/media'

import type { HeraldDatabase } from './client'

const DEFAULT_UPLOAD_INTENT_TTL_MS = 15 * 60 * 1_000
const DEFAULT_DELETION_GRACE_PERIOD_MS = 24 * 60 * 60 * 1_000

export interface MediaAssetStoreOptions {
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
    | { readonly kind: 'not_found' }

export type PurgeMediaAssetResult =
    | { readonly kind: 'deleted'; readonly media: MediaAssetReference }
    | { readonly kind: 'blocked'; readonly reason: 'grace_period' | 'referenced' }
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

const representationColumns = `
    id,
    project_id as projectId,
    asset_id as assetId,
    kind,
    source_representation_id as sourceRepresentationId,
    state,
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
    database: HeraldDatabase,
    mediaStore: MediaStore,
    options: MediaAssetStoreOptions = {}
) {
    const client = database.$client
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())
    const uploadIntentTtlMs = options.uploadIntentTtlMs ?? DEFAULT_UPLOAD_INTENT_TTL_MS
    const inspectionLimits = options.inspectionLimits ?? defaultMediaInspectionLimits
    const deletionGracePeriodMs = options.deletionGracePeriodMs ?? DEFAULT_DELETION_GRACE_PERIOD_MS
    const inspectors = new MediaInspectionRegistry()

    validateDuration(uploadIntentTtlMs, 'uploadIntentTtlMs', false)
    validateDuration(deletionGracePeriodMs, 'deletionGracePeriodMs', true)
    validateInspectionLimits(inspectionLimits, mediaStore.maxObjectBytes)

    const loadHumanActorStatement = client.query<{ id: string }, [string, string]>(`
        select id
        from actors
        where project_id = ?1
          and subject_id = ?2
          and kind = 'human'
        limit 1
    `)
    const loadAssetStatement = client.query<MediaAssetRow, [string, string]>(`
        select ${assetColumns}
        from media_assets
        where project_id = ?1
          and id = ?2
    `)
    const listAssetsStatement = client.query<MediaAssetRow, [string]>(`
        select ${assetColumns}
        from media_assets
        where project_id = ?1
          and state <> 'deleted'
          and archived_at is null
        order by created_at, id
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
        where state = 'deletion_requested'
          and deletion_requested_at <= ?1
        order by deletion_requested_at, id
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
        set state = 'deletion_requested', deletion_requested_at = ?1,
            archived_at = coalesce(archived_at, ?1),
            failure_code = null, failure_message = null, updated_at = ?1
        where project_id = ?2 and id = ?3 and state <> 'deleted'
    `)
    const requestDeletionRepresentationsStatement = client.query<void, [number, string, string]>(`
        update media_representations
        set state = 'deletion_requested', failure_code = null,
            failure_message = null, updated_at = ?1
        where project_id = ?2 and asset_id = ?3 and state <> 'deleted'
    `)
    const expireAssetIntentsStatement = client.query<void, [number, string, string]>(`
        update media_upload_intents
        set state = 'expired', completed_at = ?1, updated_at = ?1
        where project_id = ?2 and asset_id = ?3
          and state in ('pending', 'uploading', 'uploaded')
    `)
    const deleteRepresentationsStatement = client.query<void, [number, string, string]>(`
        update media_representations
        set state = 'deleted', updated_at = ?1
        where project_id = ?2 and asset_id = ?3 and state = 'deletion_requested'
    `)
    const deleteAssetStatement = client.query<void, [number, string, string]>(`
        update media_assets
        set state = 'deleted', deleted_at = ?1, updated_at = ?1
        where project_id = ?2 and id = ?3 and state = 'deletion_requested'
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
                and id <> ?4 and state = 'ready'
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
    const markDeletedTransaction = client.transaction(
        (input: { readonly at: number; readonly projectId: string; readonly assetId: string }) => {
            deleteRepresentationsStatement.run(input.at, input.projectId, input.assetId)
            deleteAssetStatement.run(input.at, input.projectId, input.assetId)
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
        return loadHumanActorStatement.get(projectId, subjectId) !== null
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
            const scanned = await scanObject(opened, inspectionLimits.maxHeaderBytes)
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

            const inspection = inspectors.inspect(scanned.header, inspectionLimits)
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

            finalizeReadyTransaction.immediate({
                at: timestamp,
                projectId,
                reservation: inspecting,
                inspection,
                byteSize: scanned.size,
                sha256: scanned.sha256,
            })
            const ready = loadReservation(projectId, intentId)
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
        const media = readMedia(projectId, assetId)
        if (media === null) return { kind: 'not_found' }
        if (media.asset.state !== 'deletion_requested') return { kind: 'not_found' }
        if (
            media.asset.deletionRequestedAt === null ||
            at < safeAdd(media.asset.deletionRequestedAt, gracePeriodMs, 'deletion grace period')
        ) {
            return { kind: 'blocked', reason: 'grace_period' }
        }
        if (hasMediaReference(client, projectId, assetId)) {
            return { kind: 'blocked', reason: 'referenced' }
        }

        for (const representation of media.representations) {
            await mediaStore.delete(representation.objectKey)
        }
        markDeletedTransaction.immediate({ at, projectId, assetId })
        const deleted = readMedia(projectId, assetId)
        return deleted === null ? { kind: 'not_found' } : { kind: 'deleted', media: deleted }
    }

    return {
        reserveUpload(input: ReserveMediaUploadInput): MediaUploadReservation | null {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const actor = loadHumanActorStatement.get(projectId, subjectId)
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

        async openAssetContent(
            projectId: string,
            assetId: string,
            subjectId: string
        ): Promise<MediaAssetContent | null> {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            if (!hasProjectAccess(normalizedProjectId, requireNonBlank(subjectId, 'subjectId'))) {
                return null
            }
            const media = readMedia(normalizedProjectId, requireNonBlank(assetId, 'assetId'))
            if (media === null || media.asset.state !== 'ready') return null

            const representation =
                media.representations.find(
                    candidate => candidate.kind === 'original' && candidate.state === 'ready'
                ) ?? media.representations.find(candidate => candidate.state === 'ready')
            if (
                representation === undefined ||
                representation.byteSize === null ||
                representation.detectedContentType === null ||
                representation.sha256 === null
            ) {
                return null
            }

            const opened = await mediaStore.open(representation.objectKey, {
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
        },

        listAssets(projectId: string, subjectId: string): readonly MediaAssetReference[] | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            if (!hasProjectAccess(normalizedProjectId, requireNonBlank(subjectId, 'subjectId'))) {
                return null
            }
            return listAssetsStatement.all(normalizedProjectId).map(asset => ({
                asset: toMediaAsset(asset),
                representations: listRepresentationsStatement
                    .all(normalizedProjectId, asset.id)
                    .map(toMediaRepresentation),
            }))
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
    maxHeaderBytes: number
): Promise<{ readonly size: number; readonly sha256: string; readonly header: Uint8Array }> {
    const reader = object.stream.getReader()
    const hash = createHash('sha256')
    const header = new Uint8Array(Math.min(maxHeaderBytes, object.metadata.size))
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

    return { size, sha256: hash.digest('hex'), header: header.subarray(0, headerSize) }
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

function hasMediaReference(
    database: HeraldDatabase['$client'],
    projectId: string,
    assetId: string
): boolean {
    const queries = [
        `select 1 as found from posts, json_tree(posts.source_content)
         where posts.project_id = ?1 and json_tree.type = 'text' and json_tree.value = ?2 limit 1`,
        `select 1 as found from publication_working_drafts, json_tree(publication_working_drafts.content_json)
         where publication_working_drafts.project_id = ?1 and json_tree.type = 'text' and json_tree.value = ?2 limit 1`,
        `select 1 as found from publication_target_revisions, json_tree(publication_target_revisions.content_json)
         where publication_target_revisions.project_id = ?1 and json_tree.type = 'text' and json_tree.value = ?2 limit 1`,
        `select 1 as found from publication_execution_revisions, json_tree(publication_execution_revisions.content_json)
         where publication_execution_revisions.project_id = ?1 and json_tree.type = 'text' and json_tree.value = ?2 limit 1`,
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
