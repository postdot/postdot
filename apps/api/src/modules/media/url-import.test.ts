import { describe, expect, test } from 'bun:test'

import type { NetworkControlledBinaryFetcher } from '@postdot/custom-http'
import type { MediaUploadReservation } from '@postdot/db'

import { createMediaUrlImporter, type MediaUrlImporterOptions } from './url-import'

const reservation = {
    intent: { id: 'intent-1' },
} as unknown as MediaUploadReservation

function createMediaFixture(
    responseForUrl: (url: URL) => {
        status: number
        headers: Record<string, string>
        body: Uint8Array
        bodyTruncated: boolean
    }
) {
    const requestedUrls: URL[] = []
    const reservedInputs: Array<{
        projectId: string
        subjectId: string
        originalFilename: string
        expectedSize?: number
        contentType?: string
    }> = []
    let uploadedBytes: Uint8Array<ArrayBufferLike> = new Uint8Array()

    const fetcher: NetworkControlledBinaryFetcher = async input => {
        const url = new URL(input.toString())
        requestedUrls.push(url)
        return responseForUrl(url)
    }
    const media: MediaUrlImporterOptions['media'] = {
        getUploadPolicy: () => ({
            allowedContentTypes: ['image/png', 'image/jpeg', 'image/webp'],
            maxFileSize: 100,
        }),
        reserveUpload(input) {
            reservedInputs.push(input)
            return reservation
        },
        async upload(input) {
            const reader = input.source.getReader()
            const chunks: Uint8Array[] = []
            try {
                while (true) {
                    const next = await reader.read()
                    if (next.done) break
                    chunks.push(next.value)
                }
            } finally {
                reader.releaseLock()
            }
            uploadedBytes = concatBytes(chunks)
            return { kind: 'uploaded', reservation }
        },
        async finalizeUpload() {
            return { kind: 'ready', reservation }
        },
    }

    return {
        fetcher,
        media,
        requestedUrls,
        reservedInputs,
        get uploadedBytes() {
            return uploadedBytes
        },
    }
}

describe('media URL importer', () => {
    test('follows a controlled redirect and reuses the media upload lifecycle', async () => {
        const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
        const fixture = createMediaFixture(url => {
            if (url.pathname === '/start') {
                return {
                    status: 302,
                    headers: { location: '/images/cover.png' } as Record<string, string>,
                    body: new Uint8Array(),
                    bodyTruncated: false,
                }
            }
            return {
                status: 200,
                headers: {
                    'content-type': 'image/png; charset=utf-8',
                    'content-length': String(bytes.byteLength),
                },
                body: bytes,
                bodyTruncated: false,
            }
        })
        const importer = createMediaUrlImporter(fixture)

        const result = await importer.importUrl({
            projectId: 'project-1',
            subjectId: 'user-1',
            url: 'https://images.example/start#preview',
        })

        expect(result).toEqual({ kind: 'ready', reservation })
        expect(fixture.requestedUrls.map(url => url.toString())).toEqual([
            'https://images.example/start',
            'https://images.example/images/cover.png',
        ])
        expect(fixture.reservedInputs).toEqual([
            {
                projectId: 'project-1',
                subjectId: 'user-1',
                originalFilename: 'cover.png',
                expectedSize: bytes.byteLength,
                contentType: 'image/png',
            },
        ])
        expect(fixture.uploadedBytes).toEqual(bytes)
    })

    test('rejects unsupported content types before reserving an upload', async () => {
        const fixture = createMediaFixture(() => ({
            status: 200,
            headers: { 'content-type': 'application/pdf' },
            body: new Uint8Array([1, 2, 3]),
            bodyTruncated: false,
        }))
        const importer = createMediaUrlImporter(fixture)

        await expect(
            importer.importUrl({
                projectId: 'project-1',
                subjectId: 'user-1',
                url: 'https://images.example/file.pdf',
            })
        ).rejects.toMatchObject({ code: 'media_url_unsupported_type', status: 415 })
        expect(fixture.reservedInputs).toHaveLength(0)
    })

    test('rejects a response larger than the project policy before reserving an upload', async () => {
        const fixture = createMediaFixture(() => ({
            status: 200,
            headers: {
                'content-type': 'image/png',
                'content-length': '101',
            },
            body: new Uint8Array([1, 2, 3]),
            bodyTruncated: false,
        }))
        const importer = createMediaUrlImporter(fixture)

        await expect(
            importer.importUrl({
                projectId: 'project-1',
                subjectId: 'user-1',
                url: 'https://images.example/too-large.png',
            })
        ).rejects.toMatchObject({ code: 'media_url_too_large', status: 413 })
        expect(fixture.reservedInputs).toHaveLength(0)
    })

    test('rejects URL credentials without contacting the fetcher', async () => {
        const fixture = createMediaFixture(() => {
            throw new Error('fetcher should not be called')
        })
        const importer = createMediaUrlImporter(fixture)

        await expect(
            importer.importUrl({
                projectId: 'project-1',
                subjectId: 'user-1',
                url: 'https://user:secret@images.example/file.png',
            })
        ).rejects.toMatchObject({ code: 'media_url_invalid', status: 400 })
        expect(fixture.requestedUrls).toHaveLength(0)
    })
})

function concatBytes(chunks: readonly Uint8Array<ArrayBufferLike>[]): Uint8Array<ArrayBufferLike> {
    const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
    const result = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.byteLength
    }
    return result
}
