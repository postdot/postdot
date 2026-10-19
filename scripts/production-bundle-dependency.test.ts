import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { collectExternalRequires, isPackageSpecifier } from './bundle-requires'

/**
 * The production image carries the bundle, the migrations and the dashboard
 * assets. It carries no `node_modules`, so the bundle must not need one.
 *
 * Two checks guard that contract:
 *
 * 1. The bundle is served from a working directory where no module can
 *    resolve, the way the image runs it. A bundle that reaches for a package
 *    answers 500 instead of serving, exactly as it did when Elysia loaded the
 *    TypeBox namespaces through a require the bundler could not inline.
 * 2. The bundle text is inspected for runtime requires of external packages.
 *    A literal require of a package can never be satisfied in the image, and
 *    a dynamic require of a package the bundle does not carry can never be
 *    satisfied either.
 *
 * The scan the second check uses lives in `scripts/bundle-requires.ts`, and
 * `scripts/bundle-requires.test.ts` pins its behaviour on source fixtures.
 *
 * The check needs no container and no network: the bundle is built locally,
 * the serving process runs with Bun's auto install disabled, and the
 * environment of that process is assembled from scratch.
 */

const repositoryRoot = resolve(import.meta.dir, '..')
const apiEntrypoint = join(repositoryRoot, 'apps/api/src/index.ts')
const migrationsDirectory = join(repositoryRoot, 'packages/db/drizzle')

const startupDeadlineMilliseconds = 30_000
const shutdownDeadlineMilliseconds = 15_000
const healthPollIntervalMilliseconds = 50
const servingTimeoutMilliseconds = 60_000

const syntheticBetterAuthSecret = 'postbot-bundle-guard-better-auth-secret-value'
const syntheticMediaPublicUrlSecret = 'postbot-bundle-guard-media-public-url-secret'
const syntheticPublisherEncryptionKey = 'a1b2c3d4'.repeat(8)

interface BundleWorkspace {
    readonly root: string
    readonly workingDirectory: string
    readonly bundlePath: string
    readonly assetsDirectory: string
    readonly mediaDirectory: string
    readonly databaseFile: string
    readonly bunInstallDirectory: string
    readonly bundleText: string
    readonly carriedSpecifiers: ReadonlySet<string>
    child: ReturnType<typeof Bun.spawn> | undefined
}

let workspace: BundleWorkspace | undefined

beforeAll(async () => {
    workspace = await createBundleWorkspace()
})

afterAll(async () => {
    if (workspace === undefined) return
    await disposeBundleWorkspace(workspace)
    workspace = undefined
})

describe('production bundle dependency guard', () => {
    it(
        'serves the production bundle from a directory where no module can resolve',
        async () => {
            const current = requireWorkspace()
            const { baseURL, child } = await startBundle(current)
            current.child = child

            try {
                const health = await fetch(`${baseURL}/health`)
                expect(health.status).toBe(200)
                expect(await health.json()).toEqual({ status: 'ok' })

                const ready = await fetch(`${baseURL}/ready`)
                expect(ready.status).toBe(200)

                // A body that does not satisfy the route schema must be
                // rejected by the request validation, not by a route that
                // failed to compile.
                const rejection = await fetch(`${baseURL}/api/projects`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({}),
                })
                expect(rejection.status).toBe(422)
                const body = (await rejection.json()) as { error?: { code?: string } }
                expect(body.error?.code).toBe('validation_error')
            } finally {
                await stopBundle(child)
                current.child = undefined
            }
        },
        servingTimeoutMilliseconds
    )

    it('carries no runtime require of an external package', () => {
        const current = requireWorkspace()
        const violations = collectExternalRequires(current.bundleText, current.carriedSpecifiers)

        if (violations.length > 0) {
            throw new Error(
                `The production bundle requires packages the image does not carry: ${violations
                    .map(violation => `${violation.specifier} (${violation.shape})`)
                    .join(', ')}`
            )
        }

        expect(violations).toEqual([])
    })
})

function requireWorkspace(): BundleWorkspace {
    if (workspace === undefined) throw new Error('The bundle workspace was not created')
    return workspace
}

/**
 * Builds the production bundle into a temporary directory that mirrors the
 * image: the bundle, the migrations and the dashboard assets, and no
 * `node_modules` anywhere on the path from the working directory upwards.
 */
async function createBundleWorkspace(): Promise<BundleWorkspace> {
    const root = mkdtempSync(join(tmpdir(), 'postbot-production-bundle-'))
    try {
        return await populateBundleWorkspace(root)
    } catch (error) {
        // Nothing is running yet, so the temporary directory is safe to remove.
        rmSync(root, { recursive: true, force: true })
        throw error
    }
}

