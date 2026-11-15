import { openAsBlob } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'

import { createPostdotClient, type PostdotClient } from '@postdot/client'
import { InvalidArgumentError } from 'commander'

import { resolveConnection, type ConfigurationOptions } from './configuration'
import { CliError } from './errors'

export { CliError } from './errors'

export interface Options extends ConfigurationOptions {
    readonly timeoutMs: number
    readonly json?: boolean
}

export function positiveInteger(value: string) {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
        throw new InvalidArgumentError('Expected a positive integer.')
    return Number(value)
}

export function clientFor(
    origin: string,
    token: string | undefined,
    timeoutMs: number
): PostdotClient {
    return createPostdotClient(origin, {
        ...(token === undefined ? {} : { token }),
        parseDate: false,
        fetcher: (input, init) =>
            fetch(input, {
                ...init,
                signal: init?.signal
                    ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
                    : AbortSignal.timeout(timeoutMs),
                // Avoid forwarding stored credentials through a server redirect.
                redirect: 'error',
            }),
    })
}
export function publicClient(options: Options): PostdotClient {
    const settings = resolveConnection(options)
    return clientFor(settings.origin, undefined, options.timeoutMs)
}
function requireToken(token: string | undefined): string {
    if (!token)
        throw new CliError(
            'No API key is available. Use auth login for a saved profile, or POSTDOT_API_KEY for automation.',
            'authentication_required',
            3
        )
    return token
}
export function connection(options: Options): PostdotClient {
    const settings = resolveConnection(options)
    return clientFor(settings.origin, requireToken(settings.token), options.timeoutMs)
}
export function projectConnection(options: Options): { client: PostdotClient; projectId: string } {
    const settings = resolveConnection(options)
    if (!settings.project)
        throw new CliError(
            'Choose a project with --project, POSTDOT_PROJECT or config set-project.',
            'project_required',
            2
        )
    return {
        client: clientFor(settings.origin, requireToken(settings.token), options.timeoutMs),
        projectId: settings.project,
    }
}

export function resolveWebsiteOption(options: { url?: string; clear?: boolean }): string | null {
    const hasUrl = options.url !== undefined
    const hasClear = Boolean(options.clear)
    if (hasUrl && hasClear) {
        throw new CliError('Specify either --url or --clear, not both.', 'invalid_input', 2)
    }
    if (!hasUrl && !hasClear) {
        throw new CliError('Specify --url <url> or --clear.', 'invalid_input', 2)
    }
    if (hasClear) return null
    const trimmed = options.url?.trim() ?? ''
    if (!trimmed) {
        throw new CliError(
            '--url must not be empty; use --clear to remove the website.',
            'invalid_input',
            2
        )
    }
    return trimmed
}

const maximumIdentityImageBytes = 2 * 1024 * 1024

export async function uploadIdentityImage<T>(
    options: Options,
    apiPath: string,
    filePath: string
): Promise<T> {
    const settings = resolveConnection(options)
    const token = requireToken(settings.token)
    let size: number
    try {
        const info = await stat(filePath)
        if (!info.isFile() || info.size === 0) throw new Error('Not a nonempty file')
        size = info.size
    } catch {
        throw new CliError('--file must be a readable, nonempty regular file.', 'invalid_input', 2)
    }
    if (size > maximumIdentityImageBytes) {
        throw new CliError('The file exceeds the 2 MB identity image limit.', 'invalid_input', 2)
    }
    const blob = await openAsBlob(filePath)
    const form = new FormData()
    form.set('file', blob, basename(filePath))
    let response: Response
    try {
        response = await fetch(`${settings.origin}${apiPath}`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${token}`,
                accept: 'application/json',
            },
            body: form,
            redirect: 'error',
            signal: AbortSignal.timeout(options.timeoutMs),
        })
    } catch {
        throw new CliError(
            'No API response received. A submitted write may have succeeded; inspect its state before retrying.',
            'transport_error'
        )
    }
    const body = (await response.json().catch(() => null)) as
        | { error?: { code?: string; message?: string } }
        | T
        | null
    if (!response.ok) {
        const err =
            body && typeof body === 'object' && 'error' in body && body.error
                ? (body.error as { code?: string; message?: string })
                : undefined
        throw new CliError(
            err?.message ?? `The server refused the request (HTTP ${response.status}).`,
            err?.code ?? 'http_error',
            response.status === 401 || response.status === 403 ? 3 : 1,
            { status: response.status, ...(err === undefined ? {} : { server: err }) }
        )
    }
    if (body === null) {
        throw new CliError('The server returned an empty response.', 'invalid_response')
    }
    return body as T
}

type ApiResult<T, E> = Promise<{ data: T; error: E; status: number; response?: Response }>
export function result<T, E>(request: ApiResult<T, E>, nullable?: false): Promise<NonNullable<T>>
export function result<T, E>(
    request: ApiResult<T, E>,
    nullable: true
): Promise<NonNullable<T> | null>
export async function result<T, E>(request: ApiResult<T, E>, nullable = false) {
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
        const message =
            typeof error === 'object' &&
            error !== null &&
            'message' in error &&
            typeof error.message === 'string'
                ? error.message
                : `The server refused the request (HTTP ${response.status}).`
        throw new CliError(
            message,
            code,
            response.status === 401 || response.status === 403 ? 3 : 1,
            {
                status: response.status,
                ...(error === undefined ? {} : { server: errOrValue(error) }),
            }
        )
    }
    if (nullable && (response.data === null || response.data === undefined || response.data === ''))
        return null
    if (response.data === null || response.data === undefined)
        throw new CliError('The server returned an empty response.', 'invalid_response')
    return response.data
}

function errOrValue(error: unknown) {
    return error
}

export function output(value: unknown, human: string, options: Options) {
    process.stdout.write(`${options.json ? JSON.stringify(value) : human}\n`)
}
