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

async function run() {
    const root = join(import.meta.dir, '..')
    const apiDirectory = join(root, 'apps/api')
    const coordinator = createRestartCoordinator(() =>
        Bun.spawn([process.execPath, '--env-file=.env', './src/index.ts'], {
            cwd: apiDirectory,
            env: { ...process.env },
            stdin: 'inherit',
            stdout: 'inherit',
            stderr: 'inherit',
        })
    )
    const watchers: FSWatcher[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    let closing = false
    const schedule = () => {
        if (closing) return
        clearTimeout(timer)
        timer = setTimeout(() => void coordinator.restart(), 150)
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
        clearTimeout(timer)
        for (const watcher of watchers) watcher.close()
        await coordinator.stop(signal)
    }
    process.once('SIGINT', () => void stop('SIGINT'))
    process.once('SIGTERM', () => void stop('SIGTERM'))
    await coordinator.restart()
}

if (import.meta.main) await run()
