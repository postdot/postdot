import type { MediaFinalize, MediaReference, MediaReservation, MediaUpload } from '@postdot/client'
import { defaultMediaUploadContentTypes } from '@postdot/core'
import Uppy, { type Meta, type UppyFile } from '@uppy/core'
import GoldenRetriever from '@uppy/golden-retriever'

import { MediaVerificationError } from '@/lib/media-errors'

export type PostdotMediaUppyFile = UppyFile<Meta, Record<string, never>>

export interface PostdotMediaUploadPolicy {
    readonly allowedContentTypes: readonly string[]
    readonly maxFileSize: number | null
}

export const defaultPostdotMediaUploadPolicy: PostdotMediaUploadPolicy = {
    allowedContentTypes: defaultMediaUploadContentTypes,
    maxFileSize: null,
}

export interface MediaUploadRequestOptions {
    readonly signal?: AbortSignal
}

export interface PostdotMediaUploadClient {
    reserveMediaUpload: (
        projectId: string,
        input: {
            originalFilename: string
            expectedSize?: number
            contentType?: string
        },
        options?: MediaUploadRequestOptions
    ) => Promise<MediaReservation>
    uploadMedia: (
        projectId: string,
        intentId: string,
        file: Blob,
        options?: MediaUploadRequestOptions
    ) => Promise<MediaUpload>
    finalizeMediaUpload: (
        projectId: string,
        intentId: string,
        options?: MediaUploadRequestOptions
    ) => Promise<MediaFinalize | { status: 'pending'; media: MediaReservation }>
    getMedia: (
        projectId: string,
        assetId: string,
        options?: MediaUploadRequestOptions
    ) => Promise<MediaReference>
}

export interface PostdotMediaUploadController {
    readonly uppy: Uppy<Meta, Record<string, never>>
    readonly mediaByFileId: ReadonlyMap<string, MediaReference>
    readonly errorsByFileId: ReadonlyMap<string, unknown>
    readonly policy: PostdotMediaUploadPolicy
    readonly dispose: () => void
    readonly setUploadPolicy: (policy: PostdotMediaUploadPolicy) => void
}

export interface PostdotMediaUploadOptions {
    readonly id?: string
    readonly recoveryExpires?: number
    readonly recoveryEnabled?: boolean
}

