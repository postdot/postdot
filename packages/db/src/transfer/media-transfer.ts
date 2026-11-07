import { createHash } from 'node:crypto'

import type { MediaStore } from '@postdot/media'

import type { DatabaseHandle } from '../client'

/**
 * Offline copy of every media object to another store (ADR-097 §8), such as
 * local files to S3. Objects are copied through the storage contract and
 * verified (size and SHA-256 against the database when it records them, and
 * the written object read back). Only when every object is verified are the
 * database locators rewritten, in one transaction. The source store is never
 * changed, so a failed or interrupted transfer can simply be run again.
 */
export interface MediaTransferOptions {
    readonly database: DatabaseHandle
    readonly source: MediaStore
    readonly destination: MediaStore
    readonly onProgress?: (progress: MediaTransferProgress) => void
}

export interface MediaTransferProgress {
    readonly done: number
    readonly total: number
    readonly objectKey: string
}

export interface MediaTransferReport {
    /** Objects written to the destination. */
    readonly copied: number
    /** Objects already present in the destination with the expected bytes. */
    readonly alreadyPresent: number
    /** Optional objects (unfinished or failed uploads) missing from the source. */
    readonly skippedMissing: number
    readonly bytes: number
    /** Database rows whose store locator now names the destination. */
    readonly relocatedRows: number
}

interface ObjectReference {
    readonly objectKey: string
    /** A row in a live state needs its object; others copy it when present. */
    readonly required: boolean
    readonly byteSize: number | null
    readonly sha256: string | null
}

const locatorTables = ['media_representations', 'user_avatars', 'resource_cleanup_objects'] as const

export async function transferMedia(options: MediaTransferOptions): Promise<MediaTransferReport> {
    const { database, source, destination } = options
    const { sql } = database
    if (source.storeId === destination.storeId) {
        throw new Error(
            `The destination store must have its own store ID (both are ${source.storeId}); ` +
                'set POSTDOT_MEDIA_STORE_ID for the new store'
        )
    }
    for (const table of locatorTables) {
        const foreign = await sql
            .statement<{ storeId: string }, [string, string]>(
                `select distinct store_id as storeId from ${table}
                 where store_id <> ?1 and store_id <> ?2`
            )
            .all(source.storeId, destination.storeId)
        if (foreign.length > 0) {
            throw new Error(
                `Table ${table} references store ${foreign[0]!.storeId}, which is neither the source nor the destination`
            )
        }
    }

    const references = await objectReferences(database, source.storeId)
    let copied = 0
    let alreadyPresent = 0
    let skippedMissing = 0
    let bytes = 0
    for (const [index, reference] of references.entries()) {
        options.onProgress?.({
            done: index,
            total: references.length,
            objectKey: reference.objectKey,
        })
        const outcome = await copyObject(source, destination, reference)
        if (outcome === 'missing') skippedMissing += 1
        else if (outcome.copied) {
            copied += 1
            bytes += outcome.size
        } else alreadyPresent += 1
    }

    const relocatedRows = await sql.transaction(async () => {
        let rows = 0
        for (const table of locatorTables) {
            const result = await sql
                .statement<never, [string, string]>(
                    `update ${table} set store_id = ?1 where store_id = ?2`
                )
                .run(destination.storeId, source.storeId)
            rows += result.changes
        }
        return rows
    }, 'immediate')
    return { copied, alreadyPresent, skippedMissing, bytes, relocatedRows }
}

async function objectReferences(
    database: DatabaseHandle,
    storeId: string
): Promise<ObjectReference[]> {
    const rows = await database.sql
        .statement<
            {
                objectKey: string
                required: number
                byteSize: number | null
                sha256: string | null
            },
            [string]
        >(
            `select object_key as objectKey,
                    case when state in ('stored', 'inspecting', 'ready', 'deletion_requested')
                         then 1 else 0 end as required,
                    byte_size as byteSize, sha256
             from media_representations where store_id = ?1
             union all
             select object_key, case when state in ('ready', 'retired') then 1 else 0 end,
                    byte_size, sha256
             from user_avatars where store_id = ?1`
        )
        .all(storeId)
    const byKey = new Map<string, ObjectReference>()
    for (const row of rows) {
        const existing = byKey.get(row.objectKey)
        byKey.set(row.objectKey, {
            objectKey: row.objectKey,
            required: (existing?.required ?? false) || row.required === 1,
            byteSize: existing?.byteSize ?? row.byteSize,
            sha256: existing?.sha256 ?? row.sha256,
        })
    }
    return [...byKey.values()].sort((a, b) => (a.objectKey < b.objectKey ? -1 : 1))
}

async function copyObject(
    source: MediaStore,
    destination: MediaStore,
    reference: ObjectReference
): Promise<'missing' | { readonly copied: boolean; readonly size: number }> {
    const key = reference.objectKey
    const original = await source.open(key, { maxBytes: source.maxObjectBytes })
    if (original === null) {
        if (reference.required) {
            throw new Error(`Media object ${key} is missing from the source store`)
        }
        return 'missing'
    }
    const sourceDigest = await digest(original.stream)
    if (
        (reference.byteSize !== null && sourceDigest.size !== Number(reference.byteSize)) ||
        (reference.sha256 !== null && sourceDigest.sha256 !== reference.sha256)
    ) {
        throw new Error(`Media object ${key} in the source store does not match the database`)
    }

    const present = await destination.open(key, { maxBytes: destination.maxObjectBytes })
    if (present !== null) {
        const existing = await digest(present.stream)
        if (existing.sha256 !== sourceDigest.sha256 || existing.size !== sourceDigest.size) {
            throw new Error(
                `The destination store already holds a different object at ${key}; it was not overwritten`
            )
        }
        return { copied: false, size: existing.size }
    }

    const reopened = await source.open(key, { maxBytes: source.maxObjectBytes })
    if (reopened === null) throw new Error(`Media object ${key} disappeared from the source store`)
    await destination.put(key, reopened.stream, { expectedSize: sourceDigest.size })
    const written = await destination.open(key, { maxBytes: destination.maxObjectBytes })
    const check = written === null ? null : await digest(written.stream)
    if (
        check === null ||
        check.sha256 !== sourceDigest.sha256 ||
        check.size !== sourceDigest.size
    ) {
        await destination.delete(key)
        throw new Error(`Media object ${key} failed verification after the copy`)
    }
    return { copied: true, size: check.size }
}

async function digest(
    stream: ReadableStream<Uint8Array>
): Promise<{ readonly size: number; readonly sha256: string }> {
    const hash = createHash('sha256')
    let size = 0
    for await (const chunk of stream) {
        hash.update(chunk)
        size += chunk.byteLength
    }
    return { size, sha256: hash.digest('hex') }
}
