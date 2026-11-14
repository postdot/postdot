import { constants, existsSync } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
    createAuth,
    postdotPasswordPolicy,
    postdotUserApiKeyConfigId,
    runWithAuthorizedBootstrap,
} from '@postdot/auth'
import {
    acquireRuntimeQuiescenceLock,
    closeDatabase,
    closePostgresDatabase,
    createAccessStore,
    createDatabase,
    createPostgresDatabase,
    runMigrations,
    type DatabaseHandle,
} from '@postdot/db'

import { createPostdotBootstrapConfig } from './config'
import {
    generatedUserApiKeyName,
    metadataForProjectAccess,
    toUserApiKey,
} from './modules/access/api-key-routes'

export interface LocalAccountBootstrapResult {
    readonly user: {
        readonly id: string
        readonly name: string
        readonly email: string
        readonly role: 'admin'
    }
    readonly instanceState: 'claimed'
    readonly apiKey?: {
        readonly id: string
        readonly name: string
        readonly tokenPrefix: string
        readonly projectAccess: 'all' | readonly string[]
        readonly actionAccess: 'all' | readonly string[]
        readonly expiresAt: number | null
        readonly outputFile?: string
        readonly token?: string
    }
}

interface ParsedBootstrapArguments {
    readonly target:
        | { readonly kind: 'sqlite'; readonly databaseFilename: string }
        | { readonly kind: 'postgres'; readonly databaseUrl: string }
    readonly inputFile: string
    readonly issueApiKey: boolean
    readonly apiKeyName?: string
    readonly apiKeyOutput?: string
    readonly json: boolean
}

const booleanFlags = new Set(['--issue-api-key', '--json'])
const valueFlags = new Set([
    '--database',
    '--database-url',
    '--input',
    '--api-key-name',
    '--api-key-output',
])

export async function runLocalAccountBootstrap(
    args: readonly string[]
): Promise<LocalAccountBootstrapResult> {
    const bootstrapConfig = createPostdotBootstrapConfig()
    const parsed = parseBootstrapArguments(args, bootstrapConfig.POSTDOT_DATABASE_URL)
    const credentials = await readCredentials(parsed.inputFile)
    const apiKeyOutputPath = parsed.apiKeyOutput
        ? await assertApiKeyOutputWritable(parsed.apiKeyOutput)
        : undefined

    let result: {
        readonly summary: LocalAccountBootstrapResult
        readonly plaintextToken?: string
    }

    if (parsed.target.kind === 'sqlite') {
        const databaseFilename = parsed.target.databaseFilename
        const lock = acquireRuntimeQuiescenceLock(databaseFilename, 'recovery')
        let released = false
        try {
            const existed = existsSync(databaseFilename)
            const database = createDatabase(databaseFilename)
            try {
                // Only initialize a new database. A refused bootstrap must not
                // silently migrate an existing installation.
                if (!existed) {
                    await runMigrations(database, bootstrapConfig.POSTDOT_MIGRATIONS_DIR)
                }
                result = await claimInstanceInDatabase(database, credentials, {
                    issueApiKey: parsed.issueApiKey,
                    apiKeyName: parsed.apiKeyName,
                })
            } finally {
                closeDatabase(database)
            }
        } finally {
            released = lock.release()
            if (!released)
                console.error('Bootstrap runtime lock was retained; inspect it before restarting')
        }
        if (!released) throw new Error('Bootstrap runtime lock was retained')
    } else {
        const database = createPostgresDatabase(parsed.target.databaseUrl, {
            max: 1,
        })
        try {
            const initialized = await database.sql
                .statement<{ readonly exists: string | null }>(
                    "select to_regclass('postdot_migrations') as exists"
                )
                .get()
            if (initialized?.exists === null) {
                await runMigrations(database, bootstrapConfig.POSTDOT_MIGRATIONS_DIR)
            }
            result = await claimInstanceInDatabase(database, credentials, {
                issueApiKey: parsed.issueApiKey,
                apiKeyName: parsed.apiKeyName,
            })
        } finally {
            await closePostgresDatabase(database)
        }
    }

    let summary = result.summary
    if (result.plaintextToken !== undefined) {
        if (apiKeyOutputPath !== undefined) {
            await writeApiKeyOutputFile(apiKeyOutputPath, result.plaintextToken)
            summary = {
                ...summary,
                apiKey: {
                    ...summary.apiKey!,
                    outputFile: apiKeyOutputPath,
                },
            }
        } else {
            summary = {
                ...summary,
                apiKey: {
                    ...summary.apiKey!,
                    token: result.plaintextToken,
                },
            }
        }
    }

    if (parsed.json) {
        console.log(JSON.stringify(summary))
    } else if (summary.apiKey === undefined) {
        console.log(
            'Installation administrator created. Public signup is closed. Start Postdot and sign in.'
        )
    } else if (summary.apiKey.outputFile !== undefined) {
        console.log(
            `Installation administrator created. Public signup is closed. API key "${summary.apiKey.name}" saved to ${summary.apiKey.outputFile}.`
        )
    } else {
        console.log(
            `Installation administrator created. Public signup is closed. API key "${summary.apiKey.name}": ${summary.apiKey.token}`
        )
    }

    return summary
}

