import { getTargetEditorFields, readTargetField } from '@/lib/target-editor'

export interface DraftPreviewInput {
    readonly profileId: string
    readonly postContent: string
    readonly postTitle: string
    readonly targetContent?: string
}

export interface DraftPreviewModel {
    readonly body: string
    readonly hasText: boolean
    readonly showTitle: boolean
    readonly title: string
}

/**
 * Resolve the content the operator is currently editing for one channel.
 *
 * This intentionally models the small, stable distinction that the current
 * authoring contract exposes. Provider-specific validation and rendering stay
 * outside this local preview until they have their own product contract.
 */
export function getDraftPreviewModel({
    postContent,
    postTitle,
    profileId,
    targetContent,
}: DraftPreviewInput): DraftPreviewModel {
    const body = targetContent === undefined ? postContent : targetContent
    const title = postTitle.trim()

    return {
        body,
        hasText: body.trim() !== '',
        showTitle: profileId === 'devto',
        title,
    }
}

/** Read the destination headline, without substituting post metadata for missing content. */
export function getTargetPreviewTitle(
    profile: unknown,
    target: Readonly<Record<string, unknown>> | null
): string {
    if (target === null) return ''
    const field = getTargetEditorFields(profile).find(field => field.semantic === 'headline')
    if (field === undefined) return ''
    const value = readTargetField(target, field.path)
    return typeof value === 'string' ? value : ''
}
