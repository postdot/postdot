import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { createLocalMediaStore, createS3MediaStore, type MediaStore } from './index'

type StoreFixture = {
    readonly name: string
    readonly create: () => Promise<{
        readonly store: MediaStore
        readonly dispose: () => Promise<void>
    }>
}

const fixtures: readonly StoreFixture[] = [
    {
        name: 'local media store',
        async create() {
            const directory = await mkdtemp(join('/tmp', 'herald-media-store-'))
            return {
                store: createLocalMediaStore({
                    storeId: 'local-test',
                    rootDirectory: directory,
                    maxObjectBytes: 8,
                }),
                dispose: () => rm(directory, { recursive: true, force: true }),
            }
        },
    },
    {
        name: 'S3 media store',
        async create() {
            const backend = new FakeS3Backend()
            return {
                store: createS3MediaStore({
                    storeId: 's3-test',
                    client: backend as unknown as Bun.S3Client,
                    prefix: 'herald-media',
                    maxObjectBytes: 8,
                }),
                dispose: async () => {},
            }
        },
    },
]

for (const fixture of fixtures) {
    describe(fixture.name, () => {
        let store: MediaStore
        let dispose: () => Promise<void>

        beforeEach(async () => {
            const created = await fixture.create()
            store = created.store
            dispose = created.dispose
        })

        afterEach(async () => {
            await dispose()
        })

        it('stores, stats, reads, and deletes complete objects', async () => {
            const metadata = await store.put('assets/example', byteStream([1, 2], [3, 4, 5]), {
                contentType: 'image/png',
                expectedSize: 5,
            })

            expect(metadata.key).toBe('assets/example')
            expect(metadata.size).toBe(5)
            expect((await store.stat('assets/example'))?.size).toBe(5)

            const opened = await store.open('assets/example')
            expect(opened?.metadata.size).toBe(5)
            expect(opened?.range).toBeNull()
            expect(await readBytes(opened!.stream)).toEqual([1, 2, 3, 4, 5])

            await store.delete('assets/example')
            await store.delete('assets/example')
            expect(await store.stat('assets/example')).toBeNull()
            expect(await store.open('assets/example')).toBeNull()
        })

        it('reads an exact bounded range without changing full-object metadata', async () => {
            await store.put('assets/range', byteStream([10, 20, 30, 40, 50, 60]))

            const opened = await store.open('assets/range', {
                range: { start: 1, end: 4 },
            })

            expect(opened?.metadata.size).toBe(6)
            expect(opened?.range).toEqual({ start: 1, end: 4 })
            expect(await readBytes(opened!.stream)).toEqual([20, 30, 40])
        })

        it('replaces a key atomically from the store contract perspective', async () => {
            await store.put('assets/replaced', byteStream([1, 2, 3]))
            await store.put('assets/replaced', byteStream([8, 9]))

            const opened = await store.open('assets/replaced')
            expect(await readBytes(opened!.stream)).toEqual([8, 9])
        })

        it('does not leave an object after a write limit or size mismatch', async () => {
            await store.put('assets/safe', byteStream([1, 2, 3]))

            await expect(
                store.put('assets/safe', byteStream([4, 5, 6, 7, 8, 9, 10]), { maxBytes: 6 })
            ).rejects.toMatchObject({ code: 'write_limit_exceeded' })
            expect(await readBytes((await store.open('assets/safe'))!.stream)).toEqual([1, 2, 3])

            await expect(
                store.put('assets/mismatch', byteStream([1, 2]), { expectedSize: 3 })
            ).rejects.toMatchObject({ code: 'size_mismatch' })
            expect(await store.stat('assets/mismatch')).toBeNull()
        })

        it('enforces operation read limits before opening an oversized object', async () => {
            await store.put('assets/limited', byteStream([1, 2, 3, 4]))

            await expect(store.open('assets/limited', { maxBytes: 3 })).rejects.toMatchObject({
                code: 'read_limit_exceeded',
            })

            const opened = await store.open('assets/limited', {
                range: { start: 1, end: 4 },
                maxBytes: 3,
            })
            expect(await readBytes(opened!.stream)).toEqual([2, 3, 4])
        })

        it('rejects unsafe keys and invalid ranges', async () => {
            for (const key of [
                '../escape',
                'assets/../../escape',
                '/leading',
                'trailing/',
                'assets//empty',
                'assets\\windows',
                'assets/..',
                'assets/with space',
                'assets/\u0001',
            ]) {
                await expect(store.stat(key)).rejects.toMatchObject({ code: 'invalid_object_key' })
            }

            await store.put('assets/range-validation', byteStream([1, 2, 3]))
            for (const range of [
                { start: -1, end: 2 },
                { start: 2, end: 2 },
                { start: 0, end: 4 },
            ]) {
                await expect(
                    store.open('assets/range-validation', { range })
                ).rejects.toMatchObject({
                    code: 'invalid_range',
                })
            }
        })
    })
}

