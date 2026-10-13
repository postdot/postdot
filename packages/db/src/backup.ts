import { Database } from 'bun:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { MediaStore } from '@postbot/media'

import { createRecoveryHold } from './recovery-hold'
import { acquireRuntimeQuiescenceLock } from './runtime-quiescence'

const SQLITE_BUSY_TIMEOUT_MILLISECONDS = 5_000
const MEDIA_BACKUP_VERSION = 2
const MEDIA_BACKUP_DATABASE_FILENAME = 'database.sqlite'
const MEDIA_BACKUP_MANIFEST_FILENAME = 'manifest.json'
const DEFAULT_MEDIA_BACKUP_FENCE_LEASE_MS = 15 * 60_000

export interface MediaBackupOptions {
    readonly databaseFilename: string
    readonly destinationDirectory: string
    readonly mediaStore: MediaStore
    readonly now?: () => number
    readonly ownerId?: string
    readonly fenceLeaseMs?: number
}

export interface MediaRestoreOptions {
    readonly sourceDirectory: string
    readonly databaseFilename: string
    readonly mediaStore: MediaStore
    readonly now?: () => number
    readonly ownerId?: string
    readonly fenceLeaseMs?: number
}

export interface MediaBackupManifest {
    readonly version: 1 | 2
    readonly createdAt: number
    readonly database: {
        readonly filename: typeof MEDIA_BACKUP_DATABASE_FILENAME
        readonly size: number
        readonly sha256: string
    }
    readonly avatars?: readonly MediaBackupAvatar[]
    readonly representations: readonly MediaBackupRepresentation[]
}

export interface MediaBackupRepresentation {
    readonly projectId: string
    readonly assetId: string
    readonly representationId: string
    readonly kind: 'original' | 'derived'
    readonly state: 'stored' | 'inspecting' | 'ready' | 'deletion_requested'
    readonly storeId: string
    readonly objectKey: string
    readonly relativePath: string
    readonly size: number
    readonly sha256: string
    readonly databaseByteSize: number | null
    readonly databaseSha256: string | null
}

export interface MediaBackupAvatar {
    readonly avatarId: string
    readonly userId: string
    readonly state: 'ready' | 'retired'
    readonly storeId: string
    readonly objectKey: string
    readonly relativePath: string
    readonly size: number
    readonly sha256: string
    readonly databaseByteSize: number
    readonly databaseSha256: string
}

export function backupDatabase(sourceFilename: string, destinationFilename: string) {
    const sourcePath = resolve(sourceFilename)
    const destinationPath = resolve(destinationFilename)

    assertDifferentPaths(sourcePath, destinationPath)
    assertExistingFile(sourcePath, 'Database')
    if (existsSync(destinationPath)) {
        throw new Error(`Backup destination already exists: ${destinationPath}`)
    }

    mkdirSync(dirname(destinationPath), { recursive: true })

    const database = openReadOnlyDatabase(sourcePath)
    try {
        assertHealthy(database, sourcePath)
        assertPostbotDatabase(database, sourcePath)
        database.query('VACUUM INTO ?').run(destinationPath)

        const backup = openReadOnlyDatabase(destinationPath)
        try {
            assertHealthy(backup, destinationPath)
            assertPostbotDatabase(backup, destinationPath)
        } finally {
            backup.close()
        }
    } catch (error) {
        removeIfPresent(destinationPath)
        throw error
    } finally {
        database.close()
    }
}

export function restoreDatabase(sourceFilename: string, destinationFilename: string) {
    const sourcePath = resolve(sourceFilename)
    const destinationPath = resolve(destinationFilename)
    const runtimeLock = acquireRuntimeQuiescenceLock(destinationPath, 'restore')

    try {
        restoreDatabaseWithoutRuntimeLock(sourcePath, destinationPath)
    } finally {
        runtimeLock.release()
    }
}

