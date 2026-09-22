import { createHeraldClient } from '@herald/client'

type CliFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface HeraldCliEnvironment {
    readonly HERALD_API_KEY?: string
    readonly HERALD_SESSION_COOKIE?: string
    readonly HERALD_URL?: string
}

interface CliDependencies {
    readonly fetcher?: CliFetcher
    readonly output?: (message: string) => void
}

interface ErrorResponse {
    readonly error?: {
        readonly code?: string
        readonly message?: string
    }
}

export class CliError extends Error {
    readonly exitCode: number

    constructor(message: string, exitCode = 1) {
        super(message)
        this.name = 'CliError'
        this.exitCode = exitCode
    }
}

export async function runCli(
    args: readonly string[] = Bun.argv.slice(2),
    environment: HeraldCliEnvironment = Bun.env as HeraldCliEnvironment,
    dependencies: CliDependencies = {}
) {
    const output = dependencies.output ?? console.log
    const fetcher = dependencies.fetcher ?? fetch
    const jsonOutput = args.includes('--json')
    const baseURL = (
        optionValue(args, '--base-url') ??
        environment.HERALD_URL ??
        'http://localhost:3000'
    ).replace(/\/$/, '')
    const sessionCookie = optionValue(args, '--cookie') ?? environment.HERALD_SESSION_COOKIE
    const apiKey = optionValue(args, '--token') ?? environment.HERALD_API_KEY
    const client = createHeraldClient(baseURL, {
        cookie: sessionCookie,
        fetcher,
        token: apiKey,
    })

    const write = (value: unknown, humanMessage: string) => {
        output(jsonOutput ? JSON.stringify(value, null, 2) : humanMessage)
    }
    const printHelp = () => printCliHelp(output)
    const requestAuth = <T>(path: string, init: RequestInit = {}) =>
        requestAuthenticated<T>(baseURL, sessionCookie, fetcher, path, init)

    const [resource, action] = args
    if (!resource || resource === '--help' || resource === '-h') {
        printHelp()
        return
    }

    if (resource === 'auth' && action === 'login') {
        const email = requiredOption(args, '--email')
        const password = requiredOption(args, '--password')
        const { body, response } = await requestAuth<{ user: { email: string } }>(
            '/api/auth/sign-in/email',
            {
                method: 'POST',
                body: JSON.stringify({ email, password }),
            }
        )
        const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
        if (!cookie) throw new CliError('Authentication succeeded without a session cookie')
        write(
            { cookie, user: body.user },
            `Authenticated as ${body.user.email}. Export HERALD_SESSION_COOKIE='${cookie}'.`
        )
        return
    }

    if (resource === 'api-keys') {
        requireSession(sessionCookie)
    } else {
        requireAuthenticated(sessionCookie, apiKey)
    }

    if (resource === 'projects' && action === 'list') {
        const body = await call<{ projects: Array<{ id: string; name: string }> }>(
            client.api.projects.get()
        )
        write(body, body.projects.map(project => `${project.id}\t${project.name}`).join('\n'))
        return
    }

    if (resource === 'projects' && action === 'create') {
        const body = await call(client.api.projects.post({ name: requiredOption(args, '--name') }))
        write(body, 'Project created.')
        return
    }

    if (resource === 'api-keys' && action === 'list') {
        const body = await requestAuth<{ keys: UserApiKey[] }>('/api/api-keys')
        write(body.body, body.body.keys.map(formatUserApiKey).join('\n'))
        return
    }

    if (resource === 'api-keys' && action === 'create') {
        const expiresAt = parseExpiresAt(optionValue(args, '--expires-at'))
        const projectIds = parseProjectIds(optionValue(args, '--projects'))
        const body = await requestAuth<CreatedUserApiKey>('/api/api-keys', {
            method: 'POST',
            body: JSON.stringify({
                ...(optionValue(args, '--name') === undefined
                    ? {}
                    : { name: optionValue(args, '--name') }),
                projectIds,
                ...(expiresAt === undefined ? {} : { expiresAt }),
            }),
        })
        write(
            body.body,
            `Created API key "${body.body.key.name}". Copy it now; it will not be shown again:\n\n${body.body.token}`
        )
        return
    }

    if (resource === 'api-keys' && action === 'revoke') {
        const keyId = requiredOption(args, '--key-id')
        const body = await requestAuth<{ deleted: true }>(
            `/api/api-keys/${encodeURIComponent(keyId)}`,
            { method: 'DELETE' }
        )
        write(body.body, 'API key revoked.')
        return
    }

    if (resource === 'channels' && action === 'list') {
        const projectId = requiredOption(args, '--project')
        const body = await call<{ channels: Array<{ id: string; name: string }> }>(
            client.api.projects({ projectId }).channels.get()
        )
        write(body, body.channels.map(channel => `${channel.id}\t${channel.name}`).join('\n'))
        return
    }

    if (resource === 'channels' && action === 'create') {
        const projectId = requiredOption(args, '--project')
        const body = await call(
            client.api.projects({ projectId }).channels.post({
                name: requiredOption(args, '--name'),
            })
        )
        write(body, 'Channel created.')
        return
    }

    if (resource === 'publications' && action === 'due') {
        const projectId = requiredOption(args, '--project')
        const body = await call(client.api.projects({ projectId }).publications.due.get())
        write(body, 'Due publications listed.')
        return
    }

    if (resource === 'publications' && action === 'publish') {
        const projectId = requiredOption(args, '--project')
        const publicationId = requiredOption(args, '--publication')
        const externalUrl = optionValue(args, '--external-url')
        const body = await call(
            client.api
                .projects({ projectId })
                .publications({ publicationId })
                .publish.post(externalUrl ? { externalUrl } : {})
        )
        write(body, 'Publication marked as published.')
        return
    }

    if (resource === 'publications' && action === 'reconcile') {
        const projectId = requiredOption(args, '--project')
        const publicationId = requiredOption(args, '--publication')
        const resolution = requiredOption(args, '--resolution')
        if (resolution !== 'published' && resolution !== 'failed') {
            throw new CliError('--resolution must be either published or failed', 2)
        }

        if (resolution === 'published') {
            const body = await call(
                client.api
                    .projects({ projectId })
                    .publications({ publicationId })
                    .reconcile.post({
                        resolution,
                        externalId: requiredOption(args, '--external-id'),
                        externalUrl: optionValue(args, '--external-url'),
                    })
            )
            write(body, 'Publication reconciled as published.')
        } else {
            const body = await call(
                client.api
                    .projects({ projectId })
                    .publications({ publicationId })
                    .reconcile.post({
                        resolution,
                        errorMessage: requiredOption(args, '--error-message'),
                    })
            )
            write(body, 'Publication reconciled as failed.')
        }
        return
    }

    if (resource === 'audit' && action === 'list') {
        const projectId = requiredOption(args, '--project')
        const body = await call(client.api.projects({ projectId })['audit-events'].get())
        write(body, 'Audit events listed.')
        return
    }

    throw new CliError(`Unknown command: ${resource} ${action ?? ''}`.trim(), 2)
}

