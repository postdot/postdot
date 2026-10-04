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
    /** Final cleanup is incomplete: closing SQLite or releasing the runtime
     * lock threw. A retained lock keeps the fail-closed exclusion. */
    | 2

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
