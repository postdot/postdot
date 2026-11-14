import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'

import {
    createPostdotClient,
    type PostdotClient,
    type UserApiKeyCapability,
    type Post,
    type Publication,
    type MediaReservation,
    type MediaUploadPolicy,
    type MediaUrlImport,
} from '@postdot/client'

type CliFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface PostdotCliEnvironment {
    readonly POSTDOT_API_KEY?: string
    readonly POSTDOT_SESSION_COOKIE?: string
    readonly POSTDOT_URL?: string
    readonly POSTDOT_BOOTSTRAP_TOKEN?: string
    readonly POSTDOT_BOOTSTRAP_TOKEN_FILE?: string
    /** Deprecated names still read for scripts written before the Postdot rename. */
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
    cadence?: { confirmation: string; warnings: CadenceWarning[] }

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
    environment: PostdotCliEnvironment = Bun.env as PostdotCliEnvironment,
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
        environment.POSTDOT_URL ??
        environment.POSTBOT_URL ??
        'http://localhost:3000'
    ).replace(/\/$/, '')
    const sessionCookie =
        optionValue(args, '--cookie') ??
        environment.POSTDOT_SESSION_COOKIE ??
        environment.POSTBOT_SESSION_COOKIE
    const apiKey =
        optionValue(args, '--token') ?? environment.POSTDOT_API_KEY ?? environment.POSTBOT_API_KEY
    const client = createPostdotClient(baseURL, {
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
            `Authenticated as ${body.user.email}. Export POSTDOT_SESSION_COOKIE='${cookie}'.`
        )
        return
    }

    if (resource === 'instance' && action === 'status') {
        const body = await typedCall(client.api.instance.status.get())
        write(body, `Setup available: ${body.setupAvailable} (mode: ${body.bootstrapMode}).`)
        return
    }

    if (resource === 'instance' && action === 'bootstrap') {
        const passwordStdin = args.includes('--password-stdin')
        const bootstrapTokenStdin = args.includes('--bootstrap-token-stdin')
        if (passwordStdin && bootstrapTokenStdin) {
            throw new CliError(
                'Cannot read both --password-stdin and --bootstrap-token-stdin from stdin',
                2,
                'invalid_input'
            )
        }
        const bootstrapToken = await resolveCliSecret(
            'bootstrap token',
            optionValue(args, '--bootstrap-token'),
            bootstrapTokenStdin,
            optionValue(args, '--bootstrap-token-file'),
            environment.POSTDOT_BOOTSTRAP_TOKEN,
            environment.POSTDOT_BOOTSTRAP_TOKEN_FILE
        )
        const password = await resolveCliSecret(
            'administrator password',
            optionValue(args, '--password'),
            passwordStdin,
            optionValue(args, '--password-file'),
            undefined,
            undefined
        )
        if (!password) {
            throw new CliError(
                'Provide an administrator password via --password-stdin, --password-file, or --password',
                2,
                'invalid_input'
            )
        }
        const apiKeyActions = parseActionsOption(optionValue(args, '--actions'))
        const apiKeyProjects = optionValue(args, '--projects')
            ? parseProjectIds(optionValue(args, '--projects'))
            : undefined
        const apiKeyExpiresAt = parseExpiresAt(optionValue(args, '--expires-at'))
        const apiKeyName = optionValue(args, '--api-key-name')
        const includeKey =
            args.includes('--issue-api-key') ||
            apiKeyName !== undefined ||
            apiKeyActions !== undefined ||
            apiKeyProjects !== undefined ||
            apiKeyExpiresAt !== undefined
        const body = await typedCall(
            client.api.instance.bootstrap.post(
                {
                    name: requiredOption(args, '--name'),
                    email: requiredOption(args, '--email'),
                    password,
                    ...(includeKey
                        ? {
                              apiKey: {
                                  ...(apiKeyName ? { name: apiKeyName } : {}),
                                  ...(apiKeyProjects ? { projectIds: apiKeyProjects } : {}),
                                  ...(apiKeyActions ? { actionAccess: apiKeyActions } : {}),
                                  ...(apiKeyExpiresAt !== undefined
                                      ? { expiresAt: apiKeyExpiresAt }
                                      : {}),
                              },
                          }
                        : {}),
                },
                bootstrapToken
                    ? { headers: { 'x-postdot-bootstrap-token': bootstrapToken } }
                    : undefined
            )
        )
        write(
            body,
            body.apiKey
                ? `Bootstrapped ${body.user.email}. API key "${body.apiKey.key.name}" issued:\n\n${body.apiKey.token}`
                : `Bootstrapped ${body.user.email}.`
        )
        return
    }

    requireAuthenticated(sessionCookie, apiKey)

    if (resource === 'access') {
        const subAction = args[2]
        if (action === 'summary') {
            const body = await typedCall(client.api.access.get())
            write(
                body,
                `Instance ${body.instance.state}; role=${body.membership?.role ?? 'none'}; admin=${body.isAdmin}.`
            )
            return
        }
        if (action === 'members' && subAction === 'list') {
            const body = await typedCall(client.api.access.members.get())
            write(
                body,
                body.members
                    .map(m => `${m.userId}\t${m.email ?? m.name}\t${m.role}\t${m.state}`)
                    .join('\n')
            )
            return
        }
        if (action === 'members' && subAction === 'create') {
            const password = await resolveCliSecret(
                'member password',
                optionValue(args, '--password'),
                args.includes('--password-stdin'),
                optionValue(args, '--password-file'),
                undefined,
                undefined
            )
            const roleOption = optionValue(args, '--role')
            if (roleOption !== undefined && roleOption !== 'admin' && roleOption !== 'member') {
                throw new CliError('--role must be admin or member', 2, 'invalid_input')
            }
            const apiKeyActions = parseActionsOption(optionValue(args, '--actions'))
            const apiKeyProjects = optionValue(args, '--projects')
                ? parseProjectIds(optionValue(args, '--projects'))
                : undefined
            const apiKeyExpiresAt = parseExpiresAt(optionValue(args, '--expires-at'))
            const apiKeyName = optionValue(args, '--api-key-name')
            const includeKey =
                args.includes('--issue-api-key') ||
                apiKeyName !== undefined ||
                apiKeyActions !== undefined ||
                apiKeyProjects !== undefined ||
                apiKeyExpiresAt !== undefined
            const body = await typedCall(
                client.api.access.members.post({
                    email: requiredOption(args, '--email'),
                    name: requiredOption(args, '--name'),
                    ...(roleOption ? { role: roleOption } : {}),
                    ...(password ? { password } : {}),
                    ...(args.includes('--no-default-workspace')
                        ? { joinDefaultWorkspace: false }
                        : {}),
                    ...(includeKey
                        ? {
                              apiKey: {
                                  ...(apiKeyName ? { name: apiKeyName } : {}),
                                  ...(apiKeyProjects ? { projectIds: apiKeyProjects } : {}),
                                  ...(apiKeyActions ? { actionAccess: apiKeyActions } : {}),
                                  ...(apiKeyExpiresAt !== undefined
                                      ? { expiresAt: apiKeyExpiresAt }
                                      : {}),
                              },
                          }
                        : {}),
                })
            )
            write(
                body,
                body.apiKey
                    ? `Created member ${body.membership.userId}. Token:\n\n${body.apiKey.token}`
                    : `Created member ${body.membership.userId}.`
            )
            return
        }
        if (action === 'members' && subAction === 'update') {
            const role = optionValue(args, '--role') as 'admin' | 'member' | undefined
            const state = optionValue(args, '--state') as 'enabled' | 'disabled' | undefined
            if (role !== undefined && role !== 'admin' && role !== 'member') {
                throw new CliError('--role must be admin or member', 2, 'invalid_input')
            }
            if (state !== undefined && state !== 'enabled' && state !== 'disabled') {
                throw new CliError('--state must be enabled or disabled', 2, 'invalid_input')
            }
            if (!role && !state) {
                throw new CliError('Provide --role and/or --state', 2, 'invalid_input')
            }
            const body = await typedCall(
                client.api.access
                    .members({ userId: requiredOption(args, '--user') })
                    .patch({ ...(role ? { role } : {}), ...(state ? { state } : {}) })
            )
            write(body, `Updated member ${body.membership.userId}.`)
            return
        }
        if (action === 'members' && subAction === 'api-keys') {
            const body = await typedCall(
                client.api.access
                    .members({ userId: requiredOption(args, '--user') })
                    ['api-keys'].get()
            )
            write(body, body.keys.map(k => `${k.id}\t${k.name}\t${k.tokenPrefix}`).join('\n'))
            return
        }
        if (action === 'members' && subAction === 'revoke-key') {
            const keyId = requiredOption(args, '--key')
            const body = await typedCall(
                client.api.access
                    .members({ userId: requiredOption(args, '--user') })
                    ['api-keys']({ keyId })
                    .delete()
            )
            write(body, `Revoked API key ${keyId}.`)
            return
        }
        if (action === 'invitations' && subAction === 'list') {
            const body = await typedCall(client.api.access.invitations.get())
            write(
                body,
                body.invitations
                    .map(inv => `${inv.id}\t${inv.targetEmail}\t${inv.state}`)
                    .join('\n')
            )
            return
        }
        if (action === 'invitations' && subAction === 'create') {
            const expiresAt = parseExpiresAt(optionValue(args, '--expires-at'))
            const body = await typedCall(
                client.api.access.invitations.post({
                    targetEmail: requiredOption(args, '--email'),
                    ...(expiresAt !== undefined ? { expiresAt } : {}),
                })
            )
            write(body, `Created invitation ${body.invitation.id}. Token:\n\n${body.token}`)
            return
        }
        if (action === 'invitations' && subAction === 'revoke') {
            const invitationId = requiredOption(args, '--invitation')
            const headers: Record<string, string> = { accept: 'application/json' }
            if (apiKey) headers.authorization = `Bearer ${apiKey}`
            else if (sessionCookie) headers.cookie = sessionCookie
            const response = await fetcher(
                `${baseURL}/api/access/invitations/${encodeURIComponent(invitationId)}`,
                { method: 'DELETE', headers }
            )
            const body = (await response.json().catch(() => null)) as ErrorResponse | null
            if (!response.ok) {
                throw new CliError(
                    body?.error?.message ?? `Request failed with status ${response.status}`,
                    1,
                    body?.error?.code ?? 'http_error',
                    response.status
                )
            }
            write(body ?? { revoked: true }, `Revoked invitation ${invitationId}.`)
            return
        }
    }

    if (resource === 'settings') {
        const subAction = args[2]
        if (action === 'email' && subAction === 'get') {
            const body = await typedCall(client.api.settings.email.get())
            write(body, JSON.stringify(body, null, 2))
            return
        }
        if (action === 'email' && subAction === 'save') {
            const inputPath = requiredOption(args, '--input')
            const passwordStdin = args.includes('--password-stdin')
            if (inputPath === '-' && passwordStdin) {
                throw new CliError(
                    'Cannot read both --input and --password-stdin from stdin',
                    2,
                    'invalid_input'
                )
            }
            type EmailPutInput = Parameters<PostdotClient['api']['settings']['email']['put']>[0]
            const payload = await readJsonInput<EmailPutInput>(args, dependencies)
            const password = await resolveCliSecret(
                'SMTP password',
                undefined,
                passwordStdin,
                optionValue(args, '--password-file'),
                undefined,
                undefined
            )
            const body = await typedCall(
                client.api.settings.email.put(
                    password !== undefined ? { ...payload, password } : payload
                )
            )
            write(body, 'Email settings saved.')
            return
        }
        if (action === 'email' && subAction === 'test') {
            const body = await typedCall(client.api.settings.email.test.post())
            write(body, 'Test email dispatched.')
            return
        }
        if (action === 'recovery' && subAction === 'get') {
            const body = await typedCall(client.api.settings.recovery.get())
            write(body, JSON.stringify(body, null, 2))
            return
        }
        if (action === 'recovery' && subAction === 'resume') {
            if (!args.includes('--confirm')) {
                throw new CliError('Pass --confirm to resume after restore', 2, 'invalid_input')
            }
            const body = await typedCall(
                client.api.settings.recovery.resume.post({
                    token: optionValue(args, '--recovery-token') ?? requiredOption(args, '--token'),
                    confirm: true,
                })
            )
            write(body, 'Restore recovery hold cleared.')
            return
        }
        if (action === 'provider-applications' && subAction === 'list') {
            const body = await typedCall(client.api.settings['provider-applications'].get())
            write(body, JSON.stringify(body, null, 2))
            return
        }
        if (action === 'provider-applications' && subAction === 'create') {
            type AppPostInput = Parameters<
                PostdotClient['api']['settings']['provider-applications']['post']
            >[0]
            const body = await typedCall(
                client.api.settings['provider-applications'].post(
                    await readJsonInput<AppPostInput>(args, dependencies)
                )
            )
            write(body, `Created provider application ${body.application.id}.`)
            return
        }
        if (action === 'provider-applications' && subAction === 'update') {
            type AppPatchInput = Parameters<
                ReturnType<PostdotClient['api']['settings']['provider-applications']>['patch']
            >[0]
            const body = await typedCall(
                client.api.settings['provider-applications']({
                    applicationId: requiredOption(args, '--application'),
                }).patch(await readJsonInput<AppPatchInput>(args, dependencies))
            )
            write(body, `Updated provider application ${body.application.id}.`)
            return
        }
    }

    if (resource === 'workspaces' && action === 'list') {
        const body = await typedCall(client.api.workspaces.get())
        write(body, body.workspaces.map(w => `${w.id}\t${w.name}`).join('\n'))
        return
    }

    if (resource === 'workspaces' && action === 'show') {
        const body = await typedCall(
            client.api.workspaces({ workspaceId: requiredOption(args, '--workspace') }).get()
        )
        write(body, JSON.stringify(body, null, 2))
        return
    }

    if (resource === 'workspaces' && action === 'create') {
        const body = await typedCall(
            client.api.workspaces.post({ name: requiredOption(args, '--name') })
        )
        write(body, `Created workspace ${body.workspace.id}.`)
        return
    }

    if (
        (resource === 'projects' || resource === 'workspaces') &&
        ['impact', 'archive', 'restore', 'delete'].includes(action ?? '')
    ) {
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
        const body = await call(
            client.api.projects.post({
                name: requiredOption(args, '--name'),
                workspaceId: optionValue(args, '--workspace'),
            })
        )
        write(body, 'Project created.')
        return
    }

    if (resource === 'api-keys' && action === 'list') {
        const body = await call<{ keys: UserApiKey[] }>(client.api['api-keys'].get())
        write(body, body.keys.map(formatUserApiKey).join('\n'))
        return
    }

    if (resource === 'api-keys' && action === 'create') {
        const expiresAt = parseExpiresAt(optionValue(args, '--expires-at'))
        const projectIds = args.includes('--all-projects')
            ? null
            : parseProjectIds(optionValue(args, '--projects'))
        if (args.includes('--all-projects') && optionValue(args, '--projects') !== undefined) {
            throw new CliError('Use either --projects or --all-projects, not both', 2)
        }
        const actions = parseActionsOption(optionValue(args, '--actions'))
        const allActions = args.includes('--all-actions')
        if (actions !== undefined && allActions) {
            throw new CliError('Use either --actions or --all-actions, not both', 2)
        }
        const body = await call<CreatedUserApiKey>(
            client.api['api-keys'].post({
                ...(optionValue(args, '--name') === undefined
                    ? {}
                    : { name: optionValue(args, '--name') }),
                projectIds,
                ...(actions !== undefined
                    ? { actionAccess: actions }
                    : allActions
                      ? { actionAccess: null }
                      : {}),
                ...(expiresAt === undefined ? {} : { expiresAt }),
            })
        )
        write(
            body,
            `Created API key "${body.key.name}". Copy it now; it will not be shown again:\n\n${body.token}`
        )
        return
    }

    if (resource === 'api-keys' && action === 'update') {
        const keyId = requiredOption(args, '--key-id')
        const name = optionValue(args, '--name')
        const projectsArg = optionValue(args, '--projects')
        const allProjects = args.includes('--all-projects')
        if (allProjects && projectsArg !== undefined) {
            throw new CliError('Use either --projects or --all-projects, not both', 2)
        }
        const actions = parseActionsOption(optionValue(args, '--actions'))
        const allActions = args.includes('--all-actions')
        if (actions !== undefined && allActions) {
            throw new CliError('Use either --actions or --all-actions, not both', 2)
        }
        const expiresAt = parseExpiresAt(optionValue(args, '--expires-at'))
        const noExpiry = args.includes('--no-expiry')
        if (expiresAt !== undefined && noExpiry) {
            throw new CliError('Use either --expires-at or --no-expiry, not both', 2)
        }
        type ApiKeyPatch = NonNullable<
            Parameters<ReturnType<PostdotClient['api']['api-keys']>['patch']>[0]
        >
        const patch: ApiKeyPatch = {
            ...(name !== undefined ? { name } : {}),
            ...(projectsArg !== undefined
                ? { projectIds: parseProjectIds(projectsArg) }
                : allProjects
                  ? { projectIds: null }
                  : {}),
            ...(actions !== undefined
                ? { actionAccess: actions }
                : allActions
                  ? { actionAccess: null }
                  : {}),
            ...(expiresAt !== undefined ? { expiresAt } : noExpiry ? { expiresAt: null } : {}),
        }
        if (Object.keys(patch).length === 0) {
            throw new CliError('Specify at least one field to update', 2, 'invalid_input')
        }
        const body = await typedCall(client.api['api-keys']({ keyId }).patch(patch))
        write(body, `Updated API key ${body.key.id}.`)
        return
    }

    if (resource === 'api-keys' && action === 'revoke') {
        const keyId = requiredOption(args, '--key-id')
        const body = await call<{ deleted: true }>(client.api['api-keys']({ keyId }).delete())
        write(body, 'API key revoked.')
        return
    }

    if (resource === 'channels' && action === 'list') {
        const context = channelContext(args)
        if (context.kind === 'workspace') {
            const body = await call(
                client.api.workspaces({ workspaceId: context.id }).channels.get({
                    query: { includeArchived: args.includes('--include-archived') },
                })
            )
            write(body, JSON.stringify(body, null, 2))
        } else {
            const body = await call<{ channels: Array<{ id: string; name: string }> }>(
                client.api.projects({ projectId: context.id }).channels.get()
            )
            write(body, body.channels.map(channel => `${channel.id}\t${channel.name}`).join('\n'))
        }
        return
    }

    if (resource === 'channels' && action === 'sharing') {
        const result = await call(
            client.api
                .projects({ projectId: requiredOption(args, '--project') })
                .channels({ channelId: requiredOption(args, '--channel') })
                .sharing.get()
        )
        write(result, JSON.stringify(result, null, 2))
        return
    }

    if (resource === 'channels' && action === 'occupancy') {
        const from = integerOption(args, '--from', 0)
        const to = integerOption(args, '--to', 1)
        if (to <= from) throw new CliError('--to must be later than --from', 2, 'invalid_input')
        const result = await call(
            client.api
                .projects({ projectId: requiredOption(args, '--project') })
                ['channel-occupancy'].get({ query: { from, to } })
        )
        write(result, JSON.stringify(result, null, 2))
        return
    }

    if (
        resource === 'channels' &&
        ['attach', 'withdraw', 'transfer', 'cadence', 'configure-cadence'].includes(action ?? '')
    ) {
        const context = channelContext(args)
        const channelId = requiredOption(args, '--channel')
        const route =
            context.kind === 'workspace'
                ? client.api.workspaces({ workspaceId: context.id }).channels({ channelId })
                : client.api.projects({ projectId: context.id }).channels({ channelId })
        let result: unknown
        if (action === 'cadence') {
            result = await call(route.cadence.get())
        } else if (action === 'configure-cadence') {
            result = await call(
                route.cadence.put(await readJsonInput<ConfigureCadenceInput>(args, dependencies))
            )
        } else {
            const expectedRevision = integerOption(args, '--expected-revision', 1)
            const projectId = requiredOption(args, '--target-project')
            if (action === 'attach')
                result = await call(route.attachments.post({ projectId, expectedRevision }))
            else if (action === 'transfer')
                result = await call(route.management.post({ projectId, expectedRevision }))
            else {
                const lastAttachment = args.includes('--archive-last')
                    ? ('archive' as const)
                    : undefined
                result =
                    context.kind === 'workspace'
                        ? await call(
                              client.api
                                  .workspaces({ workspaceId: context.id })
                                  .channels({ channelId })
                                  .withdraw.post({ projectId, expectedRevision, lastAttachment })
                          )
                        : await call(
                              client.api
                                  .projects({ projectId: context.id })
                                  .channels({ channelId })
                                  .attachments({ attachedProjectId: projectId })
                                  .withdraw.post({ expectedRevision, lastAttachment })
                          )
            }
        }
        write(result, JSON.stringify(result, null, 2))
        return
    }

    if (
        resource === 'publications' &&
        ['move', 'cadence', 'override-cadence'].includes(action ?? '')
    ) {
        const route = client.api
            .projects({ projectId: requiredOption(args, '--project') })
            .publications({ publicationId: requiredOption(args, '--publication') })
        const result =
            action === 'move'
                ? await call(
                      route.move.post(await readJsonInput<MovePublicationInput>(args, dependencies))
                  )
                : action === 'cadence'
                  ? await call(route.cadence.get(), true)
                  : await call(
                        route['cadence-override'].post({
                            confirmation: requiredOption(args, '--confirmation'),
                        }),
                        true
                    )
        write(result, JSON.stringify(result, null, 2))
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
                    cadenceConfirmation: optionValue(args, '--cadence-confirmation'),
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
                          cadenceConfirmation: optionValue(args, '--cadence-confirmation'),
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
            client.api
                .projects({ projectId })
                .publications({ publicationId })
                .retry.post({ cadenceConfirmation: optionValue(args, '--cadence-confirmation') })
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

type ProjectRoutes = ReturnType<PostdotClient['api']['projects']>
type PublicationRoutes = ReturnType<ProjectRoutes['publications']>
type CreatePostInput = Parameters<ProjectRoutes['posts']['post']>[0]
type SaveDraftInput = Parameters<PublicationRoutes['draft']['patch']>[0]
type MovePublicationInput = Parameters<PublicationRoutes['move']['post']>[0]
type ConfigureCadenceInput = Parameters<ReturnType<ProjectRoutes['channels']>['cadence']['put']>[0]

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

function typedCall<T, E>(
    request: Promise<{ data: T; error: E; status: number; response?: Response }>,
    nullable?: false
): Promise<NonNullable<T>>
function typedCall<T, E>(
    request: Promise<{ data: T; error: E; status: number; response?: Response }>,
    nullable: true
): Promise<NonNullable<T> | null>
async function typedCall<T, E>(
    request: Promise<{ data: T; error: E; status: number; response?: Response }>,
    nullable = false
) {
    return call<NonNullable<T>>(
        request as Promise<{ data: unknown; error: unknown; status: number; response?: Response }>,
        nullable
    )
}

async function call<T>(
    request: Promise<{ data: unknown; error: unknown; status: number; response?: Response }>,
    nullable = false
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
        const failure = new CliError(
            errorMessage(result.error) ?? `Request failed with status ${result.status}`,
            1,
            errorCode(result.error) ?? 'http_error',
            result.status
        )
        failure.cadence = cadenceDetails(result.error)
        throw failure
    }
    // Elysia's nullable timing route can serialize absence as an empty 200 body.
    if (nullable && (result.data === null || result.data === undefined || result.data === ''))
        return null as T
    if (result.data === null || result.data === undefined) throw new CliError('Empty API response')
    return result.data as T
}