function parseBootstrapArguments(
    args: readonly string[],
    configuredPostgresUrl?: string
): ParsedBootstrapArguments {
    if (args[0] !== 'account' || args[1] !== 'bootstrap') {
        throw new Error(
            'Use account bootstrap [--database <path> | --database-url <postgres-url>] --input <private-json-file>'
        )
    }

    const options = new Map<string, string>()
    const flags = new Set<string>()
    for (let index = 2; index < args.length; index += 1) {
        const key = args[index]
        if (!key) {
            throw new Error('Invalid bootstrap option')
        }
        if (booleanFlags.has(key)) {
            if (flags.has(key)) throw new Error(`Duplicate bootstrap flag: ${key}`)
            flags.add(key)
            continue
        }
        if (!valueFlags.has(key) || options.has(key)) {
            throw new Error(`Unknown or duplicate bootstrap option: ${key}`)
        }
        const value = args[index + 1]
        if (!value || value.startsWith('-')) {
            throw new Error(`Missing value for bootstrap option: ${key}`)
        }
        options.set(key, value)
        index += 1
    }

    const inputFile = options.get('--input')
    if (!inputFile) {
        throw new Error('Bootstrap requires --input <private-json-file>')
    }

    const requestedSqlite = options.get('--database')
    const requestedPostgres = options.get('--database-url')
    if (requestedSqlite !== undefined && requestedPostgres !== undefined) {
        throw new Error('Specify either --database or --database-url, not both')
    }

    let target: ParsedBootstrapArguments['target']
    if (requestedSqlite !== undefined) {
        if (requestedSqlite === ':memory:') {
            throw new Error('Bootstrap requires a persistent database')
        }
        target = { kind: 'sqlite', databaseFilename: resolve(requestedSqlite) }
    } else if (requestedPostgres !== undefined) {
        assertValidPostgresUrl(requestedPostgres)
        target = { kind: 'postgres', databaseUrl: requestedPostgres }
    } else if (configuredPostgresUrl !== undefined) {
        assertValidPostgresUrl(configuredPostgresUrl)
        target = { kind: 'postgres', databaseUrl: configuredPostgresUrl }
    } else {
        throw new Error(
            'Bootstrap requires --database <path>, --database-url <postgres-url>, or POSTDOT_DATABASE_URL'
        )
    }

    const issueApiKey = flags.has('--issue-api-key')
    const apiKeyName = options.get('--api-key-name')?.trim()
    const apiKeyOutput = options.get('--api-key-output')
    if ((apiKeyName !== undefined || apiKeyOutput !== undefined) && !issueApiKey) {
        throw new Error('--api-key-name and --api-key-output require --issue-api-key')
    }
    if (apiKeyName !== undefined && (apiKeyName.length === 0 || apiKeyName.length > 100)) {
        throw new Error('--api-key-name must be between 1 and 100 characters')
    }

    return {
        target,
        inputFile,
        issueApiKey,
        ...(apiKeyName === undefined ? {} : { apiKeyName }),
        ...(apiKeyOutput === undefined ? {} : { apiKeyOutput }),
        json: flags.has('--json'),
    }
}

function assertValidPostgresUrl(url: string): void {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        throw new Error('--database-url must be a postgres:// or postgresql:// URL')
    }
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
        throw new Error('--database-url must be a postgres:// or postgresql:// URL')
    }
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
    if (name.length === 0) {
        throw new Error('--database-url must name a database')
    }
}

