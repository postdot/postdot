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
    const directory = await mkdtemp(join(tmpdir(), 'postbot-restart-'))
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
    const root = await mkdtemp(join(tmpdir(), 'postbot-launcher-'))
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
                POSTBOT_MEDIA_DIRECTORY: resources.mediaDirectory,
                POSTBOT_MEDIA_STORE: 'local',
                BETTER_AUTH_URL: resources.apiOrigin,
                POSTBOT_WEB_ORIGIN: resources.webOrigin,
                BETTER_AUTH_SECRET: 'postbot-isolated-test-auth-secret-at-least-32-characters',
                POSTBOT_MEDIA_PUBLIC_URL_SECRET:
                    'postbot-isolated-test-media-secret-at-least-32-characters',
                POSTBOT_PUBLISHER_ENCRYPTION_KEY: '12'.repeat(32),
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

const requestDeadlineMs = 15_000
const streamRequestDeadlineMs = 20_000
const streamDrainDeadlineMs = 10_000

type StreamReadOutcome =
    | { readonly kind: 'frame'; readonly text: string }
    | { readonly kind: 'eof' }
    | { readonly kind: 'error'; readonly message: string }
    | { readonly kind: 'timeout' }

/** Every loopback request is bounded, so no request can hang the test. */
function boundedFetch(
    url: string,
    init?: RequestInit,
    deadlineMs: number = requestDeadlineMs
): Promise<Response> {
    return fetch(url, { ...init, signal: AbortSignal.timeout(deadlineMs) })
}

/**
 * Reads one chunk of a response body under a deadline.
 *
 * A rejected read is a transport error, never the end of the body: a reset
 * connection is not a server that ended the stream on purpose.
 */
async function readStreamChunk(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    deadlineMs: number
): Promise<StreamReadOutcome> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = reader.read().then(
        (
            result
        ):
            | { readonly kind: 'frame'; readonly text: string }
            | { readonly kind: 'eof' }
            | { readonly kind: 'error'; readonly message: string } => {
            if (result.done) return { kind: 'eof' }
            return {
                kind: 'frame',
                text: result.value === undefined ? '' : new TextDecoder().decode(result.value),
            }
        },
        (error: unknown): { readonly kind: 'error'; readonly message: string } => ({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
        })
    )
    try {
        return await Promise.race([
            read,
            new Promise<{ readonly kind: 'timeout' }>(resolve => {
                timer = setTimeout(() => resolve({ kind: 'timeout' }), deadlineMs)
            }),
        ])
    } finally {
        if (timer !== undefined) clearTimeout(timer)
    }
}

/**
 * Drains a response body until it ends, under a deadline.
 *
 * Only a clean end of the body is graceful. A transport error and a body that
 * never ends are both failures, and both are reported apart from each other.
 */
async function drainStreamToEnd(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    deadlineMs: number
): Promise<
    | { readonly outcome: 'eof'; readonly text: string }
    | { readonly outcome: 'error'; readonly text: string; readonly message: string }
    | { readonly outcome: 'timeout'; readonly text: string }
> {
    const deadline = Date.now() + deadlineMs
    let text = ''
    for (;;) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) return { outcome: 'timeout', text }
        const outcome = await readStreamChunk(reader, remaining)
        if (outcome.kind === 'eof') return { outcome: 'eof', text }
        if (outcome.kind === 'error') return { outcome: 'error', text, message: outcome.message }
        if (outcome.kind === 'timeout') return { outcome: 'timeout', text }
        text += outcome.text
    }
}

