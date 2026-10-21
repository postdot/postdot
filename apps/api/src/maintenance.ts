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

import { runLocalAccountPasswordRecovery } from './local-account-recovery'

export async function runMaintenanceCommand(
    args: readonly string[],
    options: {
        readonly databaseFileName?: string
        readonly mediaStore?: MediaStore
    } = {}
) {
    const command = args[0]
    if (command === 'account') {
        await runLocalAccountPasswordRecovery(args)
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
                console.error('[postbot-maintenance] media preview runtime lock was retained')
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
            if (!released) console.error('[postbot-maintenance] recovery runtime lock was retained')
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