async function requestAuthenticated<T>(
    baseURL: string,
    sessionCookie: string | undefined,
    fetcher: CliFetcher,
    path: string,
    init: RequestInit = {}
) {
    const headers = new Headers(init.headers)
    if (sessionCookie) headers.set('cookie', sessionCookie)
    if (init.body !== undefined) headers.set('content-type', 'application/json')

    const response = await fetcher(`${baseURL}${path}`, { ...init, headers })
    const body = (await response.json().catch(() => null)) as T | ErrorResponse | null
    if (!response.ok) {
        const errorBody = body as ErrorResponse | null
        throw new CliError(
            errorBody?.error?.message ?? `Request failed with status ${response.status}`
        )
    }
    return { body: body as T, response }
}

async function call<T>(request: Promise<{ data: unknown; error: unknown; status: number }>) {
    const result = await request
    if (result.error !== null) {
        throw new CliError(
            errorMessage(result.error) ?? `Request failed with status ${result.status}`
        )
    }
    return result.data as T
}

function errorMessage(value: unknown) {
    if (typeof value !== 'object' || value === null || !('value' in value)) return undefined
    const errorValue = value.value
    if (typeof errorValue !== 'object' || errorValue === null || !('error' in errorValue)) {
        return undefined
    }
    const body = errorValue.error
    if (typeof body !== 'object' || body === null || !('message' in body)) return undefined
    return typeof body.message === 'string' ? body.message : undefined
}

