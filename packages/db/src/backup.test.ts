import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backupDatabase, restoreDatabase } from './backup'
import { closeDatabase, createDatabase } from './client'
import { runMigrations } from './migrations'

describe('SQLite backup and restore', () => {
    it('creates a consistent backup and restores it atomically', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'herald-db-recovery-'))
        const sourcePath = join(directory, 'source.sqlite')
        const backupPath = join(directory, 'backups', 'herald.sqlite')
        const restoredPath = join(directory, 'restored.sqlite')

        try {
            const source = createDatabase(sourcePath)
            runMigrations(source)
            source.$client.run('create table records (value text not null)')
            source.$client.run('insert into records values (?)', ['from-backup'])
            closeDatabase(source)

            backupDatabase(sourcePath, backupPath)

            const target = createDatabase(restoredPath)
            runMigrations(target)
            target.$client.run('create table records (value text not null)')
            target.$client.run('insert into records values (?)', ['before-restore'])
            closeDatabase(target)

            restoreDatabase(backupPath, restoredPath)

            const restored = new Database(restoredPath, { readonly: true })
            expect(restored.query('select value from records').all()).toEqual([
                { value: 'from-backup' },
            ])
            restored.close()
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('rejects overwriting an existing backup and using the same path', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'herald-db-recovery-'))
        const sourcePath = join(directory, 'source.sqlite')
        const backupPath = join(directory, 'backup.sqlite')

        try {
            const source = createDatabase(sourcePath)
            runMigrations(source)
            source.$client.run('create table records (value text not null)')
            closeDatabase(source)

            backupDatabase(sourcePath, backupPath)

            expect(() => backupDatabase(sourcePath, backupPath)).toThrow(
                'Backup destination already exists'
            )
            expect(() => backupDatabase(sourcePath, sourcePath)).toThrow(
                'Source and destination database paths must be different'
            )
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
})