export function createPostdotMediaUploadController(
    projectId: string,
    client: PostdotMediaUploadClient,
    waitForVerification: (milliseconds: number) => Promise<void> = delay,
    initialPolicy: PostdotMediaUploadPolicy = defaultPostdotMediaUploadPolicy,
    options: PostdotMediaUploadOptions = {}
): PostdotMediaUploadController {
    const mediaByFileId = new Map<string, MediaReference>()
    const errorsByFileId = new Map<string, unknown>()
    let uploadPolicy = normalizeUploadPolicy(initialPolicy)
    const uppy = new Uppy<Meta, Record<string, never>>({
        id: options.id ?? `postdot-media-${projectId}`,
        autoProceed: false,
        allowMultipleUploadBatches: true,
        restrictions: toUppyRestrictions(uploadPolicy),
    })

    const persistentRecovery = options.recoveryEnabled !== false
    if (persistentRecovery) pruneUploadCheckpoints(uppy.getID())
    const attempts = new Map<string, AbortController>()
    let preservingRecovery = false
    uppy.on('file-added', file => {
        // An explicit new selection supersedes a previous dismissal of the same local file ID.
        for (const storage of persistentRecovery ? uploadIntentStores() : []) {
            try {
                storage.removeItem(uploadIntentKey(uppy.getID(), file.id))
            } catch {
                /* Best effort. */
            }
        }
    })
    uppy.on('restored', () => {
        for (const file of uppy.getFiles()) {
            if (readUploadCheckpoint(uppy.getID(), file.id)?.discarded) uppy.removeFile(file.id)
        }
    })
    uppy.on('file-removed', file => {
        attempts.get(file.id)?.abort()
        attempts.delete(file.id)
        mediaByFileId.delete(file.id)
        errorsByFileId.delete(file.id)
        if (!preservingRecovery && persistentRecovery)
            rememberUploadIntent(uppy.getID(), file.id, null)
    })

    uppy.addUploader(async (fileIds, _uploadId) => {
        for (const fileId of fileIds) {
            const file = uppy.getFile(fileId)
            if (file === undefined || file.isRemote || !(file.data instanceof Blob)) {
                const error = new Error('media_upload_file_unavailable')
                errorsByFileId.set(fileId, error)
                if (file !== undefined) {
                    uppy.emit('upload-error', file, {
                        name: 'PostdotMediaUploadError',
                        message: error.message,
                    })
                }
                continue
            }

            const attempt = new AbortController()
            attempts.set(fileId, attempt)
            errorsByFileId.delete(fileId)
            try {
                const savedIntent =
                    (persistentRecovery ? readUploadIntent(uppy.getID(), fileId) : undefined) ??
                    file.meta.postdotUploadIntentId
                const media = await uploadPostdotMediaFile(
                    client,
                    projectId,
                    {
                        data: file.data,
                        filename: file.name,
                        expectedSize: file.size ?? undefined,
                        contentType: file.type || undefined,
                    },
                    waitForVerification,
                    {
                        signal: attempt.signal,
                        intentId: typeof savedIntent === 'string' ? savedIntent : undefined,
                        onReserved: intentId => {
                            uppy.setFileMeta(fileId, { postdotUploadIntentId: intentId })
                            if (persistentRecovery)
                                rememberUploadIntent(uppy.getID(), fileId, intentId)
                        },
                    }
                )
                if (attempt.signal.aborted || !uppy.getFile(fileId)) continue
                mediaByFileId.set(fileId, media)
                uppy.emit('upload-progress', file, {
                    uploadStarted: file.progress.uploadStarted ?? Date.now(),
                    bytesUploaded: file.size ?? 0,
                    bytesTotal: file.size,
                    uploadComplete: false,
                })
                uppy.emit('upload-success', file, {
                    status: 200,
                    body: {},
                })
            } catch (error) {
                if (attempt.signal.aborted || !uppy.getFile(fileId)) continue
                errorsByFileId.set(fileId, error)
                uppy.emit('upload-error', file, {
                    name: 'PostdotMediaUploadError',
                    message: error instanceof Error ? error.message : String(error),
                })
            } finally {
                if (attempts.get(fileId) === attempt) attempts.delete(fileId)
            }
        }
    })

    if (persistentRecovery && canUseBrowserRecovery()) {
        uppy.use(GoldenRetriever, {
            expires: options.recoveryExpires ?? 24 * 60 * 60 * 1000,
        })
    }

    return {
        uppy,
        mediaByFileId,
        errorsByFileId,
        dispose() {
            preservingRecovery = true
            // Destroy cancels files; detach persistence first so navigation is not a dismissal.
            const recovery = uppy.getPlugin('GoldenRetriever')
            if (recovery) uppy.removePlugin(recovery)
            uppy.destroy()
        },
        get policy() {
            return uploadPolicy
        },
        setUploadPolicy(policy) {
            uploadPolicy = normalizeUploadPolicy(policy)
            uppy.setOptions({ restrictions: toUppyRestrictions(uploadPolicy) })
        },
    }
}

function normalizeUploadPolicy(policy: PostdotMediaUploadPolicy): PostdotMediaUploadPolicy {
    const allowedContentTypes = [
        ...new Set(
            policy.allowedContentTypes
                .map(contentType => contentType.trim().toLowerCase())
                .filter(contentType => contentType !== '')
        ),
    ]
    if (allowedContentTypes.length === 0) {
        throw new Error('media_upload_policy_invalid')
    }

    if (
        policy.maxFileSize !== null &&
        (!Number.isSafeInteger(policy.maxFileSize) || policy.maxFileSize <= 0)
    ) {
        throw new Error('media_upload_policy_invalid')
    }

    return { allowedContentTypes, maxFileSize: policy.maxFileSize }
}

function toUppyRestrictions(policy: PostdotMediaUploadPolicy) {
    return {
        allowedFileTypes: [...policy.allowedContentTypes],
        maxFileSize: policy.maxFileSize,
    }
}

export async function uploadPostdotMediaFile(
    client: PostdotMediaUploadClient,
    projectId: string,
    input: {
        readonly data: Blob
        readonly filename: string
        readonly expectedSize?: number
        readonly contentType?: string
    },
    waitForVerification: (milliseconds: number) => Promise<void> = delay,
    options: MediaUploadRequestOptions & {
        readonly intentId?: string
        readonly onReserved?: (intentId: string) => void
    } = {}
): Promise<MediaReference> {
    options.signal?.throwIfAborted()
    let intentId = options.intentId
    if (intentId === undefined) {
        const reservation = await client.reserveMediaUpload(
            projectId,
            {
                originalFilename: input.filename,
                expectedSize: input.expectedSize,
                contentType: input.contentType,
            },
            options
        )
        options.signal?.throwIfAborted()
        intentId = reservation.intent.id
        options.onReserved?.(intentId)
    }
    try {
        await client.uploadMedia(projectId, intentId, input.data, options)
    } catch (error) {
        options.signal?.throwIfAborted()
        // The server has retired this known intent; its bytes can start a fresh reservation.
        if (
            options.intentId !== undefined &&
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'upload_expired'
        ) {
            return uploadPostdotMediaFile(client, projectId, input, waitForVerification, {
                ...options,
                intentId: undefined,
            })
        }
        throw error
    }
    options.signal?.throwIfAborted()
    return completePostdotMediaUpload(client, projectId, intentId, waitForVerification, options)
}