function optionValue(args: readonly string[], name: string) {
    const index = args.indexOf(name)
    const value = index === -1 ? undefined : args[index + 1]
    return value === undefined || value.startsWith('--') ? undefined : value
}

function requiredOption(args: readonly string[], name: string) {
    const value = optionValue(args, name)
    if (!value) throw new CliError(`Missing required option ${name}`)
    return value
}

function parseExpiresAt(value: string | undefined) {
    if (value === undefined) return undefined
    const expiresAt = Number(value)
    if (!Number.isSafeInteger(expiresAt) || expiresAt < 0) {
        throw new CliError('--expires-at must be a non-negative epoch timestamp in milliseconds', 2)
    }
    return expiresAt
}

interface UserApiKey {
    readonly id: string
    readonly name: string
    readonly tokenPrefix: string
    readonly projectAccess: 'all' | readonly string[]
    readonly expiresAt: number | null
    readonly createdAt: number
    readonly updatedAt: number
}

interface CreatedUserApiKey {
    readonly key: UserApiKey
    readonly token: string
}

function formatUserApiKey(key: UserApiKey) {
    const expiry = key.expiresAt === null ? 'never' : new Date(key.expiresAt).toISOString()
    const scope = key.projectAccess === 'all' ? 'all-projects' : key.projectAccess.join(',')
    return `${key.id}\t${key.name}\t${key.tokenPrefix}\t${scope}\t${expiry}`
}

function parseProjectIds(value: string | undefined): string[] | null {
    if (value === undefined) return null
    const projectIds = [...new Set(value.split(',').map(projectId => projectId.trim()))].filter(
        projectId => projectId.length > 0
    )
    if (projectIds.length === 0) {
        throw new CliError('--projects must contain at least one project id', 2)
    }
    return projectIds
}

function printCliHelp(output: (message: string) => void) {
    output(`Herald CLI

Usage:
  bun run herald <resource> <action> [options]

Resources:
  auth login                         Sign in and print a session cookie
  projects list                      List projects
  projects create --name <name>      Create a project
  api-keys list                      List your API keys
  api-keys create [--name <name>]    Create a user-owned API key
  api-keys revoke --key-id <id>      Revoke one of your API keys
  channels list --project <id>       List project channels
  channels create --project <id> --name <name>
  publications due --project <id>    List due manual publications
  publications publish --project <id> --publication <id>
  publications reconcile --project <id> --publication <id> --resolution <published|failed>
  audit list --project <id>          List project audit events

Options:
  --json                             Print structured JSON
  --base-url <url>                   Herald API URL (default: http://localhost:3000)
  --cookie <value>                   Session cookie for authenticated requests
  --token <value>                    Herald API key for machine requests
  --projects <id,id,...>             Limit a new API key to selected projects
  --expires-at <epoch-ms>            Expiration for a new token

Environment:
  HERALD_URL
  HERALD_SESSION_COOKIE
  HERALD_API_KEY`)
}

function requireAuthenticated(sessionCookie: string | undefined, apiKey: string | undefined) {
    if (!sessionCookie && !apiKey) {
        throw new CliError(
            'Authentication required. Set HERALD_SESSION_COOKIE or HERALD_API_KEY, or pass --cookie or --token.'
        )
    }
}

function requireSession(sessionCookie: string | undefined) {
    if (!sessionCookie) {
        throw new CliError(
            'This command requires a human session. Set HERALD_SESSION_COOKIE or pass --cookie <value>.'
        )
    }
}

if (import.meta.main) {
    try {
        await runCli()
    } catch (error) {
        const cliError = error instanceof CliError ? error : new CliError('The command failed')
        console.error(`Error: ${cliError.message}`)
        process.exitCode = cliError.exitCode
    }
}