interface CadenceWarning {
    channelId: string
    rule: 'daily_max' | 'weekly_max'
    period: string
    maximum: number
    count: number
}

function cadenceDetails(value: unknown): CliError['cadence'] {
    if (!value || typeof value !== 'object' || !('value' in value)) return undefined
    const body = value.value
    if (!body || typeof body !== 'object' || !('error' in body)) return undefined
    const error = body.error
    if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'cadence_conflict' ||
        !('confirmation' in error) ||
        typeof error.confirmation !== 'string' ||
        !/^[a-f0-9]{64}$/.test(error.confirmation) ||
        !('warnings' in error) ||
        !Array.isArray(error.warnings)
    )
        return undefined
    const warnings: CadenceWarning[] = []
    for (const warning of error.warnings) {
        if (
            !warning ||
            typeof warning !== 'object' ||
            typeof warning.channelId !== 'string' ||
            !['daily_max', 'weekly_max'].includes(warning.rule) ||
            !(
                typeof warning.period === 'string' ||
                (warning.period instanceof Date && Number.isFinite(warning.period.getTime()))
            ) ||
            !Number.isSafeInteger(warning.maximum) ||
            !Number.isSafeInteger(warning.count)
        )
            return undefined
        warnings.push({
            channelId: warning.channelId,
            rule: warning.rule,
            // Treaty parses YYYY-MM-DD strings as dates; retain the civil period.
            period:
                warning.period instanceof Date
                    ? warning.period.toISOString().slice(0, 10)
                    : warning.period,
            maximum: warning.maximum,
            count: warning.count,
        })
    }
    return { confirmation: error.confirmation, warnings }
}

