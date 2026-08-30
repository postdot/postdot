import { backupDatabase, backupWithMedia, restoreDatabase, restoreWithMedia } from '@herald/db'
import type { MediaStore } from '@herald/media'

import { defaultDatabaseFileName } from './config'

export async function runMaintenanceCommand(
    args: readonly string[],
    options: { readonly mediaStore?: MediaStore } = {}
) {
    const command = args[0]
    if (command !== 'backup' && command !== 'restore') return false

    const databaseFilename =
        optionValue(args, '--database') ?? Bun.env.DB_FILE_NAME ?? defaultDatabaseFileName

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
        throw new Error('A configured media store is required when --media is used')
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
