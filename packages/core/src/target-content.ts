import type { ChannelFieldBinding, ChannelProfileDefinition } from './channel-profile'
import { ChannelProfileCompiler } from './channel-profile'
import { DomainInvariantError } from './invariants'
import type { SourceContent } from './source-content'
import { hasValidationErrors, type ValidationResult, validationFailure } from './validation'

export type TargetContent = Readonly<Record<string, unknown>>

export interface TargetMediaReference {
    readonly bindingId: string
    readonly itemIndex: number
    readonly contentPath: string
    readonly assetId: string
    readonly accessibilityText: string | null
    readonly role: string | null
}

/**
 * Maps only Postdot-owned source semantics. Provider-specific fields must be
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

/** Explicitly replace source-owned copy and attachments, preserving other target fields. */
export function applySourceContentToTarget(
    source: SourceContent,
    profile: ChannelProfileDefinition,
    content: TargetContent
): TargetContent {
    const target = structuredClone(content) as Record<string, unknown>
    for (const binding of profile.fieldBindings) {
        if (!['primary_text', 'headline', 'ordered_media'].includes(binding.semantic)) continue
        const value = sourceValueForBinding(source, binding)
        if (value !== undefined) setJsonPointer(target, binding.path, value)
        else {
            const segments = binding.path
                .slice(1)
                .split('/')
                .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
            let parent: unknown = target
            for (const segment of segments.slice(0, -1)) {
                parent = isRecord(parent) ? parent[segment] : undefined
            }
            const key = segments.at(-1)
            if (isRecord(parent) && key !== undefined) delete parent[key]
        }
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

/**
 * Extracts the media identities from a validated target payload. The returned
 * paths point to the media item, so persistence can prove which content field
 * each immutable representation satisfies.
 */
export function extractTargetMediaReferences(
    profile: ChannelProfileDefinition,
    content: TargetContent
): readonly TargetMediaReference[] {
    const references: TargetMediaReference[] = []

    for (const binding of profile.fieldBindings) {
        if (binding.semantic !== 'ordered_media') continue

        const media = readJsonPointer(content, binding.path)
        if (media === undefined) continue
        if (!Array.isArray(media)) {
            throw new DomainInvariantError(
                'invalid_content',
                `Media binding ${binding.id} must resolve to an array`
            )
        }

        for (const [itemIndex, item] of media.entries()) {
            if (!isRecord(item)) {
                throw new DomainInvariantError(
                    'invalid_content',
                    `Media binding ${binding.id} item ${itemIndex} must be an object`
                )
            }

            const assetId = readJsonPointer(item, binding.item.assetIdPath)
            if (typeof assetId !== 'string' || assetId.trim().length === 0) {
                throw new DomainInvariantError(
                    'invalid_content',
                    `Media binding ${binding.id} item ${itemIndex} must contain a non-blank asset ID`
                )
            }

            const accessibilityText = binding.item.accessibilityTextPath
                ? readJsonPointer(item, binding.item.accessibilityTextPath)
                : undefined
            if (accessibilityText !== undefined && typeof accessibilityText !== 'string') {
                throw new DomainInvariantError(
                    'invalid_content',
                    `Media binding ${binding.id} item ${itemIndex} accessibility text must be a string`
                )
            }
            if (typeof accessibilityText === 'string' && accessibilityText.trim().length === 0) {
                throw new DomainInvariantError(
                    'invalid_content',
                    `Media binding ${binding.id} item ${itemIndex} accessibility text must not be blank`
                )
            }

            references.push({
                bindingId: binding.id,
                itemIndex,
                contentPath: appendJsonPointer(binding.path, itemIndex),
                assetId: assetId.trim(),
                accessibilityText:
                    accessibilityText === undefined ? null : accessibilityText.trim(),
                role: binding.role ?? null,
            })
        }
    }

    return references
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

function readJsonPointer(root: unknown, pointer: string): unknown {
    if (pointer === '') return root
    if (!pointer.startsWith('/')) return undefined

    let current: unknown = root
    for (const segment of pointer
        .slice(1)
        .split('/')
        .map(value => value.replaceAll('~1', '/').replaceAll('~0', '~'))) {
        if (Array.isArray(current)) {
            if (!/^\d+$/.test(segment)) return undefined
            current = current[Number(segment)]
        } else if (isRecord(current)) {
            current = current[segment]
        } else {
            return undefined
        }
    }

    return current
}

function appendJsonPointer(pointer: string, ...segments: (number | string)[]): string {
    return [pointer, ...segments.map(segment => String(segment))]
        .map((segment, index) =>
            index === 0 ? segment : segment.replaceAll('~', '~0').replaceAll('/', '~1')
        )
        .join('/')
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}