function channelContext(args: readonly string[]): { kind: 'project' | 'workspace'; id: string } {
    const project = optionValue(args, '--project')
    const workspace = optionValue(args, '--workspace')
    if (Boolean(project) === Boolean(workspace))
        throw new CliError('Choose exactly one of --project or --workspace', 2, 'invalid_input')
    return workspace ? { kind: 'workspace', id: workspace } : { kind: 'project', id: project! }
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

const allCapabilities = [
    'project:read',
    'project:manage',
    'project:permanently_delete',
    'publication:manage',
    'publication:dispatch',
    'channel:manage',
    'channel:share',
    'media:manage',
    'analytics:refresh',
    'media:permanently_delete',
    'project:access_manage',
    'publication:approve',
    'workspace:manage',
    'api_key:manage',
    'instance:admin',
] as const satisfies readonly UserApiKeyCapability[]

const capabilitySet = new Set<string>(allCapabilities)

function parseActionsOption(value: string | undefined): UserApiKeyCapability[] | undefined {
    if (value === undefined) return undefined
    const items = [
        ...new Set(
            value
                .split(',')
                .map(item => item.trim())
                .filter(item => item.length > 0)
        ),
    ]
    if (items.length === 0) {
        throw new CliError('--actions must contain at least one capability', 2, 'invalid_input')
    }
    for (const item of items) {
        if (!capabilitySet.has(item)) {
            throw new CliError(
                `Unknown capability "${item}". Valid capabilities: ${allCapabilities.join(', ')}`,
                2,
                'invalid_input'
            )
        }
    }
    return items as UserApiKeyCapability[]
}

const maximumSecretBytes = 16_384

async function readSecretStream(label: string): Promise<string> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of process.stdin) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += bytes.length
        if (size > maximumSecretBytes) {
            throw new CliError(`The ${label} exceeds 16 KiB`, 2, 'invalid_input')
        }
        chunks.push(bytes)
    }
    const text = Buffer.concat(chunks).toString('utf8').trim()
    if (!text) throw new CliError(`The ${label} from stdin was empty`, 2, 'invalid_input')
    return text
}

