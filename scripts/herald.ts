import {
    createHeraldClient,
    type CreatedProjectAccessToken,
    type ProjectAccessToken,
} from '@herald/client'

type CliFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface HeraldCliEnvironment {
    readonly HERALD_PROJECT_TOKEN?: string
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
    const projectToken = optionValue(args, '--token') ?? environment.HERALD_PROJECT_TOKEN
    const sessionClient = createHeraldClient(baseURL, {
        cookie: sessionCookie,
        fetcher,
    })
    const client = createHeraldClient(baseURL, {
        cookie: sessionCookie,
        fetcher,
        token: projectToken,
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

    if (resource === 'access-tokens') {
        requireSession(sessionCookie)
    } else {
        requireAuthenticated(sessionCookie, projectToken)
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

    if (resource === 'access-tokens' && action === 'list') {
        const projectId = requiredOption(args, '--project')
        const body = await call<{ accessTokens: ProjectAccessToken[] }>(
            sessionClient.api.projects({ projectId })['access-tokens'].get()
        )
        write(body, body.accessTokens.map(formatAccessToken).join('\n'))
        return
    }

    if (resource === 'access-tokens' && action === 'create') {
        const projectId = requiredOption(args, '--project')
        const expiresAt = parseExpiresAt(optionValue(args, '--expires-at'))
        const body = await call<CreatedProjectAccessToken>(
            sessionClient.api.projects({ projectId })['access-tokens'].post({
                name: requiredOption(args, '--name'),
                ...(expiresAt === undefined ? {} : { expiresAt }),
            })
        )
        write(
            body,
            `Created access token "${body.accessToken.name}". Copy it now; it will not be shown again:\n\n${body.token}`
        )
        return
    }

    if (resource === 'access-tokens' && action === 'revoke') {
        const projectId = requiredOption(args, '--project')
        const tokenId = requiredOption(args, '--token-id')
        const body = await call(
            sessionClient.api.projects({ projectId })['access-tokens']({ tokenId }).delete()
        )
        write(body, 'Access token revoked.')
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

function formatAccessToken(token: ProjectAccessToken) {
    const expiry = token.expiresAt === null ? 'never' : new Date(token.expiresAt).toISOString()
    const state = token.revokedAt === null ? 'active' : 'revoked'
    return `${token.id}\t${token.name}\t${token.tokenPrefix}\t${state}\t${expiry}`
}

function printCliHelp(output: (message: string) => void) {
    output(`Herald CLI

Usage:
  bun run herald <resource> <action> [options]

Resources:
  auth login                         Sign in and print a session cookie
  projects list                      List projects
  projects create --name <name>      Create a project
  access-tokens list --project <id>  List project token metadata
  access-tokens create --project <id> --name <name>
  access-tokens revoke --project <id> --token-id <id>
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
  --token <value>                    Project bearer token for machine requests
  --expires-at <epoch-ms>            Expiration for a new token

Environment:
  HERALD_URL
  HERALD_SESSION_COOKIE
  HERALD_PROJECT_TOKEN`)
}

function requireAuthenticated(sessionCookie: string | undefined, projectToken: string | undefined) {
    if (!sessionCookie && !projectToken) {
        throw new CliError(
            'Authentication required. Set HERALD_SESSION_COOKIE or HERALD_PROJECT_TOKEN, or pass --cookie or --token.'
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
