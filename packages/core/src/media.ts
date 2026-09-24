import type { MediaFamily } from './channel-profile'
import { DomainInvariantError } from './invariants'

export const mediaAssetStates = [
    'reserved',
    'stored',
    'inspecting',
    'ready',
    'failed',
    'deletion_requested',
    'deleted',
] as const

export const mediaRepresentationStates = mediaAssetStates
export const mediaUploadIntentStates = [
    'pending',
    'uploading',
    'uploaded',
    'consumed',
    'expired',
    'failed',
] as const
export const providerMediaDeliveryStates = [
    'pending',
    'uploading',
    'uploaded',
    'failed',
    'ambiguous',
] as const
export const mediaRepresentationKinds = ['original', 'derived'] as const
export type MediaAssetState = (typeof mediaAssetStates)[number]
export type MediaRepresentationState = (typeof mediaRepresentationStates)[number]
export type MediaUploadIntentState = (typeof mediaUploadIntentStates)[number]
export type MediaRepresentationKind = (typeof mediaRepresentationKinds)[number]
export type ProviderMediaDeliveryState = (typeof providerMediaDeliveryStates)[number]

export function assertProviderMediaDeliveryTransition(
    from: ProviderMediaDeliveryState,
    to: ProviderMediaDeliveryState
): void {
    assertTransition('provider media delivery', from, to, providerMediaDeliveryTransitions)
}

export interface MediaAsset {
    readonly id: string
    readonly projectId: string
    readonly originalFilename: string
    readonly defaultAccessibilityText: string | null
    readonly state: MediaAssetState
    readonly archivedAt: number | null
    readonly deletionRequestedAt: number | null
    readonly deletedAt: number | null
    readonly failureCode: string | null
    readonly failureMessage: string | null
    readonly createdByActorId: string
    readonly createdAt: number
    readonly updatedAt: number
}

export interface MediaRepresentation {
    readonly id: string
    readonly projectId: string
    readonly assetId: string
    readonly kind: MediaRepresentationKind
    readonly sourceRepresentationId: string | null
    readonly state: MediaRepresentationState
    readonly storeId: string
    readonly objectKey: string
    readonly declaredContentType: string | null
    readonly detectedContentType: string | null
    readonly detectedFormat: string | null
    readonly family: MediaFamily | null
    readonly byteSize: number | null
    readonly sha256: string | null
    readonly width: number | null
    readonly height: number | null
    readonly durationMs: number | null
    readonly pageCount: number | null
    readonly isAnimated: boolean | null
    readonly processorId: string | null
    readonly processorVersion: string | null
    readonly recipeJson: string | null
    readonly failureCode: string | null
    readonly failureMessage: string | null
    readonly createdAt: number
    readonly updatedAt: number
}

export interface MediaUploadIntent {
    readonly id: string
    readonly projectId: string
    readonly assetId: string
    readonly representationId: string
    readonly state: MediaUploadIntentState
    readonly expectedSize: number | null
    readonly maxBytes: number
    readonly contentTypeHint: string | null
    readonly expiresAt: number
    readonly uploadStartedAt: number | null
    readonly completedAt: number | null
    readonly failureCode: string | null
    readonly failureMessage: string | null
    readonly createdAt: number
    readonly updatedAt: number
}

export interface MediaInspection {
    readonly family: MediaFamily
    readonly format: string
    readonly contentType: string
    readonly width: number | null
    readonly height: number | null
    readonly durationMs: number | null
    readonly pageCount: number | null
    readonly isAnimated: boolean | null
}

export interface MediaInspectionLimits {
    readonly maxHeaderBytes: number
    readonly maxPixels: number
}

export const defaultMediaUploadContentTypes = ['image/png', 'image/jpeg', 'image/webp'] as const

export type DefaultMediaUploadContentType = (typeof defaultMediaUploadContentTypes)[number]

export interface MediaUploadPolicy {
    readonly allowedContentTypes: readonly string[]
    readonly maxFileSize: number
}

export const defaultMediaInspectionLimits: MediaInspectionLimits = {
    maxHeaderBytes: 1_048_576,
    maxPixels: 100_000_000,
}

export interface MediaInspector {
    readonly format: string
    readonly matches: (bytes: Uint8Array) => boolean
    readonly inspect: (bytes: Uint8Array, limits: MediaInspectionLimits) => MediaInspection | null
}

export class MediaInspectionRegistry {
    readonly #inspectors: readonly MediaInspector[]

    constructor(inspectors: readonly MediaInspector[] = defaultMediaInspectors) {
        if (inspectors.length === 0) {
            throw new DomainInvariantError(
                'invalid_input',
                'At least one media inspector is required'
            )
        }
        this.#inspectors = [...inspectors]
    }

