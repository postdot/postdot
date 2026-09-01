export interface MediaSelection {
    readonly assetId: string
    readonly accessibilityText?: string
}

export function updateTargetMedia(
    profile: unknown,
    target: Record<string, unknown>,
    media: readonly MediaSelection[]
): Record<string, unknown> {
    const next = JSON.parse(JSON.stringify(target)) as Record<string, unknown>
    if (!isRecord(profile) || !Array.isArray(profile.fieldBindings)) return next

    for (const binding of profile.fieldBindings) {
        if (!isRecord(binding) || binding.semantic !== 'ordered_media') continue
        if (typeof binding.path !== 'string' || !isRecord(binding.item)) continue
        const itemBinding = binding.item
        const assetIdPath = itemBinding.assetIdPath
        const accessibilityTextPath = itemBinding.accessibilityTextPath
        if (typeof assetIdPath !== 'string') continue

        const existingItems = readJsonPointer(next, binding.path)
        const existingMedia = Array.isArray(existingItems) ? existingItems.filter(isRecord) : []
        const items = media.map(selection => {
            const existingItem = existingMedia.find(item => {
                const existingAssetId = readJsonPointer(item, assetIdPath)
                return existingAssetId === selection.assetId
            })
            const item = existingItem === undefined ? {} : structuredClone(existingItem)
            setJsonPointer(item, assetIdPath, selection.assetId)
            if (
                typeof accessibilityTextPath === 'string' &&
                selection.accessibilityText?.trim() !== ''
            ) {
                setJsonPointer(item, accessibilityTextPath, selection.accessibilityText)
            } else if (typeof accessibilityTextPath === 'string') {
                deleteJsonPointer(item, accessibilityTextPath)
            }
            return item
        })
        setJsonPointer(next, binding.path, items)
    }

    return next
}

function readJsonPointer(root: unknown, pointer: string): unknown {
    if (pointer === '') return root
    if (!pointer.startsWith('/')) return undefined

    let current: unknown = root
    for (const segment of pointer
        .slice(1)
        .split('/')
        .map(value => value.replaceAll('~1', '/').replaceAll('~0', '~'))) {
        if (!isRecord(current)) return undefined
        current = current[segment]
    }
    return current
}

function setJsonPointer(target: Record<string, unknown>, pointer: string, value: unknown) {
    if (!pointer.startsWith('/')) return
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
        if (isRecord(existing)) {
            current = existing
            continue
        }
        const next: Record<string, unknown> = {}
        current[segment] = next
        current = next
    }
}

function deleteJsonPointer(target: Record<string, unknown>, pointer: string) {
    if (!pointer.startsWith('/')) return
    const segments = pointer
        .slice(1)
        .split('/')
        .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    let current: Record<string, unknown> = target

    for (const [index, segment] of segments.entries()) {
        if (index === segments.length - 1) {
            delete current[segment]
            return
        }
        const existing = current[segment]
        if (!isRecord(existing)) return
        current = existing
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
