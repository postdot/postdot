import { describe, expect, test } from 'bun:test'

import { isCopyableImage } from './manual-publication-media'

describe('isCopyableImage', () => {
    test('accepts still images the clipboard can carry once converted to PNG', () => {
        expect(isCopyableImage('image/png')).toBe(true)
        expect(isCopyableImage('image/jpeg')).toBe(true)
        expect(isCopyableImage('IMAGE/WEBP')).toBe(true)
    })

    test('leaves animated, vector and video files to downloading', () => {
        expect(isCopyableImage('image/gif')).toBe(false)
        expect(isCopyableImage('image/svg+xml')).toBe(false)
        expect(isCopyableImage('video/mp4')).toBe(false)
        expect(isCopyableImage(null)).toBe(false)
        expect(isCopyableImage(undefined)).toBe(false)
    })
})