export async function completePostdotMediaUpload(
    client: PostdotMediaUploadClient,
    projectId: string,
    intentId: string,
    waitForVerification: (milliseconds: number) => Promise<void> = delay,
    options: MediaUploadRequestOptions = {}
): Promise<MediaReference> {
    options.signal?.throwIfAborted()
    const finalized = await client.finalizeMediaUpload(projectId, intentId, options)
    options.signal?.throwIfAborted()
    if (finalized.status === 'ready') return finalized.media
    if (finalized.status === 'failed') {
        throw new MediaVerificationError(finalized.media)
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
        await waitForVerification(250)
        options.signal?.throwIfAborted()
        const media = await client.getMedia(projectId, finalized.media.asset.id, options)
        options.signal?.throwIfAborted()
        if (media.asset.state === 'ready') return media
        if (media.asset.state === 'failed') {
            throw new MediaVerificationError(media)
        }
    }

    throw new Error('media_verification_pending')
}

function delay(milliseconds: number) {
    return new Promise<void>(resolve => window.setTimeout(resolve, milliseconds))
}

function canUseBrowserRecovery() {
    return (
        typeof window !== 'undefined' &&
        (typeof indexedDB !== 'undefined' || typeof localStorage !== 'undefined')
    )
}

/** Apply independently completed upload batches in their original addition order. */
export function createOrderedUploadResults() {
    const pending: Array<{ settled: boolean; apply: () => void }> = []
    return {
        reserve() {
            const entry = { settled: false, apply: () => {} }
            pending.push(entry)
            return (apply: () => void) => {
                if (entry.settled) return
                entry.settled = true
                entry.apply = apply
                while (pending[0]?.settled) {
                    const ready = pending.shift()!
                    ready.apply()
                }
            }
        },
    }
}

/** Synchronous checkpoint complements the browser blob store's asynchronous writes. */
function uploadIntentStores(): Storage[] {
    if (typeof window === 'undefined') return []
    const stores: Storage[] = []
    try {
        stores.push(window.sessionStorage)
    } catch {
        /* Recovery is best effort. */
    }
    try {
        stores.push(window.localStorage)
    } catch {
        /* Recovery is best effort. */
    }
    return stores
}
function uploadIntentKey(owner: string, fileId: string) {
    return `postdot:media-upload-intent:v1:${encodeURIComponent(owner)}:${encodeURIComponent(fileId)}`
}
function readUploadCheckpoint(
    owner: string,
    fileId: string
): { intentId?: string; discarded?: boolean } | undefined {
    for (const storage of uploadIntentStores()) {
        try {
            const key = uploadIntentKey(owner, fileId)
            const raw = storage.getItem(key)
            if (!raw) continue
            const value: unknown = JSON.parse(raw)
            if (
                value &&
                typeof value === 'object' &&
                'expiresAt' in value &&
                typeof value.expiresAt === 'number' &&
                value.expiresAt > Date.now()
            ) {
                if ('discarded' in value && value.discarded === true) return { discarded: true }
                if ('intentId' in value && typeof value.intentId === 'string')
                    return { intentId: value.intentId }
            }
            storage.removeItem(key)
        } catch {
            /* Try the other recovery store. */
        }
    }
}
function readUploadIntent(owner: string, fileId: string) {
    return readUploadCheckpoint(owner, fileId)?.intentId
}
function rememberUploadIntent(owner: string, fileId: string, intentId: string | null) {
    for (const storage of uploadIntentStores()) {
        try {
            const key = uploadIntentKey(owner, fileId)
            storage.setItem(
                key,
                JSON.stringify({
                    ...(intentId === null ? { discarded: true } : { intentId }),
                    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
                })
            )
        } catch {
            /* Recovery is best effort. */
        }
    }
}

function pruneUploadCheckpoints(owner: string) {
    const prefix = `postdot:media-upload-intent:v1:${encodeURIComponent(owner)}:`
    for (const storage of uploadIntentStores()) {
        try {
            for (const key of Object.keys(storage)) {
                if (!key.startsWith(prefix)) continue
                try {
                    const value: unknown = JSON.parse(storage.getItem(key) ?? 'null')
                    if (
                        !value ||
                        typeof value !== 'object' ||
                        !('expiresAt' in value) ||
                        typeof value.expiresAt !== 'number' ||
                        value.expiresAt <= Date.now()
                    )
                        storage.removeItem(key)
                } catch {
                    storage.removeItem(key)
                }
            }
        } catch {
            /* Recovery is best effort. */
        }
    }
}
