import { statSync } from 'node:fs'
import { resolve } from 'node:path'

import { hashPostdotPassword, postdotPasswordPolicy } from '@postdot/auth'
import {
    closePostgresDatabase,
    createPostgresDatabase,
    recoverAccountPasswordInDatabase,
    recoverLocalAccountPassword,
    type DatabaseAccountPasswordRecoveryResult,
    type LocalAccountPasswordRecoveryResult,
} from '@postdot/db'

export interface AccountRecoveryPromptOptions {
    readonly hidden?: boolean
}

export type AccountRecoveryPrompt = (
    message: string,
    options?: AccountRecoveryPromptOptions
) => Promise<string>

export async function runLocalAccountPasswordRecovery(
    args: readonly string[],
    prompt: AccountRecoveryPrompt = promptTerminal
): Promise<LocalAccountPasswordRecoveryResult | DatabaseAccountPasswordRecoveryResult> {
    const target = assertRecoveryCommandArguments(args)
    if (target === '--database-url')
        return recoverPostgresAccount(requiredOption(args, target), prompt)

    const databaseArgument = requiredOption(args, '--database')
    const databaseFilename = resolve(databaseArgument)
    let databaseStats
    try {
        databaseStats = statSync(databaseFilename)
    } catch {
        throw new Error(`The requested database file does not exist: ${databaseArgument}`)
    }
    if (!databaseStats.isFile()) {
        throw new Error('The requested database path is not a regular file')
    }

    const confirmation = await prompt(
        `Target database: ${databaseFilename}\nType the exact path to confirm: `
    )
    if (confirmation !== databaseFilename) {
        throw new Error('Database path confirmation did not match; no changes were made')
    }

    const { email, passwordHash } = await promptCredentials(prompt)
    const result = recoverLocalAccountPassword({
        databaseFilename,
        email,
        passwordHash,
    })

    console.log(`Password updated for ${result.email}.`)
    console.log(
        `${result.revokedSessionCount} session(s) revoked; ${result.invalidatedResetTokenCount} reset link(s) invalidated.`
    )
    console.log(`Recovery backup: ${result.backupFilename}`)

    return result
}

/**
 * PostgreSQL profile: the account is changed in one transaction; servers may
 * keep running. Back the database up with the PostgreSQL tooling first.
 */
async function recoverPostgresAccount(url: string, prompt: AccountRecoveryPrompt) {
    let target: URL
    try {
        target = new URL(url)
    } catch {
        throw new Error('--database-url must be a postgres:// or postgresql:// URL')
    }
    if (target.protocol !== 'postgres:' && target.protocol !== 'postgresql:')
        throw new Error('--database-url must be a postgres:// or postgresql:// URL')
    const name = decodeURIComponent(target.pathname.replace(/^\//, ''))
    if (name.length === 0) throw new Error('--database-url must name a database')
    const confirmation = await prompt(
        `Target PostgreSQL database: ${name} on ${target.hostname || 'local socket'}\nType the database name to confirm: `
    )
    if (confirmation !== name) {
        throw new Error('Database name confirmation did not match; no changes were made')
    }
    const { email, passwordHash } = await promptCredentials(prompt)
    const database = createPostgresDatabase(url, { max: 1 })
    try {
        const result = await recoverAccountPasswordInDatabase(database, { email, passwordHash })
        console.log(`Password updated for ${result.email}.`)
        console.log(
            `${result.revokedSessionCount} session(s) revoked; ${result.invalidatedResetTokenCount} reset link(s) invalidated.`
        )
        return result
    } finally {
        await closePostgresDatabase(database)
    }
}

async function promptCredentials(prompt: AccountRecoveryPrompt) {
    const email = (await prompt('Account email: ')).trim()
    if (email.length === 0) throw new Error('An account email is required')

    const password = await prompt('New password (input hidden): ', { hidden: true })
    if (
        password.length < postdotPasswordPolicy.minimumLength ||
        password.length > postdotPasswordPolicy.maximumLength
    ) {
        throw new Error(
            `Password must contain between ${postdotPasswordPolicy.minimumLength} and ${postdotPasswordPolicy.maximumLength} characters`
        )
    }
    const confirmationPassword = await prompt('Confirm new password (input hidden): ', {
        hidden: true,
    })
    if (password !== confirmationPassword) {
        throw new Error('The passwords do not match; no changes were made')
    }

    return { email, passwordHash: await hashPostdotPassword(password) }
}

/** Exactly one explicit target: a SQLite file (`--database`) or a PostgreSQL URL. */
function assertRecoveryCommandArguments(args: readonly string[]): '--database' | '--database-url' {
    if (args[0] !== 'account' || args[1] !== 'recover-password') {
        throw new Error(
            'Usage: postdot account recover-password --database <path> | --database-url <postgres-url>'
        )
    }

    const targets: ('--database' | '--database-url')[] = []
    for (let index = 2; index < args.length; index += 1) {
        const argument = args[index]
        if (argument !== '--database' && argument !== '--database-url') {
            throw new Error(`Unknown account recovery option: ${argument ?? ''}`)
        }
        targets.push(argument)
        const value = args[index + 1]
        if (value === undefined || value.startsWith('--')) {
            throw new Error(`Missing value for ${argument}`)
        }
        index += 1
    }

    if (targets.length !== 1) {
        throw new Error(
            'Account recovery requires exactly one explicit --database path or --database-url'
        )
    }
    return targets[0]!
}

function requiredOption(args: readonly string[], name: string): string {
    const index = args.indexOf(name)
    const value = index === -1 ? undefined : args[index + 1]
    if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing required option ${name}`)
    }
    return value
}

let ignoreNextLineFeed = false

async function promptTerminal(
    message: string,
    options: AccountRecoveryPromptOptions = {}
): Promise<string> {
    const input = process.stdin
    if (!input.isTTY || !process.stdout.isTTY) {
        throw new Error('Account recovery requires an interactive terminal')
    }

    process.stdout.write(message)
    const wasRaw = input.isRaw

    return new Promise((resolve, reject) => {
        let value = ''
        let settled = false
        const decoder = new TextDecoder()

        const finish = (result: { readonly value: string } | { readonly error: Error }) => {
            if (settled) return
            settled = true
            input.off('data', onData)
            try {
                input.setRawMode(wasRaw)
            } catch (error) {
                reject(error)
                return
            }
            input.pause()
            process.stdout.write('\n')
            if ('error' in result) reject(result.error)
            else resolve(result.value)
        }

        const onData = (chunk: Buffer) => {
            for (const character of decoder.decode(chunk, { stream: true })) {
                if (ignoreNextLineFeed) {
                    ignoreNextLineFeed = false
                    if (character === '\n') continue
                }

                if (character === '\r') {
                    ignoreNextLineFeed = true
                    finish({ value })
                    return
                }
                if (character === '\n') {
                    finish({ value })
                    return
                }
                if (character === '\u0003' || character === '\u0004') {
                    finish({ error: new Error('Account recovery was cancelled') })
                    return
                }
                if (character === '\u007f' || character === '\b') {
                    const characters = Array.from(value)
                    if (characters.length === 0) continue
                    characters.pop()
                    value = characters.join('')
                    if (!options.hidden) process.stdout.write('\b \b')
                    continue
                }
                if ((character.codePointAt(0) ?? 0) < 32) continue

                value += character
                if (!options.hidden) process.stdout.write(character)
            }
        }

        try {
            input.setRawMode(true)
            input.on('data', onData)
            input.resume()
        } catch (error) {
            finish({
                error: error instanceof Error ? error : new Error('Unable to read terminal input'),
            })
        }
    })
}
