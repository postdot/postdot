import { createHash } from 'node:crypto'

export const identityImageMaxBytes = 2 * 1024 * 1024
export const identityImageMaxDimension = 256
export const identityImageMaxStoredBytes = 262_144
export const identityImageMaxPixels = 16_000_000

export type IdentityImageErrorCode =
    | 'identity_image_size'
    | 'identity_image_format'
    | 'identity_website_invalid'

export class IdentityImageValidationError extends Error {
    constructor(
        readonly code: IdentityImageErrorCode,
        message: string
    ) {
        super(message)
        this.name = 'IdentityImageValidationError'
    }
}

export type SniffedIdentityImageFormat =
    | 'image/png'
    | 'image/jpeg'
    | 'image/webp'
    | 'image/gif'
    | 'image/x-icon'

export interface ProcessedIdentityImage {
    readonly sha256: string
    readonly imageUrl: string
    readonly contentType: 'image/webp'
    readonly byteSize: number
    readonly width: number
    readonly height: number
    readonly bytes: Uint8Array
}

export interface StoredIdentityImage {
    readonly sha256: string
    readonly contentType: string
    readonly byteSize: number
    readonly width: number
    readonly height: number
    readonly bytes: Uint8Array
}

export function identityImageUrl(sha256: string): string {
    return `/api/identity-images/${sha256}`
}

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
    if (bytes.byteLength < offset + prefix.length) return false
    for (let index = 0; index < prefix.length; index += 1) {
        if (bytes[offset + index] !== prefix[index]) return false
    }
    return true
}

function looksLikeSvgOrXml(bytes: Uint8Array): boolean {
    const sample = new TextDecoder('utf-8', { fatal: false })
        .decode(bytes.subarray(0, Math.min(bytes.byteLength, 1_024)))
        .replace(/^\uFEFF/, '')
        .trimStart()
        .toLowerCase()
    return (
        sample.startsWith('<svg') ||
        sample.startsWith('<?xml') ||
        sample.startsWith('<!doctype svg') ||
        sample.includes('<svg')
    )
}

interface IcoEntry {
    readonly width: number
    readonly height: number
    readonly bitCount: number
    readonly bytesInRes: number
    readonly imageOffset: number
    readonly isPng: boolean
}

function parseIcoEntries(bytes: Uint8Array): readonly IcoEntry[] | null {
    if (bytes.byteLength < 22 || !startsWithBytes(bytes, [0x00, 0x00, 0x01, 0x00])) {
        return null
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const count = view.getUint16(4, true)
    if (count < 1 || count > 64 || bytes.byteLength < 6 + count * 16) {
        return null
    }
    const directoryEnd = 6 + count * 16
    const entries: IcoEntry[] = []
    for (let index = 0; index < count; index += 1) {
        const entryOffset = 6 + index * 16
        const rawWidth = bytes[entryOffset]!
        const rawHeight = bytes[entryOffset + 1]!
        const reserved = bytes[entryOffset + 3]!
        if (reserved !== 0) return null
        const bitCount = view.getUint16(entryOffset + 6, true)
        const bytesInRes = view.getUint32(entryOffset + 8, true)
        const imageOffset = view.getUint32(entryOffset + 12, true)
        if (
            bytesInRes < 16 ||
            imageOffset < directoryEnd ||
            imageOffset + bytesInRes > bytes.byteLength
        ) {
            return null
        }
        const isPng = startsWithBytes(
            bytes,
            [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
            imageOffset
        )
        entries.push({
            width: rawWidth === 0 ? 256 : rawWidth,
            height: rawHeight === 0 ? 256 : rawHeight,
            bitCount,
            bytesInRes,
            imageOffset,
            isPng,
        })
    }
    return entries
}

export function sniffIdentityImageFormat(bytes: Uint8Array): SniffedIdentityImageFormat {
    if (bytes.byteLength === 0) {
        throw new IdentityImageValidationError('identity_image_format', 'An image is required')
    }
    if (bytes.byteLength > identityImageMaxBytes) {
        throw new IdentityImageValidationError(
            'identity_image_size',
            'Image exceeds the 2 MB limit'
        )
    }
    if (looksLikeSvgOrXml(bytes)) {
        throw new IdentityImageValidationError(
            'identity_image_format',
            'SVG images are not supported; upload a PNG, JPEG, WebP, GIF, or ICO image'
        )
    }
    if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return 'image/png'
    }
    if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) {
        return 'image/jpeg'
    }
    if (
        startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        startsWithBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)
    ) {
        return 'image/webp'
    }
    if (
        startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
        startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    ) {
        return 'image/gif'
    }
    if (parseIcoEntries(bytes) !== null) {
        return 'image/x-icon'
    }
    throw new IdentityImageValidationError(
        'identity_image_format',
        'Unsupported image format; use PNG, JPEG, WebP, GIF, or ICO'
    )
}

