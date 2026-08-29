import { backupDatabase, restoreDatabase } from '@herald/db'

import { defaultDatabaseFileName } from './config'

export async function runMaintenanceCommand(args: readonly string[]) {
    const command = args[0]
    if (command !== 'backup' && command !== 'restore') return false

    const databaseFilename =
        optionValue(args, '--database') ?? Bun.env.DB_FILE_NAME ?? defaultDatabaseFileName

    if (command === 'backup') {
        backupDatabase(databaseFilename, requiredOption(args, '--output'))
        console.log('Database backup created.')
        return true
    }

    restoreDatabase(requiredOption(args, '--input'), databaseFilename)
    console.log('Database restored.')
    return true
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
