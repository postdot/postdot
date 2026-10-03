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

test('launcher diagnoses unexpected API exit, restarts on edit and drains terminal hangup', async () => {
    const { mkdir, mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const root = await mkdtemp(join(tmpdir(), 'herald-launcher-'))
    const api = join(root, 'apps/api')
    const database = join(root, 'runtime.sqlite')
    const lockModule = join(import.meta.dir, '../packages/db/src/runtime-quiescence.ts')
    const launcherModule = join(import.meta.dir, 'dev-api.ts')
    await mkdir(join(api, 'src'), { recursive: true })
    await mkdir(join(root, 'packages'), { recursive: true })
    await writeFile(join(root, 'bun.lock'), '')
    await writeFile(join(root, 'package.json'), '{}')
    await writeFile(join(api, '.env'), '')
    await writeFile(
        join(api, 'src/index.ts'),
        `
        import { acquireRuntimeQuiescenceLock } from ${JSON.stringify(lockModule)};
        const lock = acquireRuntimeQuiescenceLock(${JSON.stringify(database)}, 'server');
        const timer = setInterval(() => {}, 1000);
        let stopping = false;
        const stop = async () => {
            if (stopping) return;
            stopping = true;
            await Bun.sleep(80);
            lock.release();
            clearInterval(timer);
        };
        process.once('SIGTERM', stop);
        process.once('SIGHUP', stop);
        console.log('fixture ready');
    `
    )
    const launcher = Bun.spawn(
        [
            process.execPath,
            '-e',
            `
        import { runDevelopmentApi } from ${JSON.stringify(launcherModule)};
        await runDevelopmentApi(${JSON.stringify(root)});
    `,
        ],
        { detached: true, stdout: 'pipe', stderr: 'pipe' }
    )
    let output = ''
    const consume = async (stream: ReadableStream<Uint8Array>) => {
        for await (const chunk of stream) output += new TextDecoder().decode(chunk)
    }
    const streams = Promise.all([consume(launcher.stdout), consume(launcher.stderr)])
    let apiPid: number | undefined
    const waitFor = async (condition: () => boolean | Promise<boolean>) => {
        for (let attempt = 0; attempt < 200; attempt++) {
            if (await condition()) return
            await Bun.sleep(10)
        }
        throw new Error(`Launcher condition not reached: ${output}`)
    }
    try {
        await waitFor(() => output.includes('fixture ready'))
        apiPid = JSON.parse(await readFile(`${database}.runtime.lock`, 'utf8')).pid
        process.kill(apiPid!, 'SIGTERM')
        await waitFor(() => output.includes('API exited unexpectedly'))
        expect(output).toContain('code 0')
        expect(output).toContain('waiting for a watched edit')
        expect(launcher.exitCode).toBeNull()
        await writeFile(join(api, 'src/reload.ts'), '// watched change\n')
        await waitFor(() => output.split('fixture ready').length === 3)
        const replacement = JSON.parse(await readFile(`${database}.runtime.lock`, 'utf8')).pid
        expect(replacement).not.toBe(apiPid)
        apiPid = replacement
        process.kill(-launcher.pid, 'SIGHUP')
        expect(await launcher.exited).toBe(129)
        await streams
        expect(output).toContain('Launcher stopping (SIGHUP)')
        expect(output).toContain('API stopped')
        expect(await Bun.file(`${database}.runtime.lock`).exists()).toBe(false)
        expect(() => process.kill(apiPid!, 0)).toThrow()
    } finally {
        if (launcher.exitCode === null) launcher.kill('SIGTERM')
        await launcher.exited
        if (apiPid) {
            try {
                process.kill(apiPid, 'SIGTERM')
            } catch {}
        }
        await streams
        await rm(root, { recursive: true, force: true })
    }
}, 10000)

test('real API releases its runtime lock when terminal hangup reaches the child directly', async () => {
    const { rm } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const { createE2ERuntimeResources } = await import('./e2e-runtime')
    const resources = await createE2ERuntimeResources({})
    const server = Bun.spawn(
        [process.execPath, join(import.meta.dir, '../apps/api/src/index.ts')],
        {
            cwd: resources.dataDirectory,
            env: {
                PATH: process.env.PATH,
                NODE_ENV: 'test',
                PORT: String(resources.apiPort),
                DB_FILE_NAME: resources.databaseFile,
                HERALD_MEDIA_DIRECTORY: resources.mediaDirectory,
                HERALD_MEDIA_STORE: 'local',
                BETTER_AUTH_URL: resources.apiOrigin,
                HERALD_WEB_ORIGIN: resources.webOrigin,
                BETTER_AUTH_SECRET: 'herald-isolated-test-auth-secret-at-least-32-characters',
                HERALD_MEDIA_PUBLIC_URL_SECRET:
                    'herald-isolated-test-media-secret-at-least-32-characters',
                HERALD_PUBLISHER_ENCRYPTION_KEY: '12'.repeat(32),
                LOG_LEVEL: 'silent',
            },
            stdout: 'ignore',
            stderr: 'pipe',
        }
    )
    try {
        let ready = false
        for (let attempt = 0; attempt < 100; attempt++) {
            try {
                ready = (await fetch(`${resources.apiOrigin}/health`)).ok
            } catch {}
            if (ready) break
            await Bun.sleep(25)
        }
        expect(ready).toBe(true)
        expect(await Bun.file(`${resources.databaseFile}.runtime.lock`).exists()).toBe(true)
        server.kill('SIGHUP')
        expect(await server.exited).toBe(0)
        expect(await Bun.file(`${resources.databaseFile}.runtime.lock`).exists()).toBe(false)
        expect(
            await fetch(`${resources.apiOrigin}/health`)
                .then(response => response.ok)
                .catch(() => false)
        ).toBe(false)
    } finally {
        if (server.exitCode === null) server.kill('SIGTERM')
        await server.exited
        await rm(resources.dataDirectory, { recursive: true, force: true })
    }
}, 10000)
