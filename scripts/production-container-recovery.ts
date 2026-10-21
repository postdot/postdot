// cspell:words nostdin image2pipe
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { verifyProductionDashboard } from './production-web-assets'

const repositoryRoot = resolve(import.meta.dir, '..')
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const suppliedImage = process.env.POSTBOT_CONTAINER_TEST_IMAGE
const imageTag = suppliedImage ?? `postbot-recovery:${runId}`
let executionImage = imageTag
let imageArchitecture: string | undefined
let acceptanceProjectId: string | undefined
const containerName = `postbot-recovery-${runId}`

/**
 * The scenarios this script can run.
 *
 * `full` is the default acceptance scenario of the production image. The
 * `startup-termination` scenario runs the container-level startup
 * termination check alone, so it can be executed against a lightweight image
 * that carries neither the packaged poster decoder nor the dashboard assets.
 */
const fullScenario = 'full'
const startupTerminationScenario = 'startup-termination'
const selectedScenario = process.env.POSTBOT_CONTAINER_TEST_SCENARIO ?? fullScenario
if (selectedScenario !== fullScenario && selectedScenario !== startupTerminationScenario) {
    throw new Error(
        `Unsupported POSTBOT_CONTAINER_TEST_SCENARIO "${selectedScenario}"; use "${fullScenario}" or "${startupTerminationScenario}".`
    )
}

/** The bounded deadline for the runtime marker to appear after the start. */
const startupMarkerDeadlineMs = 60_000
/** The bounded grace period Docker grants the container to stop on its own. */
const startupStopGracePeriodSeconds = 10
/** The bounded number of attempts to land the termination inside the startup window. */
const startupWindowAttempts = 3
/** The bounded interval between the observations of the runtime marker. */
const startupMarkerPollIntervalMs = 10
/** The bounded deadline for the in-container probe of the API. */
const startupProbeTimeoutMs = 2_000
/** The bounded deadline for the probe request inside the container. */
const startupProbeRequestTimeoutMs = 500

