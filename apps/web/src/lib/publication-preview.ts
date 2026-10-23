import { getTargetEditorFields, readTargetField } from '@/lib/target-editor'
import { providerRegistry } from '@/providers/registry'

export interface DraftPreviewInput {
    readonly platform: string
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
    platform,
    targetContent,
}: DraftPreviewInput): DraftPreviewModel {
    const body = targetContent === undefined ? postContent : targetContent
    const title = postTitle.trim()

    return {
        body,
        hasText: body.trim() !== '',
        showTitle: providerRegistry.get(platform)?.editor === 'article',
        title,
    }
}

/** Read the destination headline, without substituting post metadata for missing content. */
export function getTargetPreviewTitle(
    profile: unknown,
    target: Readonly<Record<string, unknown>> | null
): string {
    return readDeclaredSemantic(profile, target, 'headline')
}

/**
 * Read the destination body from the field the profile declares as
 * `primary_text`.
 *
 * The declared binding is the only source of truth, so a nested pointer such as
 * `/article/body` and a custom profile are read correctly instead of being
 * approximated from top-level property names. A blank adaptation stays blank and
 * an unbound or non-textual field yields nothing, because substituting source
 * content for a destination field would break source/destination ownership.
 */
export function getTargetPreviewBody(
    profile: unknown,
    target: Readonly<Record<string, unknown>> | null
): string {
    return readDeclaredSemantic(profile, target, 'primary_text')
}

function readDeclaredSemantic(
    profile: unknown,
    target: Readonly<Record<string, unknown>> | null,
    semantic: 'headline' | 'primary_text'
): string {
    if (target === null) return ''
    const field = getTargetEditorFields(profile).find(field => field.semantic === semantic)
    if (field === undefined) return ''
    const value = readTargetField(target, field.path)
    return typeof value === 'string' ? value : ''
}

/**
 * The one destination document a preview reads.
 *
 * While the publication is editable that is the working target. Once it is locked
 * the preview describes what was selected for execution, so a later draft that has
 * not been applied yet must not leak into the headline, the body, or the media.
 * Sharing one selector across all three is what makes that guarantee hold by
 * construction rather than by three separate expressions agreeing.
 */
export function getPreviewTarget(input: {
    readonly editable: boolean
    readonly workingTarget: Readonly<Record<string, unknown>> | null
    readonly selectedTarget: Readonly<Record<string, unknown>> | null | undefined
}): Readonly<Record<string, unknown>> | null {
    if (input.editable) return input.workingTarget
    return input.selectedTarget ?? input.workingTarget
}
