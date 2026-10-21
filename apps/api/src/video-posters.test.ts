import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLocalMediaStore } from '@postdot/media'

import { createVideoPosterExtractor, createVideoPosterRuntime } from './video-posters'

function deferred() {
    let resolve!: () => void
    const promise = new Promise<void>(done => {
        resolve = done
    })
    return { promise, resolve }
}

describe('video poster background runtime', () => {
    it('deduplicates startup and upload work, serializes and drains the active job', async () => {
        const entered = deferred(),
            held = deferred()
        const calls: string[] = []
        const runtime = createVideoPosterRuntime({
            pending: () => [{ projectId: 'p', id: 'one' }],
            generate: async (_, id) => {
                calls.push(id)
                entered.resolve()
                await held.promise
                return true
            },
            cancel: () => held.resolve(),
        })
        runtime.start()
        runtime.enqueue('p', 'one')
        runtime.enqueue('p', 'two')
        await entered.promise
        expect(calls).toEqual(['one'])
        await runtime.stop()
        expect(calls).toEqual(['one'])
    })
    it('continues after an extraction fails without repeating an asset', async () => {
        const second = deferred()
        const calls: string[] = []
        const runtime = createVideoPosterRuntime({
            pending: () => [
                { projectId: 'p', id: 'one' },
                { projectId: 'p', id: 'two' },
            ],
            generate: async (_, id) => {
                calls.push(id)
                if (id === 'one') throw new Error('private')
                second.resolve()
                return true
            },
            cancel: () => {},
        })
        runtime.start()
        await second.promise
        runtime.enqueue('p', 'one')
        await runtime.stop()
        expect(calls).toEqual(['one', 'two'])
    })
})

it('optional decoder absence and cancellation never require the original to change', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'postbot-poster-test-'))
    try {
        const store = createLocalMediaStore({
            storeId: 'poster-test',
            rootDirectory: join(directory, 'media'),
            maxObjectBytes: 1024,
        })
        await store.put('original.mp4', new Blob(['original']).stream())
        const missing = createVideoPosterExtractor(store, join(directory, 'missing'))
        await expect(missing.extract('original.mp4')).rejects.toThrow()
        const executable = join(directory, 'decoder')
        const marker = join(directory, 'entered')
        await Bun.write(
            executable,
            `#!${process.execPath}\nawait Bun.write(${JSON.stringify(marker)},'ready');setInterval(()=>{},1000);`
        )
        await chmod(executable, 0o700)
        const extractor = createVideoPosterExtractor(store, executable)
        const result = extractor.extract('original.mp4')
        // Wait for the real child, rather than assuming a delay means it has started.
        while (!(await Bun.file(marker).exists())) await Bun.sleep(5)
        extractor.cancel()
        await expect(result).rejects.toMatchObject({ name: 'AbortError' })
        const opened = await store.open('original.mp4')
        expect(await new Response(opened!.stream).text()).toBe('original')
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