async function claimInstanceInDatabase(
    database: DatabaseHandle,
    credentials: { readonly name: string; readonly email: string; readonly password: string },
    options: { readonly issueApiKey: boolean; readonly apiKeyName?: string }
): Promise<{
    readonly summary: LocalAccountBootstrapResult
    readonly plaintextToken?: string
}> {
    const access = createAccessStore(database)
    if (
        (await access.getInstanceState()).state !== 'claimable' ||
        !(await access.isSignupAllowed())
    ) {
        throw new Error(
            'The installation is already configured or cannot be claimed; no account was changed'
        )
    }

    const baseURL = 'http://localhost:3000'
    const auth = createAuth(database, {
        baseURL,
        secret: crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID(),
        trustedOrigins: [baseURL],
        access,
        isOpenSignupAllowed: () => false,
        logger: { disabled: true },
    })

    return database.sql.transaction(
        () =>
            runWithAuthorizedBootstrap(async () => {
                if (
                    (await access.getInstanceState()).state !== 'claimable' ||
                    !(await access.isSignupAllowed())
                ) {
                    throw new Error(
                        'The installation is already configured or cannot be claimed; no account was changed'
                    )
                }

                const response = await auth.handler(
                    new Request(`${baseURL}/api/auth/sign-up/email`, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json', origin: baseURL },
                        body: JSON.stringify(credentials),
                    })
                )
                if (!response.ok) {
                    throw new Error(
                        'Administrator creation failed; check the input and installation state'
                    )
                }
                const state = await access.getInstanceState()
                if (state.state !== 'claimed' || !state.claimedByUserId) {
                    throw new Error('Administrator claim was not confirmed')
                }

                const cookie = response.headers
                    .getSetCookie()
                    .map(value => value.split(';', 1)[0])
                    .join('; ')
                if (cookie) {
                    const signedOut = await auth.handler(
                        new Request(`${baseURL}/api/auth/sign-out`, {
                            method: 'POST',
                            headers: {
                                cookie,
                                origin: baseURL,
                                'content-type': 'application/json',
                            },
                            body: '{}',
                        })
                    )
                    if (!signedOut.ok) {
                        throw new Error(
                            'Administrator created, but bootstrap session cleanup failed; use ordinary sign-in'
                        )
                    }
                }

                let apiKeySummary: LocalAccountBootstrapResult['apiKey']
                let plaintextToken: string | undefined
                if (options.issueApiKey) {
                    const created = await auth.api.createApiKey({
                        body: {
                            configId: postdotUserApiKeyConfigId,
                            name: options.apiKeyName ?? generatedUserApiKeyName(),
                            userId: state.claimedByUserId,
                            metadata: metadataForProjectAccess(null),
                        },
                    })
                    const mapped = toUserApiKey(created)
                    apiKeySummary = {
                        id: mapped.id,
                        name: mapped.name,
                        tokenPrefix: mapped.tokenPrefix,
                        projectAccess: mapped.projectAccess,
                        actionAccess: mapped.actionAccess,
                        expiresAt: mapped.expiresAt,
                    }
                    plaintextToken = created.key
                }

                return {
                    summary: {
                        user: {
                            id: state.claimedByUserId,
                            name: credentials.name,
                            email: credentials.email,
                            role: 'admin' as const,
                        },
                        instanceState: 'claimed' as const,
                        ...(apiKeySummary === undefined ? {} : { apiKey: apiKeySummary }),
                    },
                    ...(plaintextToken === undefined ? {} : { plaintextToken }),
                }
            }),
        'immediate'
    )
}

async function assertApiKeyOutputWritable(outputPath: string): Promise<string> {
    const resolved = resolve(outputPath)
    try {
        await lstat(resolved)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return resolved
        }
        throw error
    }
    throw new Error(`API key output path already exists: ${resolved}`)
}

async function writeApiKeyOutputFile(outputPath: string, token: string): Promise<void> {
    const file = await open(
        outputPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600
    )
    try {
        await file.chmod(0o600)
        await file.writeFile(token, 'utf8')
    } finally {
        await file.close()
    }
}

async function readCredentials(
    filename: string
): Promise<{ name: string; email: string; password: string }> {
    let input: unknown
    try {
        const file = await open(
            filename,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
        )
        try {
            const stat = await file.stat()
            if (!stat.isFile() || stat.size > 16_384) throw new Error('Invalid input file')
            input = JSON.parse(await file.readFile('utf8'))
        } finally {
            await file.close()
        }
    } catch {
        throw new Error(
            'Bootstrap input must be a readable regular JSON file of at most 16 KiB; symbolic links are not accepted'
        )
    }
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new Error('Bootstrap input requires name, email and password')
    const fields = input as Record<string, unknown>
    if (
        Object.keys(fields).length !== 3 ||
        typeof fields.name !== 'string' ||
        !fields.name.trim() ||
        fields.name.length > 200 ||
        typeof fields.email !== 'string' ||
        !fields.email.trim() ||
        fields.email.length > 320 ||
        typeof fields.password !== 'string' ||
        fields.password.length < postdotPasswordPolicy.minimumLength ||
        fields.password.length > postdotPasswordPolicy.maximumLength
    ) {
        throw new Error(
            'Bootstrap input requires a name, email and a password meeting the password policy'
        )
    }
    return { name: fields.name.trim(), email: fields.email.trim(), password: fields.password }
}
