import {
    MediaStoreError,
    type MediaObjectMetadata,
    type MediaObjectRead,
    type MediaStore,
    type MediaStoreAdapterOptions,
    type MediaStoreReadOptions,
    type MediaStoreWriteOptions,
    normalizeObjectKey,
    normalizePrefix,
    normalizeRange,
    normalizeReadLimit,
    normalizeWriteOptions,
    validateAdapterOptions,
} from './contract'
import { limitReadableStream, writeStreamToSink, type ByteSink } from './streaming'

interface S3MediaStoreFile {
    writer(options?: { readonly type?: string }): ByteSink
    stream(): ReadableStream<Uint8Array>
    slice(begin?: number, end?: number): S3MediaStoreFile
    stat(): Promise<{ readonly size: number; readonly lastModified: Date }>
    delete(): Promise<void>
}

interface S3MediaStoreClient {
    file(path: string, options?: { readonly type?: string }): S3MediaStoreFile
}

export interface S3MediaStoreOptions extends MediaStoreAdapterOptions {
    readonly client: Bun.S3Client
    readonly prefix?: string
}

export class S3MediaStore implements MediaStore {
    readonly storeId: string
    readonly maxObjectBytes: number
    readonly #client: S3MediaStoreClient
    readonly #prefix: string

    constructor(options: S3MediaStoreOptions) {
        validateAdapterOptions(options)
        if (options.client === null || typeof options.client?.file !== 'function') {
            throw new MediaStoreError('storage_failure', 'Bun S3 client is not valid')
        }

        this.storeId = options.storeId
        this.maxObjectBytes = options.maxObjectBytes
        this.#client = options.client
        this.#prefix = normalizePrefix(options.prefix)
    }

    async put(
        key: string,
        source: ReadableStream<Uint8Array>,
        options?: MediaStoreWriteOptions
    ): Promise<MediaObjectMetadata> {
        const normalizedKey = normalizeObjectKey(key)
        const writeOptions = normalizeWriteOptions(options, this.maxObjectBytes, normalizedKey)
        const file = this.#file(normalizedKey, writeOptions.contentType)
        const writer = file.writer(
            writeOptions.contentType === undefined ? undefined : { type: writeOptions.contentType }
        )

        await writeStreamToSink(source, writer, {
            maxBytes: writeOptions.maxBytes,
            expectedSize: writeOptions.expectedSize,
            key: normalizedKey,
        })

        const metadata = await this.#statFile(normalizedKey, file)
        if (metadata === null) {
            throw new MediaStoreError(
                'storage_failure',
                'Stored media object disappeared before metadata could be read',
                { key: normalizedKey }
            )
        }
        return metadata
    }

    async stat(key: string): Promise<MediaObjectMetadata | null> {
        const normalizedKey = normalizeObjectKey(key)
        return this.#statFile(normalizedKey, this.#file(normalizedKey))
    }

    async open(key: string, options?: MediaStoreReadOptions): Promise<MediaObjectRead | null> {
        const normalizedKey = normalizeObjectKey(key)
        const file = this.#file(normalizedKey)
        const metadata = await this.#statFile(normalizedKey, file)
        if (metadata === null) return null

        const range = normalizeRange(options?.range, metadata.size, normalizedKey)
        const maxBytes = normalizeReadLimit(options?.maxBytes, this.maxObjectBytes, normalizedKey)
        const selectedSize = range === null ? metadata.size : range.end - range.start
        if (selectedSize > maxBytes) {
            throw new MediaStoreError(
                'read_limit_exceeded',
                `Media object range exceeds the ${maxBytes}-byte read limit`,
                { key: normalizedKey }
            )
        }

        const selected = range === null ? file : file.slice(range.start, range.end)
        return {
            metadata,
            range,
            stream: limitReadableStream(selected.stream(), maxBytes, normalizedKey),
        }
    }

    async delete(key: string): Promise<void> {
        const normalizedKey = normalizeObjectKey(key)
        const file = this.#file(normalizedKey)

        try {
            await file.delete()
        } catch (error) {
            if (isNotFoundError(error)) return
            throw error
        }
    }

    #file(key: string, contentType?: string): S3MediaStoreFile {
        const fullKey = `${this.#prefix}${key}`
        if (fullKey.length > 1024) {
            throw new MediaStoreError('invalid_object_key', 'Media object key is not valid', {
                key,
            })
        }
        return this.#client.file(
            fullKey,
            contentType === undefined ? undefined : { type: contentType }
        )
    }

    async #statFile(key: string, file: S3MediaStoreFile): Promise<MediaObjectMetadata | null> {
        try {
            const stats = await file.stat()
            if (
                !Number.isSafeInteger(stats.size) ||
                stats.size < 0 ||
                !(stats.lastModified instanceof Date) ||
                Number.isNaN(stats.lastModified.getTime())
            ) {
                throw new MediaStoreError('storage_failure', 'S3 object size is not valid', { key })
            }
            return { key, size: stats.size, lastModified: stats.lastModified }
        } catch (error) {
            if (error instanceof MediaStoreError) throw error
            if (isNotFoundError(error)) return null
            throw error
        }
    }
}

function isNotFoundError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    const candidate = error as {
        code?: unknown
        status?: unknown
        statusCode?: unknown
        name?: unknown
    }
    return (
        candidate.code === 'NoSuchKey' ||
        candidate.code === 'NotFound' ||
        candidate.name === 'NotFound' ||
        candidate.status === 404 ||
        candidate.statusCode === 404 ||
        (candidate.name === 'S3Error' &&
            /(?:\b404\b|not[ -]?found|no such key)/i.test(
                error instanceof Error ? error.message : ''
            ))
    )
}

export function createS3MediaStore(options: S3MediaStoreOptions): S3MediaStore {
    return new S3MediaStore(options)
}
