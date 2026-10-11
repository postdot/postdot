// cspell:words nostdin image2pipe
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { verifyProductionDashboard } from './production-web-assets'

const repositoryRoot = resolve(import.meta.dir, '..')
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const suppliedImage = process.env.HERALD_CONTAINER_TEST_IMAGE
const imageTag = suppliedImage ?? `herald-recovery:${runId}`
const containerName = `herald-recovery-${runId}`
const testRoot = await mkdtemp(join(tmpdir(), 'herald-production-recovery-'))
const sourceData = join(testRoot, 'source-data')
const restoredData = join(testRoot, 'restored-data')
const backupDirectory = join(testRoot, 'backups')
const authSecret = 'production-image-recovery-test-auth-secret'
const mediaUrlSecret = 'production-image-recovery-test-media-secret'
const publisherEncryptionKey = '0123456789abcdef'.repeat(4)
let imageBuilt = false
let imageAvailable = false
let containerStarted = false

async function prepareContainerWritableDirectory(path: string): Promise<void> {
    await mkdir(path, { recursive: true })
    // The private temporary parent limits access while the image's `bun` user
    // can write even when its UID differs from the host runner's UID.
    await chmod(path, 0o777)
}

function runDocker(args: readonly string[]): string {
    const result = spawnSync('docker', args, {
        cwd: repositoryRoot,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    })

    if (result.error !== undefined) throw result.error
    if (result.status !== 0) {
        throw new Error(`Docker ${args[0]} failed: ${result.stderr.trim() || result.stdout.trim()}`)
    }

    return result.stdout.trim()
}

async function waitForReadiness(port: number): Promise<void> {
    let lastFailure = 'The production container did not become ready'

    for (let attempt = 0; attempt < 120; attempt += 1) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/ready`, {
                signal: AbortSignal.timeout(1_000),
            })
            if (response.ok) return
            lastFailure = `Readiness returned HTTP ${response.status}`
        } catch (error) {
            lastFailure = error instanceof Error ? error.message : String(error)
        }

        await new Promise(resolve => setTimeout(resolve, 500))
    }

    throw new Error(lastFailure)
}

async function startServer(dataDirectory: string, stage: 'source' | 'restored'): Promise<void> {
    await mkdir(dataDirectory, { recursive: true })
    runDocker([
        'run',
        '--detach',
        '--name',
        containerName,
        '--publish',
        '127.0.0.1::3000',
        ...serverEnvironment(dataDirectory),
        imageTag,
    ])
    containerStarted = true

    const mappedAddress = runDocker(['port', containerName, '3000/tcp']).split('\n')[0]
    const port = Number(mappedAddress?.slice(mappedAddress.lastIndexOf(':') + 1))
    if (!Number.isInteger(port) || port < 1) {
        throw new Error(`Docker returned an invalid published port: ${mappedAddress}`)
    }

    try {
        await waitForReadiness(port)
        const executable = runDocker([
            'exec',
            containerName,
            'bun',
            '-e',
            "console.log(await import('node:fs/promises').then(fs => fs.readlink('/proc/1/exe')))",
        ])
        if (!executable.endsWith('/bun')) {
            throw new Error(`The production server is not running Bun: ${executable}`)
        }
        if (stage === 'source') {
            const session = await fetch(`http://127.0.0.1:${port}/api/auth/get-session`)
            if (!session.ok || (await session.json()) !== null)
                throw new Error('Production session route did not return an anonymous session')
        }
        const recoveryStatus = await fetch(`http://127.0.0.1:${port}/api/recovery/status`)
        const recoveryBody = (await recoveryStatus.json()) as { held: boolean }
        if (recoveryBody.held !== (stage === 'restored'))
            throw new Error('Unexpected production recovery hold')
        if (stage === 'restored') {
            const blocked = await fetch(`http://127.0.0.1:${port}/api/projects`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
            })
            if (blocked.status !== 503)
                throw new Error('Restored production container accepted writes')
        }
        const dashboard = await verifyProductionDashboard(`http://127.0.0.1:${port}`)
        console.log(
            `The ${stage} production container served the dashboard shell and ${dashboard.assetCount} built assets.`
        )
    } catch (error) {
        const containerState = runDocker(['inspect', '--format', '{{json .State}}', containerName])
        const logs = runDocker(['logs', '--tail', '100', containerName])
        throw new Error(
            `The ${stage} production container failed its HTTP acceptance checks: ${String(error)}\n` +
                `Container state: ${containerState}\nContainer logs:\n${logs}`
        )
    }
    const stopStartedAt = Date.now()
    runDocker(['stop', '--timeout', '30', containerName])
    const stopDurationMs = Date.now() - stopStartedAt
    const stopState = inspectContainerState(containerName)
    if (stopState.exitCode !== 0) {
        const logs = runDocker(['logs', '--tail', '100', containerName])
        throw new Error(
            `The ${stage} production container did not stop gracefully: exit code ${stopState.exitCode} after ${stopDurationMs}ms. ` +
                (stopState.exitCode === 137
                    ? 'Exit code 137 means Docker SIGKILLed the container after the stop grace period instead of observing an orderly shutdown; diagnose signal handling, drain, process exit, and lock release. '
                    : '') +
                `Container logs:\n${logs}`
        )
    }
    const retainedLock = join(dataDirectory, 'herald.sqlite.runtime.lock')
    if (await Bun.file(retainedLock).exists()) {
        throw new Error(
            `The ${stage} production container exited 0 but retained its runtime lock at ${retainedLock}; graceful shutdown must release the lock.`
        )
    }
    console.log(
        `The ${stage} production container stopped gracefully (exit 0 in ${(stopDurationMs / 1_000).toFixed(1)}s) and released its runtime lock.`
    )
    runDocker(['rm', containerName])
    containerStarted = false
}