function readSecretFile(path: string, label: string): string {
    let descriptor: number | undefined
    try {
        const info = lstatSync(path)
        if (!info.isFile() || info.isSymbolicLink() || info.size > maximumSecretBytes) {
            throw new Error('Invalid file')
        }
        descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
        const opened = fstatSync(descriptor)
        if (!opened.isFile() || opened.size > maximumSecretBytes) throw new Error('Invalid file')
        const value = readFileSync(descriptor, 'utf8').trim()
        if (!value) throw new Error('Empty secret')
        return value
    } catch {
        throw new CliError(
            `Cannot read a non-empty ${label} file (maximum 16 KiB)`,
            2,
            'invalid_input'
        )
    } finally {
        if (descriptor !== undefined) closeSync(descriptor)
    }
}

async function resolveCliSecret(
    label: string,
    directValue: string | undefined,
    fromStdin: boolean,
    filePath: string | undefined,
    envValue: string | undefined,
    envFilePath: string | undefined
): Promise<string | undefined> {
    const sources = [directValue !== undefined, fromStdin, filePath !== undefined].filter(
        Boolean
    ).length
    if (sources > 1) {
        throw new CliError(
            `Specify at most one direct, file, or stdin option for ${label}`,
            2,
            'invalid_input'
        )
    }
    if (directValue !== undefined) {
        const trimmed = directValue.trim()
        if (!trimmed) throw new CliError(`The ${label} must not be empty`, 2, 'invalid_input')
        return trimmed
    }
    if (fromStdin) return readSecretStream(label)
    if (filePath !== undefined) return readSecretFile(filePath, label)
    if (envValue !== undefined && envValue.trim().length > 0) return envValue.trim()
    if (envFilePath !== undefined && envFilePath.trim().length > 0) {
        return readSecretFile(envFilePath.trim(), label)
    }
    return undefined
}

