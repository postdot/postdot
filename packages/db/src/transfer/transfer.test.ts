import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createManualChannelProfile } from '@postdot/core'
import { createLocalMediaStore, type MediaStore } from '@postdot/media'

import type { DatabaseHandle } from '../client'
import { previewFixturePng } from '../image-preview-fixture'
import { createManualStore } from '../manual-store'
import { createMediaAssetStore } from '../media-asset-store'
import { runMigrations } from '../migrations'
import { createPublisherCredentialCipher } from '../publisher-credential-crypto'
import { createPublisherCredentialStore } from '../publisher-credential-store'
import { describeSchema } from '../sql/schema-introspection'
import { testEngines, type OpenedTestDatabase } from '../sql/test-engines'
import { seedTestWorkspace } from '../testing'
import { createUserAvatarStore } from '../user-avatar-store'
import { exportDatabase, importDatabase, type TransferManifest } from './database-transfer'
import { transferMedia } from './media-transfer'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function open(engine: (typeof testEngines)[number]): Promise<DatabaseHandle> {
    const opened: OpenedTestDatabase = await engine.open()
    cleanups.push(() => opened.close())
    return opened.database
}

async function temporaryDirectory(prefix: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), prefix))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    return directory
}

function localStore(storeId: string, rootDirectory: string): MediaStore {
    return createLocalMediaStore({ storeId, rootDirectory, maxObjectBytes: 5_000_000 })
}

/**
 * A database exercising what a transfer must preserve: journal facts and their
 * sequence, rows derived by triggers, an archived channel whose children
 * triggers would reject on insert, encrypted blobs, media with previews and an
 * avatar.
 */
async function populate(database: DatabaseHandle, media: MediaStore) {
    await runMigrations(database)
    const workspaceId = await seedTestWorkspace(database)
    const manual = createManualStore(database)
    const project = await manual.createProject({
        name: 'Transferred',
        subjectId: 'owner',
        displayName: 'Owner',
        workspaceId,
    })
    const projectId = project.project.id
    const channels = []
    for (const name of ['Kept', 'Archived']) {
        channels.push(
            (await manual.createChannel({
                projectId,
                subjectId: 'owner',
                name,
                profile: createManualChannelProfile(),
            }))!
        )
    }
    await manual.archiveChannel({
        projectId,
        channelId: channels[1]!.id,
        subjectId: 'owner',
        expectedRevision: channels[1]!.revision,
    })
    const credentials = createPublisherCredentialStore(database, {
        cipher: createPublisherCredentialCipher({ keyId: 'test', key: new Uint8Array(32).fill(7) }),
    })
    await credentials.createPublisherCredential({
        projectId,
        connectedByActorId: project.actor.id,
        providerId: 'fixture',
        externalAccountId: 'account',
        accessToken: 'synthetic-access',
        refreshToken: 'synthetic-refresh',
        providerSession: 'synthetic-session',
    })
    const assets = createMediaAssetStore(database, media)
    const reservation = (await assets.reserveUpload({
        projectId,
        subjectId: 'owner',
        originalFilename: 'picture.png',
    }))!
    await assets.upload({
        projectId,
        subjectId: 'owner',
        intentId: reservation.intent.id,
        source: new Blob([previewFixturePng(640, 360)]).stream(),
    })
    expect(
        (
            await assets.finalizeUpload({
                projectId,
                subjectId: 'owner',
                intentId: reservation.intent.id,
            })
        ).kind
    ).toBe('ready')
    await database.sql
        .statement('insert into "user" (id, name, email) values (?1, ?1, ?2)')
        .run('owner-user', 'owner@transfer.local')
    await createUserAvatarStore(database, media).replace('owner-user', previewFixturePng(64, 64))
    return { projectId, workspaceId }
}

async function count(database: DatabaseHandle, table: string): Promise<number> {
    const row = await database.sql
        .statement<{ count: number }>(`select count(*) as count from ${table}`)
        .get()
    return Number(row?.count)
}

const pairs = testEngines.flatMap(from => testEngines.map(to => [from, to] as const))

