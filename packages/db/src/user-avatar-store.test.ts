import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLocalMediaStore, createS3MediaStore, type MediaStore } from '@postdot/media'

import { backupWithMedia, restoreWithMedia } from './backup'
import { closeDatabase, createDatabase, type DatabaseHandle } from './client'
import { runMigrations } from './migrations'
import { closeTestDatabase, openTestDatabase, testEngine } from './testing'
import { createUserAvatarStore } from './user-avatar-store'

const bytes = Uint8Array.from(
    Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
        'base64'
    )
)

async function addUser(database: DatabaseHandle, id: string) {
    await database.sql
        .statement('INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)')
        .run(id, id, `${id}@postdot.local`)
}

describe('personal avatar storage', () => {
    it('replaces and removes personal images through the S3 storage adapter', async () => {
        const objects = new Map<string, Uint8Array>()
        const file = (key: string, start?: number, end?: number) => ({
            writer() {
                const chunks: Uint8Array[] = []
                return {
                    write(chunk: Uint8Array) {
                        chunks.push(Uint8Array.from(chunk))
                        return chunk.byteLength
                    },
                    async end(error?: Error) {
                        if (error) return 0
                        const data = new Uint8Array(
                            chunks.reduce((size, chunk) => size + chunk.length, 0)
                        )
                        let offset = 0
                        for (const chunk of chunks) {
                            data.set(chunk, offset)
                            offset += chunk.length
                        }
                        objects.set(key, data)
                        return data.length
                    },
                }
            },
            stream() {
                const data = objects.get(key)
                if (!data) throw Object.assign(new Error('Missing object'), { status: 404 })
                return new Blob([new Uint8Array(data.slice(start, end))]).stream()
            },
            slice(begin?: number, finish?: number) {
                return file(key, begin, finish)
            },
            async stat() {
                const data = objects.get(key)
                if (!data) throw Object.assign(new Error('Missing object'), { status: 404 })
                return { size: data.length, lastModified: new Date() }
            },
            async delete() {
                objects.delete(key)
            },
        })
        const storage = createS3MediaStore({
            storeId: 'avatar-s3-test',
            client: { file } as unknown as Bun.S3Client,
            prefix: 'postdot-test',
            maxObjectBytes: 6 * 1024 * 1024,
        })
        const database = (await openTestDatabase()).database
        await addUser(database, 'owner')
        const avatars = createUserAvatarStore(database, storage)
        try {
            const first = await avatars.replace('owner', bytes)
            const second = await avatars.replace('owner', bytes)
            expect(await avatars.open(first.split('/').at(-1)!)).toBeNull()
            const opened = await avatars.open(second.split('/').at(-1)!)
            expect(new Uint8Array(await new Response(opened!.stream).arrayBuffer())).toEqual(bytes)
            expect(objects.size).toBe(1)
            await avatars.remove('owner')
            expect(objects.size).toBe(0)
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('retries retired-image cleanup without changing another person and honors backup fences', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postdot-avatar-'))
        const database = (await openTestDatabase()).database
        await addUser(database, 'owner')
        await addUser(database, 'other')
        const local = createLocalMediaStore({
            storeId: 'avatar-test',
            rootDirectory: directory,
            maxObjectBytes: 6 * 1024 * 1024,
        })
        let failDelete = false
        const storage: MediaStore = {
            ...local,
            storeId: local.storeId,
            maxObjectBytes: local.maxObjectBytes,
            put: (...args) => local.put(...args),
            open: (...args) => local.open(...args),
            stat: key => local.stat(key),
            delete: async key => {
                if (failDelete) throw new Error('Temporary deletion failure')
                await local.delete(key)
            },
        }
        const avatars = createUserAvatarStore(database, storage)
        try {
            const other = await avatars.replace('other', bytes)
            const first = await avatars.replace('owner', bytes)
            failDelete = true
            const second = await avatars.replace('owner', bytes)
            expect(second).not.toBe(first)
            expect(await avatars.open(first.split('/').at(-1)!)).toBeNull()
            expect(await avatars.open(other.split('/').at(-1)!)).not.toBeNull()
            expect(
                await database.sql
                    .statement("SELECT count(*) as count FROM user_avatars WHERE state = 'retired'")
                    .get()
            ).toEqual({ count: 1 })
            failDelete = false
            const now = Date.now()
            await database.sql
                .statement(
                    'INSERT INTO media_backup_fences (id, owner_id, created_at, expires_at) VALUES (1, ?, ?, ?)'
                )
                .run('backup-test', now, now + 60_000)
            await avatars.reconcile()
            expect(
                await database.sql
                    .statement("SELECT count(*) as count FROM user_avatars WHERE state = 'retired'")
                    .get()
            ).toEqual({ count: 1 })
            await database.sql.statement('DELETE FROM media_backup_fences').run()
            await avatars.reconcile()
            expect(
                await database.sql
                    .statement("SELECT count(*) as count FROM user_avatars WHERE state = 'retired'")
                    .get()
            ).toEqual({ count: 0 })
            await avatars.remove('owner')
            expect(await avatars.open(second.split('/').at(-1)!)).toBeNull()
            expect(await avatars.open(other.split('/').at(-1)!)).not.toBeNull()
        } finally {
            await closeTestDatabase(database)
            await rm(directory, { recursive: true, force: true })
        }
    })

    it.skipIf(testEngine === 'postgres')(
        'includes personal images in verified backup and restore bundles',
        async () => {
            const directory = await mkdtemp(join(tmpdir(), 'postdot-avatar-backup-'))
            const sourceFile = join(directory, 'source.sqlite')
            const database = createDatabase(sourceFile)
            await runMigrations(database)
            await addUser(database, 'owner')
            const source = createLocalMediaStore({
                storeId: 'avatar-test',
                rootDirectory: join(directory, 'source'),
                maxObjectBytes: 6 * 1024 * 1024,
            })
            try {
                const avatarUrl = await createUserAvatarStore(database, source).replace(
                    'owner',
                    bytes
                )
                const manifest = await backupWithMedia({
                    databaseFilename: sourceFile,
                    destinationDirectory: join(directory, 'bundle'),
                    mediaStore: source,
                })
                expect(manifest.version).toBe(2)
                expect(manifest.avatars).toHaveLength(1)
                const destination = createLocalMediaStore({
                    storeId: 'avatar-test',
                    rootDirectory: join(directory, 'destination'),
                    maxObjectBytes: 6 * 1024 * 1024,
                })
                const restoredFile = join(directory, 'restored.sqlite')
                await restoreWithMedia({
                    sourceDirectory: join(directory, 'bundle'),
                    databaseFilename: restoredFile,
                    mediaStore: destination,
                })
                const restored = createDatabase(restoredFile)
                await runMigrations(restored)
                try {
                    const image = await createUserAvatarStore(restored, destination).open(
                        avatarUrl.split('/').at(-1)!
                    )
                    expect(image).not.toBeNull()
                    expect(new Uint8Array(await new Response(image!.stream).arrayBuffer())).toEqual(
                        bytes
                    )
                } finally {
                    closeDatabase(restored)
                }
            } finally {
                closeDatabase(database)
                await rm(directory, { recursive: true, force: true })
            }
        }
    )
})
