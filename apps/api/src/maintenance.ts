import { statSync } from 'node:fs'

import {
    acquireRuntimeQuiescenceLock,
    createDatabase,
    closeDatabase,
    createMediaAssetStore,
    createRecoveryHold,
    readRecoveryHold,
    releaseRecoveryHold,
    backupDatabase,
    backupWithMedia,
    restoreDatabase,
    restoreWithMedia,
} from '@postdot/db'
import type { MediaStore } from '@postdot/media'

import { runLocalAccountBootstrap } from './local-account-bootstrap'
import { runLocalAccountPasswordRecovery } from './local-account-recovery'

const maintenanceUsage = {
    backup: `Usage: bun /app/postdot.js backup --output <path> [--media] [--database <path>]

Create a database backup, or a database and media bundle with --media.
The output path must not already exist. Backups may run while the server is running.
Retain deployment secrets separately; the backup does not include them.`,
    restore: `Usage: bun /app/postdot.js restore --input <path> [--media] [--database <path>]

Restore a database backup, or a database and media bundle with --media.
Stop the server first. Restoration enables recovery hold; review before resuming.`,
    recovery: `Usage: bun /app/postdot.js recovery <hold|status|resume> [--database <path>] [--confirm]

Inspect recovery hold with status. Stop the server before hold or resume.
Offline resume requires --confirm after reviewing outstanding work.`,
    'media-previews': `Usage: bun /app/postdot.js media-previews [--project <id>] [--dry-run] [--database <path>]

Generate missing image previews against an existing offline database.
Stop the server first. --dry-run reports work without generating previews.`,
    account: `Usage: bun /app/postdot.js account bootstrap --database <path> --input <private-json-file>
       bun /app/postdot.js account recover-password --database <path>

Bootstrap creates the first administrator offline from a private JSON file with
name, email and password. Stop the server; existing installations are refused.
Password recovery changes an existing account and requires an interactive terminal.`,
} as const

export function printMaintenanceHelp(args: readonly string[]): boolean {
    if (args[0] === '--help' || args[0] === '-h') {
        console.log(`Usage: bun /app/postdot.js [command] [options]

Without a command, start the Postdot server using its environment configuration.

Commands:
  backup          Back up the database and optionally media
  restore         Restore a backup while the server is stopped
  recovery        Inspect, enable or resume recovery hold
  media-previews  Generate missing image previews offline
  account         Bootstrap an administrator or recover an account offline

Use --version [--json] for packaged release identification.
Use <command> --help for its options and operating requirements.`)
        return true
    }
    const command = args[0]
    if (command === undefined || !Object.hasOwn(maintenanceUsage, command)) return false
    if (!args.includes('--help') && !args.includes('-h')) return false
    console.log(maintenanceUsage[command as keyof typeof maintenanceUsage])
    return true
}

export async function runMaintenanceCommand(
    args: readonly string[],
    options: {
        readonly databaseFileName?: string
        readonly mediaStore?: MediaStore
    } = {}
) {
    if (printMaintenanceHelp(args)) return true
    const command = args[0]
    if (command === 'account') {
        if (args[1] === 'bootstrap') await runLocalAccountBootstrap(args)
        else await runLocalAccountPasswordRecovery(args)
        return true
    }
    if (!['backup', 'restore', 'recovery', 'media-previews'].includes(command ?? '')) return false

    const databaseFilename = optionValue(args, '--database') ?? options.databaseFileName
    if (databaseFilename === undefined) {
        throw new Error('A database path must be configured or passed with --database')
    }

    if (command === 'media-previews') {
        const mediaStore = requireMediaStore(options)
        const projectId = args.includes('--project') ? requiredOption(args, '--project') : undefined
        if (!statSync(databaseFilename).isFile())
            throw new Error('An existing database file is required')
        const lock = acquireRuntimeQuiescenceLock(databaseFilename, 'recovery')
        let released = false
        try {
            const database = createDatabase(databaseFilename)
            try {
                const report = await createMediaAssetStore(
                    database,
                    mediaStore
                ).generateMissingImagePreviews({
                    projectId,
                    dryRun: args.includes('--dry-run'),
                })
                console.log(JSON.stringify({ dryRun: args.includes('--dry-run'), ...report }))
                if (report.failed > 0)
                    throw new Error(
                        'Some image previews could not be generated; originals were preserved'
                    )
            } finally {
                closeDatabase(database)
            }
        } finally {
            released = lock.release()
            if (!released)
                console.error('[postdot-maintenance] media preview runtime lock was retained')
        }
        if (!released) throw new Error('Media preview runtime lock was retained')
        return true
    }

    if (command === 'recovery') {
        if (args[1] === 'status') {
            console.log(JSON.stringify(readRecoveryHold(databaseFilename)))
            return true
        }
        if (!['hold', 'resume'].includes(args[1] ?? ''))
            throw new Error('Use recovery hold, status or resume --confirm')
        if (args[1] === 'resume' && !args.includes('--confirm'))
            throw new Error(
                'Offline resumption requires --confirm after reviewing outstanding work'
            )
        const lock = acquireRuntimeQuiescenceLock(databaseFilename, 'recovery')
        let released = false
        try {
            if (args[1] === 'resume') {
                const hold = readRecoveryHold(databaseFilename)
                if (!hold) throw new Error('No recovery hold exists')
                releaseRecoveryHold(databaseFilename, hold.token)
                console.log(
                    'Recovery hold released. The next startup resumes delivery and cleanup.'
                )
            } else {
                createRecoveryHold(databaseFilename, 'external_restore')
                console.log(
                    'Recovery hold enabled. Start Postdot to inspect and resume from administration.'
                )
            }
        } finally {
            released = lock.release()
            if (!released) console.error('[postdot-maintenance] recovery runtime lock was retained')
        }
        if (!released) throw new Error('Recovery runtime lock was retained')
        return true
    }

    if (command === 'backup') {
        if (args.includes('--media')) {
            await backupWithMedia({
                databaseFilename,
                destinationDirectory: requiredOption(args, '--output'),
                mediaStore: requireMediaStore(options),
            })
            console.log('Complete media backup created.')
        } else {
            backupDatabase(databaseFilename, requiredOption(args, '--output'))
            console.log('Database backup created.')
        }
        return true
    }

    if (args.includes('--media')) {
        await restoreWithMedia({
            sourceDirectory: requiredOption(args, '--input'),
            databaseFilename,
            mediaStore: requireMediaStore(options),
        })
        console.log('Complete media backup restored.')
    } else {
        restoreDatabase(requiredOption(args, '--input'), databaseFilename)
        console.log('Database restored.')
    }
    return true
}

function requireMediaStore(options: { readonly mediaStore?: MediaStore }): MediaStore {
    if (options.mediaStore === undefined) {
        throw new Error('A configured media store is required for this command')
    }
    return options.mediaStore
}

function optionValue(args: readonly string[], name: string) {
    const index = args.indexOf(name)
    const value = index === -1 ? undefined : args[index + 1]
    return value === undefined || value.startsWith('--') ? undefined : value
}

function requiredOption(args: readonly string[], name: string) {
    const value = optionValue(args, name)
    if (!value) throw new Error(`Missing required option ${name}`)
    return value
}
