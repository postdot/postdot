import {
    DomainInvariantError,
    extractTargetMediaReferences,
    type ChannelProfileDefinition,
    type MediaFieldCapability,
    type MediaRepresentation,
    type TargetContent,
    type TargetMediaReference,
    type ValidationIssue,
} from '@herald/core'

import type { MediaAssetStore } from '../media-asset-store'
import { isRecord } from './content-codec'
import type { ResolvedTargetMedia, TargetRevisionMediaRow } from './rows'

function profileAssessmentIssue(code: string, message: string, path = '/media'): ValidationIssue {
    return { path, code, message, severity: 'error', source: 'capability' }
}

export function assessWorkingDraftMedia(
    profile: ChannelProfileDefinition,
    content: unknown,
    projectId: string,
    subjectId: string,
    media: Pick<MediaAssetStore, 'getAsset'> | undefined,
    publicMediaUrlAvailable: boolean
): readonly ValidationIssue[] {
    if (!isRecord(content)) {
        return [
            profileAssessmentIssue(
                'profile.content_not_object',
                'The working draft content is not a JSON object',
                ''
            ),
        ]
    }

    try {
        resolveTargetMedia(profile, content, projectId, subjectId, media, publicMediaUrlAvailable)
        return []
    } catch (error) {
        return [
            profileAssessmentIssue(
                'profile.media_incompatible',
                error instanceof Error ? error.message : 'Media is incompatible with the profile'
            ),
        ]
    }
}

export function assessPinnedTargetMedia(
    profile: ChannelProfileDefinition,
    content: unknown,
    projectId: string,
    subjectId: string,
    media: Pick<MediaAssetStore, 'getAsset'> | undefined,
    pinnedMedia: readonly TargetRevisionMediaRow[],
    publicMediaUrlAvailable: boolean
): readonly ValidationIssue[] {
    if (!isRecord(content)) {
        return [
            profileAssessmentIssue(
                'profile.content_not_object',
                'The pending target content is not a JSON object',
                ''
            ),
        ]
    }

    let references: readonly TargetMediaReference[]
    try {
        references = extractTargetMediaReferences(profile, content)
    } catch (error) {
        return [
            profileAssessmentIssue(
                'profile.media_reference_invalid',
                error instanceof Error ? error.message : 'Media references are invalid'
            ),
        ]
    }

    const issues: ValidationIssue[] = []
    const referencesByBinding = new Map<string, TargetMediaReference[]>()
    for (const reference of references) {
        const bindingReferences = referencesByBinding.get(reference.bindingId) ?? []
        bindingReferences.push(reference)
        referencesByBinding.set(reference.bindingId, bindingReferences)
    }

    for (const capability of profile.capabilities.mediaFields) {
        const bindingReferences = referencesByBinding.get(capability.bindingId) ?? []
        if (bindingReferences.length < (capability.minItems ?? 0)) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_required',
                    `Media field ${capability.bindingId} requires at least ${capability.minItems} item(s)`,
                    `/capabilities/${capability.bindingId}`
                )
            )
        }
        if (bindingReferences.length > capability.maxItems) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_limit_exceeded',
                    `Media field ${capability.bindingId} accepts at most ${capability.maxItems} item(s)`,
                    `/capabilities/${capability.bindingId}`
                )
            )
        }
    }

    if (references.length === 0) {
        return issues
    }

    if (media === undefined) {
        return [
            profileAssessmentIssue(
                'profile.media_service_unavailable',
                'Media lifecycle service is required to assess pinned media'
            ),
        ]
    }

    if (pinnedMedia.length !== references.length) {
        issues.push(
            profileAssessmentIssue(
                'profile.media_snapshot_mismatch',
                'The persisted target media snapshot does not match its content'
            )
        )
    }

    const totalBytesByBinding = new Map<string, number>()
    for (const [position, reference] of references.entries()) {
        const pinned = pinnedMedia[position]
        if (pinned === undefined) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_snapshot_missing',
                    `No persisted media snapshot exists for ${reference.contentPath}`,
                    reference.contentPath
                )
            )
            continue
        }
        if (
            pinned.position !== position ||
            pinned.assetId !== reference.assetId ||
            pinned.contentPath !== reference.contentPath ||
            pinned.role !== reference.role
        ) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_snapshot_mismatch',
                    `The persisted media snapshot does not match ${reference.contentPath}`,
                    reference.contentPath
                )
            )
            continue
        }

        const asset = media.getAsset(projectId, reference.assetId, subjectId)
        if (asset === null || asset.asset.state !== 'ready') {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_asset_unavailable',
                    `Media asset ${reference.assetId} is not available for publication`,
                    reference.contentPath
                )
            )
            continue
        }

        const expectedAccessibilityText =
            reference.accessibilityText ?? asset.asset.defaultAccessibilityText
        if (pinned.accessibilityText !== expectedAccessibilityText) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_snapshot_mismatch',
                    `The persisted accessibility text does not match ${reference.contentPath}`,
                    reference.contentPath
                )
            )
            continue
        }

        const representation = asset.representations.find(
            candidate => candidate.id === pinned.representationId && candidate.state === 'ready'
        )
        if (representation === undefined) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_representation_unavailable',
                    `Media representation ${pinned.representationId} is not ready`,
                    reference.contentPath
                )
            )
            continue
        }

        const capability = profile.capabilities.mediaFields.find(
            candidate => candidate.bindingId === reference.bindingId
        )
        if (capability !== undefined && !supportsMediaCapability(representation, capability)) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_representation_incompatible',
                    `Media representation ${pinned.representationId} is incompatible with field ${reference.bindingId}`,
                    reference.contentPath
                )
            )
        }
        if (capability?.accessibilityTextRequired && pinned.accessibilityText === null) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_accessibility_required',
                    `Media field ${reference.bindingId} requires accessibility text`,
                    reference.contentPath
                )
            )
        }
        if (capability?.publicUrlRequired && !publicMediaUrlAvailable) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_public_url_required',
                    `Media field ${reference.bindingId} requires public media delivery, which is not configured`,
                    reference.contentPath
                )
            )
        }

        const totalBytes = totalBytesByBinding.get(reference.bindingId) ?? 0
        const nextTotalBytes = totalBytes + (representation.byteSize ?? 0)
        if (capability?.maxTotalBytes !== undefined && nextTotalBytes > capability.maxTotalBytes) {
            issues.push(
                profileAssessmentIssue(
                    'profile.media_total_size_exceeded',
                    `Media field ${reference.bindingId} exceeds its total byte limit`,
                    reference.contentPath
                )
            )
        }
        totalBytesByBinding.set(reference.bindingId, nextTotalBytes)
    }

    return issues
}

