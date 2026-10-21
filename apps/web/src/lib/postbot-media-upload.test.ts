import { describe, expect, it } from 'bun:test'

import type {
    MediaFinalize,
    MediaPending,
    MediaReference,
    MediaReservation,
    MediaUpload,
} from '@postdot/client'

import { MediaVerificationError } from './media-errors'
import {
    completePostbotMediaUpload,
    createPostbotMediaUploadController,
    createOrderedUploadResults,
    uploadPostbotMediaFile,
    type PostbotMediaUploadClient,
} from './postbot-media-upload'

describe('Postdot media upload orchestration', () => {
    it('keeps the reserve, raw upload, and ready finalization sequence', async () => {
        const media = createMedia('asset-ready')
        const reservation = createReservation(media)
        const calls: string[] = []
        const client = createClient({
            reserveMediaUpload: async (_projectId, input) => {
                calls.push(`reserve:${input.originalFilename}`)
                return reservation
            },
            uploadMedia: async (_projectId, _intentId, file) => {
                calls.push(`upload:${file.size}`)
                return createUpload(reservation)
            },
            finalizeMediaUpload: async () => {
                calls.push('finalize')
                return { status: 'ready', media } as MediaFinalize
            },
        })

        const result = await uploadPostbotMediaFile(
            client,
            'project-1',
            {
                data: new Blob(['hello'], { type: 'image/png' }),
                filename: 'hero.png',
                expectedSize: 5,
                contentType: 'image/png',
            },
            async () => undefined
        )

        expect(result).toBe(media)
        expect(calls).toEqual(['reserve:hero.png', 'upload:5', 'finalize'])
    })

    it('polls a pending inspection until the verified asset is ready', async () => {
        const media = createMedia('asset-pending')
        const reservation = createReservation(media)
        let reads = 0
        const client = createClient({
            finalizeMediaUpload: async () =>
                ({ status: 'pending', media: reservation }) as MediaPending,
            getMedia: async () => {
                reads += 1
                return media
            },
        })

        await expect(
            completePostbotMediaUpload(client, 'project-1', 'intent-1', async () => undefined)
        ).resolves.toBe(media)
        expect(reads).toBe(1)
    })

    it('preserves verification failures as typed media errors', async () => {
        const failed = createMedia(
            'asset-failed',
            'unsupported_format',
            'The format is not supported'
        )
        const client = createClient({
            finalizeMediaUpload: async () => ({ status: 'failed', media: failed }) as MediaFinalize,
        })

        await expect(
            completePostbotMediaUpload(client, 'project-1', 'intent-1', async () => undefined)
        ).rejects.toBeInstanceOf(MediaVerificationError)
    })

    it('exposes successful files through the Uppy controller without adopting a vendor UI', async () => {
        const media = createMedia('asset-controller')
        const reservation = createReservation(media)
        const client = createClient({
            finalizeMediaUpload: async () => ({ status: 'ready', media }) as MediaFinalize,
        })
        const controller = createPostbotMediaUploadController(
            'project-1',
            client,
            async () => undefined
        )

        try {
            const fileId = controller.uppy.addFile({
                name: 'controller.png',
                type: 'image/png',
                data: new Blob(['hello'], { type: 'image/png' }),
            })
            const result = await controller.uppy.upload()

            expect(result?.successful?.map(file => file.id)).toEqual([fileId])
            expect(controller.mediaByFileId.get(fileId)).toBe(media)
            expect(controller.errorsByFileId.size).toBe(0)
        } finally {
            void controller.uppy.destroy()
        }

        expect(reservation.intent.id).toBe('intent-1')
    })

    it('enforces the server-provided policy through Uppy restrictions', () => {
        const controller = createPostbotMediaUploadController('project-1', createClient())
        const failures: string[] = []
        controller.uppy.on('restriction-failed', file => {
            failures.push(file?.name ?? 'batch')
        })

        try {
            controller.setUploadPolicy({
                allowedContentTypes: ['image/png'],
                maxFileSize: 4,
            })

            expect(controller.uppy.opts.restrictions.allowedFileTypes).toEqual(['image/png'])
            expect(controller.uppy.opts.restrictions.maxFileSize).toBe(4)

            controller.uppy.addFiles([
                {
                    name: 'large.png',
                    type: 'image/png',
                    data: new Blob(['12345'], { type: 'image/png' }),
                },
                {
                    name: 'notes.txt',
                    type: 'text/plain',
                    data: new Blob(['123'], { type: 'text/plain' }),
                },
            ])

            expect(failures).toEqual(['large.png', 'notes.txt'])
            expect(controller.uppy.getFiles()).toHaveLength(0)
        } finally {
            void controller.uppy.destroy()
        }
    })
})

function createClient(overrides: Partial<PostbotMediaUploadClient> = {}): PostbotMediaUploadClient {
    const media = createMedia('asset-default')
    const reservation = createReservation(media)
    return {
        reserveMediaUpload: async () => reservation,
        uploadMedia: async () => createUpload(reservation),
        finalizeMediaUpload: async () => ({ status: 'ready', media }) as MediaFinalize,
        getMedia: async () => media,
        ...overrides,
    }
}

function createMedia(
    id: string,
    failureCode: string | null = null,
    failureMessage: string | null = null
) {
    return {
        asset: {
            id,
            state: failureCode === null ? 'ready' : 'failed',
            defaultAccessibilityText: null,
            failureCode,
            failureMessage,
        },
        representations: [],
    } as unknown as MediaReference
}

function createReservation(media: MediaReference) {
    return {
        asset: media.asset,
        representation: media.representations[0],
        intent: { id: 'intent-1' },
        upload: { storeId: 'test', maxBytes: 10_000 },
    } as unknown as MediaReservation
}

function createUpload(reservation: MediaReservation) {
    return {
        status: 'uploaded',
        media: reservation,
    } as unknown as MediaUpload
}

it('buffers later completion without preventing independent work', () => {
    const queue = createOrderedUploadResults()
    const first = queue.reserve()
    const second = queue.reserve()
    const applied: string[] = []
    second(() => applied.push('second'))
    expect(applied).toEqual([])
    first(() => applied.push('first'))
    expect(applied).toEqual(['first', 'second'])
    second(() => applied.push('duplicate'))
    expect(applied).toEqual(['first', 'second'])
})

it('failed batches release successors and application reads the current selection', () => {
    const queue = createOrderedUploadResults()
    const failed = queue.reserve()
    const later = queue.reserve()
    let selected = ['existing']
    later(() => {
        selected = [...selected, 'new']
    })
    selected = ['library', 'reordered']
    failed(() => {})
    expect(selected).toEqual(['library', 'reordered', 'new'])
})