function printCliHelp(output: (message: string) => void) {
    output(`Postdot CLI

Usage:
  bun run postdot <resource> <action> [options]

Resources:
  auth login                         Sign in and print a session cookie
  instance status                    Inspect public installation bootstrap readiness
  instance bootstrap --name <name> --email <email> (--password-stdin|--password-file <path>|--password <pw>)
    [--bootstrap-token <token>|--bootstrap-token-stdin|--bootstrap-token-file <path>]
    [--issue-api-key] [--api-key-name <name>] [--projects <ids>] [--actions <caps>] [--expires-at <epoch-ms>]
  access summary                     Inspect instance membership and admin status
  access members list                List instance members
  access members create --email <email> --name <name> [--role admin|member]
    [--password <pw>|--password-stdin|--password-file <path>] [--no-default-workspace]
    [--issue-api-key] [--api-key-name <name>] [--projects <ids>] [--actions <caps>] [--expires-at <epoch-ms>]
  access members update --user <id> [--role admin|member] [--state enabled|disabled]
  access members api-keys --user <id>
  access members revoke-key --user <id> --key <id>
  access invitations list
  access invitations create --email <email> [--expires-at <epoch-ms>]
  access invitations revoke --invitation <id>
  projects list [--include-archived] List projects
  projects impact --project <id>      Preview archive/delete impact
  projects archive|restore|delete --project <id> --fingerprint <value>
    [--cancel-pending] [--confirm-name <name>] [--acknowledge-uncertain]
  workspaces list                    List accessible workspaces
  workspaces show --workspace <id>   Inspect workspace details, members and teams
  workspaces create --name <name>    Create a workspace
  workspaces impact --workspace <id>  Preview combined workspace impact
  workspaces archive|restore|delete --workspace <id> --fingerprint <value>
    [--cancel-pending] [--confirm-name <name>] [--replacement-workspace <id>]
  projects create --name <name> [--workspace <id>] Create a project
  api-keys list                      List your API keys
  api-keys create [--name <name>] [--projects <ids>|--all-projects] [--actions <caps>|--all-actions] [--expires-at <epoch-ms>]
                                    Create a user-owned API key
  api-keys update --key-id <id> [--name <name>] [--projects <ids>|--all-projects] [--actions <caps>|--all-actions] [--expires-at <epoch-ms>|--no-expiry]
                                    Update a user-owned API key
  api-keys revoke --key-id <id>      Revoke one of your API keys
  settings email get|save|test       Inspect, save (--input <file|-> [--password-stdin|--password-file <path>]) or test SMTP
  settings recovery get|resume       Inspect or clear post-restore hold (--recovery-token <token> --confirm)
  settings provider-applications list|create|update
                                    Manage OAuth provider apps (--input <file|->, --application <id>)
  publishers list --project <id>     Inspect connections and OAuth configuration
  channels list (--project <id> | --workspace <id>) [--include-archived]
                                    List scoped channels; archived inspection uses --workspace
  channels sharing --project <id> --channel <id>
                                    Inspect sharing, revision and eligible projects
  channels attach|withdraw|transfer (--project <id> | --workspace <id>)
    --channel <id> --target-project <id> --expected-revision <n> [--archive-last]
                                    Change use/management explicitly; withdrawal preserves history
  channels cadence|configure-cadence (--project <id> | --workspace <id>)
    --channel <id> [--input <file|->]
                                    Read rules or configure with expectedRevision and nullable limits
  channels occupancy --project <id> --from <epoch-ms> --to <epoch-ms>
                                    Read scoped activity; other projects may be anonymous
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
  publications move --project <id> --publication <id> --input <file|->
                                    Submit destination, mode and expected revisions from show/profile
  publications cadence --project <id> --publication <id>
                                    Inspect timing and current override confirmation
  publications override-cadence --project <id> --publication <id> --confirmation <value>
                                    Override one minimum interval; provider limits still apply
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
  --cadence-confirmation <value>      Explicit planning exception for promote/schedule/retry
                                    For posts create/move, put cadenceConfirmation in --input
  --archive-last                     Explicitly archive when withdrawing the final attachment
  --timeout-ms <n>                    Per-request deadline (default: 30000)
  --json                             Print structured JSON
  --base-url <url>                   Postdot API URL (default: http://localhost:3000)
  --cookie <value>                   Session cookie for authenticated requests
  --token <value>                    Postdot API key for machine requests
  --projects <id,id,...>             Limit a new API key to selected projects
  --all-projects                     Grant API key access across all accessible projects
  --actions <cap,cap,...>            Limit an API key to selected capabilities
  --all-actions                      Allow all capabilities permitted for the caller
  --expires-at <epoch-ms>            Expiration for a new token or invitation
  --no-expiry                        Clear expiration when updating an API key

Sharing grants publication use, not connection management. Attached projects can see
anonymous occupied times. Inspect before writing; stale revisions require review.
Cadence conflicts exit without retry and return confirmation/warnings in --json.
Cadence input: {expectedRevision,timeZone?,dailyMax,weeklyMax,minimumIntervalMs}.
Move input: {targetChannelId,deliveryMode,expectedPublicationUpdatedAt,
  expectedDraftRevision,expectedSourceRevision,expectedTargetRevisionId,
  expectedScheduledAt,expectedTargetProfileVersionId,cadenceConfirmation?}.
Incompatible moved content remains an unscheduled review draft; requested time is retained.

Environment:
  POSTDOT_URL
  POSTDOT_SESSION_COOKIE
  POSTDOT_API_KEY
  POSTDOT_BOOTSTRAP_TOKEN
  POSTDOT_BOOTSTRAP_TOKEN_FILE`)
}

function requireAuthenticated(sessionCookie: string | undefined, apiKey: string | undefined) {
    if (!sessionCookie && !apiKey) {
        throw new CliError(
            'Authentication required. Set POSTDOT_SESSION_COOKIE or POSTDOT_API_KEY, or pass --cookie or --token.'
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
                          ...(cliError.cadence === undefined ? {} : cliError.cadence),
                      },
                  })
                : `Error: ${cliError.message}${cliError.media ? ` (asset ${cliError.media.assetId}, intent ${cliError.media.intentId ?? 'unknown'})` : ''}${cliError.cadence ? `\nCadence warnings: ${JSON.stringify(cliError.cadence.warnings)}\nConfirmation: ${cliError.cadence.confirmation}\nReview these warnings, then resubmit the same operation with this cadence confirmation.` : ''}`
        )
        process.exitCode = cliError.exitCode
    }
}
