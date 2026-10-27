import { createHash, randomUUID } from 'node:crypto'

import { MediaInspectionRegistry } from '@postdot/core'
import type { MediaStore } from '@postdot/media'

import type { PostdotDatabase } from './client'

export const avatarMaxBytes = 5 * 1024 * 1024
const abandonedUploadMs = 60 * 60 * 1000
const inspectors = new MediaInspectionRegistry()

export class AvatarValidationError extends Error {}

interface AvatarRow {
    readonly id: string
    readonly userId: string
    readonly objectKey: string
    readonly contentType: string
    readonly storeId: string
    readonly state: 'pending' | 'ready' | 'retired'
}

export function createUserAvatarStore(database: PostdotDatabase, storage: MediaStore) {
    const client = database.$client
    const url = (id: string) => `/api/account/avatars/${id}`
    const get = client.query<AvatarRow, [string]>(`SELECT id, user_id as userId,
        object_key as objectKey, content_type as contentType, store_id as storeId, state
        FROM user_avatars WHERE id = ?`)

    async function reconcile() {
        const now = Date.now()
        if (client.query('SELECT 1 FROM media_backup_fences WHERE expires_at > ?').get(now)) return
        client
            .query(`UPDATE user_avatars SET state = 'retired', updated_at = ?
            WHERE (state = 'pending' AND created_at < ?)
            OR (state = 'ready' AND NOT EXISTS
                (SELECT 1 FROM user WHERE user.id = user_avatars.user_id
                 AND user.image = '/api/account/avatars/' || user_avatars.id))`)
            .run(now, now - abandonedUploadMs)
        const rows = client
            .query<AvatarRow, []>(`SELECT id, user_id as userId,
            object_key as objectKey, content_type as contentType, store_id as storeId, state
            FROM user_avatars WHERE state = 'retired'`)
            .all()
        for (const row of rows) {
            if (row.storeId !== storage.storeId) continue
            // Recheck the shared backup fence before each physical deletion.
            if (
                client
                    .query('SELECT 1 FROM media_backup_fences WHERE expires_at > ?')
                    .get(Date.now())
            )
                return
            await storage.delete(row.objectKey)
            client.query("DELETE FROM user_avatars WHERE id = ? AND state = 'retired'").run(row.id)
        }
    }

    return {
        reconcile,
        async replace(userId: string, bytes: Uint8Array): Promise<string> {
            if (bytes.byteLength === 0 || bytes.byteLength > avatarMaxBytes) {
                throw new AvatarValidationError('avatar_size')
            }
            let inspected
            try {
                inspected = inspectors.inspect(bytes, {
                    maxHeaderBytes: 256 * 1024,
                    maxPixels: 16_000_000,
                })
            } catch {
                throw new AvatarValidationError('avatar_format')
            }
            if (
                !inspected ||
                !['image/png', 'image/jpeg', 'image/webp'].includes(inspected.contentType) ||
                inspected.width === null ||
                inspected.height === null ||
                inspected.isAnimated
            ) {
                throw new AvatarValidationError('avatar_format')
            }
            const id = randomUUID()
            const objectKey = `avatars/${id}`
            const now = Date.now()
            client
                .query(`INSERT INTO user_avatars
                (id, user_id, state, store_id, object_key, content_type, byte_size, sha256, created_at, updated_at)
                VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`)
                .run(
                    id,
                    userId,
                    storage.storeId,
                    objectKey,
                    inspected.contentType,
                    bytes.byteLength,
                    createHash('sha256').update(bytes).digest('hex'),
                    now,
                    now
                )
            try {
                await storage.put(objectKey, new Blob([new Uint8Array(bytes)]).stream(), {
                    maxBytes: avatarMaxBytes,
                    expectedSize: bytes.byteLength,
                    contentType: inspected.contentType,
                })
                client
                    .transaction(() => {
                        client
                            .query(
                                "UPDATE user_avatars SET state = 'retired', updated_at = ? WHERE user_id = ? AND state = 'ready'"
                            )
                            .run(Date.now(), userId)
                        client
                            .query(
                                "UPDATE user_avatars SET state = 'ready', updated_at = ? WHERE id = ?"
                            )
                            .run(Date.now(), id)
                        const updated = client
                            .query('UPDATE user SET image = ?, updated_at = ? WHERE id = ?')
                            .run(url(id), Date.now(), userId)
                        if (updated.changes !== 1) throw new Error('Avatar owner is unavailable')
                    })
                    .immediate()
            } catch (error) {
                client
                    .query(
                        "UPDATE user_avatars SET state = 'retired', updated_at = ? WHERE id = ? AND state = 'pending'"
                    )
                    .run(Date.now(), id)
                throw error
            }
            // Cleanup is retryable and cannot make a committed replacement look failed.
            await reconcile().catch(() => undefined)
            return url(id)
        },
        async remove(userId: string) {
            client
                .transaction(() => {
                    client
                        .query('UPDATE user SET image = NULL, updated_at = ? WHERE id = ?')
                        .run(Date.now(), userId)
                    client
                        .query(
                            "UPDATE user_avatars SET state = 'retired', updated_at = ? WHERE user_id = ? AND state = 'ready'"
                        )
                        .run(Date.now(), userId)
                })
                .immediate()
            await reconcile().catch(() => undefined)
        },
        async open(id: string) {
            const row = get.get(id)
            if (!row || row.state !== 'ready' || row.storeId !== storage.storeId) return null
            const object = await storage.open(row.objectKey, { maxBytes: avatarMaxBytes })
            return object === null ? null : { stream: object.stream, contentType: row.contentType }
        },
    }
}

export type UserAvatarStore = ReturnType<typeof createUserAvatarStore>