function serverEnvironment(dataDirectory: string): string[] {
    return [
        '--mount',
        `type=bind,source=${dataDirectory},target=/data`,
        '--env',
        'NODE_ENV=production',
        '--env',
        'BETTER_AUTH_URL=http://localhost:3000',
        '--env',
        'HERALD_WEB_ORIGIN=http://localhost:3000',
        '--env',
        `BETTER_AUTH_SECRET=${authSecret}`,
        '--env',
        `HERALD_MEDIA_PUBLIC_URL_SECRET=${mediaUrlSecret}`,
        '--env',
        `HERALD_PUBLISHER_ENCRYPTION_KEY=${publisherEncryptionKey}`,
    ]
}

function inspectContainerState(container: string): { status: string; exitCode: number } {
    const raw = runDocker(['inspect', '--format', '{{json .State}}', container])
    const state = JSON.parse(raw) as { Status?: unknown; ExitCode?: unknown }
    if (typeof state.Status !== 'string' || typeof state.ExitCode !== 'number') {
        throw new Error(`Docker returned an unreadable container state: ${raw}`)
    }
    return { status: state.Status, exitCode: state.ExitCode }
}

async function verifyForcedStopRetainsLock(dataDirectory: string): Promise<void> {
    // SIGKILL cannot run the graceful drain, so forced termination must stay
    // visible (exit 137), retain the runtime lock, and block a fresh server
    // until an operator verifies the stale marker. The disposable probe data
    // is removed with the test root; no retained lock is ever deleted here.
    runDocker([
        'run',
        '--detach',
        '--name',
        containerName,
        '--publish',
        '127.0.0.1::3000',
        ...serverEnvironment(dataDirectory),
        imageTag,
    ])
    containerStarted = true

    const mappedAddress = runDocker(['port', containerName, '3000/tcp']).split('\n')[0]
    const port = Number(mappedAddress?.slice(mappedAddress.lastIndexOf(':') + 1))
    if (!Number.isInteger(port) || port < 1) {
        throw new Error(`Docker returned an invalid published port: ${mappedAddress}`)
    }
    await waitForReadiness(port)
    runDocker(['kill', containerName])
    const killed = inspectContainerState(containerName)
    if (killed.exitCode !== 137) {
        throw new Error(
            `docker kill must report SIGKILL as exit code 137; observed ${killed.exitCode}`
        )
    }
    const retainedLock = join(dataDirectory, 'herald.sqlite.runtime.lock')
    if (!(await Bun.file(retainedLock).exists())) {
        throw new Error(
            'A SIGKILLed production container must retain its runtime lock; graceful shutdown is the only path that releases it.'
        )
    }
    // Bounded refused-restart probe: a regression that lets the server start
    // must fail the gate instead of hanging it on a foreground container, and
    // the identifiable probe container is always removed, even when the
    // regression keeps it running.
    const probeName = `${containerName}-refused-restart`
    runDocker([
        'run',
        '--detach',
        '--name',
        probeName,
        '--publish',
        '127.0.0.1::3000',
        ...serverEnvironment(dataDirectory),
        imageTag,
    ])
    try {
        const deadline = Date.now() + 20_000
        let probe = inspectContainerState(probeName)
        while (
            (probe.status === 'created' || probe.status === 'running') &&
            Date.now() < deadline
        ) {
            await new Promise(resolve => setTimeout(resolve, 500))
            probe = inspectContainerState(probeName)
        }
        if (probe.status === 'created' || probe.status === 'running') {
            throw new Error(
                'The refused-restart probe is still running after 20s; a fresh server must exit promptly against the retained lock instead of hanging the gate.'
            )
        }
        if (probe.exitCode === 0) {
            throw new Error(
                'A fresh server started successfully against the retained lock; runtime exclusion regressed.'
            )
        }
        const probeLogs = runDockerLogs(probeName)
        if (!probeLogs.includes('already held')) {
            throw new Error(`A refused restart must cite the held lock; probe logs:\n${probeLogs}`)
        }
        console.log(
            'Forced termination stays visible (exit 137), retains the runtime lock, and blocks a fresh server until an operator verifies the stale marker.'
        )
    } finally {
        runDocker(['rm', '--force', probeName])
    }
    runDocker(['rm', containerName])
    containerStarted = false
}

