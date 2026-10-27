// cspell:words nostdin ffmpeg
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type { MediaStore } from '@postdot/media'

/** One optional decoder, isolated from publication and upload success. */
export function createVideoPosterExtractor(
    store: MediaStore,
    executable = Bun.which('postdot-poster') ?? Bun.which('ffmpeg')
) {
    let active: AbortController | undefined
    return {
        available: executable !== null,
        cancel() {
            active?.abort()
        },
        async extract(objectKey: string): Promise<Blob> {
            if (!executable) throw new Error('Video preview decoder unavailable')
            const directory = await mkdtemp(join(tmpdir(), 'postdot-poster-'))
            const controller = new AbortController()
            active = controller
            const timer = setTimeout(
                () => controller.abort(new DOMException('Video preview timed out', 'TimeoutError')),
                10_000
            )
            let child: ReturnType<typeof Bun.spawn> | undefined
            try {
                const opened = await new Promise<Awaited<ReturnType<MediaStore['open']>>>(
                    (resolve, reject) => {
                        const abort = () => reject(controller.signal.reason)
                        controller.signal.addEventListener('abort', abort, { once: true })
                        void store
                            .open(objectKey, { maxBytes: store.maxObjectBytes })
                            .then(result => {
                                if (controller.signal.aborted) {
                                    void result?.stream.cancel().catch(() => {})
                                    return
                                }
                                resolve(result)
                            }, reject)
                            .finally(() => controller.signal.removeEventListener('abort', abort))
                        if (controller.signal.aborted) abort()
                    }
                )
                if (!opened || controller.signal.aborted)
                    throw new Error('Video preview source unavailable')
                const input = join(directory, 'input.mp4')
                const sourceReader = opened.stream.getReader()
                const cancelSource = () => {
                    void sourceReader.cancel().catch(() => {})
                }
                controller.signal.addEventListener('abort', cancelSource, { once: true })
                async function* chunks() {
                    try {
                        while (true) {
                            const next = await sourceReader.read()
                            if (next.done) break
                            yield next.value
                        }
                    } finally {
                        sourceReader.releaseLock()
                    }
                }
                try {
                    await pipeline(
                        Readable.from(chunks()),
                        createWriteStream(input, { mode: 0o600 }),
                        { signal: controller.signal }
                    )
                } finally {
                    controller.signal.removeEventListener('abort', cancelSource)
                }
                child = Bun.spawn(
                    [
                        executable,
                        '-v',
                        'error',
                        '-nostdin',
                        '-filter_threads',
                        '1',
                        '-threads',
                        '1',
                        '-protocol_whitelist',
                        'file,pipe',
                        '-f',
                        'mov',
                        '-c:v',
                        'h264',
                        '-ss',
                        '1',
                        '-i',
                        input,
                        '-map',
                        '0:v:0',
                        '-an',
                        '-frames:v',
                        '1',
                        '-vf',
                        "scale=w='min(768,iw)':h='min(768,ih)':force_original_aspect_ratio=decrease",
                        '-threads',
                        '1',
                        '-f',
                        'image2pipe',
                        'pipe:1',
                    ],
                    { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' }
                )
                const running = child
                const terminate = () => running.kill('SIGKILL')
                controller.signal.addEventListener('abort', terminate, { once: true })
                if (controller.signal.aborted) terminate()
                try {
                    const reader = (child.stdout as ReadableStream<Uint8Array>).getReader()
                    const chunks: Uint8Array<ArrayBuffer>[] = []
                    let size = 0
                    try {
                        while (true) {
                            const next = await reader.read()
                            if (next.done) break
                            size += next.value.length
                            if (size > 2 * 1024 * 1024) {
                                terminate()
                                throw new Error('Video preview output too large')
                            }
                            chunks.push(next.value.slice())
                        }
                    } finally {
                        reader.releaseLock()
                    }
                    if ((await child.exited) !== 0 || controller.signal.aborted || size === 0)
                        throw new Error('Video preview extraction failed')
                    const blob = new Blob(chunks, { type: 'image/jpeg' })
                    const metadata = await new Bun.Image(blob).metadata()
                    if (metadata.width > 768 || metadata.height > 768)
                        throw new Error('Video preview dimensions invalid')
                    return blob
                } finally {
                    controller.signal.removeEventListener('abort', terminate)
                }
            } catch (error) {
                if (controller.signal.aborted) throw controller.signal.reason
                throw error
            } finally {
                clearTimeout(timer)
                if (child) {
                    child.kill('SIGKILL')
                    await child.exited
                }
                await rm(directory, { recursive: true, force: true })
                if (active === controller) active = undefined
            }
        },
    }
}

export function createVideoPosterRuntime(options: {
    readonly pending: () => readonly { projectId: string; id: string }[]
    readonly generate: (projectId: string, assetId: string) => Promise<boolean>
    readonly cancel: () => void
}) {
    const queue = new Map<string, { projectId: string; id: string }>()
    const seen = new Set<string>()
    let running: Promise<void> | undefined
    let started = false
    function wake() {
        if (!started || running) return
        running = Promise.resolve()
            .then(async () => {
                while (started && queue.size) {
                    const [key, item] = queue.entries().next().value!
                    queue.delete(key)
                    try {
                        await options.generate(item.projectId, item.id)
                    } catch {
                        console.error('[postdot-media] Video preview job failed')
                    }
                }
            })
            .finally(() => {
                running = undefined
                if (started && queue.size) wake()
            })
    }
    function enqueue(projectId: string, id: string) {
        const key = `${projectId}:${id}`
        if (seen.has(key)) return
        seen.add(key)
        queue.set(key, { projectId, id })
        wake()
    }
    return {
        enqueue,
        start() {
            if (started) return
            started = true
            for (const item of options.pending()) enqueue(item.projectId, item.id)
            wake()
        },
        async stop() {
            started = false
            queue.clear()
            options.cancel()
            await running
        },
    }
}
