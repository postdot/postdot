import { createPostdotClient, type PostdotClient } from '@postdot/client'
import { InvalidArgumentError } from 'commander'

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

export interface Options {
    readonly baseUrl?: string
    readonly timeoutMs: number
    readonly json?: boolean
}

export function positiveInteger(value: string) {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
        throw new InvalidArgumentError('Expected a positive integer.')
    return Number(value)
}

export function connection(options: Options): PostdotClient {
    let url: URL
    try {
        url = new URL(options.baseUrl ?? process.env.POSTDOT_URL ?? 'http://localhost:3000')
    } catch {
        throw new CliError(
            'Provide a valid server origin with --base-url or POSTDOT_URL.',
            'invalid_input',
            2
        )
    }
    if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
    )
        throw new CliError(
            'The server URL must be an HTTP(S) origin without credentials, query or path.',
            'invalid_input',
            2
        )
    const token = process.env.POSTDOT_API_KEY
    if (!token)
        throw new CliError(
            'Set POSTDOT_API_KEY to an API key created in Studio.',
            'authentication_required',
            3
        )
    return createPostdotClient(url.origin, {
        token,
        fetcher: (input, init) =>
            fetch(input, {
                ...init,
                signal: init?.signal
                    ? AbortSignal.any([init.signal, AbortSignal.timeout(options.timeoutMs)])
                    : AbortSignal.timeout(options.timeoutMs),
            }),
    })
}

export async function result<T, E>(
    request: Promise<{ data: T; error: E; status: number; response?: Response }>
): Promise<NonNullable<T>> {
    let response: Awaited<typeof request>
    try {
        response = await request
    } catch {
        throw new CliError(
            'No API response received. A submitted write may have succeeded; inspect its state before retrying.',
            'transport_error'
        )
    }
    if (response.error !== null && response.error !== undefined) {
        if (!response.response)
            throw new CliError(
                'No API response received. A submitted write may have succeeded; inspect its state before retrying.',
                'transport_error'
            )
        const failure = response.error
        const value =
            typeof failure === 'object' && failure !== null && 'value' in failure
                ? failure.value
                : undefined
        const error =
            typeof value === 'object' && value !== null && 'error' in value
                ? value.error
                : undefined
        const code =
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            typeof error.code === 'string'
                ? error.code
                : 'http_error'
        throw new CliError(
            `The server refused the request (HTTP ${response.status}).`,
            code,
            response.status === 401 || response.status === 403 ? 3 : 1,
            { status: response.status }
        )
    }
    if (response.data === null || response.data === undefined)
        throw new CliError('The server returned an empty response.', 'invalid_response')
    return response.data
}

export function output(value: unknown, human: string, options: Options) {
    process.stdout.write(`${options.json ? JSON.stringify(value) : human}\n`)
}
