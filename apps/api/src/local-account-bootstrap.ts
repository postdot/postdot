import { constants, existsSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createAuth, postdotPasswordPolicy } from '@postdot/auth'
import {
    acquireRuntimeQuiescenceLock,
    closeDatabase,
    createAccessStore,
    createDatabase,
    runMigrations,
} from '@postdot/db'

import { createPostdotBootstrapConfig } from './config'

export async function runLocalAccountBootstrap(args: readonly string[]) {
    const options = new Map<string, string>()
    if (args[0] !== 'account' || args[1] !== 'bootstrap')
        throw new Error('Use account bootstrap --database <path> --input <private-json-file>')
    for (let index = 2; index < args.length; index += 2) {
        const key = args[index]
        const value = args[index + 1]
        if (
            !key ||
            !['--database', '--input'].includes(key) ||
            options.has(key) ||
            !value ||
            value.startsWith('-')
        ) {
            throw new Error('Bootstrap requires exactly one --database path and one --input file')
        }
        options.set(key, value)
    }
    if (options.size !== 2) throw new Error('Bootstrap requires --database and --input')
    const credentials = await readCredentials(options.get('--input')!)
    const requestedDatabase = options.get('--database')!
    if (requestedDatabase === ':memory:')
        throw new Error('Bootstrap requires a persistent database')
    const databaseFilename = resolve(requestedDatabase)
    const lock = acquireRuntimeQuiescenceLock(databaseFilename, 'recovery')
    let released = false
    try {
        const existed = existsSync(databaseFilename)
        const database = createDatabase(databaseFilename)
        try {
            // Only initialize a new database. A refused bootstrap must not
            // silently migrate an existing installation.
            if (!existed)
                runMigrations(database, createPostdotBootstrapConfig().POSTDOT_MIGRATIONS_DIR)
            const access = createAccessStore(database)
            if (access.getInstanceState().state !== 'claimable' || !access.isSignupAllowed()) {
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
                logger: { disabled: true },
            })
            const response = await auth.handler(
                new Request(`${baseURL}/api/auth/sign-up/email`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', origin: baseURL },
                    body: JSON.stringify(credentials),
                })
            )
            if (!response.ok)
                throw new Error(
                    'Administrator creation failed; check the input and installation state'
                )
            const state = access.getInstanceState()
            if (state.state !== 'claimed' || !state.claimedByUserId)
                throw new Error('Administrator claim was not confirmed')
            const cookie = response.headers
                .getSetCookie()
                .map(value => value.split(';', 1)[0])
                .join('; ')
            if (cookie) {
                const signedOut = await auth.handler(
                    new Request(`${baseURL}/api/auth/sign-out`, {
                        method: 'POST',
                        headers: { cookie, origin: baseURL, 'content-type': 'application/json' },
                        body: '{}',
                    })
                )
                if (!signedOut.ok)
                    throw new Error(
                        'Administrator created, but bootstrap session cleanup failed; use ordinary sign-in'
                    )
            }
            console.log(
                'Installation administrator created. Public signup is closed. Start Postdot and sign in.'
            )
        } finally {
            closeDatabase(database)
        }
    } finally {
        released = lock.release()
        if (!released)
            console.error('Bootstrap runtime lock was retained; inspect it before restarting')
    }
    if (!released) throw new Error('Bootstrap runtime lock was retained')
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
