export const mediaStoreErrorCodes = [
    'invalid_store_id',
    'invalid_object_key',
    'invalid_byte_limit',
    'invalid_range',
    'invalid_content_type',
    'invalid_source',
    'size_mismatch',
    'write_limit_exceeded',
    'read_limit_exceeded',
    'storage_failure',
] as const

export type MediaStoreErrorCode = (typeof mediaStoreErrorCodes)[number]

export class MediaStoreError extends Error {
    readonly code: MediaStoreErrorCode
    readonly key: string | undefined
    readonly cause: unknown

    constructor(
        code: MediaStoreErrorCode,
        message: string,
        options: { key?: string; cause?: unknown } = {}
    ) {
        super(message)
        this.name = 'MediaStoreError'
        this.code = code
        this.key = options.key
        this.cause = options.cause
    }
}

export interface MediaObjectMetadata {
    readonly key: string
    readonly size: number
    readonly lastModified: Date
}

export interface MediaObjectRange {
    /** Inclusive byte offset. */
    readonly start: number
    /** Exclusive byte offset. */
    readonly end: number
}

export interface MediaObjectRead {
    /** Metadata for the complete stored object, even when a range is selected. */
    readonly metadata: MediaObjectMetadata
    readonly range: MediaObjectRange | null
    readonly stream: ReadableStream<Uint8Array>
}

export interface MediaStoreWriteOptions {
    /** Metadata hint forwarded to backends that support content types. */
    readonly contentType?: string
    /** Optional authoritative size check performed after the stream is consumed. */
    readonly expectedSize?: number
    /** Per-operation ceiling; the adapter's configured ceiling always applies. */
    readonly maxBytes?: number
}

export interface MediaStoreReadOptions {
    readonly range?: { readonly start: number; readonly end?: number }
    /** Per-operation ceiling; the adapter's configured ceiling always applies. */
    readonly maxBytes?: number
}

export interface MediaStore {
    readonly storeId: string
    readonly maxObjectBytes: number

    /** Store a complete object stream at the opaque key. Existing keys are replaced. */
    put(
        key: string,
        source: ReadableStream<Uint8Array>,
        options?: MediaStoreWriteOptions
    ): Promise<MediaObjectMetadata>
    /** Return metadata when the object exists, or null when it does not. */
    stat(key: string): Promise<MediaObjectMetadata | null>
    /** Open a complete or bounded range stream, or null when the object does not exist. */
    open(key: string, options?: MediaStoreReadOptions): Promise<MediaObjectRead | null>
    /** Delete an object; deleting a missing object is successful. */
    delete(key: string): Promise<void>
}

export interface MediaStoreAdapterOptions {
    readonly storeId: string
    readonly maxObjectBytes: number
}

export interface NormalizedWriteOptions {
    readonly maxBytes: number
    readonly expectedSize: number | undefined
    readonly contentType: string | undefined
}

export function normalizeObjectKey(key: string): string {
    if (
        typeof key !== 'string' ||
        key.length === 0 ||
        key.length > 1024 ||
        key !== key.trim() ||
        key.startsWith('/') ||
        key.endsWith('/') ||
        key.includes('\\') ||
        key.includes('\u0000')
    ) {
        throw new MediaStoreError('invalid_object_key', 'Media object key is not valid', { key })
    }

    for (const segment of key.split('/')) {
        if (
            segment.length === 0 ||
            segment === '.' ||
            segment === '..' ||
            !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)
        ) {
            throw new MediaStoreError('invalid_object_key', 'Media object key is not valid', {
                key,
            })
        }
    }

    return key
}

export function normalizePrefix(prefix: string | undefined): string {
    if (prefix === undefined || prefix.length === 0) return ''
    return `${normalizeObjectKey(prefix)}/`
}

export function validateAdapterOptions(options: MediaStoreAdapterOptions) {
    if (
        typeof options.storeId !== 'string' ||
        options.storeId.length === 0 ||
        options.storeId.length > 255 ||
        options.storeId !== options.storeId.trim()
    ) {
        throw new MediaStoreError('invalid_store_id', 'Media store ID is not valid')
    }

    assertPositiveSafeInteger(options.maxObjectBytes, 'Media store object limit is not valid')
}

export function normalizeWriteOptions(
    options: MediaStoreWriteOptions | undefined,
    maxObjectBytes: number,
    key: string
): NormalizedWriteOptions {
    const maxBytes = normalizeOperationLimit(options?.maxBytes, maxObjectBytes, key)
    const expectedSize = options?.expectedSize

    if (expectedSize !== undefined) {
        if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) {
            throw new MediaStoreError('invalid_byte_limit', 'Expected object size is not valid', {
                key,
            })
        }
        if (expectedSize > maxBytes) {
            throw new MediaStoreError(
                'write_limit_exceeded',
                `Expected object size exceeds the ${maxBytes}-byte write limit`,
                { key }
            )
        }
    }

    const contentType = options?.contentType
    if (
        contentType !== undefined &&
        (typeof contentType !== 'string' ||
            contentType.trim().length === 0 ||
            contentType.length > 255)
    ) {
        throw new MediaStoreError('invalid_content_type', 'Media content type is not valid', {
            key,
        })
    }

    return { maxBytes, expectedSize, contentType }
}

export function normalizeReadLimit(
    requestedLimit: number | undefined,
    maxObjectBytes: number,
    key: string
): number {
    return normalizeOperationLimit(requestedLimit, maxObjectBytes, key)
}

export function normalizeRange(
    range: MediaStoreReadOptions['range'],
    objectSize: number,
    key: string
): MediaObjectRange | null {
    if (range === undefined) return null

    const end = range.end ?? objectSize
    if (
        !Number.isSafeInteger(range.start) ||
        !Number.isSafeInteger(end) ||
        range.start < 0 ||
        end <= range.start ||
        range.start > objectSize ||
        end > objectSize
    ) {
        throw new MediaStoreError('invalid_range', 'Media object range is not valid', { key })
    }

    return { start: range.start, end }
}

function normalizeOperationLimit(
    requestedLimit: number | undefined,
    maxObjectBytes: number,
    key: string
): number {
    if (requestedLimit !== undefined && !Number.isSafeInteger(requestedLimit)) {
        throw new MediaStoreError('invalid_byte_limit', 'Media byte limit is not valid', { key })
    }
    if (requestedLimit !== undefined && requestedLimit <= 0) {
        throw new MediaStoreError('invalid_byte_limit', 'Media byte limit must be positive', {
            key,
        })
    }

    return Math.min(requestedLimit ?? maxObjectBytes, maxObjectBytes)
}

function assertPositiveSafeInteger(value: number, message: string): asserts value is number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new MediaStoreError('invalid_byte_limit', message)
    }
}
