import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs'

import type { PostdotClient, UserApiKeyCapability } from '@postdot/client'
import { InvalidArgumentError, Option, type Command } from 'commander'

import { resolveConnection } from './configuration'
import { CliError, connection, output, publicClient, result, type Options } from './context'
import { commaSeparatedIds, nonnegativeInteger, readJsonObject } from './input'

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

function parseCapabilities(value: string): UserApiKeyCapability[] {
    const items = [...new Set(commaSeparatedIds(value))]
    for (const item of items) {
        if (!capabilitySet.has(item)) {
            throw new InvalidArgumentError(
                `Unknown capability "${item}". Valid capabilities: ${allCapabilities.join(', ')}`
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
        if (size > maximumSecretBytes)
            throw new CliError(`The ${label} exceeds 16 KiB.`, 'invalid_input', 2)
        chunks.push(bytes)
    }
    const text = Buffer.concat(chunks).toString('utf8').trim()
    if (!text) throw new CliError(`The ${label} from stdin was empty.`, 'invalid_input', 2)
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
            `Cannot read a non-empty ${label} file (maximum 16 KiB).`,
            'invalid_input',
            2
        )
    } finally {
        if (descriptor !== undefined) closeSync(descriptor)
    }
}

async function resolveOptionalSecret(
    label: string,
    directValue: string | undefined,
    fromStdin: boolean | undefined,
    filePath: string | undefined,
    envValue: string | undefined,
    envFilePath: string | undefined
): Promise<{ value?: string; usedStdin: boolean }> {
    const sources = [directValue !== undefined, Boolean(fromStdin), filePath !== undefined].filter(
        Boolean
    ).length
    if (sources > 1) {
        throw new CliError(
            `Specify at most one direct, file, or stdin option for ${label}.`,
            'invalid_input',
            2
        )
    }
    if (directValue !== undefined) {
        const trimmed = directValue.trim()
        if (!trimmed) throw new CliError(`The ${label} must not be empty.`, 'invalid_input', 2)
        return { value: trimmed, usedStdin: false }
    }
    if (fromStdin) return { value: await readSecretStream(label), usedStdin: true }
    if (filePath !== undefined) return { value: readSecretFile(filePath, label), usedStdin: false }
    if (envValue !== undefined && envValue.trim().length > 0)
        return { value: envValue.trim(), usedStdin: false }
    if (envFilePath !== undefined && envFilePath.trim().length > 0)
        return { value: readSecretFile(envFilePath.trim(), label), usedStdin: false }
    return { value: undefined, usedStdin: false }
}