function restoreDatabaseWithoutRuntimeLock(sourcePath: string, destinationPath: string) {
    const temporaryPath = `${destinationPath}.${randomUUID()}.restore`

    assertDifferentPaths(sourcePath, destinationPath)
    assertExistingFile(sourcePath, 'Backup')

    const backup = openReadOnlyDatabase(sourcePath)
    try {
        assertHealthy(backup, sourcePath)
        assertPostbotDatabase(backup, sourcePath)
    } finally {
        backup.close()
    }

    mkdirSync(dirname(destinationPath), { recursive: true })

    try {
        copyFileSync(sourcePath, temporaryPath)
        const restored = openReadOnlyDatabase(temporaryPath)
        try {
            assertHealthy(restored, temporaryPath)
            assertPostbotDatabase(restored, temporaryPath)
        } finally {
            restored.close()
        }
        createRecoveryHold(destinationPath, 'restore', true)
        renameSync(temporaryPath, destinationPath)
    } catch (error) {
        removeIfPresent(temporaryPath)
        throw error
    }
}

/**
 * Creates a complete, inspectable backup of the SQLite database and the media
 * objects referenced by retained representations. Object bytes are copied as
 * streams and never assembled into one in-memory buffer.
 */
export async function backupWithMedia(options: MediaBackupOptions): Promise<MediaBackupManifest> {
    const sourcePath = resolve(options.databaseFilename)
    const destinationPath = resolve(options.destinationDirectory)
    const temporaryPath = `${destinationPath}.${randomUUID()}.backup`
    const now = options.now ?? Date.now
    const ownerId = options.ownerId ?? `backup-${randomUUID()}`
    const leaseMs = validateFenceLease(options.fenceLeaseMs)

    assertExistingFile(sourcePath, 'Database')
    if (sourcePath === destinationPath) {
        throw new Error('Database and backup bundle paths must be different')
    }
    if (existsSync(destinationPath)) {
        throw new Error(`Backup destination already exists: ${destinationPath}`)
    }

    await mkdir(dirname(destinationPath), { recursive: true })
    const fence = acquireMediaBackupFence(sourcePath, ownerId, now(), leaseMs)

    try {
        await mkdir(join(temporaryPath, 'media'), { recursive: true, mode: 0o700 })
        const databasePath = join(temporaryPath, MEDIA_BACKUP_DATABASE_FILENAME)
        backupDatabase(sourcePath, databasePath)
        clearMediaBackupFenceFromSnapshot(databasePath)

        const snapshot = openReadOnlyDatabase(databasePath)
        let representations: readonly MediaBackupRepresentation[]
        let avatars: readonly MediaBackupAvatar[]
        try {
            assertHealthy(snapshot, databasePath)
            assertPostbotDatabase(snapshot, databasePath)
            representations = snapshotMediaRepresentations(snapshot, options.mediaStore)
            avatars = snapshotAvatars(snapshot, options.mediaStore)
        } finally {
            snapshot.close()
        }

        const backedUpRepresentations: MediaBackupRepresentation[] = []
        const backedUpAvatars: MediaBackupAvatar[] = []
        for (const representation of [...representations, ...avatars]) {
            fence.refresh(now())
            const object = await options.mediaStore.open(representation.objectKey, {
                maxBytes: options.mediaStore.maxObjectBytes,
            })
            if (object === null) {
                throw new Error(
                    `Media object ${representation.objectKey} disappeared during backup`
                )
            }
            if (
                representation.databaseByteSize !== null &&
                object.metadata.size !== representation.databaseByteSize
            ) {
                throw new Error(
                    `Media object ${representation.objectKey} changed size during backup`
                )
            }

            const relativePath = representation.relativePath
            const objectPath = safeBundlePath(temporaryPath, relativePath)
            await mkdir(dirname(objectPath), { recursive: true, mode: 0o700 })
            const copied = await copyStreamToFile(object.stream, objectPath)
            await chmod(objectPath, 0o600)
            if (
                (representation.databaseByteSize !== null &&
                    copied.size !== representation.databaseByteSize) ||
                (representation.databaseSha256 !== null &&
                    copied.sha256 !== representation.databaseSha256)
            ) {
                throw new Error(
                    `Media object ${representation.objectKey} failed its backup integrity check`
                )
            }
            if ('avatarId' in representation) {
                backedUpAvatars.push({
                    ...representation,
                    size: copied.size,
                    sha256: copied.sha256,
                })
            } else {
                backedUpRepresentations.push({
                    ...representation,
                    size: copied.size,
                    sha256: copied.sha256,
                })
            }
        }

        fence.refresh(now())
        const databaseIntegrity = await hashFile(databasePath)
        const manifest: MediaBackupManifest = {
            version: MEDIA_BACKUP_VERSION,
            createdAt: requireBackupTimestamp(now()),
            database: {
                filename: MEDIA_BACKUP_DATABASE_FILENAME,
                size: databaseIntegrity.size,
                sha256: databaseIntegrity.sha256,
            },
            representations: backedUpRepresentations,
            avatars: backedUpAvatars,
        }
        await writeFile(
            join(temporaryPath, MEDIA_BACKUP_MANIFEST_FILENAME),
            `${JSON.stringify(manifest, null, 2)}\n`,
            { mode: 0o600 }
        )
        fence.refresh(now())
        await rename(temporaryPath, destinationPath)
        return manifest
    } catch (error) {
        await removeIfPresentAsync(temporaryPath)
        throw error
    } finally {
        fence.release()
    }
}