for (const [from, to] of pairs) {
    describe(`database transfer ${from.name} -> ${to.name}`, () => {
        test('reproduces every row, the schema and the journal sequence', async () => {
            const media = localStore('local-default', await temporaryDirectory('postdot-media-'))
            const source = await open(from)
            await populate(source, media)
            const exports = await temporaryDirectory('postdot-transfer-')
            const manifest = await exportDatabase(source, join(exports, 'export'))
            expect(manifest.sourceEngine).toBe(from.name)
            expect(manifest.sequences.audit_events).toBeGreaterThan(0)
            expect(manifest.tables.find(t => t.name === 'project_channel_profiles')?.rows).toBe(2)
            expect(
                manifest.tables.find(t => t.name === 'media_representations')?.rows
            ).toBeGreaterThan(1)

            const target = await open(to)
            await importDatabase(target, join(exports, 'export'))

            // The target re-exports to the same bytes, table by table.
            const again = await exportDatabase(target, join(exports, 'again'))
            expect(again.tables).toEqual(manifest.tables)
            expect(again.sequences).toEqual(manifest.sequences)
            // Triggers and constraints are back: the schema equals a fresh one.
            const fresh = await open(to)
            await runMigrations(fresh)
            expect(await describeSchema(target)).toEqual(await describeSchema(fresh))
            // The journal continues after the imported high-water mark.
            const before = manifest.sequences.audit_events!
            await createManualStore(target).createProject({
                name: 'After transfer',
                subjectId: 'owner',
                displayName: 'Owner',
                workspaceId: 'test-workspace',
            })
            const next = await target.sql
                .statement<{ value: number }>(
                    'select min(sequence) as value from audit_events where sequence > ?1'
                )
                .get(before)
            expect(Number(next?.value)).toBe(before + 1)
            // Media remain readable through the imported rows.
            const avatar = await target.sql
                .statement<{ objectKey: string }>(
                    "select object_key as objectKey from user_avatars where state = 'ready'"
                )
                .get()
            expect(await media.stat(avatar!.objectKey)).not.toBeNull()
        }, 30_000)
    })
}

describe('database transfer refusals', () => {
    const engine = testEngines[testEngines.length - 1]!

    async function exported() {
        const media = localStore('local-default', await temporaryDirectory('postdot-media-'))
        const source = await open(testEngines[0]!)
        await populate(source, media)
        const directory = join(await temporaryDirectory('postdot-transfer-'), 'export')
        const manifest = await exportDatabase(source, directory)
        return { directory, manifest }
    }

    async function rewrite(
        directory: string,
        change: (manifest: TransferManifest) => TransferManifest
    ): Promise<void> {
        const path = join(directory, 'manifest.json')
        const manifest = JSON.parse(await readFile(path, 'utf8')) as TransferManifest
        await writeFile(path, JSON.stringify(change(manifest)))
    }

    test('refuses a target that already holds data', async () => {
        const { directory } = await exported()
        const target = await open(engine)
        await runMigrations(target)
        await seedTestWorkspace(target)
        await expect(importDatabase(target, directory)).rejects.toThrow('not empty')
    }, 30_000)

    test('refuses a tampered file before touching the target', async () => {
        const { directory } = await exported()
        const file = join(directory, 'tables/projects.ndjson')
        await writeFile(file, (await readFile(file, 'utf8')).replace('Transferred', 'Tampered'))
        const target = await open(engine)
        await expect(importDatabase(target, directory)).rejects.toThrow('checksum')
        expect(
            await target.sql
                .statement('select 1 from postdot_migrations')
                .get()
                .catch(() => null)
        ).toBeNull()
    }, 30_000)

    test('refuses an export from another schema version', async () => {
        const { directory } = await exported()
        await rewrite(directory, manifest => ({
            ...manifest,
            migrations: manifest.migrations.slice(0, -1),
        }))
        await expect(importDatabase(await open(engine), directory)).rejects.toThrow(
            'schema version'
        )
    }, 30_000)

    test('rolls back entirely when the rows break a foreign key', async () => {
        const { directory, manifest } = await exported()
        // Drop the projects while keeping their children, with a consistent manifest.
        await writeFile(join(directory, 'tables/projects.ndjson'), '')
        await rewrite(directory, current => ({
            ...current,
            tables: current.tables.map(table =>
                table.name === 'projects'
                    ? {
                          ...table,
                          rows: 0,
                          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                      }
                    : table
            ),
        }))
        expect(manifest.tables.find(t => t.name === 'projects')?.rows).toBe(1)
        const target = await open(engine)
        await expect(importDatabase(target, directory)).rejects.toThrow()
        expect(await count(target, 'actors')).toBe(0)
        expect(await count(target, 'instance_state')).toBe(1)
        const fresh = await open(engine)
        await runMigrations(fresh)
        expect(await describeSchema(target)).toEqual(await describeSchema(fresh))
    }, 30_000)
})