export function registerAdminCommands(program: Command) {
    // --- Instance readiness and token-gated bootstrap ---
    const instance = program
        .command('instance')
        .description('Inspect installation readiness and bootstrap an unclaimed instance.')

    instance
        .command('status')
        .description('Inspect public installation bootstrap readiness.')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const body = await result(publicClient(options).api.instance.status.get())
            output(
                body,
                `Setup available: ${body.setupAvailable} (mode: ${body.bootstrapMode}).`,
                options
            )
        })

    instance
        .command('bootstrap')
        .description('Claim an unclaimed instance and optionally issue an initial API key.')
        .requiredOption('--name <name>', 'Initial administrator display name')
        .requiredOption('--email <email>', 'Initial administrator email address')
        .option('--password <password>', 'Initial administrator password (avoid shared shells)')
        .option('--password-stdin', 'Read the initial administrator password from stdin')
        .option('--password-file <path>', 'Read the initial administrator password from a file')
        .option('--bootstrap-token <token>', 'One-time bootstrap token')
        .option('--bootstrap-token-stdin', 'Read the bootstrap token from stdin')
        .option('--bootstrap-token-file <path>', 'Read the bootstrap token from a file')
        .option('--issue-api-key', 'Mint an initial API key in the same bootstrap transaction')
        .option('--api-key-name <name>', 'Name for the minted API key')
        .option(
            '--projects <ids>',
            'Comma-separated project IDs for the minted key (default: all projects)',
            commaSeparatedIds
        )
        .option(
            '--actions <capabilities>',
            'Comma-separated capabilities for the minted key (default: all capabilities)',
            parseCapabilities
        )
        .option(
            '--expires-at <epochMs>',
            'Expiration epoch timestamp in milliseconds for the minted key',
            nonnegativeInteger
        )
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<
                Options & {
                    name: string
                    email: string
                    password?: string
                    passwordStdin?: boolean
                    passwordFile?: string
                    bootstrapToken?: string
                    bootstrapTokenStdin?: boolean
                    bootstrapTokenFile?: string
                    issueApiKey?: boolean
                    apiKeyName?: string
                    projects?: string[]
                    actions?: UserApiKeyCapability[]
                    expiresAt?: number
                }
            >()
            if (options.passwordStdin && options.bootstrapTokenStdin) {
                throw new CliError(
                    'Cannot read both password and bootstrap token from stdin; provide one via file or environment.',
                    'invalid_input',
                    2
                )
            }
            const bootstrapSecret = await resolveOptionalSecret(
                'bootstrap token',
                options.bootstrapToken,
                options.bootstrapTokenStdin,
                options.bootstrapTokenFile,
                process.env.POSTDOT_BOOTSTRAP_TOKEN,
                process.env.POSTDOT_BOOTSTRAP_TOKEN_FILE
            )
            const passwordSecret = await resolveOptionalSecret(
                'administrator password',
                options.password,
                options.passwordStdin,
                options.passwordFile,
                undefined,
                undefined
            )
            if (!passwordSecret.value) {
                throw new CliError(
                    'Provide an administrator password via --password-stdin, --password-file, or --password.',
                    'invalid_input',
                    2
                )
            }
            const headers = bootstrapSecret.value
                ? { 'x-postdot-bootstrap-token': bootstrapSecret.value }
                : undefined
            const includeKey =
                Boolean(options.issueApiKey) ||
                options.apiKeyName !== undefined ||
                options.projects !== undefined ||
                options.actions !== undefined ||
                options.expiresAt !== undefined
            const body = await result(
                publicClient(options).api.instance.bootstrap.post(
                    {
                        name: options.name,
                        email: options.email,
                        password: passwordSecret.value,
                        ...(includeKey
                            ? {
                                  apiKey: {
                                      ...(options.apiKeyName ? { name: options.apiKeyName } : {}),
                                      ...(options.projects ? { projectIds: options.projects } : {}),
                                      ...(options.actions ? { actionAccess: options.actions } : {}),
                                      ...(options.expiresAt !== undefined
                                          ? { expiresAt: options.expiresAt }
                                          : {}),
                                  },
                              }
                            : {}),
                    },
                    headers ? { headers } : undefined
                )
            )
            const human = body.apiKey
                ? `Bootstrapped ${body.user.email}. API key "${body.apiKey.key.name}" issued (shown once):\n\n${body.apiKey.token}`
                : `Bootstrapped ${body.user.email}.`
            output(body, human, options)
        })

    // --- Access summary, members, invitations ---
    const access = program
        .command('access')
        .description('Inspect and administer instance membership and invitations.')

    access
        .command('summary')
        .description('Inspect the calling user instance membership and admin status.')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const body = await result(connection(options).api.access.get())
            output(
                body,
                `Instance ${body.instance.state}; role=${body.membership?.role ?? 'none'}; admin=${body.isAdmin}.`,
                options
            )
        })

    const accessMembers = access.command('members').description('Manage instance members.')
    accessMembers
        .command('list')
        .description('List instance members.')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const body = await result(connection(options).api.access.members.get())
            output(
                body,
                body.members
                    .map(
                        member =>
                            `${member.userId}\t${member.email ?? member.name ?? '-'}\t${member.role}\t${member.state}`
                    )
                    .join('\n') || 'No members.',
                options
            )
        })
    accessMembers
        .command('create')
        .description(
            'Provision an enabled user or agent account directly, optionally minting an initial API key.'
        )
        .requiredOption('--email <email>', 'Member or service account email address')
        .requiredOption('--name <name>', 'Display name')
        .addOption(new Option('--role <role>', 'Instance role').choices(['admin', 'member']))
        .option('--password <password>', 'Optional initial password')
        .option('--password-stdin', 'Read optional initial password from stdin')
        .option('--password-file <path>', 'Read optional initial password from a file')
        .option('--no-default-workspace', 'Do not attach the user to the default workspace')
        .option('--issue-api-key', 'Mint an initial API key for the created account')
        .option('--api-key-name <name>', 'Name for the minted API key')
        .option('--projects <ids>', 'Comma-separated project IDs for the key', commaSeparatedIds)
        .option(
            '--actions <capabilities>',
            'Comma-separated capabilities for the key',
            parseCapabilities
        )
        .option(
            '--expires-at <epochMs>',
            'Expiration timestamp in milliseconds',
            nonnegativeInteger
        )
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<
                Options & {
                    email: string
                    name: string
                    role?: 'admin' | 'member'
                    password?: string
                    passwordStdin?: boolean
                    passwordFile?: string
                    defaultWorkspace?: boolean
                    issueApiKey?: boolean
                    apiKeyName?: string
                    projects?: string[]
                    actions?: UserApiKeyCapability[]
                    expiresAt?: number
                }
            >()
            const passwordSecret = await resolveOptionalSecret(
                'member password',
                options.password,
                options.passwordStdin,
                options.passwordFile,
                undefined,
                undefined
            )
            const includeKey =
                Boolean(options.issueApiKey) ||
                options.apiKeyName !== undefined ||
                options.projects !== undefined ||
                options.actions !== undefined ||
                options.expiresAt !== undefined
            const body = await result(
                connection(options).api.access.members.post({
                    email: options.email,
                    name: options.name,
                    ...(options.role ? { role: options.role } : {}),
                    ...(passwordSecret.value ? { password: passwordSecret.value } : {}),
                    ...(options.defaultWorkspace === false ? { joinDefaultWorkspace: false } : {}),
                    ...(includeKey
                        ? {
                              apiKey: {
                                  ...(options.apiKeyName ? { name: options.apiKeyName } : {}),
                                  ...(options.projects ? { projectIds: options.projects } : {}),
                                  ...(options.actions ? { actionAccess: options.actions } : {}),
                                  ...(options.expiresAt !== undefined
                                      ? { expiresAt: options.expiresAt }
                                      : {}),
                              },
                          }
                        : {}),
                })
            )
            const human = body.apiKey
                ? `Created member ${body.membership.userId} (${body.membership.role}). API key "${body.apiKey.key.name}" issued (shown once):\n\n${body.apiKey.token}`
                : `Created member ${body.membership.userId} (${body.membership.role}).`
            output(body, human, options)
        })
    accessMembers
        .command('update')
        .description('Update an instance member role or enabled state.')
        .requiredOption('--user <id>', 'Target user identifier')
        .addOption(new Option('--role <role>', 'New instance role').choices(['admin', 'member']))
        .addOption(
            new Option('--state <state>', 'New account state').choices(['enabled', 'disabled'])
        )
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<
                Options & {
                    user: string
                    role?: 'admin' | 'member'
                    state?: 'enabled' | 'disabled'
                }
            >()
            if (options.role === undefined && options.state === undefined) {
                throw new CliError('Provide --role and/or --state to update.', 'invalid_input', 2)
            }
            const body = await result(
                connection(options)
                    .api.access.members({ userId: options.user })
                    .patch({
                        ...(options.role ? { role: options.role } : {}),
                        ...(options.state ? { state: options.state } : {}),
                    })
            )
            output(
                body,
                `Updated member ${body.membership.userId}: role=${body.membership.role}, state=${body.membership.state}.`,
                options
            )
        })
    accessMembers
        .command('api-keys')
        .description('List API keys owned by an instance member.')
        .requiredOption('--user <id>', 'Target user identifier')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options & { user: string }>()
            const body = await result(
                connection(options).api.access.members({ userId: options.user })['api-keys'].get()
            )
            output(
                body,
                body.keys.map(k => `${k.id}\t${k.name}\t${k.tokenPrefix}`).join('\n') ||
                    'No API keys.',
                options
            )
        })
    accessMembers
        .command('revoke-key')
        .description('Revoke an API key belonging to an instance member.')
        .requiredOption('--user <id>', 'Target user identifier')
        .requiredOption('--key <id>', 'API key identifier')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options & { user: string; key: string }>()
            const body = await result(
                connection(options)
                    .api.access.members({ userId: options.user })
                    ['api-keys']({ keyId: options.key })
                    .delete()
            )
            output(body, `Revoked API key ${options.key}.`, options)
        })

    const accessInvitations = access
        .command('invitations')
        .description('Manage instance invitations.')
    accessInvitations
        .command('list')
        .description('List instance invitations.')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const body = await result(connection(options).api.access.invitations.get())
            output(
                body,
                body.invitations
                    .map(inv => `${inv.id}\t${inv.targetEmail}\t${inv.state}`)
                    .join('\n') || 'No invitations.',
                options
            )
        })
    accessInvitations
        .command('create')
        .description('Create an instance invitation.')
        .requiredOption('--email <email>', 'Invited email address')
        .option(
            '--expires-at <epochMs>',
            'Expiration timestamp in milliseconds',
            nonnegativeInteger
        )
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<
                Options & { email: string; expiresAt?: number }
            >()
            const body = await result(
                connection(options).api.access.invitations.post({
                    targetEmail: options.email,
                    ...(options.expiresAt !== undefined ? { expiresAt: options.expiresAt } : {}),
                })
            )
            output(
                body,
                `Created invitation ${body.invitation.id} for ${body.invitation.targetEmail}. Token:\n\n${body.token}`,
                options
            )
        })
    accessInvitations
        .command('revoke')
        .description('Revoke an instance invitation.')
        .requiredOption('--invitation <id>', 'Invitation identifier')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options & { invitation: string }>()
            const settings = resolveConnection(options)
            if (!settings.token) {
                throw new CliError(
                    'No API key is available. Use auth login for a saved profile, or POSTDOT_API_KEY for automation.',
                    'authentication_required',
                    3
                )
            }
            let response: Response
            try {
                response = await fetch(
                    `${settings.origin}/api/access/invitations/${encodeURIComponent(options.invitation)}`,
                    {
                        method: 'DELETE',
                        headers: {
                            authorization: `Bearer ${settings.token}`,
                            accept: 'application/json',
                        },
                        redirect: 'error',
                        signal: AbortSignal.timeout(options.timeoutMs),
                    }
                )
            } catch {
                throw new CliError(
                    'No API response received. A submitted write may have succeeded; inspect its state before retrying.',
                    'transport_error'
                )
            }
            const body = (await response.json().catch(() => null)) as
                | { error?: { code?: string; message?: string } }
                | Record<string, unknown>
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
            output(body ?? { revoked: true }, `Revoked invitation ${options.invitation}.`, options)
        })

    // --- API keys ---
    const apiKeys = program
        .command('api-keys')
        .description('List, mint, update, and revoke your user-owned API keys.')

    apiKeys
        .command('list')
        .description('List your API keys.')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const body = await result(connection(options).api['api-keys'].get())
            output(
                body,
                body.keys
                    .map(
                        k =>
                            `${k.id}\t${k.name}\t${k.tokenPrefix}\t${k.projectAccess === 'all' ? 'all-projects' : k.projectAccess.join(',')}`
                    )
                    .join('\n') || 'No API keys.',
                options
            )
        })

    apiKeys
        .command('create')
        .description('Mint a new API key bounded by your current scope and capabilities.')
        .option('--name <name>', 'Key name')
        .option('--projects <ids>', 'Comma-separated project IDs', commaSeparatedIds)
        .option('--all-projects', 'Grant access across all accessible projects')
        .option('--actions <capabilities>', 'Comma-separated capabilities', parseCapabilities)
        .option('--all-actions', 'Inherit all actions available to the calling key/user')
        .option(
            '--expires-at <epochMs>',
            'Expiration timestamp in milliseconds',
            nonnegativeInteger
        )
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<
                Options & {
                    name?: string
                    projects?: string[]
                    allProjects?: boolean
                    actions?: UserApiKeyCapability[]
                    allActions?: boolean
                    expiresAt?: number
                }
            >()
            if (options.projects && options.allProjects) {
                throw new CliError(
                    'Use either --projects or --all-projects, not both.',
                    'invalid_input',
                    2
                )
            }
            if (options.actions && options.allActions) {
                throw new CliError(
                    'Use either --actions or --all-actions, not both.',
                    'invalid_input',
                    2
                )
            }
            const body = await result(
                connection(options).api['api-keys'].post({
                    ...(options.name ? { name: options.name } : {}),
                    projectIds: options.projects ?? null,
                    ...(options.actions !== undefined
                        ? { actionAccess: options.actions }
                        : options.allActions
                          ? { actionAccess: null }
                          : {}),
                    ...(options.expiresAt !== undefined ? { expiresAt: options.expiresAt } : {}),
                })
            )
            output(
                body,
                `Created API key "${body.key.name}". Copy it now; it will not be shown again:\n\n${body.token}`,
                options
            )
        })

    apiKeys
        .command('update')
        .description('Update API key name, expiry, project scope, or capability ceiling.')
        .requiredOption('--key-id <id>', 'API key identifier')
        .option('--name <name>', 'Updated key name')
        .option('--projects <ids>', 'Comma-separated project IDs', commaSeparatedIds)
        .option('--all-projects', 'Grant access across all accessible projects')
        .option('--actions <capabilities>', 'Comma-separated capabilities', parseCapabilities)
        .option('--all-actions', 'Grant all capabilities allowed for the caller')
        .option(
            '--expires-at <epochMs>',
            'Expiration timestamp in milliseconds',
            nonnegativeInteger
        )
        .option('--no-expiry', 'Remove key expiration')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<
                Options & {
                    keyId: string
                    name?: string
                    projects?: string[]
                    allProjects?: boolean
                    actions?: UserApiKeyCapability[]
                    allActions?: boolean
                    expiresAt?: number
                    expiry?: boolean
                }
            >()
            if (options.projects && options.allProjects) {
                throw new CliError(
                    'Use either --projects or --all-projects, not both.',
                    'invalid_input',
                    2
                )
            }
            if (options.actions && options.allActions) {
                throw new CliError(
                    'Use either --actions or --all-actions, not both.',
                    'invalid_input',
                    2
                )
            }
            if (options.expiresAt !== undefined && options.expiry === false) {
                throw new CliError(
                    'Use either --expires-at or --no-expiry, not both.',
                    'invalid_input',
                    2
                )
            }
            type ApiKeyPatch = NonNullable<
                Parameters<ReturnType<PostdotClient['api']['api-keys']>['patch']>[0]
            >
            const patch: ApiKeyPatch = {
                ...(options.name !== undefined ? { name: options.name } : {}),
                ...(options.projects !== undefined
                    ? { projectIds: options.projects }
                    : options.allProjects
                      ? { projectIds: null }
                      : {}),
                ...(options.actions !== undefined
                    ? { actionAccess: options.actions }
                    : options.allActions
                      ? { actionAccess: null }
                      : {}),
                ...(options.expiresAt !== undefined
                    ? { expiresAt: options.expiresAt }
                    : options.expiry === false
                      ? { expiresAt: null }
                      : {}),
            }
            if (Object.keys(patch).length === 0) {
                throw new CliError('Specify at least one field to update.', 'invalid_input', 2)
            }
            const body = await result(
                connection(options).api['api-keys']({ keyId: options.keyId }).patch(patch)
            )
            output(body, `Updated API key ${body.key.id}.`, options)
        })

    apiKeys
        .command('revoke')
        .description('Revoke one of your API keys.')
        .requiredOption('--key-id <id>', 'API key identifier')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options & { keyId: string }>()
            const body = await result(
                connection(options).api['api-keys']({ keyId: options.keyId }).delete()
            )
            output(body, `Revoked API key ${options.keyId}.`, options)
        })

    // --- Workspaces & lifecycle & membership ---
    const workspaces = program
        .command('workspaces')
        .description('Create, inspect, and administer workspaces, teams, and lifecycle.')

    workspaces
        .command('list')
        .description('List accessible workspaces.')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const body = await result(connection(options).api.workspaces.get())
            output(
                body,
                body.workspaces.map(w => `${w.id}\t${w.name}`).join('\n') || 'No workspaces.',
                options
            )
        })

    workspaces
        .command('show')
        .description('Inspect workspace details, members, and teams.')
        .requiredOption('--workspace <id>', 'Workspace identifier')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options & { workspace: string }>()
            const body = await result(
                connection(options).api.workspaces({ workspaceId: options.workspace }).get()
            )
            output(body, JSON.stringify(body, null, 2), options)
        })

    workspaces
        .command('create')
        .description('Create a new workspace.')
        .requiredOption('--name <name>', 'Workspace name')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options & { name: string }>()
            const body = await result(
                connection(options).api.workspaces.post({ name: options.name })
            )
            output(
                body,
                `Created workspace ${body.workspace.id} (${body.workspace.name}).`,
                options
            )
        })

    workspaces
        .command('impact')
        .description('Inspect combined workspace archive/deletion impact and fingerprint.')
        .requiredOption('--workspace <id>', 'Workspace identifier')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options & { workspace: string }>()
            const body = await result(
                connection(options)
                    .api.workspaces({ workspaceId: options.workspace })
                    .lifecycle.get()
            )
            output(body, JSON.stringify(body, null, 2), options)
        })

    for (const action of ['archive', 'restore', 'delete'] as const) {
        const cmd = workspaces
            .command(action)
            .description(`${action[0]!.toUpperCase()}${action.slice(1)} a workspace.`)
            .requiredOption('--workspace <id>', 'Workspace identifier')
            .requiredOption(
                '--fingerprint <value>',
                'Lifecycle impact fingerprint from workspaces impact'
            )
            .option('--cancel-pending', 'Cancel pending scheduled work')
            .option('--acknowledge-uncertain', 'Acknowledge uncertain delivery outcomes')
            .option('--confirm-name <name>', 'Confirm workspace name when required')
            .option('--replacement-workspace <id>', 'Replacement default workspace identifier')
        cmd.action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<
                Options & {
                    workspace: string
                    fingerprint: string
                    cancelPending?: boolean
                    acknowledgeUncertain?: boolean
                    confirmName?: string
                    replacementWorkspace?: string
                }
            >()
            const route = connection(options).api.workspaces({
                workspaceId: options.workspace,
            }).lifecycle
            const payload = {
                fingerprint: options.fingerprint,
                cancelPending: Boolean(options.cancelPending),
                acknowledgeUncertain: Boolean(options.acknowledgeUncertain),
                ...(options.confirmName ? { confirmName: options.confirmName } : {}),
                ...(options.replacementWorkspace
                    ? { replacementWorkspaceId: options.replacementWorkspace }
                    : {}),
            }
            const body =
                action === 'delete'
                    ? await result(route.delete(payload))
                    : action === 'archive'
                      ? await result(route.archive.post(payload))
                      : await result(route.restore.post(payload))
            output(body, JSON.stringify(body, null, 2), options)
        })
    }

    // --- Instance settings (email, recovery, provider applications) ---
    const settings = program
        .command('settings')
        .description('Manage instance-level SMTP email, recovery, and OAuth provider apps.')

    const email = settings
        .command('email')
        .description('Inspect and configure SMTP email settings.')
    email
        .command('get')
        .description('Inspect current SMTP configuration.')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const body = await result(connection(options).api.settings.email.get())
            output(body, JSON.stringify(body, null, 2), options)
        })
    email
        .command('save')
        .description('Update SMTP configuration from JSON input.')
        .requiredOption('--input <file|->', 'JSON object or stdin (-)')
        .option('--password-file <path>', 'Read SMTP password from a file and inject into payload')
        .option('--password-stdin', 'Read SMTP password from stdin and inject into payload')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<
                Options & { input: string; passwordFile?: string; passwordStdin?: boolean }
            >()
            if (options.input === '-' && options.passwordStdin) {
                throw new CliError(
                    'Cannot read both --input and --password-stdin from stdin.',
                    'invalid_input',
                    2
                )
            }
            const route = connection(options).api.settings.email
            const payload = await readJsonObject<Parameters<typeof route.put>[0]>(options.input)
            const pw = await resolveOptionalSecret(
                'SMTP password',
                undefined,
                options.passwordStdin,
                options.passwordFile,
                undefined,
                undefined
            )
            const body = await result(
                route.put(pw.value !== undefined ? { ...payload, password: pw.value } : payload)
            )
            output(body, 'Email settings saved.', options)
        })
    email
        .command('test')
        .description('Verify saved SMTP delivery settings.')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const body = await result(connection(options).api.settings.email.test.post())
            output(body, 'Test email dispatched.', options)
        })

    const recovery = settings
        .command('recovery')
        .description('Inspect and resume post-restore dispatch holds.')
    recovery
        .command('get')
        .description('Inspect current restore recovery hold state.')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const body = await result(connection(options).api.settings.recovery.get())
            output(body, JSON.stringify(body, null, 2), options)
        })
    recovery
        .command('resume')
        .description('Clear a post-restore hold and resume dispatch.')
        .requiredOption('--token <token>', 'Recovery hold token from settings recovery get')
        .requiredOption('--confirm', 'Explicitly confirm resuming scheduled dispatch')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options & { token: string }>()
            const body = await result(
                connection(options).api.settings.recovery.resume.post({
                    token: options.token,
                    confirm: true,
                })
            )
            output(body, 'Restore recovery hold cleared.', options)
        })

    const providerApps = settings
        .command('provider-applications')
        .description('Manage runtime OAuth provider application credentials.')
    providerApps
        .command('list')
        .description('List configured OAuth provider applications.')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const body = await result(
                connection(options).api.settings['provider-applications'].get()
            )
            output(body, JSON.stringify(body, null, 2), options)
        })
    providerApps
        .command('create')
        .description('Create an OAuth provider application configuration from JSON.')
        .requiredOption('--input <file|->', 'JSON object or stdin (-)')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options & { input: string }>()
            const route = connection(options).api.settings['provider-applications']
            const input = await readJsonObject<Parameters<typeof route.post>[0]>(options.input)
            const body = await result(route.post(input))
            output(body, `Created provider application ${body.application.id}.`, options)
        })
    providerApps
        .command('update')
        .description('Update an OAuth provider application configuration from JSON.')
        .requiredOption('--application <id>', 'Provider application identifier')
        .requiredOption('--input <file|->', 'JSON object or stdin (-)')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<
                Options & { application: string; input: string }
            >()
            const route = connection(options).api.settings['provider-applications']({
                applicationId: options.application,
            })
            const input = await readJsonObject<Parameters<typeof route.patch>[0]>(options.input)
            const body = await result(route.patch(input))
            output(body, `Updated provider application ${body.application.id}.`, options)
        })
}
