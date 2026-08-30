import { MediaStoreError } from './contract'

export interface ByteSink {
    write(chunk: Uint8Array): number | Promise<number>
    end(error?: Error): number | Promise<number>
}

export async function writeStreamToSink(
    source: ReadableStream<Uint8Array>,
    sink: ByteSink,
    options: { readonly maxBytes: number; readonly expectedSize?: number; readonly key: string }
): Promise<number> {
    if (source === null || typeof source?.getReader !== 'function') {
        throw new MediaStoreError(
            'invalid_source',
            'Media object source must be a readable stream',
            {
                key: options.key,
            }
        )
    }

    const reader = source.getReader()
    let released = false
    let ended = false
    let size = 0

    const release = () => {
        if (!released) {
            released = true
            reader.releaseLock()
        }
    }

    try {
        while (true) {
            const result = await reader.read()
            if (result.done) break

            if (!(result.value instanceof Uint8Array)) {
                throw new MediaStoreError(
                    'invalid_source',
                    'Media object source must yield Uint8Array chunks',
                    { key: options.key }
                )
            }

            const nextSize = size + result.value.byteLength
            if (nextSize > options.maxBytes) {
                throw new MediaStoreError(
                    'write_limit_exceeded',
                    `Media object exceeds the ${options.maxBytes}-byte write limit`,
                    { key: options.key }
                )
            }

            await sink.write(result.value)
            size = nextSize
        }

        if (options.expectedSize !== undefined && size !== options.expectedSize) {
            throw new MediaStoreError(
                'size_mismatch',
                `Media object size ${size} does not match expected size ${options.expectedSize}`,
                { key: options.key }
            )
        }

        await sink.end()
        ended = true
        return size
    } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error))

        if (!ended) {
            try {
                await sink.end(failure)
            } catch {
                // Preserve the original transfer error.
            }
        }

        try {
            await reader.cancel(failure)
        } catch {
            // The source may already have failed or closed.
        }

        throw error
    } finally {
        release()
    }
}

export function limitReadableStream(
    source: ReadableStream<Uint8Array>,
    maxBytes: number,
    key: string
): ReadableStream<Uint8Array> {
    if (source === null || typeof source?.getReader !== 'function') {
        throw new MediaStoreError(
            'invalid_source',
            'Media object source must be a readable stream',
            {
                key,
            }
        )
    }

    const reader = source.getReader()
    let released = false
    let finished = false
    let size = 0

    const release = () => {
        if (!released) {
            released = true
            reader.releaseLock()
        }
    }

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const result = await reader.read()
                if (result.done) {
                    finished = true
                    release()
                    controller.close()
                    return
                }

                if (!(result.value instanceof Uint8Array)) {
                    const error = new MediaStoreError(
                        'invalid_source',
                        'Media object source must yield Uint8Array chunks',
                        { key }
                    )
                    finished = true
                    await reader.cancel(error)
                    release()
                    controller.error(error)
                    return
                }

                const nextSize = size + result.value.byteLength
                if (nextSize > maxBytes) {
                    const error = new MediaStoreError(
                        'read_limit_exceeded',
                        `Media object exceeds the ${maxBytes}-byte read limit`,
                        { key }
                    )
                    finished = true
                    await reader.cancel(error)
                    release()
                    controller.error(error)
                    return
                }

                size = nextSize
                controller.enqueue(result.value)
            } catch (error) {
                finished = true
                release()
                controller.error(error)
            }
        },
        async cancel(reason) {
            if (!finished) {
                finished = true
                try {
                    await reader.cancel(reason)
                } finally {
                    release()
                }
            } else {
                release()
            }
        },
    })
}