export function resolveTargetMedia(
    profile: ChannelProfileDefinition,
    content: TargetContent,
    projectId: string,
    subjectId: string,
    media: Pick<MediaAssetStore, 'getAsset'> | undefined,
    publicMediaUrlAvailable: boolean
): readonly ResolvedTargetMedia[] {
    const references = extractTargetMediaReferences(profile, content)
    if (references.length === 0) {
        for (const capability of profile.capabilities.mediaFields) {
            if ((capability.minItems ?? 0) > 0) {
                throw mediaContentError(
                    `Media field ${capability.bindingId} requires at least ${capability.minItems} item(s)`
                )
            }
        }
        return []
    }
    if (media === undefined) {
        throw mediaContentError('Media lifecycle service is required for media publications')
    }

    const referencesByBinding = new Map<string, TargetMediaReference[]>()
    for (const reference of references) {
        const bindingReferences = referencesByBinding.get(reference.bindingId) ?? []
        bindingReferences.push(reference)
        referencesByBinding.set(reference.bindingId, bindingReferences)
    }

    for (const capability of profile.capabilities.mediaFields) {
        const bindingReferences = referencesByBinding.get(capability.bindingId) ?? []
        if (bindingReferences.length < (capability.minItems ?? 0)) {
            throw mediaContentError(
                `Media field ${capability.bindingId} requires at least ${capability.minItems} item(s)`
            )
        }
        if (bindingReferences.length > capability.maxItems) {
            throw mediaContentError(
                `Media field ${capability.bindingId} accepts at most ${capability.maxItems} item(s)`
            )
        }
    }

    const resolved: ResolvedTargetMedia[] = []
    const totalBytesByBinding = new Map<string, number>()
    for (const reference of references) {
        const capability = profile.capabilities.mediaFields.find(
            candidate => candidate.bindingId === reference.bindingId
        )
        const asset = media.getAsset(projectId, reference.assetId, subjectId)
        if (asset === null || asset.asset.state !== 'ready') {
            throw mediaContentError(
                `Media asset ${reference.assetId} is not available for publication`
            )
        }

        const candidates = asset.representations
            .filter(representation => representation.state === 'ready')
            .sort(
                (left, right) =>
                    Number(right.kind === 'original') - Number(left.kind === 'original')
            )
        const representation = candidates.find(candidate =>
            capability === undefined ? true : supportsMediaCapability(candidate, capability)
        )
        if (representation === undefined) {
            throw mediaContentError(
                `Media asset ${reference.assetId} has no ready representation compatible with field ${reference.bindingId}`
            )
        }

        const accessibilityText =
            reference.accessibilityText ?? asset.asset.defaultAccessibilityText
        if (capability?.accessibilityTextRequired && accessibilityText === null) {
            throw mediaContentError(
                `Media field ${reference.bindingId} requires accessibility text for asset ${reference.assetId}`
            )
        }
        if (capability?.publicUrlRequired && !publicMediaUrlAvailable) {
            throw mediaContentError(
                `Media field ${reference.bindingId} requires public media delivery, which is not configured`
            )
        }

        const totalBytes = totalBytesByBinding.get(reference.bindingId) ?? 0
        const nextTotalBytes = totalBytes + (representation.byteSize ?? 0)
        if (capability?.maxTotalBytes !== undefined && nextTotalBytes > capability.maxTotalBytes) {
            throw mediaContentError(
                `Media field ${reference.bindingId} exceeds its total byte limit`
            )
        }
        totalBytesByBinding.set(reference.bindingId, nextTotalBytes)

        resolved.push({ reference, representation, accessibilityText })
    }

    return resolved
}