/**
 * Restores a complete media backup after validating every database and object
 * checksum. Existing destination objects are never overwritten when their
 * bytes differ from the bundle.
 */
export async function restoreWithMedia(options: MediaRestoreOptions): Promise<void> {
    const sourcePath = resolve(options.sourceDirectory)
    const destinationPath = resolve(options.databaseFilename)
    const runtimeLock = acquireRuntimeQuiescenceLock(destinationPath, 'restore')

    try {
        await restoreWithMediaWithoutRuntimeLock(options, sourcePath, destinationPath)
    } finally {
        runtimeLock.release()
    }
}

async function restoreWithMediaWithoutRuntimeLock(
    options: MediaRestoreOptions,
    sourcePath: string,
    destinationPath: string
): Promise<void> {
    const temporaryPath = `${destinationPath}.${randomUUID()}.restore`
    const now = options.now ?? Date.now
    const ownerId = options.ownerId ?? `restore-${randomUUID()}`
    const leaseMs = validateFenceLease(options.fenceLeaseMs)
    const manifest = await readMediaBackupManifest(sourcePath)
    const bundleDatabasePath = safeBundlePath(sourcePath, manifest.database.filename)

    await assertFileIntegrity(bundleDatabasePath, manifest.database.size, manifest.database.sha256)
    const bundleDatabase = openReadOnlyDatabase(bundleDatabasePath)
    try {
        assertHealthy(bundleDatabase, bundleDatabasePath)
        assertPostbotDatabase(bundleDatabase, bundleDatabasePath)
        assertBackupDatabaseMediaMatches(bundleDatabase, manifest, options.mediaStore)
        const expectedAvatars = snapshotAvatars(bundleDatabase, options.mediaStore)
        const actualAvatars = manifest.avatars ?? []
        if (
            expectedAvatars.length !== actualAvatars.length ||
            expectedAvatars.some(row => {
                const item = actualAvatars.find(candidate => candidate.avatarId === row.avatarId)
                return (
                    !item ||
                    Object.entries(row).some(([key, value]) => Reflect.get(item, key) !== value)
                )
            })
        )
            throw new Error('Avatar backup manifest does not match its database snapshot')
    } finally {
        bundleDatabase.close()
    }

    for (const representation of [...manifest.representations, ...(manifest.avatars ?? [])]) {
        const objectPath = safeBundlePath(sourcePath, representation.relativePath)
        await assertFileIntegrity(objectPath, representation.size, representation.sha256)
        if (representation.storeId !== options.mediaStore.storeId) {
            throw new Error(
                `Media backup store ${representation.storeId} does not match destination store ${options.mediaStore.storeId}`
            )
        }
        const existing = await options.mediaStore.open(representation.objectKey, {
            maxBytes: options.mediaStore.maxObjectBytes,
        })
        if (existing !== null) {
            const existingIntegrity = await hashStream(existing.stream)
            if (
                existing.metadata.size !== representation.size ||
                existingIntegrity.sha256 !== representation.sha256
            ) {
                throw new Error(
                    `Destination media object ${representation.objectKey} differs from the backup`
                )
            }
        }
    }

    const fence = existsSync(destinationPath)
        ? acquireMediaBackupFence(destinationPath, ownerId, now(), leaseMs)
        : null
    try {
        await mkdir(dirname(destinationPath), { recursive: true })
        await copyFile(bundleDatabasePath, temporaryPath)
        const restored = openReadOnlyDatabase(temporaryPath)
        try {
            assertHealthy(restored, temporaryPath)
            assertPostbotDatabase(restored, temporaryPath)
        } finally {
            restored.close()
        }

        for (const representation of [...manifest.representations, ...(manifest.avatars ?? [])]) {
            fence?.refresh(now())
            const existing = await options.mediaStore.stat(representation.objectKey)
            if (existing !== null) continue
            const objectPath = safeBundlePath(sourcePath, representation.relativePath)
            await options.mediaStore.put(representation.objectKey, Bun.file(objectPath).stream(), {
                expectedSize: representation.size,
                maxBytes: options.mediaStore.maxObjectBytes,
            })
            const stored = await options.mediaStore.open(representation.objectKey, {
                maxBytes: options.mediaStore.maxObjectBytes,
            })
            if (stored === null) {
                throw new Error(
                    `Restored media object ${representation.objectKey} disappeared before verification`
                )
            }
            const storedIntegrity = await hashStream(stored.stream)
            if (
                stored.metadata.size !== representation.size ||
                storedIntegrity.sha256 !== representation.sha256
            ) {
                throw new Error(
                    `Restored media object ${representation.objectKey} failed its integrity check`
                )
            }
        }

        fence?.refresh(now())
        createRecoveryHold(destinationPath, 'restore', true)
        renameSync(temporaryPath, destinationPath)
    } catch (error) {
        await removeIfPresentAsync(temporaryPath)
        throw error
    } finally {
        fence?.release()
    }
}