async function populateBundleWorkspace(root: string): Promise<BundleWorkspace> {
    const workingDirectory = join(root, 'app')
    const analysisDirectory = join(root, 'analysis')
    const assetsDirectory = join(workingDirectory, 'public')
    const mediaDirectory = join(workingDirectory, 'media')
    const dataDirectory = join(workingDirectory, 'data')
    const bunInstallDirectory = join(root, 'bun-install')
    for (const directory of [
        workingDirectory,
        analysisDirectory,
        assetsDirectory,
        mediaDirectory,
        dataDirectory,
        bunInstallDirectory,
    ]) {
        mkdirSync(directory, { recursive: true })
    }
    writeFileSync(
        join(assetsDirectory, 'index.html'),
        '<!doctype html><html><head><title>Postbot</title></head><body><div id="root"></div></body></html>'
    )

    const build = await Bun.build({
        entrypoints: [apiEntrypoint],
        outdir: workingDirectory,
        target: 'bun',
        minify: true,
    })
    if (!build.success) {
        throw new AggregateError(build.logs, 'Could not build the production bundle')
    }
    if (build.outputs.length !== 1) {
        throw new Error(
            `The production bundle produced ${build.outputs.length} outputs, expected exactly one`
        )
    }
    const bundlePath = build.outputs[0]!.path

    // The same build with a metafile, so the analysis knows which modules the
    // bundle carries. The metafile is observation only, and the two bundles
    // are compared byte for byte before the analysis trusts it.
    const analysis = await Bun.build({
        entrypoints: [apiEntrypoint],
        outdir: analysisDirectory,
        target: 'bun',
        minify: true,
        metafile: true,
    })
    if (!analysis.success) {
        throw new AggregateError(analysis.logs, 'Could not analyse the production bundle')
    }
    const bundleText = await Bun.file(bundlePath).text()
    const analysisText = await Bun.file(analysis.outputs[0]!.path).text()
    if (analysisText !== bundleText) {
        throw new Error('The analyzed production bundle differs from the served bundle')
    }
    const carriedSpecifiers = new Set<string>()
    for (const input of Object.values(analysis.metafile?.inputs ?? {})) {
        for (const entry of input.imports) {
            carriedSpecifiers.add(entry.original ?? entry.path)
        }
    }

    await assertNoModuleResolves(workingDirectory, bunInstallDirectory, carriedSpecifiers)

    return {
        root,
        workingDirectory,
        bundlePath,
        assetsDirectory,
        mediaDirectory,
        databaseFile: join(dataDirectory, 'postbot.sqlite'),
        bunInstallDirectory,
        bundleText,
        carriedSpecifiers,
        child: undefined,
    }
}

/**
 * Proves the working directory cannot resolve a module, instead of assuming
 * it. The image has no `node_modules` and no Bun cache, so the probe runs
 * with the auto install disabled and with an empty Bun install directory:
 * a package that still resolves means the environment is not faithful and
 * the check would pass by luck.
 */
async function assertNoModuleResolves(
    workingDirectory: string,
    bunInstallDirectory: string,
    carriedSpecifiers: ReadonlySet<string>
): Promise<void> {
    for (const directory of ancestorDirectories(workingDirectory)) {
        if (existsSync(join(directory, 'node_modules'))) {
            throw new Error(
                `The bundle working directory ${workingDirectory} is not module free: ${join(directory, 'node_modules')} exists`
            )
        }
    }

    const specifiers = [...carriedSpecifiers]
        .filter(specifier => isPackageSpecifier(specifier))
        .toSorted()
    if (specifiers.length === 0) {
        throw new Error('The production bundle carries no package, the analysis is not meaningful')
    }

    const probePath = join(workingDirectory, 'module-resolution-probe.cjs')
    writeFileSync(
        probePath,
        [
            `const specifiers = ${JSON.stringify(specifiers)}`,
            'const resolved = []',
            'for (const specifier of specifiers) {',
            '    try {',
            '        require.resolve(specifier)',
            '        resolved.push(specifier)',
            '    } catch {}',
            '}',
            'console.log(JSON.stringify(resolved))',
            '',
        ].join('\n')
    )
    const probe = Bun.spawnSync([process.execPath, '--no-install', probePath], {
        cwd: workingDirectory,
        env: {
            PATH: process.env.PATH ?? '',
            TMPDIR: process.env.TMPDIR ?? tmpdir(),
            BUN_INSTALL: bunInstallDirectory,
        },
    })
    if (probe.exitCode !== 0) {
        throw new Error(
            `The module resolution probe failed: ${probe.stderr.toString().trim() || 'no output'}`
        )
    }
    const resolved = JSON.parse(probe.stdout.toString().trim()) as string[]
    if (resolved.length > 0) {
        throw new Error(
            `The bundle working directory ${workingDirectory} can still resolve ${resolved.join(', ')}; the image carries no node_modules`
        )
    }
}

function ancestorDirectories(directory: string): string[] {
    const directories: string[] = []
    let current = resolve(directory)
    while (true) {
        directories.push(current)
        const parent = dirname(current)
        if (parent === current) return directories
        current = parent
    }
}

