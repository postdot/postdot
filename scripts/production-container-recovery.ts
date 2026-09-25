import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dir, '..')
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const imageTag = `herald-recovery:${runId}`
const containerName = `herald-recovery-${runId}`
const testRoot = await mkdtemp(join(tmpdir(), 'herald-production-recovery-'))
const sourceData = join(testRoot, 'source-data')
const restoredData = join(testRoot, 'restored-data')
const backupDirectory = join(testRoot, 'backups')
const authSecret = 'production-image-recovery-test-auth-secret'
const mediaUrlSecret = 'production-image-recovery-test-media-secret'
const publisherEncryptionKey = '0123456789abcdef'.repeat(4)
let imageBuilt = false
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
    } catch (error) {
        const containerState = runDocker(['inspect', '--format', '{{json .State}}', containerName])
        const logs = runDocker(['logs', '--tail', '100', containerName])
        throw new Error(
            `The ${stage} production container did not become ready: ${String(error)}\n` +
                `Container state: ${containerState}\nContainer logs:\n${logs}`
        )
    }
    runDocker(['stop', '--time', '60', containerName])
    runDocker(['rm', containerName])
    containerStarted = false
}

try {
    await prepareContainerWritableDirectory(sourceData)
    await prepareContainerWritableDirectory(backupDirectory)
    runDocker(['build', '--tag', imageTag, '.'])
    imageBuilt = true

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
    console.log(
        'Production image started, created a media backup without server secrets, restored it, and became ready.'
    )
} finally {
    if (containerStarted) {
        try {
            runDocker(['stop', '--time', '60', containerName])
        } catch {
            runDocker(['rm', '--force', containerName])
        }
        try {
            runDocker(['rm', containerName])
        } catch {
            // The container may already have been removed during cleanup.
        }
    }

    if (imageBuilt) {
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

        try {
            runDocker(['image', 'rm', imageTag])
        } catch {
            // The uniquely tagged image is disposable and may already be absent.
        }
    }

    await rm(testRoot, { recursive: true, force: true })
}