interface MediaBackupFence {
    refresh(at: number): void
    release(): void
}

function acquireMediaBackupFence(
    databaseFilename: string,
    ownerId: string,
    at: number,
    leaseMs: number
): MediaBackupFence {
    const database = new Database(databaseFilename)
    database.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MILLISECONDS}`)
    const expiresAt = safeAdd(at, leaseMs)
    const result = database
        .query(
            `INSERT INTO media_backup_fences (id, owner_id, expires_at, created_at, updated_at)
             VALUES (1, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                 owner_id = excluded.owner_id,
                 expires_at = excluded.expires_at,
                 created_at = excluded.created_at,
                 updated_at = excluded.updated_at
             WHERE media_backup_fences.expires_at <= ?`
        )
        .run(ownerId, expiresAt, at, at, at)
    if (result.changes !== 1) {
        database.close()
        throw new Error('Another media backup or restore is already in progress')
    }

    return {
        refresh(refreshAt: number) {
            const refreshed = database
                .query(
                    `UPDATE media_backup_fences
                     SET expires_at = ?, updated_at = ?
                     WHERE id = 1 AND owner_id = ?`
                )
                .run(safeAdd(refreshAt, leaseMs), refreshAt, ownerId)
            if (refreshed.changes !== 1) {
                throw new Error('The media backup fence was lost')
            }
        },
        release() {
            try {
                database
                    .query('DELETE FROM media_backup_fences WHERE id = 1 AND owner_id = ?')
                    .run(ownerId)
            } catch (error) {
                // A media restore atomically replaces the database path while this
                // connection still points to the previous inode.
                if (!isDatabaseMovedError(error)) throw error
            } finally {
                database.close()
            }
        },
    }
}

function isDatabaseMovedError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false

    return 'code' in error && error.code === 'SQLITE_READONLY_DBMOVED'
}

function clearMediaBackupFenceFromSnapshot(filename: string): void {
    const database = new Database(filename)
    try {
        database.query('DELETE FROM media_backup_fences').run()
    } finally {
        database.close()
    }
}

function snapshotAvatars(database: Database, mediaStore: MediaStore): readonly MediaBackupAvatar[] {
    if (
        !database
            .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user_avatars'")
            .get()
    )
        return []
    const rows = database
        .query<
            Omit<MediaBackupAvatar, 'relativePath' | 'databaseByteSize' | 'databaseSha256'>,
            []
        >(`
        SELECT id as avatarId, user_id as userId, state, store_id as storeId,
            object_key as objectKey, byte_size as size, sha256
        FROM user_avatars WHERE state IN ('ready', 'retired') ORDER BY id`)
        .all()
    return rows.map(row => {
        if (row.storeId !== mediaStore.storeId)
            throw new Error('Avatar backup store does not match')
        return {
            ...row,
            relativePath: `avatars/${row.avatarId}.bin`,
            databaseByteSize: row.size,
            databaseSha256: row.sha256,
        }
    })
}

function snapshotMediaRepresentations(
    database: Database,
    mediaStore: MediaStore
): readonly MediaBackupRepresentation[] {
    const rows = database
        .query<
            {
                projectId: string
                assetId: string
                representationId: string
                kind: 'original' | 'derived'
                state: 'stored' | 'inspecting' | 'ready' | 'deletion_requested'
                storeId: string
                objectKey: string
                byteSize: number | null
                sha256: string | null
            },
            []
        >(
            `SELECT project_id as projectId,
                    asset_id as assetId,
                    id as representationId,
                    kind,
                    state,
                    store_id as storeId,
                    object_key as objectKey,
                    byte_size as byteSize,
                    sha256
             FROM media_representations
             WHERE state IN ('stored', 'inspecting', 'ready', 'deletion_requested')
             ORDER BY project_id, id`
        )
        .all()

    return rows.map(row => {
        if (row.storeId !== mediaStore.storeId) {
            throw new Error(
                `Media representation ${row.representationId} belongs to store ${row.storeId}, not ${mediaStore.storeId}`
            )
        }
        return {
            projectId: row.projectId,
            assetId: row.assetId,
            representationId: row.representationId,
            kind: row.kind,
            state: row.state,
            storeId: row.storeId,
            objectKey: row.objectKey,
            relativePath: `media/${row.representationId}.bin`,
            size: row.byteSize ?? 0,
            sha256: row.sha256 ?? '',
            databaseByteSize: row.byteSize,
            databaseSha256: row.sha256,
        }
    })
}

function assertBackupDatabaseMediaMatches(
    database: Database,
    manifest: MediaBackupManifest,
    mediaStore: MediaStore
): void {
    const rows = database
        .query<
            {
                projectId: string
                assetId: string
                representationId: string
                kind: 'original' | 'derived'
                state: 'stored' | 'inspecting' | 'ready' | 'deletion_requested'
                storeId: string
                objectKey: string
                byteSize: number | null
                sha256: string | null
            },
            []
        >(
            `SELECT project_id as projectId,
                    asset_id as assetId,
                    id as representationId,
                    kind,
                    state,
                    store_id as storeId,
                    object_key as objectKey,
                    byte_size as byteSize,
                    sha256
             FROM media_representations
             WHERE state IN ('stored', 'inspecting', 'ready', 'deletion_requested')
             ORDER BY project_id, id`
        )
        .all()
    if (rows.length !== manifest.representations.length) {
        throw new Error('Media backup manifest does not match its database snapshot')
    }

    for (const row of rows) {
        const item = manifest.representations.find(
            candidate => candidate.representationId === row.representationId
        )
        if (
            item === undefined ||
            item.projectId !== row.projectId ||
            item.assetId !== row.assetId ||
            item.kind !== row.kind ||
            item.state !== row.state ||
            item.storeId !== row.storeId ||
            item.objectKey !== row.objectKey ||
            item.databaseByteSize !== row.byteSize ||
            item.databaseSha256 !== row.sha256 ||
            row.storeId !== mediaStore.storeId
        ) {
            throw new Error('Media backup manifest does not match its database snapshot')
        }
    }
}

async function readMediaBackupManifest(bundlePath: string): Promise<MediaBackupManifest> {
    const manifestPath = safeBundlePath(bundlePath, MEDIA_BACKUP_MANIFEST_FILENAME)
    let parsed: unknown
    try {
        parsed = JSON.parse(await readFile(manifestPath, 'utf8'))
    } catch {
        throw new Error(`Media backup manifest is not valid JSON: ${manifestPath}`)
    }
    if (!isRecord(parsed) || (parsed.version !== 1 && parsed.version !== MEDIA_BACKUP_VERSION)) {
        throw new Error('Unsupported media backup manifest version')
    }
    if (
        !isRecord(parsed.database) ||
        parsed.database.filename !== MEDIA_BACKUP_DATABASE_FILENAME ||
        !isSafeNonNegativeInteger(parsed.database.size) ||
        !isSha256(parsed.database.sha256)
    ) {
        throw new Error('Media backup manifest database entry is invalid')
    }
    if (!Array.isArray(parsed.representations)) {
        throw new Error('Media backup manifest representations entry is invalid')
    }
    const representationIds = new Set<string>()
    const objectKeys = new Set<string>()
    for (const value of parsed.representations) {
        if (!isRecord(value)) throw new Error('Media backup representation entry is invalid')
        if (
            typeof value.projectId !== 'string' ||
            typeof value.assetId !== 'string' ||
            typeof value.representationId !== 'string' ||
            typeof value.storeId !== 'string' ||
            typeof value.objectKey !== 'string' ||
            typeof value.relativePath !== 'string' ||
            !['original', 'derived'].includes(String(value.kind)) ||
            !['stored', 'inspecting', 'ready', 'deletion_requested'].includes(
                String(value.state)
            ) ||
            !isSafeNonNegativeInteger(value.size) ||
            !isSha256(value.sha256) ||
            (value.databaseByteSize !== null &&
                !isSafeNonNegativeInteger(value.databaseByteSize)) ||
            (value.databaseSha256 !== null && !isSha256(value.databaseSha256)) ||
            value.relativePath !== `media/${value.representationId}.bin` ||
            value.projectId.length === 0 ||
            value.assetId.length === 0 ||
            value.representationId.length === 0 ||
            value.storeId.length === 0 ||
            value.objectKey.length === 0 ||
            representationIds.has(value.representationId) ||
            objectKeys.has(value.objectKey)
        ) {
            throw new Error('Media backup representation entry is invalid')
        }
        representationIds.add(value.representationId)
        objectKeys.add(value.objectKey)
    }
    if (parsed.version === 2 && !Array.isArray(parsed.avatars)) {
        throw new Error('Avatar backup manifest entry is invalid')
    }
    const avatars = parsed.avatars ?? []
    if (!Array.isArray(avatars)) throw new Error('Avatar backup manifest entry is invalid')
    const avatarIds = new Set<string>()
    for (const value of avatars) {
        if (
            !isRecord(value) ||
            typeof value.avatarId !== 'string' ||
            !/^[a-zA-Z0-9-]+$/.test(value.avatarId) ||
            typeof value.userId !== 'string' ||
            value.userId.length === 0 ||
            typeof value.storeId !== 'string' ||
            value.storeId.length === 0 ||
            typeof value.objectKey !== 'string' ||
            value.objectKey.length === 0 ||
            !['ready', 'retired'].includes(String(value.state)) ||
            value.relativePath !== `avatars/${value.avatarId}.bin` ||
            !isSafeNonNegativeInteger(value.size) ||
            !isSha256(value.sha256) ||
            value.databaseByteSize !== value.size ||
            value.databaseSha256 !== value.sha256 ||
            avatarIds.has(value.avatarId) ||
            objectKeys.has(value.objectKey)
        ) {
            throw new Error('Avatar backup manifest entry is invalid')
        }
        avatarIds.add(value.avatarId)
        objectKeys.add(value.objectKey)
    }
    return parsed as unknown as MediaBackupManifest
}

async function copyStreamToFile(
    source: ReadableStream<Uint8Array>,
    filename: string
): Promise<{ readonly size: number; readonly sha256: string }> {
    const writer = Bun.file(filename).writer()
    const reader = source.getReader()
    const hash = createHash('sha256')
    let size = 0
    try {
        while (true) {
            const result = await reader.read()
            if (result.done) break
            if (!(result.value instanceof Uint8Array)) {
                throw new Error('Media storage yielded invalid bytes')
            }
            size += result.value.byteLength
            hash.update(result.value)
            await Promise.resolve(writer.write(result.value))
        }
        await Promise.resolve(writer.end())
    } finally {
        reader.releaseLock()
    }
    return { size, sha256: hash.digest('hex') }
}

async function hashFile(filename: string) {
    return hashStream(Bun.file(filename).stream())
}

async function hashStream(
    stream: ReadableStream<Uint8Array>
): Promise<{ readonly size: number; readonly sha256: string }> {
    const reader = stream.getReader()
    const hash = createHash('sha256')
    let size = 0
    try {
        while (true) {
            const result = await reader.read()
            if (result.done) break
            if (!(result.value instanceof Uint8Array)) {
                throw new Error('Backup stream yielded invalid bytes')
            }
            size += result.value.byteLength
            hash.update(result.value)
        }
    } finally {
        reader.releaseLock()
    }
    return { size, sha256: hash.digest('hex') }
}

async function assertFileIntegrity(filename: string, expectedSize: number, expectedSha256: string) {
    if (
        !Number.isSafeInteger(expectedSize) ||
        expectedSize < 0 ||
        !/^[a-f0-9]{64}$/.test(expectedSha256)
    ) {
        throw new Error(`Media backup integrity metadata is invalid for ${filename}`)
    }
    const actual = await hashFile(filename)
    if (actual.size !== expectedSize || actual.sha256 !== expectedSha256) {
        throw new Error(`Backup file integrity check failed: ${filename}`)
    }
}

function safeBundlePath(bundlePath: string, relativePath: string): string {
    if (
        relativePath.length === 0 ||
        relativePath.startsWith('/') ||
        relativePath.includes('\\') ||
        relativePath
            .split('/')
            .some(segment => segment === '' || segment === '.' || segment === '..')
    ) {
        throw new Error(`Invalid media backup path: ${relativePath}`)
    }
    const resolvedBundle = resolve(bundlePath)
    const resolvedPath = resolve(resolvedBundle, ...relativePath.split('/'))
    const fromBundle = relative(resolvedBundle, resolvedPath)
    if (fromBundle === '..' || fromBundle.startsWith(`..${sep}`) || isAbsolute(fromBundle)) {
        throw new Error(`Invalid media backup path: ${relativePath}`)
    }
    return resolvedPath
}

function validateFenceLease(value: number | undefined): number {
    const leaseMs = value ?? DEFAULT_MEDIA_BACKUP_FENCE_LEASE_MS
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000) {
        throw new Error('Media backup fence lease must be at least one second')
    }
    return leaseMs
}

function isSafeNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isSha256(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function requireBackupTimestamp(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error('Backup timestamp must be a non-negative epoch-millisecond timestamp')
    }
    return value
}

function safeAdd(value: number, amount: number): number {
    const result = value + amount
    if (!Number.isSafeInteger(result)) throw new Error('Backup fence timestamp overflow')
    return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function removeIfPresentAsync(filename: string): Promise<void> {
    await rm(filename, { recursive: true, force: true })
}

function openReadOnlyDatabase(filename: string) {
    const database = new Database(filename, { readonly: true })
    database.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MILLISECONDS}`)
    return database
}

function assertHealthy(database: Database, filename: string) {
    const result = database.query<{ integrity_check: string }, []>('PRAGMA integrity_check').get()
    if (result?.integrity_check !== 'ok') {
        throw new Error(`SQLite integrity check failed for ${filename}`)
    }
}

function assertPostbotDatabase(database: Database, filename: string) {
    const migrationsTable = database
        .query<{ name: string }, []>(
            `SELECT name
             FROM sqlite_master
             WHERE type = 'table' AND name = '__drizzle_migrations'`
        )
        .get()

    if (!migrationsTable) {
        throw new Error(`The SQLite file is not a Postbot database: ${filename}`)
    }
}

function assertExistingFile(filename: string, label: string) {
    if (!existsSync(filename)) {
        throw new Error(`${label} file does not exist: ${filename}`)
    }
}

function assertDifferentPaths(sourcePath: string, destinationPath: string) {
    if (sourcePath === destinationPath) {
        throw new Error('Source and destination database paths must be different')
    }
}

function removeIfPresent(filename: string) {
    if (existsSync(filename)) unlinkSync(filename)
}
