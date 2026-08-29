import { createHeraldClient } from '@herald/client'

const args = Bun.argv.slice(2)
const jsonOutput = args.includes('--json')
const baseURL = (
    optionValue('--base-url') ??
    Bun.env.HERALD_URL ??
    'http://localhost:3000'
).replace(/\/$/, '')
const sessionCookie = optionValue('--cookie') ?? Bun.env.HERALD_SESSION_COOKIE
const client = createHeraldClient(baseURL, { cookie: sessionCookie })

interface ErrorResponse {
    readonly error?: {
        readonly code?: string
        readonly message?: string
    }
}

class CliError extends Error {
    readonly exitCode: number

    constructor(message: string, exitCode = 1) {
        super(message)
        this.name = 'CliError'
        this.exitCode = exitCode
    }
}

async function requestAuth<T>(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    if (sessionCookie) headers.set('cookie', sessionCookie)
    if (init.body !== undefined) headers.set('content-type', 'application/json')

    const response = await fetch(`${baseURL}${path}`, { ...init, headers })
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

function optionValue(name: string) {
    const index = args.indexOf(name)
    const value = index === -1 ? undefined : args[index + 1]
    return value === undefined || value.startsWith('--') ? undefined : value
}

function requiredOption(name: string) {
    const value = optionValue(name)
    if (!value) throw new CliError(`Missing required option ${name}`)
    return value
}

function write(value: unknown, humanMessage: string) {
    console.log(jsonOutput ? JSON.stringify(value, null, 2) : humanMessage)
}

function printHelp() {
    console.log(`Herald CLI

Usage:
  bun run herald <resource> <action> [options]

Resources:
  auth login                         Sign in and print a session cookie
  projects list                      List projects
  projects create --name <name>      Create a project
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

Environment:
  HERALD_URL
  HERALD_SESSION_COOKIE`)
}

async function run() {
    const [resource, action] = args
    if (!resource || resource === '--help' || resource === '-h') {
        printHelp()
        return
    }

    if (resource === 'auth' && action === 'login') {
        const email = requiredOption('--email')
        const password = requiredOption('--password')
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

    requireSession()

    if (resource === 'projects' && action === 'list') {
        const body = await call<{ projects: Array<{ id: string; name: string }> }>(
            client.api.projects.get()
        )
        write(body, body.projects.map(project => `${project.id}\t${project.name}`).join('\n'))
        return
    }

    if (resource === 'projects' && action === 'create') {
        const body = await call(client.api.projects.post({ name: requiredOption('--name') }))
        write(body, 'Project created.')
        return
    }

    if (resource === 'channels' && action === 'list') {
        const projectId = requiredOption('--project')
        const body = await call<{ channels: Array<{ id: string; name: string }> }>(
            client.api.projects({ projectId }).channels.get()
        )
        write(body, body.channels.map(channel => `${channel.id}\t${channel.name}`).join('\n'))
        return
    }

    if (resource === 'channels' && action === 'create') {
        const projectId = requiredOption('--project')
        const body = await call(
            client.api.projects({ projectId }).channels.post({ name: requiredOption('--name') })
        )
        write(body, 'Channel created.')
        return
    }

    if (resource === 'publications' && action === 'due') {
        const projectId = requiredOption('--project')
        const body = await call(client.api.projects({ projectId }).publications.due.get())
        write(body, 'Due publications listed.')
        return
    }

    if (resource === 'publications' && action === 'publish') {
        const projectId = requiredOption('--project')
        const publicationId = requiredOption('--publication')
        const externalUrl = optionValue('--external-url')
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
        const projectId = requiredOption('--project')
        const publicationId = requiredOption('--publication')
        const resolution = requiredOption('--resolution')
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
                        externalId: requiredOption('--external-id'),
                        externalUrl: optionValue('--external-url'),
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
                        errorMessage: requiredOption('--error-message'),
                    })
            )
            write(body, 'Publication reconciled as failed.')
        }
        return
    }

    if (resource === 'audit' && action === 'list') {
        const projectId = requiredOption('--project')
        const body = await call(client.api.projects({ projectId })['audit-events'].get())
        write(body, 'Audit events listed.')
        return
    }

    throw new CliError(`Unknown command: ${resource} ${action ?? ''}`.trim(), 2)
}

function requireSession() {
    if (!sessionCookie) {
        throw new CliError(
            'Authentication required. Set HERALD_SESSION_COOKIE or pass --cookie <value>.'
        )
    }
}

try {
    await run()
} catch (error) {
    const cliError = error instanceof CliError ? error : new CliError('The command failed')
    console.error(`Error: ${cliError.message}`)
    process.exitCode = cliError.exitCode
}
