export const MEDIA_LIBRARY_VIEW_MODES = ['grid', 'compact', 'list'] as const

export type MediaLibraryViewMode = (typeof MEDIA_LIBRARY_VIEW_MODES)[number]

export const DEFAULT_MEDIA_LIBRARY_VIEW_MODE: MediaLibraryViewMode = 'grid'

const MEDIA_LIBRARY_VIEW_STORAGE_KEY = 'postbot:media-library:view:v1'

export function isMediaLibraryViewMode(value: unknown): value is MediaLibraryViewMode {
    return (
        typeof value === 'string' && (MEDIA_LIBRARY_VIEW_MODES as readonly string[]).includes(value)
    )
}

export function parseMediaLibraryViewMode(value: unknown): MediaLibraryViewMode {
    return isMediaLibraryViewMode(value) ? value : DEFAULT_MEDIA_LIBRARY_VIEW_MODE
}

export function readMediaLibraryViewMode(storage?: Pick<Storage, 'getItem'>) {
    const source = storage ?? getBrowserStorage()
    if (source === undefined) return DEFAULT_MEDIA_LIBRARY_VIEW_MODE

    try {
        return parseMediaLibraryViewMode(source.getItem(MEDIA_LIBRARY_VIEW_STORAGE_KEY))
    } catch {
        return DEFAULT_MEDIA_LIBRARY_VIEW_MODE
    }
}

export function writeMediaLibraryViewMode(
    value: MediaLibraryViewMode,
    storage?: Pick<Storage, 'setItem'>
) {
    const target = storage ?? getBrowserStorage()
    if (target === undefined) return

    try {
        target.setItem(MEDIA_LIBRARY_VIEW_STORAGE_KEY, value)
    } catch {
        // A blocked or full localStorage must not make the library unusable.
    }
}

function getBrowserStorage(): Storage | undefined {
    if (typeof window === 'undefined') return undefined
    try {
        return window.localStorage
    } catch {
        return undefined
    }
}