describe('media transfer', () => {
    async function fixture() {
        const sourceRoot = await temporaryDirectory('postdot-media-source-')
        const source = localStore('local-default', sourceRoot)
        const destination = localStore(
            'shared-media',
            await temporaryDirectory('postdot-media-target-')
        )
        const database = await open(testEngines[testEngines.length - 1]!)
        await populate(database, source)
        return { database, source, destination, sourceRoot }
    }

    async function storeIds(database: DatabaseHandle): Promise<string[]> {
        const rows = await database.sql
            .statement<{ storeId: string }>(
                `select store_id as storeId from media_representations
                 union select store_id from user_avatars`
            )
            .all()
        return rows.map(row => row.storeId)
    }

    test('copies and verifies every object, then relocates the rows; a rerun is a no-op', async () => {
        const { database, source, destination } = await fixture()
        const report = await transferMedia({ database, source, destination })
        expect(report.copied).toBeGreaterThan(1)
        expect(report.relocatedRows).toBeGreaterThan(report.copied - 1)
        expect(await storeIds(database)).toEqual(['shared-media'])
        // The library reads through the new store.
        const keys = await database.sql
            .statement<{ objectKey: string }>(
                "select object_key as objectKey from media_representations where state = 'ready'"
            )
            .all()
        for (const { objectKey } of keys) expect(await destination.stat(objectKey)).not.toBeNull()
        // The source store is untouched.
        for (const { objectKey } of keys) expect(await source.stat(objectKey)).not.toBeNull()
        expect(await transferMedia({ database, source, destination })).toEqual({
            copied: 0,
            alreadyPresent: 0,
            skippedMissing: 0,
            bytes: 0,
            relocatedRows: 0,
        })
    }, 30_000)

    test('refuses an object whose bytes no longer match the database, relocating nothing', async () => {
        const { database, source, destination } = await fixture()
        const avatar = await database.sql
            .statement<{ objectKey: string }>(
                "select object_key as objectKey from user_avatars where state = 'ready'"
            )
            .get()
        await source.put(avatar!.objectKey, new Blob([previewFixturePng(32, 32)]).stream())
        await expect(transferMedia({ database, source, destination })).rejects.toThrow(
            'does not match the database'
        )
        expect(await storeIds(database)).toEqual(['local-default'])
    }, 30_000)

    test('never overwrites a different object already in the destination', async () => {
        const { database, source, destination } = await fixture()
        const avatar = await database.sql
            .statement<{ objectKey: string }>(
                "select object_key as objectKey from user_avatars where state = 'ready'"
            )
            .get()
        await destination.put(avatar!.objectKey, new Blob([new Uint8Array([1, 2, 3])]).stream())
        await expect(transferMedia({ database, source, destination })).rejects.toThrow(
            'already holds a different object'
        )
        expect(await storeIds(database)).toEqual(['local-default'])
    }, 30_000)

    test('refuses a destination with the same store ID', async () => {
        const { database, source } = await fixture()
        const same = localStore('local-default', await temporaryDirectory('postdot-media-same-'))
        await expect(transferMedia({ database, source, destination: same })).rejects.toThrow(
            'own store ID'
        )
    }, 30_000)
})