function runDockerLogs(container: string): string {
    // `docker logs` carries the refusal reason on the container stderr stream,
    // which runDocker does not return, so read both streams here.
    const result = spawnSync('docker', ['logs', container], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) {
        throw new Error(`Docker logs failed: ${result.stderr.trim() || result.stdout.trim()}`)
    }
    return `${result.stdout}${result.stderr}`.trim()
}

try {
    await prepareContainerWritableDirectory(sourceData)
    await prepareContainerWritableDirectory(backupDirectory)
    if (suppliedImage === undefined) {
        runDocker(['build', '--tag', imageTag, '.'])
        imageBuilt = true
    } else {
        runDocker(['image', 'inspect', imageTag])
    }
    imageAvailable = true
    runDocker([
        'run',
        '--rm',
        '--mount',
        `type=bind,source=${join(repositoryRoot, 'packages/db/src/fixtures/video-h264.mp4')},target=/fixture.mp4,readonly`,
        '--entrypoint',
        'bun',
        imageTag,
        '-e',
        `const child = Bun.spawn(['/usr/local/bin/herald-poster', '-v', 'error', '-nostdin', '-i', '/fixture.mp4', '-frames:v', '1', '-f', 'image2pipe', 'pipe:1'], { stdout: 'pipe', stderr: 'inherit' });
        const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
        try {
            const source = await new Response(child.stdout).blob();
            if (await child.exited !== 0) throw new Error('Poster decoder failed');
            const placeholder = await new Bun.Image(source).placeholder();
            const preview = await new Bun.Image(source).resize(256, 256, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).blob();
            const metadata = await new Bun.Image(preview).metadata();
            if (!placeholder || preview.size === 0 || metadata.width > 256 || metadata.height > 256) throw new Error('Native image preview failed');
        } finally { clearTimeout(timer); }`,
    ])
    console.log('Packaged H.264 decoder and native image preview generation passed.')

    await startServer(sourceData, 'source')

    await prepareContainerWritableDirectory(restoredData)
    runDocker([
        'run',
        '--rm',
        '--mount',
        `type=bind,source=${sourceData},target=/data`,
        '--mount',
        `type=bind,source=${backupDirectory},target=/backups`,
        imageTag,
        'backup',
        '--media',
        '--output',
        '/backups/herald.bundle',
    ])

    runDocker([
        'run',
        '--rm',
        '--mount',
        `type=bind,source=${restoredData},target=/data`,
        '--mount',
        `type=bind,source=${backupDirectory},target=/backups`,
        imageTag,
        'restore',
        '--media',
        '--input',
        '/backups/herald.bundle',
    ])

    await startServer(restoredData, 'restored')
    await verifyForcedStopRetainsLock(restoredData)
    console.log(
        'Production image started, created a media backup without server secrets, restored it, became ready, stopped gracefully with exit 0 and a released lock, and kept forced termination visible and fail-closed.'
    )
} finally {
    if (containerStarted) {
        try {
            runDocker(['stop', '--timeout', '30', containerName])
        } catch {
            runDocker(['rm', '--force', containerName])
        }
        try {
            runDocker(['rm', containerName])
        } catch {
            // The container may already have been removed during cleanup.
        }
    }

    if (imageAvailable) {
        try {
            runDocker([
                'run',
                '--rm',
                '--user',
                'root',
                '--entrypoint',
                '/usr/bin/rm',
                '--mount',
                `type=bind,source=${testRoot},target=/test-root`,
                imageTag,
                '-rf',
                '/test-root/source-data',
                '/test-root/restored-data',
                '/test-root/backups',
            ])
        } catch {
            // The host cleanup below still removes these paths when ownership permits it.
        }
    }

    if (imageBuilt) {
        try {
            runDocker(['image', 'rm', imageTag])
        } catch {
            // The uniquely tagged image is disposable and may already be absent.
        }
    }

    await rm(testRoot, { recursive: true, force: true })
}
