import { statSync } from 'node:fs'
import { resolve } from 'node:path'

import { hashPostbotPassword, postbotPasswordPolicy } from '@postbot/auth'
import { recoverLocalAccountPassword } from '@postbot/db'

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
) {
    assertRecoveryCommandArguments(args)

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

    const email = (await prompt('Account email: ')).trim()
    if (email.length === 0) throw new Error('An account email is required')

    const password = await prompt('New password (input hidden): ', { hidden: true })
    if (
        password.length < postbotPasswordPolicy.minimumLength ||
        password.length > postbotPasswordPolicy.maximumLength
    ) {
        throw new Error(
            `Password must contain between ${postbotPasswordPolicy.minimumLength} and ${postbotPasswordPolicy.maximumLength} characters`
        )
    }
    const confirmationPassword = await prompt('Confirm new password (input hidden): ', {
        hidden: true,
    })
    if (password !== confirmationPassword) {
        throw new Error('The passwords do not match; no changes were made')
    }

    const passwordHash = await hashPostbotPassword(password)
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

function assertRecoveryCommandArguments(args: readonly string[]): void {
    if (args[0] !== 'account' || args[1] !== 'recover-password') {
        throw new Error('Usage: postbot account recover-password --database <path>')
    }

    let databaseOptionCount = 0
    for (let index = 2; index < args.length; index += 1) {
        const argument = args[index]
        if (argument !== '--database') {
            throw new Error(`Unknown account recovery option: ${argument ?? ''}`)
        }
        databaseOptionCount += 1
        const value = args[index + 1]
        if (value === undefined || value.startsWith('--')) {
            throw new Error('Missing value for --database')
        }
        index += 1
    }

    if (databaseOptionCount !== 1) {
        throw new Error('Account recovery requires exactly one explicit --database path')
    }
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
