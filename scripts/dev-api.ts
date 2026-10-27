import { watch, type FSWatcher } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

interface Child {
    exited: Promise<number>
    kill(signal: NodeJS.Signals): void
}

/** Development-only restart serialization; never releases a child's runtime lock. */
export function createRestartCoordinator(spawn: () => Child) {
    let child: Child | undefined
    let pending = false
    let stopped = false
    let operation: Promise<void> | undefined

    async function drain() {
        while (pending && !stopped) {
            pending = false
            if (child) {
                child.kill('SIGTERM')
                await child.exited
            }
            if (!stopped) child = spawn()
        }
    }

    function restart() {
        if (stopped) return Promise.resolve()
        pending = true
        operation ??= drain().finally(() => {
            operation = undefined
        })
        return operation
    }

    async function stop(signal: NodeJS.Signals = 'SIGTERM') {
        stopped = true
        pending = false
        child?.kill(signal)
        await operation
        await child?.exited
    }

    return { restart, stop }
}

export async function runDevelopmentApi(root = join(import.meta.dir, '..')) {
    const apiDirectory = join(root, 'apps/api')
    const coordinator = createRestartCoordinator(() => {
        const child = Bun.spawn([process.execPath, '--env-file=.env', './src/index.ts'], {
            cwd: apiDirectory,
            env: { ...process.env },
            stdin: 'inherit',
            stdout: 'inherit',
            stderr: 'inherit',
        })
        let expectedExit = false
        let exited = false
        console.info(`[postdot-dev] API started (pid ${child.pid})`)
        return {
            exited: child.exited.then(code => {
                exited = true
                if (expectedExit) {
                    console.info(`[postdot-dev] API stopped (pid ${child.pid}, code ${code})`)
                } else {
                    console.error(
                        `[postdot-dev] API exited unexpectedly (pid ${child.pid}, code ${code}); waiting for a watched edit. No runtime lock was removed.`
                    )
                }
                return code
            }),
            kill(signal: NodeJS.Signals) {
                if (exited) return
                expectedExit = true
                child.kill(signal)
            },
        }
    })
    const watchers: FSWatcher[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    let closing = false
    const schedule = () => {
        if (closing) return
        clearTimeout(timer)
        timer = setTimeout(() => {
            console.info('[postdot-dev] Watched change: restarting API after graceful exit')
            void coordinator.restart()
        }, 150)
    }

    const packages = await readdir(join(root, 'packages'), { withFileTypes: true })
    const directories = [
        join(apiDirectory, 'src'),
        ...packages
            .filter(entry => entry.isDirectory())
            .map(entry => join(root, 'packages', entry.name, 'src')),
    ]
    for (const directory of directories) {
        watchers.push(watch(directory, { recursive: true }, schedule))
    }
    watchers.push(
        watch(apiDirectory, (_event, filename) => {
            if (filename === '.env' || filename === 'package.json') schedule()
        })
    )
    for (const filename of ['bun.lock', 'package.json']) {
        watchers.push(watch(join(root, filename), schedule))
    }

    const stop = async (signal: NodeJS.Signals) => {
        if (closing) return
        closing = true
        console.info(`[postdot-dev] Launcher stopping (${signal})`)
        process.exitCode = signal === 'SIGINT' ? 130 : signal === 'SIGHUP' ? 129 : 143
        clearTimeout(timer)
        for (const watcher of watchers) watcher.close()
        // The API handles SIGTERM; translate terminal hangup into its graceful path.
        await coordinator.stop(signal === 'SIGHUP' ? 'SIGTERM' : signal)
    }
    process.once('SIGINT', () => void stop('SIGINT'))
    process.once('SIGTERM', () => void stop('SIGTERM'))
    process.once('SIGHUP', () => void stop('SIGHUP'))
    await coordinator.restart()
}

if (import.meta.main) await runDevelopmentApi()