const testRoot = await mkdtemp(join(tmpdir(), 'postbot-production-recovery-'))
const sourceData = join(testRoot, 'source-data')
const restoredData = join(testRoot, 'restored-data')
const backupDirectory = join(testRoot, 'backups')
const startupData = join(testRoot, 'startup-data')
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
        executionImage,
    ])
    containerStarted = true

    const mappedAddress = runDocker(['port', containerName, '3000/tcp']).split('\n')[0]
    const port = Number(mappedAddress?.slice(mappedAddress.lastIndexOf(':') + 1))
    if (!Number.isInteger(port) || port < 1) {
        throw new Error(`Docker returned an invalid published port: ${mappedAddress}`)
    }

    try {
        await waitForReadiness(port)
        const runtime = JSON.parse(
            runDocker([
                'exec',
                containerName,
                'bun',
                '-e',
                "const fs = await import('node:fs/promises'); console.log(JSON.stringify({executable:await fs.readlink('/proc/1/exe'),command:(await fs.readFile('/proc/1/cmdline','utf8')).split(String.fromCharCode(0)).filter(Boolean),architecture:process.arch,bun:Bun.version}))",
            ])
        ) as { executable: string; command: string[]; architecture: string; bun: string }
        const runtimeArchitecture = runtime.architecture === 'x64' ? 'amd64' : runtime.architecture
        const emulated =
            runtime.executable.endsWith('/qemu-aarch64') &&
            imageArchitecture === 'arm64' &&
            runtime.architecture === 'arm64' &&
            runtime.command[0] === runtime.executable &&
            runtime.command[1] === '/usr/local/bin/bun'
        const command = emulated ? runtime.command.slice(2) : runtime.command
        if (
            (!runtime.executable.endsWith('/bun') && !emulated) ||
            runtimeArchitecture !== imageArchitecture ||
            command.length !== 2 ||
            !['bun', '/usr/local/bin/bun'].includes(command[0]!) ||
            command[1] !== '/app/postbot.js'
        )
            throw new Error('The production entrypoint is not the expected Bun application')
        console.log(
            `The ${stage} production container runs Bun ${runtime.bun} on ${runtime.architecture}${emulated ? ' under QEMU emulation' : ''}.`
        )
        if (stage === 'source') await verifyAuthenticatedProject(port)
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
    const retainedLock = join(dataDirectory, 'postbot.sqlite.runtime.lock')
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

async function verifyAuthenticatedProject(port: number): Promise<void> {
    const origin = `http://127.0.0.1:${port}`
    const anonymous = await fetch(`${origin}/api/auth/get-session`)
    if (!anonymous.ok || (await anonymous.json()) !== null)
        throw new Error('Production session route did not return an anonymous session')
    const denied = await fetch(`${origin}/api/projects`)
    if (denied.status !== 401)
        throw new Error('Production project reads did not require authentication')
    const signup = await fetch(`${origin}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({
            name: 'Container acceptance operator',
            email: `container-${runId}@postbot.local`,
            password: 'production-container-test-password',
        }),
    })
    if (!signup.ok) throw new Error(`Production account setup failed: HTTP ${signup.status}`)
    const cookie = signup.headers
        .getSetCookie()
        .map(value => value.split(';', 1)[0])
        .join('; ')
    if (!cookie) throw new Error('Production account setup returned no session cookie')
    const session = await fetch(`${origin}/api/auth/get-session`, { headers: { cookie } })
    const sessionBody = (await session.json()) as { user?: { id?: string } } | null
    if (!session.ok || !sessionBody?.user?.id)
        throw new Error('Production authenticated session is unavailable')
    const created = await fetch(`${origin}/api/projects`, {
        method: 'POST',
        headers: { cookie, origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Container recovery acceptance', timeZone: 'UTC' }),
    })
    const body = (await created.json()) as { project?: { id?: string } }
    if (created.status !== 201 || !body.project?.id)
        throw new Error('Production authenticated project creation failed')
    acceptanceProjectId = body.project.id
    const list = await fetch(`${origin}/api/projects`, { headers: { cookie } })
    const projects = (await list.json()) as { projects?: { id: string }[] }
    if (!list.ok || !projects.projects?.some(project => project.id === acceptanceProjectId))
        throw new Error('Production authenticated project read failed')
    console.log('Production authentication and authenticated project create/read passed.')
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
        'POSTBOT_WEB_ORIGIN=http://localhost:3000',
        '--env',
        `BETTER_AUTH_SECRET=${authSecret}`,
        '--env',
        `POSTBOT_MEDIA_PUBLIC_URL_SECRET=${mediaUrlSecret}`,
        '--env',
        `POSTBOT_PUBLISHER_ENCRYPTION_KEY=${publisherEncryptionKey}`,
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
        executionImage,
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
    const retainedLock = join(dataDirectory, 'postbot.sqlite.runtime.lock')
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
        executionImage,
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

/**
 * The verdict of the in-container probe of the API.
 *
 * `not-serving` means the container refused the probe connection, so the API
 * had not reached its listen call and the startup window was still open.
 * `serving` means the container answered the probe, so the startup window was
 * already over. `inconclusive` means the probe could not be run or its
 * outcome could not be read, so the attempt proves nothing.
 */
type StartupProbeVerdict = 'not-serving' | 'serving' | 'inconclusive'

interface StartupProbe {
    readonly verdict: StartupProbeVerdict
    readonly detail: string
}

interface StartupAttempt {
    /** True when the termination landed inside the startup window. */
    readonly caught: boolean
    /** What the in-container probe saw. */
    readonly probe: StartupProbe
    /** The state of the container the attempt used. */
    readonly state: string
    /** The logs of the container the attempt used. */
    readonly logs: string
}

/**
 * The probe runs inside the container, where the API listens on the loopback
 * interface even without a published port. The result is a single line of
 * JSON: an answered request proves that the API is serving, a refused
 * connection proves that it is not, and any other failure is reported so the
 * attempt can be discarded instead of guessed.
 */
const startupProbeScript = [
    `const probe = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(${startupProbeRequestTimeoutMs}) })`,
    '    .then(response => ({ answered: true, status: response.status }))',
    '    .catch(error => ({ answered: false, name: error?.name ?? null, code: error?.code ?? error?.cause?.code ?? null, message: String(error?.message ?? error).slice(0, 160) }))',
    'console.log(JSON.stringify(probe))',
].join('\n')

/**
 * Probes the API from inside the container and reports whether it already
 * serves.
 *
 * Any answer counts as serving, including an error status: a container that
 * answers the probe has passed its listen call, so the startup window is
 * over. A refused connection is the only proof that the API is still
 * starting.
 */
function probeStartupApi(container: string): StartupProbe {
    const result = spawnSync('docker', ['exec', container, 'bun', '-e', startupProbeScript], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        // The exec is bounded, so a wedged container cannot hang the check.
        timeout: startupProbeTimeoutMs,
        killSignal: 'SIGKILL',
    })

    if (result.error !== undefined) {
        return {
            verdict: 'inconclusive',
            detail: `the probe did not complete: ${result.error.message}`,
        }
    }
    if (result.status !== 0) {
        const stderr = (result.stderr ?? '').trim()
        return {
            verdict: 'inconclusive',
            detail: `the probe exited ${String(result.status)}${stderr === '' ? '' : `: ${stderr}`}`,
        }
    }

    const output = (result.stdout ?? '').trim()
    const line = output
        .split('\n')
        .map(entry => entry.trim())
        .filter(entry => entry.startsWith('{'))
        .pop()
    if (line === undefined) {
        return { verdict: 'inconclusive', detail: `the probe printed no result: ${output}` }
    }

    let parsed: unknown
    try {
        parsed = JSON.parse(line)
    } catch {
        return {
            verdict: 'inconclusive',
            detail: `the probe printed an unreadable result: ${line}`,
        }
    }
    const probe = parsed as {
        answered?: unknown
        status?: unknown
        name?: unknown
        code?: unknown
        message?: unknown
    }

    if (probe.answered === true) {
        return {
            verdict: 'serving',
            detail: `the API answered the probe with HTTP ${String(probe.status ?? 'an unknown status')}`,
        }
    }

    const code = typeof probe.code === 'string' ? probe.code.toUpperCase() : ''
    const message = typeof probe.message === 'string' ? probe.message : ''
    if (code.includes('REFUSED') || message.toLowerCase().includes('unable to connect')) {
        return {
            verdict: 'not-serving',
            detail: 'the container refused the probe connection, so the API was not serving yet',
        }
    }
    if (probe.name === 'TimeoutError' || message.toLowerCase().includes('timed out')) {
        return {
            verdict: 'serving',
            detail: 'the container accepted the probe connection without an answer, so the API was already serving',
        }
    }
    return {
        verdict: 'inconclusive',
        detail: `the probe failed with ${String(probe.name ?? 'an unknown error')}: ${message}`,
    }
}

/**
 * The moment the runtime marker appeared, taken from the marker file itself.
 * The observation on the host can only be later, so the file timestamp is
 * the accurate reference for the startup window.
 */
async function runtimeMarkerAppearance(marker: string): Promise<number | undefined> {
    try {
        const stat = await Bun.file(marker).stat()
        return Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : undefined
    } catch {
        return undefined
    }
}

/** The moment the container exited, taken from the container state. */
function containerExitTime(container: string): number | undefined {
    try {
        const raw = runDocker(['inspect', '--format', '{{.State.FinishedAt}}', container])
        const parsed = Date.parse(raw)
        return Number.isFinite(parsed) ? parsed : undefined
    } catch {
        return undefined
    }
}

/**
 * The time between the appearance of the runtime marker and the exit of the
 * container. It bounds the part of the startup window the termination could
 * have used, because the marker is the first statement of the startup and
 * the exit is the end of the container.
 */
function startupWindowMarginMs(
    markerAppearedAt: number,
    container: string,
    exitObservedAt: number
): number {
    const exitAt = containerExitTime(container) ?? exitObservedAt
    const margin = exitAt - markerAppearedAt
    // A marker timestamp and a container timestamp that disagree by more than
    // the startup deadline cannot describe one startup, so the observation on
    // the host is used instead.
    if (!Number.isFinite(margin) || margin < 0 || margin > startupMarkerDeadlineMs) {
        return exitObservedAt - markerAppearedAt
    }
    return margin
}

/**
 * Runs one attempt of the startup termination check.
 *
 * The attempt observes the runtime marker, probes the API from inside the
 * container and only stops the container when the probe proves that the API
 * is not serving yet. A container whose API already serves is discarded, so
 * the caller can start a fresh one instead of exercising the serving path.
 */
async function runStartupTerminationAttempt(
    dataDirectory: string,
    attempt: number
): Promise<StartupAttempt> {
    const container = `${containerName}-startup-${attempt}`
    const marker = join(dataDirectory, 'postbot.sqlite.runtime.lock')
    await prepareContainerWritableDirectory(dataDirectory)

    runDocker([
        'run',
        '--detach',
        '--name',
        container,
        '--network',
        'none',
        ...serverEnvironment(dataDirectory),
        executionImage,
    ])

    try {
        const markerDeadline = Date.now() + startupMarkerDeadlineMs
        while (!(await Bun.file(marker).exists()) && Date.now() < markerDeadline) {
            await new Promise(resolve => setTimeout(resolve, startupMarkerPollIntervalMs))
        }
        if (!(await Bun.file(marker).exists())) {
            const state = inspectContainerState(container)
            const logs = runDockerLogs(container)
            throw new Error(
                `The production container did not create its runtime marker within ${startupMarkerDeadlineMs}ms, so the startup window was never entered. Container state: ${state.status} (exit ${state.exitCode}). Container logs:\n${logs}`
            )
        }
        const markerObservedAt = Date.now()
        const markerAppearedAt = (await runtimeMarkerAppearance(marker)) ?? markerObservedAt

        const probe = probeStartupApi(container)
        const probeFinishedAt = Date.now()
        if (probe.verdict !== 'not-serving') {
            // The startup window was missed. The container is discarded with
            // its own disposable data directory, and a fresh container is
            // started for the next attempt.
            const state = inspectContainerState(container)
            const logs = runDockerLogs(container)
            return {
                caught: false,
                probe,
                state: `${state.status} (exit ${state.exitCode})`,
                logs,
            }
        }

        const stopStartedAt = Date.now()
        runDocker(['stop', '--timeout', String(startupStopGracePeriodSeconds), container])
        const stopDurationMs = Date.now() - stopStartedAt
        const exitObservedAt = Date.now()
        const stopState = inspectContainerState(container)
        const logs = runDockerLogs(container)
        // The marker is only observed, never removed by another path, so the
        // fail-closed exclusion stays in place.
        const markerRetained = await Bun.file(marker).exists()
        if (stopState.exitCode !== 0) {
            throw new Error(
                `The production container stopped during the API startup did not stop gracefully: exit code ${stopState.exitCode} after ${stopDurationMs}ms. ` +
                    (stopState.exitCode === 137
                        ? 'Exit code 137 means Docker SIGKILLed the container after the stop grace period instead of observing an orderly shutdown; as PID 1 the container ignored the stop signal, so the runtime marker survives in the data volume and the next deployment of that volume is refused until an operator removes the marker. '
                        : '') +
                    (markerRetained
                        ? `The runtime marker is still present at ${marker}. `
                        : 'The runtime marker was released. ') +
                    `Container logs:\n${logs}`
            )
        }
        if (markerRetained) {
            throw new Error(
                `The production container exited 0 but retained its runtime marker at ${marker}; a termination during the API startup must release the marker.`
            )
        }
        // The marker release has to come from the application's own drain, so
        // the container logs must carry that drain. Empty logs would mean the
        // marker was removed by another path.
        if (!logs.includes('[postbot-shutdown] SIGTERM received')) {
            throw new Error(
                `The production container exited 0 without running its own orderly drain, so the runtime marker release did not come from the application. Container logs:\n${logs}`
            )
        }
        if (!logs.includes('shutdown complete with exit code 0')) {
            throw new Error(
                `The production container did not report a completed orderly drain in its logs. Container logs:\n${logs}`
            )
        }
        const marginMs = Math.round(
            startupWindowMarginMs(markerAppearedAt, container, exitObservedAt)
        )
        const probeAfterMarkerMs = Math.round(probeFinishedAt - markerAppearedAt)
        console.log(
            `The production container stopped during the API startup exited 0 in ${(stopDurationMs / 1_000).toFixed(1)}s, released its runtime marker and logged its own orderly drain. ` +
                `The runtime marker appeared ${marginMs}ms before the container exited, which bounds the part of the startup window the termination used, and the in-container probe confirmed ${probeAfterMarkerMs}ms after the marker that the API was not serving yet.`
        )
        return {
            caught: true,
            probe,
            state: `${stopState.status} (exit ${stopState.exitCode})`,
            logs,
        }
    } finally {
        // The disposable container is always removed, including when an
        // assertion above failed and left it running.
        try {
            runDocker(['rm', '--force', container])
        } catch {
            // The container may already have been removed.
        }
    }
}

/**
 * Proves that a container stopped while the API is still starting shuts down
 * in an orderly way.
 *
 * A container runs its entrypoint as PID 1, and the kernel does not apply the
 * default action of SIGTERM to PID 1. A container without an installed
 * handler therefore ignores the stop signal entirely: Docker waits for the
 * whole grace period, SIGKILLs the container (exit 137), the container logs
 * stay empty, and the runtime marker survives in the persistent data volume.
 * The next deployment of that volume is then refused until an operator
 * removes the marker by hand.
 *
 * The runtime marker is created at the first statement of the API startup, so
 * it is the earliest observable signal that the startup began. The API logs
 * nothing when it begins to serve, so the container output cannot tell a
 * termination during the startup from a termination of a serving container.
 * The check therefore probes the API from inside the container, where the
 * loopback interface answers even without a published port, and only stops
 * the container while the probe still reports that the API does not serve.
 * A container whose API already serves is discarded and the check starts a
 * fresh container on a fresh disposable data directory, so a missed startup
 * window can never pass silently.
 *
 * The check needs no published port: it observes the marker inside the
 * mounted data directory and the container's exit status, so the container
 * runs with `--network none` and stays independent of the host network.
 *
 * A retained marker is only ever observed. The check never deletes a marker
 * by another path, so the fail-closed exclusion stays in place.
 */
async function verifyStartupTerminationReleasesLock(dataDirectory: string): Promise<void> {
    await prepareContainerWritableDirectory(dataDirectory)
    const observations: string[] = []
    let lastState = 'unknown'
    let lastLogs = ''

    for (let attempt = 1; attempt <= startupWindowAttempts; attempt += 1) {
        const outcome = await runStartupTerminationAttempt(
            join(dataDirectory, `attempt-${attempt}`),
            attempt
        )
        if (outcome.caught) return
        observations.push(`attempt ${attempt}: ${outcome.probe.detail}`)
        lastState = outcome.state
        lastLogs = outcome.logs
        console.log(
            `The startup window was missed in attempt ${attempt}: ${outcome.probe.detail}. ` +
                'The container was discarded and a fresh one was started on a fresh disposable data directory.'
        )
    }

    throw new Error(
        `The production container never landed inside the startup window in ${startupWindowAttempts} attempts, so the termination cannot be proven to stop the API during its startup. ` +
            `The in-container probe saw: ${observations.join('; ')}. ` +
            `The last container state: ${lastState}. Container logs:\n${lastLogs}`
    )
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
    const identity = JSON.parse(
        runDocker(['image', 'inspect', '--format', '{{json .}}', imageTag])
    ) as { Id: string; Os: string; Architecture: string }
    if (identity.Os !== 'linux' || !identity.Id.startsWith('sha256:'))
        throw new Error('Production acceptance requires an identifiable Linux image')
    executionImage = identity.Id
    imageArchitecture = identity.Architecture
    console.log(
        `Accepting immutable image ${executionImage} (${identity.Os}/${imageArchitecture}).`
    )
    imageAvailable = true

    // The container-level startup termination check runs in every scenario.
    // The focused scenario stops after it, so it can run against a
    // lightweight image that carries neither the packaged poster decoder nor
    // the dashboard assets of the full acceptance scenario.
    await verifyStartupTerminationReleasesLock(startupData)
    console.log(
        'The production image released its runtime marker when the container was stopped during the API startup.'
    )

    if (selectedScenario !== startupTerminationScenario) {
        runDocker([
            'run',
            '--rm',
            '--mount',
            `type=bind,source=${join(repositoryRoot, 'packages/db/src/fixtures/video-h264.mp4')},target=/fixture.mp4,readonly`,
            '--entrypoint',
            'bun',
            executionImage,
            '-e',
            `const child = Bun.spawn(['/usr/local/bin/postbot-poster', '-v', 'error', '-nostdin', '-i', '/fixture.mp4', '-frames:v', '1', '-f', 'image2pipe', 'pipe:1'], { stdout: 'pipe', stderr: 'inherit' });
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
            executionImage,
            'backup',
            '--media',
            '--output',
            '/backups/postbot.bundle',
        ])

        runDocker([
            'run',
            '--rm',
            '--mount',
            `type=bind,source=${restoredData},target=/data`,
            '--mount',
            `type=bind,source=${backupDirectory},target=/backups`,
            executionImage,
            'restore',
            '--media',
            '--input',
            '/backups/postbot.bundle',
        ])

        await startServer(restoredData, 'restored')
        const restoredProject = runDocker([
            'run',
            '--rm',
            '--mount',
            `type=bind,source=${restoredData},target=/data`,
            '--entrypoint',
            'bun',
            executionImage,
            '-e',
            `const {Database}=await import('bun:sqlite'); const db=new Database('/data/postbot.sqlite',{readonly:true}); const row=db.query('select id from projects where id = ?').get(${JSON.stringify(acceptanceProjectId)}); db.close(); if(!row)process.exit(1); console.log(row.id)`,
        ])
        if (restoredProject !== acceptanceProjectId)
            throw new Error('Restored authenticated project was not preserved')
        console.log('The authenticated project survived backup and held restoration.')
        await verifyForcedStopRetainsLock(restoredData)
        console.log(
            'Production image started, created a media backup without server secrets, restored it, became ready, stopped gracefully with exit 0 and a released lock, and kept forced termination visible and fail-closed.'
        )
    }
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
                executionImage,
                '-rf',
                '/test-root/source-data',
                '/test-root/restored-data',
                '/test-root/backups',
                '/test-root/startup-data',
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
