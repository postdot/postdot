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

export interface PostdotMediaUploadClient {
    reserveMediaUpload: (
        projectId: string,
        input: {
            originalFilename: string
            expectedSize?: number
            contentType?: string
        }
    ) => Promise<MediaReservation>
    uploadMedia: (projectId: string, intentId: string, file: Blob) => Promise<MediaUpload>
    finalizeMediaUpload: (
        projectId: string,
        intentId: string
    ) => Promise<MediaFinalize | { status: 'pending'; media: MediaReservation }>
    getMedia: (projectId: string, assetId: string) => Promise<MediaReference>
}

export interface PostdotMediaUploadController {
    readonly uppy: Uppy<Meta, Record<string, never>>
    readonly mediaByFileId: ReadonlyMap<string, MediaReference>
    readonly errorsByFileId: ReadonlyMap<string, unknown>
    readonly policy: PostdotMediaUploadPolicy
    readonly setUploadPolicy: (policy: PostdotMediaUploadPolicy) => void
}

export interface PostdotMediaUploadOptions {
    readonly id?: string
    readonly recoveryExpires?: number
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

            try {
                const media = await uploadPostdotMediaFile(
                    client,
                    projectId,
                    {
                        data: file.data,
                        filename: file.name,
                        expectedSize: file.size ?? undefined,
                        contentType: file.type || undefined,
                    },
                    waitForVerification
                )
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
                errorsByFileId.set(fileId, error)
                uppy.emit('upload-error', file, {
                    name: 'PostdotMediaUploadError',
                    message: error instanceof Error ? error.message : String(error),
                })
            }
        }
    })

    if (canUseBrowserRecovery()) {
        uppy.use(GoldenRetriever, {
            expires: options.recoveryExpires ?? 24 * 60 * 60 * 1000,
        })
    }

    return {
        uppy,
        mediaByFileId,
        errorsByFileId,
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
    waitForVerification: (milliseconds: number) => Promise<void> = delay
): Promise<MediaReference> {
    const reservation = await client.reserveMediaUpload(projectId, {
        originalFilename: input.filename,
        expectedSize: input.expectedSize,
        contentType: input.contentType,
    })
    await client.uploadMedia(projectId, reservation.intent.id, input.data)
    return completePostdotMediaUpload(client, projectId, reservation.intent.id, waitForVerification)
}

export async function completePostdotMediaUpload(
    client: PostdotMediaUploadClient,
    projectId: string,
    intentId: string,
    waitForVerification: (milliseconds: number) => Promise<void> = delay
): Promise<MediaReference> {
    const finalized = await client.finalizeMediaUpload(projectId, intentId)
    if (finalized.status === 'ready') return finalized.media
    if (finalized.status === 'failed') {
        throw new MediaVerificationError(finalized.media)
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
        await waitForVerification(250)
        const media = await client.getMedia(projectId, finalized.media.asset.id)
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
