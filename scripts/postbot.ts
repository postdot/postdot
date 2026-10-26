import { stat } from 'node:fs/promises'
import { basename } from 'node:path'

import {
    createPostbotClient,
    type PostbotClient,
    type Post,
    type Publication,
    type MediaReservation,
    type MediaUploadPolicy,
    type MediaUrlImport,
} from '@postdot/client'

type CliFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface PostbotCliEnvironment {
    readonly POSTBOT_API_KEY?: string
    readonly POSTBOT_SESSION_COOKIE?: string
    readonly POSTBOT_URL?: string
}

interface CliDependencies {
    readonly fetcher?: CliFetcher
    readonly output?: (message: string) => void
    readonly readInput?: (path: string) => Promise<string>
}

interface ErrorResponse {
    readonly error?: {
        readonly code?: string
        readonly message?: string
    }
}

export class CliError extends Error {
    readonly exitCode: number
    readonly code: string
    readonly status?: number
    media?: { assetId: string; intentId?: string }

    constructor(message: string, exitCode = 1, code = 'command_failed', status?: number) {
        super(message)
        this.name = 'CliError'
        this.exitCode = exitCode
        this.code = code
        this.status = status
    }
}

export async function runCli(
    args: readonly string[] = Bun.argv.slice(2),
    environment: PostbotCliEnvironment = Bun.env as PostbotCliEnvironment,
    dependencies: CliDependencies = {}
) {
    const output = dependencies.output ?? console.log
    const timeoutMs =
        optionValue(args, '--timeout-ms') === undefined
            ? 30_000
            : integerOption(args, '--timeout-ms', 1)
    const transport = dependencies.fetcher ?? fetch
    const fetcher: CliFetcher = (input, init) =>
        transport(input, {
            ...init,
            signal: init?.signal
                ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
                : AbortSignal.timeout(timeoutMs),
        })
    const jsonOutput = args.includes('--json')
    const baseURL = (
        optionValue(args, '--base-url') ??
        environment.POSTBOT_URL ??
        'http://localhost:3000'
    ).replace(/\/$/, '')
    const sessionCookie = optionValue(args, '--cookie') ?? environment.POSTBOT_SESSION_COOKIE
    const apiKey = optionValue(args, '--token') ?? environment.POSTBOT_API_KEY
    const client = createPostbotClient(baseURL, {
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
            `Authenticated as ${body.user.email}. Export POSTBOT_SESSION_COOKIE='${cookie}'.`
        )
        return
    }

    if (resource === 'api-keys') {
        requireSession(sessionCookie)
    } else {
        requireAuthenticated(sessionCookie, apiKey)
    }

    if (
        (resource === 'projects' || resource === 'workspaces') &&
        ['impact', 'archive', 'restore', 'delete'].includes(action ?? '')
    ) {
        if (resource === 'workspaces') requireSession(sessionCookie)
        const id = requiredOption(args, resource === 'projects' ? '--project' : '--workspace')
        if (action === 'impact') {
            const body =
                resource === 'projects'
                    ? await call(client.api.projects({ projectId: id }).lifecycle.get())
                    : await call(client.api.workspaces({ workspaceId: id }).lifecycle.get())
            write(body, JSON.stringify(body, null, 2))
            return
        }
        // A previously displayed fingerprint is mandatory. No hidden read-and-delete.
        const input = {
            fingerprint: requiredOption(args, '--fingerprint'),
            cancelPending: args.includes('--cancel-pending'),
            acknowledgeUncertain: args.includes('--acknowledge-uncertain'),
            confirmName: optionValue(args, '--confirm-name'),
            replacementWorkspaceId: optionValue(args, '--replacement-workspace'),
        }
        const route =
            resource === 'projects'
                ? client.api.projects({ projectId: id }).lifecycle
                : client.api.workspaces({ workspaceId: id }).lifecycle
        const body =
            action === 'delete'
                ? await call(route.delete(input))
                : action === 'archive'
                  ? await call(route.archive.post(input))
                  : await call(route.restore.post(input))
        write(body, JSON.stringify(body, null, 2))
        return
    }

    if (resource === 'projects' && action === 'list') {
        const body = await call<{ projects: Array<{ id: string; name: string }> }>(
            client.api.projects.get({
                query: { includeArchived: args.includes('--include-archived') },
            })
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

    if (resource === 'publishers' && action === 'list') {
        const result = await call(
            client.api.projects({ projectId: requiredOption(args, '--project') }).publishers.get()
        )
        write(result, JSON.stringify(result, null, 2))
        return
    }

    if (resource === 'channels' && action === 'profile') {
        const result = await call(
            client.api
                .projects({ projectId: requiredOption(args, '--project') })
                .channels({ channelId: requiredOption(args, '--channel') })
                .profile.get()
        )
        write(result, JSON.stringify(result, null, 2))
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

    if (resource === 'media' && action === 'policy') {
        const result = await call(
            client.api
                .projects({ projectId: requiredOption(args, '--project') })
                .media['upload-policy'].get()
        )
        write(result, JSON.stringify(result, null, 2))
        return
    }

    if (resource === 'media' && action === 'list') {
        const cursor = optionValue(args, '--cursor')
        const result = await call(
            client.api.projects({ projectId: requiredOption(args, '--project') }).media.get({
                query: { limit: 100, ...(cursor === undefined ? {} : { cursor }) },
            })
        )
        write(result, JSON.stringify(result, null, 2))
        return
    }

    if (resource === 'media' && action === 'show') {
        const result = await call(
            client.api
                .projects({ projectId: requiredOption(args, '--project') })
                .media({ assetId: requiredOption(args, '--asset') })
                .get()
        )
        write(result, JSON.stringify(result, null, 2))
        return
    }

    if (resource === 'media' && action === 'finalize') {
        const result = await call<MediaUrlImport>(
            client.api
                .projects({ projectId: requiredOption(args, '--project') })
                .media.uploads({ intentId: requiredOption(args, '--intent') })
                .finalize.post()
        )
        ensureMediaAccepted(result)
        write(result, `Media ${result.media.asset.id}: ${result.status}.`)
        return
    }

    if (resource === 'media' && action === 'import-url') {
        const result = await call<MediaUrlImport>(
            client.api
                .projects({ projectId: requiredOption(args, '--project') })
                .media.imports.url.post({ url: requiredOption(args, '--url') })
        )
        ensureMediaAccepted(result)
        write(result, `Media ${result.media.asset.id}: ${result.status}.`)
        return
    }

    if (resource === 'media' && action === 'upload') {
        const projectId = requiredOption(args, '--project')
        const path = requiredOption(args, '--file')
        let size: number
        try {
            const info = await stat(path)
            if (!info.isFile() || info.size === 0) throw new Error('Not a nonempty file')
            size = info.size
        } catch {
            throw new CliError(
                '--file must be a readable, nonempty regular file',
                2,
                'invalid_input'
            )
        }
        const file = Bun.file(path)
        const contentType =
            optionValue(args, '--content-type') ?? file.type ?? 'application/octet-stream'
        const route = client.api.projects({ projectId }).media
        const policy = await call<MediaUploadPolicy>(route['upload-policy'].get())
        if (size > policy.maxFileSize || !policy.allowedContentTypes.includes(contentType)) {
            throw new CliError(
                'File exceeds the server upload policy or its content type is unsupported. Inspect media policy.',
                2,
                'invalid_input'
            )
        }
        const reservation = await call<MediaReservation>(
            route.uploads.post({
                originalFilename: basename(path),
                expectedSize: size,
                contentType,
                defaultAccessibilityText: optionValue(args, '--alt'),
            })
        )
        const checkpoint = { assetId: reservation.asset.id, intentId: reservation.intent.id }
        try {
            // Treaty fetch overrides retain a raw stream when the declared body
            // argument is undefined; do not turn this PUT into JSON or multipart.
            await call(
                route.uploads({ intentId: checkpoint.intentId }).put(undefined, {
                    headers: { 'content-type': contentType },
                    fetch: { body: file.stream() },
                })
            )
            const result = await call<MediaUrlImport>(
                route.uploads({ intentId: checkpoint.intentId }).finalize.post()
            )
            ensureMediaAccepted(result)
            write(result, `Media ${checkpoint.assetId}: ${result.status}.`)
        } catch (error) {
            const failure =
                error instanceof CliError ? error : new CliError('Media transfer failed')
            failure.media = checkpoint
            throw failure
        }
        return
    }

    if (resource === 'posts' && action === 'create') {
        const projectId = requiredOption(args, '--project')
        const body = await readJsonInput<CreatePostInput>(args, dependencies)
        const result = await call<{ post: Post; publications: Publication[] }>(
            client.api.projects({ projectId }).posts.post(body)
        )
        write(
            result,
            `Post ${result.post.id} created with ${result.publications.length} publications.`
        )
        return
    }

    if (resource === 'publications' && action === 'list') {
        const projectId = requiredOption(args, '--project')
        const cursor = optionValue(args, '--cursor')
        const result = await call(
            client.api.projects({ projectId }).publications.get({
                query: { ...(cursor === undefined ? {} : { cursor }), limit: 100 },
            })
        )
        write(result, JSON.stringify(result, null, 2))
        return
    }

    if (resource === 'publications' && action === 'show') {
        const projectId = requiredOption(args, '--project')
        const publicationId = requiredOption(args, '--publication')
        const result = await call(
            client.api.projects({ projectId }).publications({ publicationId }).editor.get()
        )
        write(result, JSON.stringify(result, null, 2))
        return
    }

    if (resource === 'publications' && action === 'save') {
        const projectId = requiredOption(args, '--project')
        const publicationId = requiredOption(args, '--publication')
        const body = await readJsonInput<SaveDraftInput>(args, dependencies)
        const result = await call(
            client.api.projects({ projectId }).publications({ publicationId }).draft.patch(body)
        )
        write(result, 'Draft saved.')
        return
    }

    if (resource === 'publications' && action === 'promote') {
        const projectId = requiredOption(args, '--project')
        const publicationId = requiredOption(args, '--publication')
        const result = await call(
            client.api
                .projects({ projectId })
                .publications({ publicationId })
                .draft.promote.post({
                    expectedRevision: integerOption(args, '--expected-revision', 1),
                    scheduledAt: integerOption(args, '--at', 0),
                })
        )
        write(result, 'Draft promoted and scheduled.')
        return
    }

    if (resource === 'publications' && (action === 'schedule' || action === 'cancel')) {
        const projectId = requiredOption(args, '--project')
        const publicationIds = parseProjectIds(requiredOption(args, '--publications'))
        if (publicationIds === null) throw new CliError('Publication IDs are required', 2)
        const route = client.api.projects({ projectId }).publications
        const result =
            action === 'schedule'
                ? await call(
                      route.schedule.patch({
                          publicationIds,
                          scheduledAt: integerOption(args, '--at', 0),
                      })
                  )
                : await call(route.cancel.patch({ publicationIds }))
        write(
            result,
            action === 'schedule' ? 'Publications rescheduled.' : 'Publications cancelled.'
        )
        return
    }

    if (resource === 'publications' && action === 'retry') {
        const projectId = requiredOption(args, '--project')
        const publicationId = requiredOption(args, '--publication')
        const result = await call(
            client.api.projects({ projectId }).publications({ publicationId }).retry.post()
        )
        write(result, 'Publication retry requested.')
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

function ensureMediaAccepted(result: MediaUrlImport) {
    if (result.status !== 'failed') return
    const error = new CliError(
        'Media verification failed. Inspect the asset before using it.',
        1,
        'media_inspection_failed'
    )
    error.media = { assetId: result.media.asset.id }
    throw error
}

type ProjectRoutes = ReturnType<PostbotClient['api']['projects']>
type PublicationRoutes = ReturnType<ProjectRoutes['publications']>
type CreatePostInput = Parameters<ProjectRoutes['posts']['post']>[0]
type SaveDraftInput = Parameters<PublicationRoutes['draft']['patch']>[0]

async function readJsonInput<T>(
    args: readonly string[],
    dependencies: CliDependencies
): Promise<T> {
    const path = requiredOption(args, '--input')
    let text: string
    try {
        text = await (dependencies.readInput ?? readBoundedInput)(path)
    } catch {
        throw new CliError('Cannot read --input (maximum 1 MiB)', 2, 'invalid_input')
    }
    if (new TextEncoder().encode(text).length > 1_048_576) {
        throw new CliError('--input exceeds 1 MiB', 2, 'invalid_input')
    }
    let value: unknown
    try {
        value = JSON.parse(text)
    } catch {
        throw new CliError('--input must contain valid JSON', 2, 'invalid_input')
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new CliError('--input must contain a JSON object', 2, 'invalid_input')
    }
    // Untrusted JSON boundary only: the authoritative Elysia schema validates
    // the payload. Request types are inferred from Treaty, never maintained here.
    return value as T
}

async function readBoundedInput(path: string): Promise<string> {
    const file = path === '-' ? Bun.stdin : Bun.file(path)
    if (path !== '-' && file.size > 1_048_576) throw new Error('Input too large')
    const reader = file.stream().getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
        for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > 1_048_576) throw new Error('Input too large')
            chunks.push(value)
        }
    } finally {
        await reader.cancel()
        reader.releaseLock()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
    }
    return new TextDecoder().decode(bytes)
}

function integerOption(args: readonly string[], name: string, minimum: number) {
    const raw = requiredOption(args, name)
    const value = Number(raw)
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < minimum) {
        throw new CliError(`${name} must be an integer >= ${minimum}`, 2, 'invalid_input')
    }
    return value
}

function errorCode(value: unknown): string | undefined {
    if (typeof value !== 'object' || value === null || !('value' in value)) return undefined
    const body = value.value
    if (typeof body !== 'object' || body === null || !('error' in body)) return undefined
    const error = body.error
    return typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string'
        ? error.code
        : undefined
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

async function call<T>(
    request: Promise<{ data: unknown; error: unknown; status: number; response?: Response }>
) {
    let result: Awaited<typeof request>
    try {
        result = await request
    } catch {
        throw new CliError(
            'No API response received. A submitted write may have succeeded; inspect its state before retrying.',
            1,
            'transport_error'
        )
    }
    if (result.error !== null && result.response === undefined) {
        throw new CliError(
            'No API response received. A submitted write may have succeeded; inspect its state before retrying.',
            1,
            'transport_error'
        )
    }
    if (result.error !== null) {
        throw new CliError(
            errorMessage(result.error) ?? `Request failed with status ${result.status}`,
            1,
            errorCode(result.error) ?? 'http_error',
            result.status
        )
    }
    if (result.data === null || result.data === undefined) throw new CliError('Empty API response')
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
    if (!value) throw new CliError(`Missing required option ${name}`, 2, 'invalid_input')
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
    output(`Postdot CLI

Usage:
  bun run postdot <resource> <action> [options]

Resources:
  auth login                         Sign in and print a session cookie
  projects list [--include-archived] List projects
  projects impact --project <id>      Preview archive/delete impact
  projects archive|restore|delete --project <id> --fingerprint <value>
    [--cancel-pending] [--confirm-name <name>] [--acknowledge-uncertain]
  workspaces impact --workspace <id>  Preview combined workspace impact
  workspaces archive|restore|delete --workspace <id> --fingerprint <value>
    [--cancel-pending] [--confirm-name <name>] [--replacement-workspace <id>]
  projects create --name <name>      Create a project
  api-keys list                      List your API keys
  api-keys create [--name <name>]    Create a user-owned API key
  api-keys revoke --key-id <id>      Revoke one of your API keys
  publishers list --project <id>     Inspect connections and OAuth configuration
  channels list --project <id>       List project channels
  channels profile --project <id> --channel <id>
                                    Inspect active/draft destination contracts
  channels create --project <id> --name <name>
  media policy --project <id>        Inspect accepted types and size limit
  media list --project <id> [--cursor <cursor>]
  media show --project <id> --asset <id>
  media upload --project <id> --file <path> [--alt <text>] [--content-type <type>]
  media import-url --project <id> --url <url>
  media finalize --project <id> --intent <id>
  posts create --project <id> --input <file|->
  publications list --project <id> [--cursor <cursor>]
  publications show --project <id> --publication <id>
  publications save --project <id> --publication <id> --input <file|->
  publications promote --project <id> --publication <id> --expected-revision <n> --at <epoch-ms>
  publications schedule --project <id> --publications <id,id,...> --at <epoch-ms>
  publications cancel --project <id> --publications <id,id,...>
  publications retry --project <id> --publication <id>
  publications due --project <id>    List due manual publications
  publications publish --project <id> --publication <id>
  publications reconcile --project <id> --publication <id> --resolution <published|failed>
  audit list --project <id>          List project audit events

Options:
  --timeout-ms <n>                    Per-request deadline (default: 30000)
  --json                             Print structured JSON
  --base-url <url>                   Postdot API URL (default: http://localhost:3000)
  --cookie <value>                   Session cookie for authenticated requests
  --token <value>                    Postdot API key for machine requests
  --projects <id,id,...>             Limit a new API key to selected projects
  --expires-at <epoch-ms>            Expiration for a new token

Environment:
  POSTBOT_URL
  POSTBOT_SESSION_COOKIE
  POSTBOT_API_KEY`)
}

function requireAuthenticated(sessionCookie: string | undefined, apiKey: string | undefined) {
    if (!sessionCookie && !apiKey) {
        throw new CliError(
            'Authentication required. Set POSTBOT_SESSION_COOKIE or POSTBOT_API_KEY, or pass --cookie or --token.'
        )
    }
}

function requireSession(sessionCookie: string | undefined) {
    if (!sessionCookie) {
        throw new CliError(
            'This command requires a human session. Set POSTBOT_SESSION_COOKIE or pass --cookie <value>.'
        )
    }
}

if (import.meta.main) {
    try {
        await runCli()
    } catch (error) {
        const cliError = error instanceof CliError ? error : new CliError('The command failed')
        console.error(
            Bun.argv.includes('--json')
                ? JSON.stringify({
                      error: {
                          code: cliError.code,
                          message: cliError.message,
                          ...(cliError.status === undefined ? {} : { status: cliError.status }),
                          ...(cliError.media === undefined ? {} : { media: cliError.media }),
                      },
                  })
                : `Error: ${cliError.message}${cliError.media ? ` (asset ${cliError.media.assetId}, intent ${cliError.media.intentId ?? 'unknown'})` : ''}`
        )
        process.exitCode = cliError.exitCode
    }
}
