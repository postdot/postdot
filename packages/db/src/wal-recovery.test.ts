import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLocalMediaStore } from '@postdot/media'

import { backupDatabase, backupWithMedia, restoreDatabase, restoreWithMedia } from './backup'
import { closeDatabase, createDatabase } from './client'
import { runMigrations } from './migrations'
import { readRecoveryHold } from './recovery-hold'

async function leaveCommittedWal(path: string): Promise<void> {
    const database = createDatabase(path)
    runMigrations(database)
    database.$client.run('CREATE TABLE records (value TEXT)')
    closeDatabase(database)
    const writer = Bun.spawn(
        [
            process.execPath,
            '-e',
            `
        import { Database } from 'bun:sqlite';
        const database = new Database(process.argv[1]);
        database.run('PRAGMA wal_autocheckpoint = 0');
        database.run("INSERT INTO records VALUES ('old-destination')");
        console.log('committed');
        // Retain the connection until SIGKILL: GC would close it and checkpoint WAL.
        setInterval(() => database.query('SELECT 1').get(), 1000);
        Bun.gc(true);
    `,
            path,
        ],
        { stdout: 'pipe', stderr: 'pipe' }
    )
    try {
        const output = writer.stdout.getReader()
        const ready = await output.read()
        expect(new TextDecoder().decode(ready.value)).toContain('committed')
        output.releaseLock()
    } finally {
        writer.kill('SIGKILL')
        await writer.exited
    }
    expect(Bun.file(`${path}-wal`).size).toBeGreaterThan(0)
}

for (const withMedia of [false, true]) {
    test(`restores ${withMedia ? 'a media bundle' : 'a database'} over a committed WAL left by a killed process`, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postdot-wal-restore-'))
        const sourcePath = join(directory, 'source.sqlite')
        const targetPath = join(directory, 'target.sqlite')
        const backupPath = join(directory, withMedia ? 'bundle' : 'backup.sqlite')
        const mediaStore = createLocalMediaStore({
            storeId: 'local-default',
            rootDirectory: join(directory, 'media'),
            maxObjectBytes: 2_000_000,
        })
        const source = createDatabase(sourcePath)
        try {
            runMigrations(source)
            source.$client.run('PRAGMA wal_autocheckpoint = 0')
            source.$client.run('CREATE TABLE records (value TEXT)')
            source.$client.run("INSERT INTO records VALUES ('from-backup')")
            expect(Bun.file(`${sourcePath}-wal`).size).toBeGreaterThan(0)
            // Keep the source open: the snapshot must include committed WAL frames.
            if (withMedia) {
                await backupWithMedia({
                    databaseFilename: sourcePath,
                    destinationDirectory: backupPath,
                    mediaStore,
                })
            } else {
                backupDatabase(sourcePath, backupPath)
            }
            await leaveCommittedWal(targetPath)
            if (withMedia) {
                await restoreWithMedia({
                    sourceDirectory: backupPath,
                    databaseFilename: targetPath,
                    mediaStore,
                })
            } else {
                restoreDatabase(backupPath, targetPath)
            }
            expect(readRecoveryHold(targetPath)?.reason).toBe('restore')
            const restored = createDatabase(targetPath)
            try {
                runMigrations(restored)
                expect(restored.$client.query('SELECT value FROM records').all()).toEqual([
                    { value: 'from-backup' },
                ])
                expect(restored.$client.query('PRAGMA integrity_check').get()).toEqual({
                    integrity_check: 'ok',
                })
                expect(restored.$client.query('SELECT * FROM media_backup_fences').all()).toEqual(
                    []
                )
            } finally {
                closeDatabase(restored)
            }
        } finally {
            closeDatabase(source)
            await rm(directory, { recursive: true, force: true })
        }
    })
}

test('restore refuses an active destination reader and preserves its WAL data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'postdot-wal-locked-restore-'))
    const sourcePath = join(directory, 'source.sqlite')
    const targetPath = join(directory, 'target.sqlite')
    const source = createDatabase(sourcePath)
    let reader: Database | undefined
    try {
        runMigrations(source)
        await leaveCommittedWal(targetPath)
        reader = new Database(targetPath)
        reader.run('BEGIN')
        expect(reader.query('SELECT value FROM records').all()).toEqual([
            { value: 'old-destination' },
        ])
        expect(() => restoreDatabase(sourcePath, targetPath)).toThrow('locked')
        expect(readRecoveryHold(targetPath)).toBeNull()
        expect(reader.query('SELECT value FROM records').all()).toEqual([
            { value: 'old-destination' },
        ])
        reader.run('ROLLBACK')
    } finally {
        reader?.close()
        closeDatabase(source)
        await rm(directory, { recursive: true, force: true })
    }
}, 10_000)

for (const withMedia of [false, true]) {
    test(`refuses orphaned destination WAL during ${withMedia ? 'media' : 'database'} restore`, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postdot-wal-orphan-'))
        const sourcePath = join(directory, 'source.sqlite')
        const targetPath = join(directory, 'target.sqlite')
        const backupPath = join(directory, 'bundle')
        const source = createDatabase(sourcePath)
        const mediaStore = createLocalMediaStore({
            storeId: 'local-default',
            rootDirectory: join(directory, 'media'),
            maxObjectBytes: 2_000_000,
        })
        try {
            runMigrations(source)
            await Bun.write(`${targetPath}-wal`, 'preserve-recovery-material')
            if (withMedia) {
                await backupWithMedia({
                    databaseFilename: sourcePath,
                    destinationDirectory: backupPath,
                    mediaStore,
                })
                await expect(
                    restoreWithMedia({
                        sourceDirectory: backupPath,
                        databaseFilename: targetPath,
                        mediaStore,
                    })
                ).rejects.toThrow('sidecars without its database')
            } else {
                expect(() => restoreDatabase(sourcePath, targetPath)).toThrow(
                    'sidecars without its database'
                )
            }
            expect(await Bun.file(`${targetPath}-wal`).text()).toBe('preserve-recovery-material')
            expect(await Bun.file(targetPath).exists()).toBe(false)
            expect(readRecoveryHold(targetPath)).toBeNull()
        } finally {
            closeDatabase(source)
            await rm(directory, { recursive: true, force: true })
        }
    })
}