    inspect(
        bytes: Uint8Array,
        limits: MediaInspectionLimits = defaultMediaInspectionLimits
    ): MediaInspection | null {
        if (!(bytes instanceof Uint8Array)) {
            throw new DomainInvariantError('invalid_input', 'Media inspection input must be bytes')
        }
        if (!Number.isSafeInteger(limits.maxHeaderBytes) || limits.maxHeaderBytes <= 0) {
            throw new DomainInvariantError('invalid_input', 'Media header limit must be positive')
        }
        if (!Number.isSafeInteger(limits.maxPixels) || limits.maxPixels <= 0) {
            throw new DomainInvariantError('invalid_input', 'Media pixel limit must be positive')
        }

        const header =
            bytes.byteLength > limits.maxHeaderBytes
                ? bytes.subarray(0, limits.maxHeaderBytes)
                : bytes

        for (const inspector of this.#inspectors) {
            if (!inspector.matches(header)) continue
            return inspector.inspect(header, limits)
        }

        return null
    }
}

export function assertMediaAssetTransition(from: MediaAssetState, to: MediaAssetState): void {
    assertTransition('asset', from, to, mediaAssetTransitions)
}

export function assertMediaRepresentationTransition(
    from: MediaRepresentationState,
    to: MediaRepresentationState
): void {
    assertTransition('representation', from, to, mediaRepresentationTransitions)
}

const mediaAssetTransitions: Readonly<Record<MediaAssetState, readonly MediaAssetState[]>> = {
    reserved: ['stored', 'failed', 'deletion_requested'],
    stored: ['inspecting', 'failed', 'deletion_requested'],
    inspecting: ['ready', 'failed', 'deletion_requested'],
    ready: ['failed', 'deletion_requested'],
    failed: ['reserved', 'deletion_requested'],
    deletion_requested: ['reserved', 'stored', 'inspecting', 'ready', 'failed', 'deleted'],
    deleted: [],
}

const mediaRepresentationTransitions: Readonly<
    Record<MediaRepresentationState, readonly MediaRepresentationState[]>
> = {
    reserved: ['stored', 'failed', 'deletion_requested'],
    stored: ['inspecting', 'failed', 'deletion_requested'],
    inspecting: ['ready', 'failed', 'deletion_requested'],
    ready: ['failed', 'deletion_requested'],
    failed: ['reserved', 'deletion_requested'],
    deletion_requested: ['reserved', 'stored', 'inspecting', 'ready', 'failed', 'deleted'],
    deleted: [],
}

const providerMediaDeliveryTransitions: Readonly<
    Record<ProviderMediaDeliveryState, readonly ProviderMediaDeliveryState[]>
> = {
    pending: ['uploading'],
    uploading: ['uploaded', 'failed', 'ambiguous'],
    uploaded: [],
    failed: ['pending'],
    ambiguous: ['uploaded', 'failed'],
}

function assertTransition<T extends string>(
    entity: string,
    from: T,
    to: T,
    transitions: Readonly<Record<T, readonly T[]>>
): void {
    if (from === to || transitions[from].includes(to)) return
    throw new DomainInvariantError(
        'invalid_transition',
        `A ${entity} cannot transition from ${from} to ${to}`
    )
}

const defaultMediaInspectors: readonly MediaInspector[] = [
    createPngInspector(),
    createJpegInspector(),
    createWebpInspector(),
]

function createPngInspector(): MediaInspector {
    return {
        format: 'png',
        matches: bytes =>
            bytes.byteLength >= 8 &&
            bytes[0] === 0x89 &&
            bytes[1] === 0x50 &&
            bytes[2] === 0x4e &&
            bytes[3] === 0x47 &&
            bytes[4] === 0x0d &&
            bytes[5] === 0x0a &&
            bytes[6] === 0x1a &&
            bytes[7] === 0x0a,
        inspect: (bytes, limits) => {
            if (bytes.byteLength < 33 || readAscii(bytes, 12, 4) !== 'IHDR') return null
            const width = readUint32BE(bytes, 16)
            const height = readUint32BE(bytes, 20)
            if (!isSafeImageSize(width, height, limits.maxPixels)) return null

            let isAnimated = false
            let offset = 8
            while (offset + 12 <= bytes.byteLength) {
                const length = readUint32BE(bytes, offset)
                const type = readAscii(bytes, offset + 4, 4)
                if (type === 'acTL') isAnimated = true
                if (type === 'IEND') break
                if (length > bytes.byteLength - offset - 12) break
                offset += 12 + length
            }

            return {
                family: 'image',
                format: 'png',
                contentType: 'image/png',
                width,
                height,
                durationMs: null,
                pageCount: null,
                isAnimated,
            }
        },
    }
}