function supportsMediaCapability(
    representation: MediaRepresentation,
    capability: MediaFieldCapability
): boolean {
    if (
        representation.family === null ||
        representation.detectedContentType === null ||
        representation.byteSize === null ||
        !capability.families.includes(representation.family) ||
        !capability.mimeTypes.some(pattern =>
            matchesMimeType(representation.detectedContentType!, pattern)
        )
    ) {
        return false
    }
    if (
        capability.maxBytesPerItem !== undefined &&
        representation.byteSize > capability.maxBytesPerItem
    ) {
        return false
    }
    if (
        capability.dimensions?.minWidth !== undefined &&
        (representation.width === null || representation.width < capability.dimensions.minWidth)
    ) {
        return false
    }
    if (
        capability.dimensions?.maxWidth !== undefined &&
        (representation.width === null || representation.width > capability.dimensions.maxWidth)
    ) {
        return false
    }
    if (
        capability.dimensions?.minHeight !== undefined &&
        (representation.height === null || representation.height < capability.dimensions.minHeight)
    ) {
        return false
    }
    if (
        capability.dimensions?.maxHeight !== undefined &&
        (representation.height === null || representation.height > capability.dimensions.maxHeight)
    ) {
        return false
    }
    if (
        capability.duration?.minMilliseconds !== undefined &&
        (representation.durationMs === null ||
            representation.durationMs < capability.duration.minMilliseconds)
    ) {
        return false
    }
    if (
        capability.duration?.maxMilliseconds !== undefined &&
        (representation.durationMs === null ||
            representation.durationMs > capability.duration.maxMilliseconds)
    ) {
        return false
    }
    return true
}

function matchesMimeType(contentType: string, pattern: string): boolean {
    const normalizedContentType = contentType.toLowerCase()
    const normalizedPattern = pattern.toLowerCase()
    return normalizedPattern.endsWith('/*')
        ? normalizedContentType.startsWith(normalizedPattern.slice(0, -1))
        : normalizedContentType === normalizedPattern
}

function mediaContentError(message: string): DomainInvariantError {
    return new DomainInvariantError('invalid_content', message)
}
