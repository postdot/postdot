import { describe, expect, it } from 'bun:test'

import {
    assertMediaAssetTransition,
    defaultMediaInspectionLimits,
    MediaInspectionRegistry,
} from './media'

function pngHeader(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(33)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8)
    writeUint32BE(bytes, 16, width)
    writeUint32BE(bytes, 20, height)
    return bytes
}

function jpegHeader(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(21)
    bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0)
    bytes[7] = (height >> 8) & 0xff
    bytes[8] = height & 0xff
    bytes[9] = (width >> 8) & 0xff
    bytes[10] = width & 0xff
    return bytes
}

function webpHeader(width: number, height: number, animated = false): Uint8Array {
    const bytes = new Uint8Array(30)
    bytes.set([...new TextEncoder().encode('RIFF'), 0x16, 0x00, 0x00, 0x00], 0)
    bytes.set([...new TextEncoder().encode('WEBPVP8X'), 0x0a, 0x00, 0x00, 0x00], 8)
    bytes[20] = animated ? 0x02 : 0x00
    writeUint24LE(bytes, 24, width - 1)
    writeUint24LE(bytes, 27, height - 1)
    return bytes
}

function writeUint32BE(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = (value >>> 24) & 0xff
    bytes[offset + 1] = (value >>> 16) & 0xff
    bytes[offset + 2] = (value >>> 8) & 0xff
    bytes[offset + 3] = value & 0xff
}

function writeUint24LE(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = value & 0xff
    bytes[offset + 1] = (value >>> 8) & 0xff
    bytes[offset + 2] = (value >>> 16) & 0xff
}

describe('media inspection', () => {
    const registry = new MediaInspectionRegistry()

    it('recognizes PNG, JPEG, and animated WebP headers', () => {
        expect(registry.inspect(pngHeader(1920, 1080))).toMatchObject({
            family: 'image',
            format: 'png',
            contentType: 'image/png',
            width: 1920,
            height: 1080,
            isAnimated: false,
        })
        expect(registry.inspect(jpegHeader(1200, 800))).toMatchObject({
            family: 'image',
            format: 'jpeg',
            contentType: 'image/jpeg',
            width: 1200,
            height: 800,
        })
        expect(registry.inspect(webpHeader(640, 480, true))).toMatchObject({
            family: 'image',
            format: 'webp',
            contentType: 'image/webp',
            width: 640,
            height: 480,
            isAnimated: true,
        })
    })

    it('rejects unknown formats and oversized pixel dimensions', () => {
        expect(registry.inspect(new TextEncoder().encode('not media'))).toBeNull()
        expect(
            registry.inspect(pngHeader(100, 100), {
                ...defaultMediaInspectionLimits,
                maxPixels: 9_999,
            })
        ).toBeNull()
    })

    it('accepts custom inspectors without changing the database model', () => {
        const custom = new MediaInspectionRegistry([
            {
                format: 'custom-image',
                matches: bytes => bytes[0] === 0xca,
                inspect: () => ({
                    family: 'image',
                    format: 'custom-image',
                    contentType: 'image/x-custom',
                    width: null,
                    height: null,
                    durationMs: null,
                    pageCount: null,
                    isAnimated: null,
                }),
            },
        ])

        expect(custom.inspect(new Uint8Array([0xca]))?.format).toBe('custom-image')
    })
})

describe('media lifecycle transitions', () => {
    it('rejects skipping inspection before ready', () => {
        expect(() => assertMediaAssetTransition('stored', 'ready')).toThrow(
            'cannot transition from stored to ready'
        )
        expect(() => assertMediaAssetTransition('inspecting', 'ready')).not.toThrow()
    })
})