describe('media store options', () => {
    it('rejects invalid adapter limits and content types', async () => {
        expect(() =>
            createLocalMediaStore({
                storeId: 'invalid',
                rootDirectory: '/tmp/herald-media-invalid',
                maxObjectBytes: 0,
            })
        ).toThrow()

        await expect(
            createLocalMediaStore({
                storeId: 'invalid',
                rootDirectory: '/tmp/herald-media-invalid',
                maxObjectBytes: 8,
            }).put('assets/file', byteStream([1]), { contentType: ' ' })
        ).rejects.toMatchObject({ code: 'invalid_content_type' })
    })
})

async function readBytes(stream: ReadableStream<Uint8Array>): Promise<number[]> {
    return Array.from(new Uint8Array(await new Response(stream).arrayBuffer()))
}

function byteStream(...chunks: number[][]): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk))
            controller.close()
        },
    })
}

type FakeS3Object = {
    readonly bytes: Uint8Array
    readonly lastModified: Date
}

class FakeS3Backend {
    readonly objects = new Map<string, FakeS3Object>()

    file(path: string): FakeS3File {
        return new FakeS3File(this, path)
    }
}

class FakeS3File {
    readonly #backend: FakeS3Backend
    readonly #path: string
    readonly #start: number | undefined
    readonly #end: number | undefined

    constructor(backend: FakeS3Backend, path: string, start?: number, end?: number) {
        this.#backend = backend
        this.#path = path
        this.#start = start
        this.#end = end
    }

    writer() {
        const chunks: Uint8Array[] = []
        return {
            write(chunk: Uint8Array) {
                chunks.push(Uint8Array.from(chunk))
                return chunk.byteLength
            },
            end: async (error?: Error) => {
                if (error === undefined) {
                    const bytes = concatBytes(chunks)
                    this.#backend.objects.set(this.#path, {
                        bytes,
                        lastModified: new Date(),
                    })
                    return bytes.byteLength
                }
                return 0
            },
        }
    }

    stream(): ReadableStream<Uint8Array> {
        const object = this.#backend.objects.get(this.#path)
        if (object === undefined) throw notFoundError()
        const bytes = object.bytes.slice(this.#start, this.#end)
        return byteStream(Array.from(bytes))
    }

    slice(begin?: number, end?: number): FakeS3File {
        return new FakeS3File(this.#backend, this.#path, begin, end)
    }

    async stat() {
        const object = this.#backend.objects.get(this.#path)
        if (object === undefined) throw notFoundError()
        return {
            size: object.bytes.byteLength,
            lastModified: object.lastModified,
        }
    }

    async delete() {
        this.#backend.objects.delete(this.#path)
    }
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
    const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0))
    let offset = 0
    for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.byteLength
    }
    return result
}

function notFoundError() {
    return Object.assign(new Error('Object not found'), { status: 404 })
}
