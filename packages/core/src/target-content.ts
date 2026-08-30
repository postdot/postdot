import type { ChannelFieldBinding, ChannelProfileDefinition } from './channel-profile'
import { ChannelProfileCompiler } from './channel-profile'
import type { SourceContent } from './source-content'
import { hasValidationErrors, type ValidationResult, validationFailure } from './validation'

export type TargetContent = Readonly<Record<string, unknown>>

/**
 * Maps only Herald-owned source semantics. Provider-specific fields must be
 * supplied as an explicit target override by the caller.
 */
export function adaptSourceContentToProfile(
    source: SourceContent,
    profile: ChannelProfileDefinition
): TargetContent {
    const target: Record<string, unknown> = {}

    for (const binding of profile.fieldBindings) {
        const value = sourceValueForBinding(source, binding)
        if (value !== undefined) setJsonPointer(target, binding.path, value)
    }

    return target
}

export function validateTargetContent(
    profile: ChannelProfileDefinition,
    content: unknown
): ValidationResult<TargetContent> {
    const compiled = new ChannelProfileCompiler().compile(profile)
    if (!compiled.ok) return validationFailure(compiled.issues)

    const result = compiled.value.validate(content)
    if (!result.ok || hasValidationErrors(result.issues)) return result
    return result
}

function sourceValueForBinding(
    source: SourceContent,
    binding: ChannelFieldBinding
): unknown | undefined {
    switch (binding.semantic) {
        case 'primary_text':
            return source.body?.text
        case 'headline':
            return source.headline
        case 'language':
            return source.language
        case 'ordered_media':
            return source.media.map(media => {
                const item: Record<string, unknown> = {}
                setJsonPointer(item, binding.item.assetIdPath, media.assetId)
                if (media.accessibilityText !== undefined && binding.item.accessibilityTextPath) {
                    setJsonPointer(
                        item,
                        binding.item.accessibilityTextPath,
                        media.accessibilityText
                    )
                }
                return item
            })
        case 'tags':
            return undefined
    }
}

function setJsonPointer(target: Record<string, unknown>, pointer: string, value: unknown): void {
    const segments = pointer
        .slice(1)
        .split('/')
        .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    let current = target

    for (const [index, segment] of segments.entries()) {
        if (index === segments.length - 1) {
            current[segment] = value
            return
        }

        const existing = current[segment]
        if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
            current = existing as Record<string, unknown>
            continue
        }

        const next: Record<string, unknown> = {}
        current[segment] = next
        current = next
    }
}