function createJpegInspector(): MediaInspector {
    return {
        format: 'jpeg',
        matches: bytes => bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8,
        inspect: (bytes, limits) => {
            let offset = 2
            while (offset + 3 < bytes.byteLength) {
                if (bytes[offset] !== 0xff) return null
                while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1
                if (offset >= bytes.byteLength) return null

                const marker = bytes[offset]!
                offset += 1
                if (marker === 0xd9 || marker === 0xda) return null
                if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue
                if (offset + 2 > bytes.byteLength) return null

                const length = readUint16BE(bytes, offset)
                if (length < 2 || length > bytes.byteLength - offset) return null

                if (isJpegStartOfFrame(marker)) {
                    if (length < 7 || offset + 7 > bytes.byteLength) return null
                    const height = readUint16BE(bytes, offset + 3)
                    const width = readUint16BE(bytes, offset + 5)
                    if (!isSafeImageSize(width, height, limits.maxPixels)) return null
                    return {
                        family: 'image',
                        format: 'jpeg',
                        contentType: 'image/jpeg',
                        width,
                        height,
                        durationMs: null,
                        pageCount: null,
                        isAnimated: false,
                    }
                }

                offset += length
            }
            return null
        },
    }
}

function createWebpInspector(): MediaInspector {
    return {
        format: 'webp',
        matches: bytes =>
            bytes.byteLength >= 12 &&
            readAscii(bytes, 0, 4) === 'RIFF' &&
            readAscii(bytes, 8, 4) === 'WEBP',
        inspect: (bytes, limits) => {
            const chunk = findWebpChunk(bytes)
            if (chunk === null) return null

            let dimensions: { readonly width: number; readonly height: number } | null = null
            let isAnimated = false
            if (chunk.type === 'VP8X') {
                if (chunk.size < 10 || chunk.offset + 10 > bytes.byteLength) return null
                isAnimated = (bytes[chunk.offset]! & 0x02) !== 0
                dimensions = {
                    width: 1 + readUint24LE(bytes, chunk.offset + 4),
                    height: 1 + readUint24LE(bytes, chunk.offset + 7),
                }
            } else if (chunk.type === 'VP8 ') {
                if (chunk.size < 10 || chunk.offset + 10 > bytes.byteLength) return null
                if (
                    bytes[chunk.offset + 3]! !== 0x9d ||
                    bytes[chunk.offset + 4]! !== 0x01 ||
                    bytes[chunk.offset + 5]! !== 0x2a
                ) {
                    return null
                }
                dimensions = {
                    width: readUint16LE(bytes, chunk.offset + 6) & 0x3fff,
                    height: readUint16LE(bytes, chunk.offset + 8) & 0x3fff,
                }
            } else if (chunk.type === 'VP8L') {
                if (
                    chunk.size < 5 ||
                    chunk.offset + 5 > bytes.byteLength ||
                    bytes[chunk.offset]! !== 0x2f
                ) {
                    return null
                }
                const bits =
                    bytes[chunk.offset + 1]! |
                    (bytes[chunk.offset + 2]! << 8) |
                    (bytes[chunk.offset + 3]! << 16) |
                    (bytes[chunk.offset + 4]! << 24)
                dimensions = {
                    width: 1 + (bits & 0x3fff),
                    height: 1 + ((bits >>> 14) & 0x3fff),
                }
            }

            if (
                dimensions === null ||
                !isSafeImageSize(dimensions.width, dimensions.height, limits.maxPixels)
            ) {
                return null
            }

            return {
                family: 'image',
                format: 'webp',
                contentType: 'image/webp',
                width: dimensions.width,
                height: dimensions.height,
                durationMs: null,
                pageCount: null,
                isAnimated,
            }
        },
    }
}

function findWebpChunk(
    bytes: Uint8Array
): { readonly type: string; readonly offset: number; readonly size: number } | null {
    let offset = 12
    while (offset + 8 <= bytes.byteLength) {
        const type = readAscii(bytes, offset, 4)
        const size = readUint32LE(bytes, offset + 4)
        if (size > bytes.byteLength - offset - 8) return null
        if (type === 'VP8X' || type === 'VP8 ' || type === 'VP8L') {
            return { type, offset: offset + 8, size }
        }
        offset += 8 + size + (size % 2)
    }
    return null
}

function isJpegStartOfFrame(marker: number): boolean {
    return (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
    )
}

function isSafeImageSize(width: number, height: number, maxPixels: number): boolean {
    return (
        Number.isSafeInteger(width) &&
        Number.isSafeInteger(height) &&
        width > 0 &&
        height > 0 &&
        width * height <= maxPixels
    )
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
    if (offset < 0 || length < 0 || offset + length > bytes.byteLength) return ''
    return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
    return (bytes[offset]! << 8) | bytes[offset + 1]!
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
    return (
        bytes[offset]! * 0x1000000 +
        ((bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!)
    )
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
    return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
    return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
    return (
        bytes[offset]! |
        (bytes[offset + 1]! << 8) |
        (bytes[offset + 2]! << 16) |
        (bytes[offset + 3]! * 0x1000000)
    )
}
