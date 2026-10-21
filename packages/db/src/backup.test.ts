import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLocalMediaStore } from '@postdot/media'

import { backupDatabase, backupWithMedia, restoreDatabase, restoreWithMedia } from './backup'
import { closeDatabase, createDatabase } from './client'
import { previewFixturePng } from './image-preview-fixture'
import { createMediaAssetStore } from './media-asset-store'
import { runMigrations } from './migrations'
import { readRecoveryHold } from './recovery-hold'
import { acquireRuntimeQuiescenceLock } from './runtime-quiescence'

describe('SQLite backup and restore', () => {
    it('creates a consistent backup and restores it atomically', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postbot-db-recovery-'))
        const sourcePath = join(directory, 'source.sqlite')
        const backupPath = join(directory, 'backups', 'postbot.sqlite')
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
            expect(readRecoveryHold(restoredPath)?.reason).toBe('restore')

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
        const directory = await mkdtemp(join(tmpdir(), 'postbot-db-recovery-'))
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

    it('refuses restore while the Postdot runtime owns the database boundary', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postbot-db-recovery-'))
        const sourcePath = join(directory, 'source.sqlite')
        const restoredPath = join(directory, 'restored.sqlite')

        try {
            const source = createDatabase(sourcePath)
            runMigrations(source)
            closeDatabase(source)

            const serverLock = acquireRuntimeQuiescenceLock(restoredPath, 'server')
            expect(() => restoreDatabase(sourcePath, restoredPath)).toThrow('already held')
            serverLock.release()

            restoreDatabase(sourcePath, restoredPath)
            expect(await Bun.file(restoredPath).exists()).toBe(true)
            expect(await Bun.file(`${restoredPath}.runtime.lock`).exists()).toBe(false)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('backs up and restores database rows together with verified media bytes', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postbot-media-backup-'))
        const sourcePath = join(directory, 'source.sqlite')
        const bundlePath = join(directory, 'backups', 'postbot.bundle')
        const restoredPath = join(directory, 'restored.sqlite')
        const sourceMediaPath = join(directory, 'source-media')
        const restoredMediaPath = join(directory, 'restored-media')
        const now = 1_800_000_000_000

        try {
            const source = createDatabase(sourcePath)
            runMigrations(source)
            source.$client.run(
                `insert into projects (id, name, created_at, updated_at) values ('project-1', 'Backup project', ?, ?)`,
                [now, now]
            )
            source.$client.run(
                `insert into actors (id, project_id, kind, subject_id, display_name, created_at, updated_at)
                 values ('actor-1', 'project-1', 'human', 'subject-1', 'Backup operator', ?, ?)`,
                [now, now]
            )
            const sourceStore = createLocalMediaStore({
                storeId: 'local-default',
                rootDirectory: sourceMediaPath,
                maxObjectBytes: 2_000_000,
            })
            const media = createMediaAssetStore(source, sourceStore, {
                now: () => now,
                createId: (() => {
                    let sequence = 0
                    return () => `media-${++sequence}`
                })(),
            })
            const bytes = previewFixturePng(4, 3)
            const reservation = media.reserveUpload({
                projectId: 'project-1',
                subjectId: 'subject-1',
                originalFilename: 'backup.png',
                expectedSize: bytes.length,
            })
            if (reservation === null) throw new Error('Media reservation was not created')
            await media.upload({
                projectId: 'project-1',
                subjectId: 'subject-1',
                intentId: reservation.intent.id,
                source: new Blob([bytes]).stream(),
            })
            const finalized = await media.finalizeUpload({
                projectId: 'project-1',
                subjectId: 'subject-1',
                intentId: reservation.intent.id,
            })
            expect(finalized.kind).toBe('ready')
            closeDatabase(source)

            const manifest = await backupWithMedia({
                databaseFilename: sourcePath,
                destinationDirectory: bundlePath,
                mediaStore: sourceStore,
                now: () => now,
            })
            expect(manifest.representations).toHaveLength(3)
            expect(await Bun.file(join(bundlePath, 'manifest.json')).exists()).toBe(true)
            expect(
                await Bun.file(
                    join(bundlePath, 'media', `${reservation.representation.id}.bin`)
                ).exists()
            ).toBe(true)

            const restoredStore = createLocalMediaStore({
                storeId: 'local-default',
                rootDirectory: restoredMediaPath,
                maxObjectBytes: 2_000_000,
            })
            const existingTarget = createDatabase(restoredPath)
            runMigrations(existingTarget)
            existingTarget.$client.run('create table restore_sentinel (value text not null)')
            existingTarget.$client.run('insert into restore_sentinel values (?)', [
                'before-restore',
            ])
            closeDatabase(existingTarget)

            await restoreWithMedia({
                sourceDirectory: bundlePath,
                databaseFilename: restoredPath,
                mediaStore: restoredStore,
                now: () => now,
            })
            expect(readRecoveryHold(restoredPath)?.reason).toBe('restore')

            const restored = createDatabase(restoredPath)
            expect(
                restored.$client
                    .query<{ state: string }, [string]>(
                        'select state from media_assets where id = ?'
                    )
                    .get(reservation.asset.id)
            ).toEqual({ state: 'ready' })
            expect(
                restored.$client
                    .query<{ name: string }, []>(
                        "select name from sqlite_master where type = 'table' and name = 'restore_sentinel'"
                    )
                    .get()
            ).toBeNull()
            expect(
                restored.$client.query('select count(*) as count from media_backup_fences').get()
            ).toEqual({
                count: 0,
            })
            closeDatabase(restored)
            for (const representation of manifest.representations) {
                expect((await restoredStore.stat(representation.objectKey))?.size).toBe(
                    representation.size
                )
            }
            const restoredObject = await restoredStore.open(reservation.representation.objectKey)
            expect(restoredObject?.metadata.size).toBe(bytes.byteLength)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
})