/**
 * Runs the bundle the way the image runs it: the production environment, an
 * isolated database, media root and dashboard assets, a port the operating
 * system allocated, and synthetic secrets only.
 */
async function startBundle(current: BundleWorkspace): Promise<{
    baseURL: string
    child: ReturnType<typeof Bun.spawn>
}> {
    const port = await findAvailablePort()
    const baseURL = `http://127.0.0.1:${port}`
    const child = Bun.spawn([process.execPath, '--no-install', current.bundlePath], {
        cwd: current.workingDirectory,
        env: {
            PATH: process.env.PATH ?? '',
            TMPDIR: process.env.TMPDIR ?? tmpdir(),
            BUN_INSTALL: current.bunInstallDirectory,
            NODE_ENV: 'production',
            PORT: String(port),
            DB_FILE_NAME: current.databaseFile,
            POSTBOT_MEDIA_DIRECTORY: current.mediaDirectory,
            POSTBOT_MIGRATIONS_DIR: migrationsDirectory,
            POSTBOT_WEB_ASSETS_DIR: current.assetsDirectory,
            BETTER_AUTH_URL: baseURL,
            POSTBOT_WEB_ORIGIN: baseURL,
            BETTER_AUTH_SECRET: syntheticBetterAuthSecret,
            POSTBOT_MEDIA_PUBLIC_URL_SECRET: syntheticMediaPublicUrlSecret,
            POSTBOT_PUBLISHER_ENCRYPTION_KEY: syntheticPublisherEncryptionKey,
        },
        stdout: 'pipe',
        stderr: 'pipe',
    })
    // The bundle logs through pino, which writes to stdout, and the runtime
    // reports a route that cannot compile on stderr. Both are read, so a
    // failure names the reason instead of only the status.
    const stdout = new Response(child.stdout).text()
    const stderr = new Response(child.stderr).text()

    const deadline = Date.now() + startupDeadlineMilliseconds
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(
                `The production bundle exited with code ${child.exitCode}: ${(await readOutput(stdout, stderr)).trim()}`
            )
        }
        let response: Response | undefined
        try {
            response = await fetch(`${baseURL}/health`)
        } catch {
            // The server is still starting.
        }
        if (response !== undefined) {
            if (response.ok) return { baseURL, child }
            // The server answered, so it is not starting any more. A route that
            // cannot compile answers 500, and that is the defect this check
            // exists for.
            const body = (await response.text()).slice(0, 500)
            child.kill('SIGKILL')
            await child.exited
            throw new Error(
                `The production bundle answered GET /health with ${response.status}: ${body}\n${(await readOutput(stdout, stderr)).trim()}`
            )
        }
        await Bun.sleep(healthPollIntervalMilliseconds)
    }

    child.kill('SIGKILL')
    await child.exited
    throw new Error(
        `The production bundle did not answer /health within ${startupDeadlineMilliseconds} ms: ${(await readOutput(stdout, stderr)).trim()}`
    )
}

/**
 * Reads the output of the bundle process. The process is already gone when
 * this is called, so both streams have ended.
 */
async function readOutput(stdout: Promise<string>, stderr: Promise<string>): Promise<string> {
    const [out, error] = await Promise.all([stdout, stderr])
    return `${out.trim()}\n${error.trim()}`.trim()
}

async function findAvailablePort(): Promise<number> {
    const reservation = Bun.serve({
        port: 0,
        fetch: () => new Response(null, { status: 503 }),
    })
    const port = reservation.port
    await reservation.stop(true)
    if (port === undefined) throw new Error('The operating system did not allocate a port')

    return port
}

/**
 * Stops the bundle and confirms the process is gone. The temporary
 * directories are only removed once the child is confirmed gone.
 */
async function stopBundle(child: ReturnType<typeof Bun.spawn>): Promise<void> {
    if (child.exitCode === null) {
        child.kill('SIGTERM')
        const terminated = await Promise.race([
            child.exited.then(() => true),
            Bun.sleep(shutdownDeadlineMilliseconds).then(() => false),
        ])
        if (!terminated) {
            child.kill('SIGKILL')
            await Promise.race([
                child.exited,
                Bun.sleep(shutdownDeadlineMilliseconds).then(() => undefined),
            ])
        }
    }
    await child.exited
}

function isProcessAlive(processId: number): boolean {
    try {
        process.kill(processId, 0)
        return true
    } catch {
        return false
    }
}

async function disposeBundleWorkspace(current: BundleWorkspace): Promise<void> {
    const child = current.child
    current.child = undefined
    if (child !== undefined) {
        await stopBundle(child)
        if (isProcessAlive(child.pid)) {
            throw new Error(
                `The production bundle process ${child.pid} is still running; the temporary directory ${current.root} was kept`
            )
        }
    }
    rmSync(current.root, { recursive: true, force: true })
}
