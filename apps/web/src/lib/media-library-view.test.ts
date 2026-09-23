import { describe, expect, test } from 'bun:test'

import {
    DEFAULT_MEDIA_LIBRARY_VIEW_MODE,
    parseMediaLibraryViewMode,
    readMediaLibraryViewMode,
    writeMediaLibraryViewMode,
} from './media-library-view'

function createStorage(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial))
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
    }
}

describe('media library view preference', () => {
    test('uses the gallery as the default and rejects unknown values', () => {
        expect(parseMediaLibraryViewMode(null)).toBe(DEFAULT_MEDIA_LIBRARY_VIEW_MODE)
        expect(parseMediaLibraryViewMode('unknown')).toBe(DEFAULT_MEDIA_LIBRARY_VIEW_MODE)
        expect(parseMediaLibraryViewMode('grid')).toBe('grid')
        expect(parseMediaLibraryViewMode('compact')).toBe('compact')
        expect(parseMediaLibraryViewMode('list')).toBe('list')
    })

    test('round-trips the preference through storage', () => {
        const storage = createStorage()

        expect(readMediaLibraryViewMode(storage)).toBe('grid')
        writeMediaLibraryViewMode('list', storage)
        expect(readMediaLibraryViewMode(storage)).toBe('list')
    })
})