function icoDibToBmp(entryBytes: Uint8Array): Uint8Array | null {
    if (entryBytes.byteLength < 40) return null
    const view = new DataView(entryBytes.buffer, entryBytes.byteOffset, entryBytes.byteLength)
    const headerSize = view.getUint32(0, true)
    if (headerSize !== 40) return null
    const dibWidth = view.getInt32(4, true)
    const dibHeight = view.getInt32(8, true)
    const planes = view.getUint16(12, true)
    const bpp = view.getUint16(14, true)
    const compression = view.getUint32(16, true)
    const clrUsed = view.getUint32(32, true)

    const actualHeight = Math.abs(dibHeight) / 2
    if (
        dibWidth <= 0 ||
        dibWidth > 512 ||
        actualHeight <= 0 ||
        actualHeight > 512 ||
        !Number.isInteger(actualHeight) ||
        planes !== 1 ||
        compression !== 0 ||
        ![1, 4, 8, 24, 32].includes(bpp)
    ) {
        return null
    }
    const paletteColors = bpp <= 8 ? (clrUsed > 0 ? clrUsed : 1 << bpp) : 0
    if (paletteColors < 0 || paletteColors > 256) return null
    const paletteBytes = paletteColors * 4
    const xorRowStride = Math.floor((dibWidth * bpp + 31) / 32) * 4
    const xorBytes = xorRowStride * actualHeight
    const copyBytes = 40 + paletteBytes + xorBytes
    if (copyBytes > entryBytes.byteLength) return null

    const bmpSize = 14 + copyBytes
    const bmp = new Uint8Array(bmpSize)
    const bmpView = new DataView(bmp.buffer)
    bmp[0] = 0x42
    bmp[1] = 0x4d
    bmpView.setUint32(2, bmpSize, true)
    bmpView.setUint32(10, 14 + 40 + paletteBytes, true)
    bmp.set(entryBytes.subarray(0, copyBytes), 14)
    bmpView.setInt32(14 + 8, dibHeight < 0 ? -actualHeight : actualHeight, true)
    bmpView.setUint32(14 + 20, xorBytes, true)
    return bmp
}

function* selectIcoDecodableBuffers(bytes: Uint8Array): Generator<Uint8Array> {
    const entries = parseIcoEntries(bytes)
    if (!entries || entries.length === 0) return
    const sorted = [...entries].sort((left, right) => {
        const leftMeetsMin = Math.min(left.width, left.height) >= 32 ? 1 : 0
        const rightMeetsMin = Math.min(right.width, right.height) >= 32 ? 1 : 0
        if (leftMeetsMin !== rightMeetsMin) return rightMeetsMin - leftMeetsMin
        const leftDim = Math.min(256, Math.max(left.width, left.height))
        const rightDim = Math.min(256, Math.max(right.width, right.height))
        if (leftDim !== rightDim) return rightDim - leftDim
        if (left.bitCount !== right.bitCount) return right.bitCount - left.bitCount
        if (left.isPng !== right.isPng) return left.isPng ? -1 : 1
        return right.bytesInRes - left.bytesInRes
    })
    for (const entry of sorted) {
        const slice = bytes.subarray(entry.imageOffset, entry.imageOffset + entry.bytesInRes)
        if (entry.isPng) {
            yield slice
        } else {
            const bmp = icoDibToBmp(slice)
            if (bmp !== null) yield bmp
        }
    }
}

let processingQueue = Promise.resolve()

export async function processIdentityImage(bytes: Uint8Array): Promise<ProcessedIdentityImage> {
    const format = sniffIdentityImageFormat(bytes)
    const candidates = format === 'image/x-icon' ? selectIcoDecodableBuffers(bytes) : [bytes]
    const previous = processingQueue
    let release!: () => void
    processingQueue = new Promise<void>(resolve => {
        release = resolve
    })
    await previous
    try {
        for (const candidate of candidates) {
            try {
                const metadata = await new Bun.Image(candidate, {
                    maxPixels: identityImageMaxPixels,
                }).metadata()
                if (
                    !Number.isSafeInteger(metadata.width) ||
                    !Number.isSafeInteger(metadata.height) ||
                    metadata.width <= 0 ||
                    metadata.height <= 0 ||
                    metadata.width * metadata.height > identityImageMaxPixels
                ) {
                    continue
                }
                const side = Math.max(
                    1,
                    Math.min(identityImageMaxDimension, Math.max(metadata.width, metadata.height))
                )
                const encoded = new Uint8Array(
                    await new Bun.Image(candidate, { maxPixels: identityImageMaxPixels })
                        .resize(side, side, { fit: 'fill' })
                        .webp({ quality: 85 })
                        .bytes()
                )
                if (encoded.byteLength === 0 || encoded.byteLength > identityImageMaxStoredBytes) {
                    continue
                }
                const sha256 = createHash('sha256').update(encoded).digest('hex')
                return {
                    sha256,
                    imageUrl: identityImageUrl(sha256),
                    contentType: 'image/webp',
                    byteSize: encoded.byteLength,
                    width: side,
                    height: side,
                    bytes: encoded,
                }
            } catch {
                continue
            }
        }
        throw new IdentityImageValidationError(
            'identity_image_format',
            'Image could not be decoded'
        )
    } finally {
        release()
    }
}
