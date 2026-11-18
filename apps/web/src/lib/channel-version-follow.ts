import {
    applySourceContentToTarget,
    type ChannelProfileDefinition,
    type SourceContent,
} from '@postdot/core'

type TargetContent = Readonly<Record<string, unknown>>

function stable(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
    if (value !== null && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
            .join(',')}}`
    }
    return JSON.stringify(value) ?? 'undefined'
}

function project(
    profile: unknown,
    source: SourceContent,
    target: TargetContent
): TargetContent | null {
    try {
        return applySourceContentToTarget(source, profile as ChannelProfileDefinition, target)
    } catch {
        return null
    }
}

/**
 * Whether a channel version publishes the post's text, title and media as they are: the
 * post's copy and attachments, projected onto the version, leave it unchanged. Fields that
 * belong to the channel only (a language, a poll, provider options) do not count.
 */
export function channelVersionFollowsSource(
    profile: unknown,
    source: SourceContent,
    target: TargetContent
): boolean {
    const projected = project(profile, source, target)
    return projected !== null && stable(projected) === stable(target)
}

/**
 * The channel version after the post changed from `previous` to `next`: a version that
 * followed the post keeps following it; a version with its own text is left alone.
 */
export function followSourceChange(
    profile: unknown,
    previous: SourceContent,
    next: SourceContent,
    target: TargetContent
): TargetContent | null {
    if (!channelVersionFollowsSource(profile, previous, target)) return null
    return project(profile, next, target)
}

/** Replace the version's copy and attachments with the post's, keeping channel-only fields. */
export function applyPostToChannel(
    profile: unknown,
    source: SourceContent,
    target: TargetContent
): TargetContent | null {
    return project(profile, source, target)
}

interface Binding {
    readonly semantic: string
    readonly path: string
    readonly item?: { readonly assetIdPath: string; readonly accessibilityTextPath?: string }
}

function readPointer(value: unknown, pointer: string): unknown {
    let current = value
    for (const segment of pointer
        .slice(1)
        .split('/')
        .map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))) {
        if (current === null || typeof current !== 'object') return undefined
        current = (current as Record<string, unknown>)[segment]
    }
    return current
}

/**
 * The post's text, title and media as a channel version shows them: the reverse of the
 * projection, used to bring the post back to an applied version. Fields the channel does
 * not carry keep their current post value.
 */
export function postFromChannelVersion(
    profile: unknown,
    target: TargetContent,
    current: SourceContent
): SourceContent {
    const bindings = ((profile as { fieldBindings?: readonly Binding[] }).fieldBindings ??
        []) as readonly Binding[]
    const next: { -readonly [K in keyof SourceContent]: SourceContent[K] } = {
        ...current,
        media: [...current.media],
    }
    for (const binding of bindings) {
        const value = readPointer(target, binding.path)
        if (binding.semantic === 'primary_text') {
            if (typeof value === 'string' && value !== '') {
                next.body = { format: current.body?.format ?? 'plain_text', text: value }
            } else delete next.body
        } else if (binding.semantic === 'headline') {
            if (typeof value === 'string' && value !== '') next.headline = value
            else delete next.headline
        } else if (binding.semantic === 'ordered_media' && binding.item) {
            const items = Array.isArray(value) ? value : []
            const item = binding.item
            next.media = items.flatMap(entry => {
                const assetId = readPointer(entry, item.assetIdPath)
                if (typeof assetId !== 'string' || assetId === '') return []
                const text = item.accessibilityTextPath
                    ? readPointer(entry, item.accessibilityTextPath)
                    : undefined
                return [
                    typeof text === 'string' && text !== ''
                        ? { assetId, accessibilityText: text }
                        : { assetId },
                ]
            })
        }
    }
    return next
}

/**
 * Sets only the channel's primary text, leaving every other field of its version exactly as
 * it is (an emptied title stays an empty title).
 */
export function withChannelText(
    profile: unknown,
    target: TargetContent,
    text: string
): TargetContent {
    const bindings = ((profile as { fieldBindings?: readonly Binding[] }).fieldBindings ??
        []) as readonly Binding[]
    const binding = bindings.find(item => item.semantic === 'primary_text')
    if (!binding) return target
    const next = structuredClone(target) as Record<string, unknown>
    const segments = binding.path
        .slice(1)
        .split('/')
        .map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    let parent: Record<string, unknown> = next
    for (const segment of segments.slice(0, -1)) {
        const child = parent[segment]
        if (child === null || typeof child !== 'object' || Array.isArray(child)) {
            parent[segment] = {}
        }
        parent = parent[segment] as Record<string, unknown>
    }
    const key = segments.at(-1)!
    if (text === '') delete parent[key]
    else parent[key] = text
    return next
}
