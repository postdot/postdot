import { expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    acquireRuntimeQuiescenceLock,
    closeDatabase,
    createDatabase,
    runMigrations,
} from '@postbot/db'
import { createLocalMediaStore } from '@postbot/media'

import { runMaintenanceCommand } from './maintenance'

it('runs preview maintenance only against an existing offline database and releases its lock', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'postbot-preview-maintenance-'))
    const databaseFileName = join(directory, 'postbot.sqlite')
    const mediaStore = createLocalMediaStore({
        storeId: 'local-default',
        rootDirectory: join(directory, 'media'),
        maxObjectBytes: 2_000_000,
    })
    const options = { databaseFileName, mediaStore }
    try {
        await expect(runMaintenanceCommand(['media-previews'], options)).rejects.toThrow()
        expect(await Bun.file(databaseFileName).exists()).toBe(false)
        const database = createDatabase(databaseFileName)
        runMigrations(database)
        closeDatabase(database)
        const runtime = acquireRuntimeQuiescenceLock(databaseFileName, 'server')
        try {
            await expect(runMaintenanceCommand(['media-previews'], options)).rejects.toThrow(
                'already held'
            )
        } finally {
            runtime.release()
        }
        await expect(
            runMaintenanceCommand(['media-previews', '--project'], options)
        ).rejects.toThrow('Missing required option')
        expect(await runMaintenanceCommand(['media-previews', '--dry-run'], options)).toBe(true)
        expect(await Bun.file(`${databaseFileName}.runtime.lock`).exists()).toBe(false)
        expect(await runMaintenanceCommand(['media-previews'], options)).toBe(true)
        expect(await Bun.file(`${databaseFileName}.runtime.lock`).exists()).toBe(false)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
