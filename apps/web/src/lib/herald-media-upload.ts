import type { MediaFinalize, MediaReference, MediaReservation, MediaUpload } from '@herald/client'
import Uppy, { type Meta, type UppyFile } from '@uppy/core'

import { MediaVerificationError } from '@/lib/media-errors'

export type HeraldMediaUppyFile = UppyFile<Meta, Record<string, never>>

export interface HeraldMediaUploadClient {
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

export interface HeraldMediaUploadController {
    readonly uppy: Uppy<Meta, Record<string, never>>
    readonly mediaByFileId: ReadonlyMap<string, MediaReference>
    readonly errorsByFileId: ReadonlyMap<string, unknown>
}

export function createHeraldMediaUploadController(
    projectId: string,
    client: HeraldMediaUploadClient,
    waitForVerification: (milliseconds: number) => Promise<void> = delay
): HeraldMediaUploadController {
    const mediaByFileId = new Map<string, MediaReference>()
    const errorsByFileId = new Map<string, unknown>()
    const uppy = new Uppy<Meta, Record<string, never>>({
        id: `herald-media-${projectId}`,
        autoProceed: false,
        allowMultipleUploadBatches: true,
    })

    uppy.addUploader(async (fileIds, _uploadId) => {
        for (const fileId of fileIds) {
            const file = uppy.getFile(fileId)
            if (file === undefined || file.isRemote || !(file.data instanceof Blob)) {
                const error = new Error('media_upload_file_unavailable')
                errorsByFileId.set(fileId, error)
                if (file !== undefined) {
                    uppy.emit('upload-error', file, {
                        name: 'HeraldMediaUploadError',
                        message: error.message,
                    })
                }
                continue
            }

            try {
                const media = await uploadHeraldMediaFile(
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
                    name: 'HeraldMediaUploadError',
                    message: error instanceof Error ? error.message : String(error),
                })
            }
        }
    })

    return { uppy, mediaByFileId, errorsByFileId }
}

export async function uploadHeraldMediaFile(
    client: HeraldMediaUploadClient,
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
    return completeHeraldMediaUpload(client, projectId, reservation.intent.id, waitForVerification)
}

export async function completeHeraldMediaUpload(
    client: HeraldMediaUploadClient,
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
