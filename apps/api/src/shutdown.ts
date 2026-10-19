/**
 * Controlled shutdown diagnostics.
 *
 * Shutdown failures are logged outside any request context, so they use the
 * same shape as the provider error convention: an error name plus a redacted
 * message (bearer material and secrets removed, whitespace collapsed,
 * bounded length). Raw exception text is never logged.
 */
export interface ShutdownErrorDetails {
    readonly step: string
    readonly name: string
    readonly message: string
}

/** Process exit contract for the server shutdown path in `index.ts`. */
export type ShutdownExitCode =
    /** Every drain completed and the final cleanup released the lock. */
    | 0
    /** A drain step failed; final cleanup was still attempted. */
    | 1
    /** Final cleanup is incomplete: closing SQLite failed, or the runtime
     * lock marker remains (release threw or reported a retained marker). A
     * retained lock keeps the fail-closed exclusion. */
    | 2

export interface ShutdownDependencies {
    readonly stopWorker: () => Promise<void>
    readonly stopMediaMaintenance: () => Promise<void>
    readonly stopNotificationProjection: () => void
    readonly stopRealtime: () => void
    readonly clearCommitObserver: () => void
    readonly stopServer: () => Promise<void> | void
    readonly closeDatabase: () => void
    /** Returns true when no runtime marker remains after the call. */
    readonly releaseRuntimeLock: () => boolean
    readonly exit: (code: ShutdownExitCode) => void
    readonly log?: (message: string, details?: string) => void
}

/**
 * The dependency set of the shutdown path, with assignable steps.
 *
 * The API runtime creates its resources gradually, so the drain has to be
 * able to run before every step exists. A step that is not assigned yet
 * corresponds to a resource that does not exist yet.
 */
export type MutableShutdownDependencies = {
    -readonly [Key in keyof ShutdownDependencies]: ShutdownDependencies[Key]
}

/**
 * Creates the dependency set of a shutdown path whose resources appear over
 * time.
 *
 * Every resource step starts as a no-op and is replaced by the real step as
 * soon as its resource exists. The two process-level steps are explicit: the
 * runtime marker release and the process exit.
 */
export function createShutdownDependencies(
    releaseRuntimeLock: () => boolean,
    exit: (code: ShutdownExitCode) => void
): MutableShutdownDependencies {
    return {
        stopWorker: async () => {},
        stopMediaMaintenance: async () => {},
        stopNotificationProjection: () => {},
        stopRealtime: () => {},
        clearCommitObserver: () => {},
        stopServer: () => {},
        closeDatabase: () => {},
        releaseRuntimeLock,
        exit,
    }
}

/**
 * Builds the process-signal shutdown path. Drain failures are fail-fast:
 * remaining drains are skipped, but the database close and the single
 * token-checked lock release are always attempted before exiting.
 *
 * The caller exits explicitly (rather than relying on natural event-loop
 * exit) because the dashboard asset cache in `@elysia/static` owns a TTL
 * sweep interval that is never cleared.
 */
export function createShutdownHandler(
    dependencies: ShutdownDependencies
): (signal: NodeJS.Signals) => Promise<void> {
    const log = dependencies.log ?? defaultShutdownLog
    let shuttingDown = false

    return async signal => {
        if (shuttingDown) return
        shuttingDown = true

        log(`${signal} received; draining worker and runtimes`)
        let exitCode: ShutdownExitCode = 0
        let step = 'worker-stop'
        try {
            await dependencies.stopWorker()
            step = 'media-maintenance-stop'
            await dependencies.stopMediaMaintenance()
            step = 'notification-projection-stop'
            dependencies.stopNotificationProjection()
            step = 'realtime-stop'
            dependencies.stopRealtime()
            step = 'commit-observer-clear'
            dependencies.clearCommitObserver()
            step = 'server-stop'
            await dependencies.stopServer()
        } catch (error) {
            exitCode = 1
            log('drain failed', JSON.stringify(describeShutdownError(step, error)))
        }
        try {
            dependencies.closeDatabase()
        } catch (error) {
            exitCode = 2
            log(
                'database close failed',
                JSON.stringify(describeShutdownError('database-close', error))
            )
        }
        try {
            if (!dependencies.releaseRuntimeLock()) {
                exitCode = 2
                log(
                    'runtime lock release failed',
                    JSON.stringify({
                        step: 'runtime-lock-release',
                        name: 'LockNotReleased',
                        message: 'The runtime marker remains after release',
                    } satisfies ShutdownErrorDetails)
                )
            }
        } catch (error) {
            exitCode = 2
            log(
                'runtime lock release failed',
                JSON.stringify(describeShutdownError('runtime-lock-release', error))
            )
        }
        log(`shutdown complete with exit code ${exitCode}`)
        dependencies.exit(exitCode)
    }
}

function defaultShutdownLog(message: string, details?: string): void {
    console.error(
        details === undefined
            ? `[postbot-shutdown] ${message}`
            : `[postbot-shutdown] ${message} ${details}`
    )
}

export function describeShutdownError(step: string, error: unknown): ShutdownErrorDetails {
    if (!(error instanceof Error)) {
        return {
            step,
            name: 'UnknownError',
            message: 'The shutdown step did not provide an Error instance',
        }
    }

    return { step, name: sanitizeErrorName(error), message: redactShutdownMessage(error.message) }
}

function sanitizeErrorName(error: Error): string {
    const name = error.constructor.name
    return /^[A-Za-z_$][\w$]{0,63}$/.test(name) ? name : 'Error'
}

function redactShutdownMessage(message: string): string {
    return message
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(
            /\b(access_token|refresh_token|client_secret|code_verifier|authorization_code|state)=\S+/gi,
            '$1=[redacted]'
        )
        .replace(/\s+/g, ' ')
        .slice(0, 500)
}