test('the real API exits and releases its runtime lock while an authenticated event stream is open', async () => {
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
                POSTBOT_MEDIA_DIRECTORY: resources.mediaDirectory,
                POSTBOT_MEDIA_STORE: 'local',
                BETTER_AUTH_URL: resources.apiOrigin,
                POSTBOT_WEB_ORIGIN: resources.webOrigin,
                BETTER_AUTH_SECRET: 'postbot-isolated-test-auth-secret-at-least-32-characters',
                POSTBOT_MEDIA_PUBLIC_URL_SECRET:
                    'postbot-isolated-test-media-secret-at-least-32-characters',
                POSTBOT_PUBLISHER_ENCRYPTION_KEY: '12'.repeat(32),
                LOG_LEVEL: 'silent',
            },
            stdout: 'ignore',
            stderr: 'pipe',
        }
    )
    let diagnostics = ''
    let exited = false
    const exitedCode = server.exited.then(code => {
        exited = true
        return code
    })
    const consumeStderr = (async () => {
        if (!(server.stderr instanceof ReadableStream)) return
        for await (const chunk of server.stderr) diagnostics += new TextDecoder().decode(chunk)
    })()
    const fail: (message: string) => never = message => {
        throw new Error(`${message}: ${diagnostics}`)
    }
    let streamReader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const failures: Error[] = []
    let childExited = false
    try {
        const readinessDeadline = Date.now() + 10_000
        let ready = false
        while (!ready && Date.now() < readinessDeadline) {
            try {
                ready = (await boundedFetch(`${resources.apiOrigin}/health`, undefined, 2_000)).ok
            } catch {}
            if (ready) break
            await Bun.sleep(25)
        }
        if (!ready) fail('The API did not become ready')

        // A synthetic actor and project, so the notification stream has an
        // authorized scope and stays open instead of ending at once.
        const signUp = await boundedFetch(`${resources.apiOrigin}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: resources.apiOrigin },
            body: JSON.stringify({
                email: 'shutdown-stream-operator@postbot.local',
                name: 'Shutdown Stream Operator',
                password: 'correct-horse-battery-staple',
            }),
        })
        if (signUp.status !== 200) fail(`The synthetic sign-up returned ${String(signUp.status)}`)
        const cookie = signUp.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
        if (cookie.length === 0) fail('The synthetic sign-up returned no session cookie')

        const project = await boundedFetch(`${resources.apiOrigin}/api/projects`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie },
            body: JSON.stringify({ name: 'Shutdown stream project' }),
        })
        if (project.status !== 201) fail(`The synthetic project returned ${String(project.status)}`)

        // The stream request outlives the shutdown on purpose, so its own
        // deadline is generous. The drain below carries the real deadline.
        const stream = await boundedFetch(
            `${resources.apiOrigin}/api/notifications/events`,
            { headers: { cookie, accept: 'text/event-stream' } },
            streamRequestDeadlineMs
        )
        if (stream.status !== 200) fail(`The event stream returned ${String(stream.status)}`)
        const body = stream.body
        if (body === null) fail('The event stream returned no body')
        streamReader = body.getReader()
        const opening = await readStreamChunk(streamReader, streamDrainDeadlineMs)
        if (opening.kind === 'timeout') fail('The event stream sent no frame')
        if (opening.kind === 'error') fail(`The event stream failed: ${opening.message}`)
        if (opening.kind === 'eof') fail('The event stream ended before the shutdown')
        expect(opening.text).toContain(': connected')

        // The stream stays open across the signal: the API must end it and
        // complete its own shutdown instead of waiting for the client.
        server.kill('SIGTERM')
        const exitCode = await Promise.race([exitedCode, Bun.sleep(20_000).then(() => null)])
        if (exitCode === null) fail('The API did not exit within the deadline')
        if (exitCode !== 0) fail(`The API exited with ${String(exitCode)}`)
        expect(await Bun.file(`${resources.databaseFile}.runtime.lock`).exists()).toBe(false)
        expect(
            await boundedFetch(`${resources.apiOrigin}/health`, undefined, 2_000)
                .then(response => response.ok)
                .catch(() => false)
        ).toBe(false)

        // The response must end, not stall and not fail: the API ends the
        // stream itself, so the body reaches a clean end of file. A single
        // delivered frame is not the end of the stream, and a transport
        // error is not a graceful end either.
        const drained = await drainStreamToEnd(streamReader, streamDrainDeadlineMs)
        const outcome = drained.outcome
        if (drained.outcome === 'error')
            fail(`The event stream ended with a transport error: ${drained.message}`)
        if (drained.outcome === 'timeout') fail('The event stream did not end within the deadline')
        expect(outcome).toBe('eof')
    } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)))
    } finally {
        // Bounded cleanup of the exact child this test owns: it never waits
        // for the exit indefinitely, and it never signals another process.
        if (!exited) {
            server.kill('SIGTERM')
            await Promise.race([exitedCode, Bun.sleep(5_000)])
        }
        if (!exited) {
            server.kill('SIGKILL')
            await Promise.race([exitedCode, Bun.sleep(5_000)])
        }
        childExited = exited
        // The reader cleanup is bounded too: a stuck body must not hold the
        // test open.
        try {
            await Promise.race([
                streamReader?.cancel().catch(() => {}) ?? Promise.resolve(),
                Bun.sleep(2_000),
            ])
        } catch {}
        try {
            streamReader?.releaseLock()
        } catch {}
        await Promise.race([consumeStderr, Bun.sleep(2_000)])
        if (childExited) {
            // The exact child this test owns is gone, so its isolated
            // database and media storage are free to remove.
            await rm(resources.mediaDirectory, { recursive: true, force: true })
            await rm(resources.dataDirectory, { recursive: true, force: true })
        }
    }
    if (!childExited) {
        // The child may still own its storage, so the fixture is kept for
        // the owner of the run instead of deleted under a live process.
        failures.push(
            new Error(
                `The API child did not exit, so its isolated fixture was kept at ${resources.dataDirectory}`
            )
        )
    }
    const [first] = failures
    if (first === undefined) return
    if (failures.length === 1) throw first
    throw new Error(failures.map(item => item.message).join('\n'), { cause: first })
}, 120_000)
