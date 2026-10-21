import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createE2ERuntimeResources } from './e2e-runtime'

const repositoryRoot = join(import.meta.dir, '..')
const apiEntryPoint = join(repositoryRoot, 'apps/api/src/index.ts')
const migrationsDirectory = join(repositoryRoot, 'packages/db/drizzle')

const markerDeadlineMs = 30_000
const markerPidDeadlineMs = 2_000
const exitDeadlineMs = 30_000
const readinessDeadlineMs = 30_000
const drainDeadlineMs = 5_000
const cleanupDeadlineMs = 5_000

interface BundleChild {
    readonly child: ReturnType<typeof Bun.spawn>
    readonly exited: Promise<number>
    readonly drained: Promise<void>
    readonly stderr: () => string
    gone: boolean
}

/**
 * Starts the production bundle as a child this test owns.
 *
 * The environment is built explicitly instead of being spread from the
 * ambient one, so the owner's own `.env`, port, database, media root and
 * secrets stay out of the child. The child runs in the isolated data
 * directory, which holds no `.env` file, so the bundle cannot pick up one
 * from the working directory either.
 */
function spawnBundle(
    bundlePath: string,
    cwd: string,
    environment: Record<string, string>
): BundleChild {
    const child = Bun.spawn([process.execPath, bundlePath], {
        cwd,
        env: environment,
        stdout: 'ignore',
        stderr: 'pipe',
    })
    let stderr = ''
    const drained = (async () => {
        if (!(child.stderr instanceof ReadableStream)) return
        for await (const chunk of child.stderr) stderr += new TextDecoder().decode(chunk)
    })()
    const tracked: BundleChild = {
        child,
        exited: child.exited,
        drained,
        stderr: () => stderr,
        gone: false,
    }
    const markGone = () => {
        tracked.gone = true
    }
    void child.exited.then(markGone, markGone)
    return tracked
}

/**
 * Reads the process identifier recorded in the runtime marker.
 *
 * The marker is the record the API runtime writes for its database, so its
 * pid names the process that owns that database. The file is created empty
 * and filled in right afterwards, so a read can land in that window. The
 * wait for a readable record is bounded, and a marker that never carries a
 * process identifier yields undefined.
 */
async function readMarkerPid(marker: string): Promise<number | undefined> {
    const deadline = Date.now() + markerPidDeadlineMs
    for (;;) {
        try {
            const record = JSON.parse(await readFile(marker, 'utf8')) as { pid?: unknown }
            if (typeof record.pid === 'number') return record.pid
        } catch {}
        if (Date.now() >= deadline) return undefined
        await Bun.sleep(2)
    }
}

