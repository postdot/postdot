import { randomUUID } from 'node:crypto'
import { chmod, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import {
    MediaStoreError,
    type MediaObjectMetadata,
    type MediaObjectRead,
    type MediaStore,
    type MediaStoreAdapterOptions,
    type MediaStoreReadOptions,
    type MediaStoreWriteOptions,
    normalizeObjectKey,
    normalizeRange,
    normalizeReadLimit,
    normalizeWriteOptions,
    validateAdapterOptions,
} from './contract'
import { limitReadableStream, writeStreamToSink } from './streaming'

export interface LocalMediaStoreOptions extends MediaStoreAdapterOptions {
    readonly rootDirectory: string
}

export class LocalMediaStore implements MediaStore {
    readonly storeId: string
    readonly maxObjectBytes: number
    readonly #rootDirectory: string

    constructor(options: LocalMediaStoreOptions) {
        validateAdapterOptions(options)
        if (
            typeof options.rootDirectory !== 'string' ||
            options.rootDirectory.trim().length === 0
        ) {
            throw new MediaStoreError('storage_failure', 'Local media store root is not valid')
        }

        this.storeId = options.storeId
        this.maxObjectBytes = options.maxObjectBytes
        this.#rootDirectory = resolve(options.rootDirectory)
    }

    async put(
        key: string,
        source: ReadableStream<Uint8Array>,
        options?: MediaStoreWriteOptions
    ): Promise<MediaObjectMetadata> {
        const normalizedKey = normalizeObjectKey(key)
        const writeOptions = normalizeWriteOptions(options, this.maxObjectBytes, normalizedKey)
        const destination = this.#pathForKey(normalizedKey)
        const temporary = join(dirname(destination), `.${randomUUID()}.upload`)

        await mkdir(dirname(destination), { recursive: true, mode: 0o700 })

        try {
            await writeStreamToSink(source, Bun.file(temporary).writer(), {
                maxBytes: writeOptions.maxBytes,
                expectedSize: writeOptions.expectedSize,
                key: normalizedKey,
            })
            await chmod(temporary, 0o600)

            await rename(temporary, destination)
            const metadata = await this.#statPath(normalizedKey, destination)
            if (metadata === null) {
                throw new MediaStoreError(
                    'storage_failure',
                    'Stored media object disappeared before metadata could be read',
                    { key: normalizedKey }
                )
            }
            return metadata
        } finally {
            await rm(temporary, { force: true })
        }
    }

    async stat(key: string): Promise<MediaObjectMetadata | null> {
        const normalizedKey = normalizeObjectKey(key)
        return this.#statPath(normalizedKey, this.#pathForKey(normalizedKey))
    }

    async open(key: string, options?: MediaStoreReadOptions): Promise<MediaObjectRead | null> {
        const normalizedKey = normalizeObjectKey(key)
        const path = this.#pathForKey(normalizedKey)
        const metadata = await this.#statPath(normalizedKey, path)
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

        const file = Bun.file(path)
        const selected = range === null ? file : file.slice(range.start, range.end)
        return {
            metadata,
            range,
            stream: limitReadableStream(selected.stream(), maxBytes, normalizedKey),
        }
    }

    async delete(key: string): Promise<void> {
        const normalizedKey = normalizeObjectKey(key)
        const path = this.#pathForKey(normalizedKey)

        try {
            await Bun.file(path).delete()
        } catch (error) {
            if (isNotFoundError(error)) return
            throw error
        }
    }

    #pathForKey(key: string): string {
        const path = resolve(this.#rootDirectory, ...key.split('/'))
        const pathFromRoot = relative(this.#rootDirectory, path)
        if (
            pathFromRoot === '..' ||
            pathFromRoot.startsWith(`..${sep}`) ||
            isAbsolute(pathFromRoot)
        ) {
            throw new MediaStoreError('invalid_object_key', 'Media object key is not valid', {
                key,
            })
        }
        return path
    }

    async #statPath(key: string, path: string): Promise<MediaObjectMetadata | null> {
        try {
            const stats = await Bun.file(path).stat()
            if (!stats.isFile()) {
                throw new MediaStoreError(
                    'storage_failure',
                    'Media storage object is not a regular file',
                    { key }
                )
            }
            if (
                !Number.isSafeInteger(stats.size) ||
                stats.size < 0 ||
                !(stats.mtime instanceof Date) ||
                Number.isNaN(stats.mtime.getTime())
            ) {
                throw new MediaStoreError('storage_failure', 'Local object metadata is not valid', {
                    key,
                })
            }
            return { key, size: stats.size, lastModified: stats.mtime }
        } catch (error) {
            if (error instanceof MediaStoreError) throw error
            if (isNotFoundError(error)) return null
            throw error
        }
    }
}

function isNotFoundError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    const candidate = error as { code?: unknown; errno?: unknown; status?: unknown }
    return candidate.code === 'ENOENT' || candidate.errno === -2 || candidate.status === 404
}

export function createLocalMediaStore(options: LocalMediaStoreOptions): LocalMediaStore {
    return new LocalMediaStore(options)
}
