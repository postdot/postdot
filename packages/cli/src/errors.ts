export class CliError extends Error {
    constructor(
        message: string,
        readonly code: string,
        readonly exitCode = 1,
        readonly details?: unknown
    ) {
        super(message)
    }
}