test('the production bundle releases its runtime marker when a termination lands during startup', async () => {
    const resources = await createE2ERuntimeResources({})
    const marker = `${resources.databaseFile}.runtime.lock`
    const buildDirectory = await mkdtemp(join(tmpdir(), 'postbot-production-bundle-'))
    const webAssetsDirectory = join(resources.dataDirectory, 'web')
    const children: BundleChild[] = []
    const failures: Error[] = []
    try {
        await mkdir(webAssetsDirectory, { recursive: true })
        // In production the dashboard plugin refuses to start without an
        // index document, so the isolated asset directory carries one.
        await writeFile(
            join(webAssetsDirectory, 'index.html'),
            '<!doctype html><html><head><title>Postdot</title></head><body><div id="root"></div></body></html>'
        )

        // The production artifact is built here, so the test never depends on
        // a pre-existing apps/api/dist.
        const build = await Bun.build({
            entrypoints: [apiEntryPoint],
            outdir: buildDirectory,
            target: 'bun',
            minify: true,
        })
        if (!build.success) throw new Error('The production bundle did not build')
        const bundlePath = join(buildDirectory, 'index.js')
        expect(await Bun.file(bundlePath).exists()).toBe(true)

        const environment: Record<string, string> = {
            PATH: process.env.PATH ?? '',
            HOME: process.env.HOME ?? '',
            TMPDIR: process.env.TMPDIR ?? '',
            NODE_ENV: 'production',
            PORT: String(resources.apiPort),
            DB_FILE_NAME: resources.databaseFile,
            POSTBOT_MEDIA_DIRECTORY: resources.mediaDirectory,
            POSTBOT_MEDIA_STORE: 'local',
            POSTBOT_MIGRATIONS_DIR: migrationsDirectory,
            POSTBOT_WEB_ASSETS_DIR: webAssetsDirectory,
            BETTER_AUTH_URL: resources.apiOrigin,
            POSTBOT_WEB_ORIGIN: resources.webOrigin,
            BETTER_AUTH_SECRET: 'postbot-isolated-production-test-auth-secret-32-characters',
            POSTBOT_MEDIA_PUBLIC_URL_SECRET:
                'postbot-isolated-production-test-media-secret-32-characters',
            POSTBOT_PUBLISHER_ENCRYPTION_KEY: '12'.repeat(32),
        }

        const first = spawnBundle(bundlePath, resources.dataDirectory, environment)
        children.push(first)

        // The health poll covers the whole lifetime of the first bundle, so a
        // request the API answered at any point is recorded. Any response
        // counts as the API having served, not only a successful one.
        let served = 0
        const pollHealth = (async () => {
            while (!first.gone) {
                try {
                    const response = await fetch(`${resources.apiOrigin}/health`, {
                        signal: AbortSignal.timeout(200),
                    })
                    served += 1
                    const body = response.body
                    if (body !== null) void body.cancel().catch(() => {})
                } catch {}
                await Bun.sleep(5)
            }
        })()

        // The marker is created at the first statement of the startup, so its
        // presence opens the window in which the API has not served yet.
        const markerDeadline = Date.now() + markerDeadlineMs
        while (!(await Bun.file(marker).exists()) && Date.now() < markerDeadline) {
            await Bun.sleep(2)
        }
        expect(await Bun.file(marker).exists()).toBe(true)
        // The marker must name the very child this test started, so it cannot
        // be a leftover of an unrelated process.
        expect(await readMarkerPid(marker)).toBe(first.child.pid)

        // The termination lands inside the startup window, before the bundle
        // can listen.
        first.child.kill('SIGTERM')
        const exitCode = await Promise.race([
            first.exited,
            Bun.sleep(exitDeadlineMs).then(() => null),
        ])
        expect(exitCode).toBe(0)
        // A null signal code means no signal ended the child, so the bundle
        // left through its own drain and not through the platform's default
        // disposition of the signal.
        expect(first.child.signalCode).toBeNull()
        expect(await Bun.file(marker).exists()).toBe(false)
        const pollFinished = await Promise.race([
            pollHealth.then(() => true),
            Bun.sleep(drainDeadlineMs).then(() => false),
        ])
        expect(pollFinished).toBe(true)
        expect(served).toBe(0)
        await Promise.race([first.drained, Bun.sleep(drainDeadlineMs)])
        // The bundle ran its own orderly drain, so it released the marker
        // itself instead of losing the default disposition of the signal.
        expect(first.stderr()).toContain('[postbot-shutdown] SIGTERM received')
        expect(first.stderr()).toContain('shutdown complete with exit code 0')

        // The next start of the same bundle on the same database must not be
        // blocked by a retained marker.
        const second = spawnBundle(bundlePath, resources.dataDirectory, environment)
        children.push(second)
        const readinessDeadline = Date.now() + readinessDeadlineMs
        let status: number | undefined
        while (Date.now() < readinessDeadline) {
            try {
                const response = await fetch(`${resources.apiOrigin}/health`, {
                    signal: AbortSignal.timeout(1_000),
                })
                status = response.status
                const body = response.body
                if (body !== null) void body.cancel().catch(() => {})
            } catch {}
            if (status === 200) break
            await Bun.sleep(25)
        }
        expect(status).toBe(200)
        expect(await Bun.file(marker).exists()).toBe(true)
        // The marker of the second start must name the second child this test
        // started, so it cannot be a leftover of an unrelated process.
        expect(await readMarkerPid(marker)).toBe(second.child.pid)

        // Stopping the second bundle releases the marker again.
        second.child.kill('SIGTERM')
        const secondExitCode = await Promise.race([
            second.exited,
            Bun.sleep(exitDeadlineMs).then(() => null),
        ])
        expect(secondExitCode).toBe(0)
        // A null signal code means no signal ended the child, so this bundle
        // left through its own drain and not through the platform's default
        // disposition of the signal.
        expect(second.child.signalCode).toBeNull()
        expect(await Bun.file(marker).exists()).toBe(false)
        await Promise.race([second.drained, Bun.sleep(drainDeadlineMs)])
        expect(second.stderr()).toContain('[postbot-shutdown] SIGTERM received')
        expect(second.stderr()).toContain('shutdown complete with exit code 0')
    } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)))
    } finally {
        // Bounded cleanup of the exact children this test owns: it never waits
        // for an exit indefinitely, and it never signals another process.
        for (const owned of children) {
            if (!owned.gone) {
                owned.child.kill('SIGTERM')
                await Promise.race([owned.exited, Bun.sleep(cleanupDeadlineMs)])
            }
            if (!owned.gone) {
                owned.child.kill('SIGKILL')
                await Promise.race([owned.exited, Bun.sleep(cleanupDeadlineMs)])
            }
            await Promise.race([owned.drained, Bun.sleep(2_000)])
        }
        const ownedProcessesGone = children.every(owned => owned.gone)
        if (ownedProcessesGone) {
            // Every owned child is gone, so the isolated fixture is free to
            // remove.
            await rm(buildDirectory, { recursive: true, force: true })
            await rm(resources.mediaDirectory, { recursive: true, force: true })
            await rm(resources.dataDirectory, { recursive: true, force: true })
        } else {
            failures.push(
                new Error(
                    `An owned bundle child did not exit, so its isolated fixture was kept at ${resources.dataDirectory} and ${buildDirectory}`
                )
            )
        }
    }
    const [first] = failures
    if (first === undefined) return
    if (failures.length === 1) throw first
    throw new Error(failures.map(item => item.message).join('\n'), { cause: first })
}, 180_000)
