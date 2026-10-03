import { expect, test } from 'bun:test'

import { createRestartCoordinator } from './dev-api'

function deferredExit() {
    let finish!: (code: number) => void
    const exited = new Promise<number>(resolve => {
        finish = resolve
    })
    return { exited, finish }
}

test('waits for graceful exit before replacing the API and coalesces pending reloads', async () => {
    const children: Array<ReturnType<typeof deferredExit> & { signals: NodeJS.Signals[] }> = []
    const coordinator = createRestartCoordinator(() => {
        const child = { ...deferredExit(), signals: [] as NodeJS.Signals[] }
        children.push(child)
        return {
            exited: child.exited,
            kill: signal => {
                child.signals.push(signal)
            },
        }
    })
    await coordinator.restart()
    const restarting = coordinator.restart()
    void coordinator.restart()
    void coordinator.restart()
    expect(children).toHaveLength(1)
    expect(children[0]!.signals).toEqual(['SIGTERM'])
    children[0]!.finish(0)
    await Promise.resolve()
    expect(children).toHaveLength(2)
    // A change while draining requires a fresh restart, also serialized.
    children[1]!.finish(0)
    await restarting
    expect(children).toHaveLength(3)
    const stopping = coordinator.stop()
    children[2]!.finish(0)
    await stopping
})

test('an operator stop during draining prevents a replacement from starting', async () => {
    const child = deferredExit()
    let starts = 0
    const coordinator = createRestartCoordinator(() => {
        starts++
        return { exited: child.exited, kill: () => {} }
    })
    await coordinator.restart()
    const restarting = coordinator.restart()
    const stopping = coordinator.stop('SIGINT')
    child.finish(0)
    await Promise.all([restarting, stopping])
    await coordinator.restart()
    expect(starts).toBe(1)
})

test('repeated subprocess restarts retain exclusive lock ownership until delayed drain completes', async () => {
    const { mkdtemp, readFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const directory = await mkdtemp(join(tmpdir(), 'herald-restart-'))
    const database = join(directory, 'runtime.sqlite')
    const lockModule = join(import.meta.dir, '../packages/db/src/runtime-quiescence.ts')
    const children: ReturnType<typeof Bun.spawn>[] = []
    const source = `
        import { acquireRuntimeQuiescenceLock } from ${JSON.stringify(lockModule)};
        const lock = acquireRuntimeQuiescenceLock(${JSON.stringify(database)}, 'server');
        const timer = setInterval(() => {}, 1000);
        process.once('SIGTERM', async () => {
            await Bun.sleep(80);
            lock.release();
            clearInterval(timer);
        });
        console.log('ready');
    `
    const coordinator = createRestartCoordinator(() => {
        const child = Bun.spawn([process.execPath, '-e', source], {
            stdout: 'pipe',
            stderr: 'pipe',
        })
        children.push(child)
        return child
    })
    try {
        for (let index = 0; index < 4; index++) {
            await coordinator.restart()
            const child = children.at(-1)!
            if (!(child.stdout instanceof ReadableStream)) throw new Error('Missing child output')
            const reader = child.stdout.getReader()
            const output = await reader.read()
            reader.releaseLock()
            expect(new TextDecoder().decode(output.value)).toContain('ready')
            expect(JSON.parse(await readFile(`${database}.runtime.lock`, 'utf8')).pid).toBe(
                child.pid
            )
        }
        await coordinator.stop()
        expect(await Bun.file(`${database}.runtime.lock`).exists()).toBe(false)
        expect(await Promise.all(children.map(child => child.exited))).toEqual([0, 0, 0, 0])
    } finally {
        await coordinator.stop()
        await rm(directory, { recursive: true, force: true })
    }
})
