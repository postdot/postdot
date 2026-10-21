import { createHash } from 'node:crypto'

import type { PublisherExecutionMedia } from '@postdot/db'

import type { ProviderMediaContentStore } from './registry'

export type PinnedMedia = Pick<
    PublisherExecutionMedia,
    'assetId' | 'representationId' | 'contentType' | 'byteSize' | 'sha256' | 'storeId' | 'objectKey'
>

export type OpenedMediaContent = Awaited<
    ReturnType<ProviderMediaContentStore['openRepresentationContent']>
>

export async function verifyPinnedMediaContent(
    mediaStore: ProviderMediaContentStore,
    projectId: string,
    targetMedia: PinnedMedia
): Promise<boolean> {
    const opened = await mediaStore.openRepresentationContent(
        projectId,
        targetMedia.assetId,
        targetMedia.representationId
    )
    if (!matchesPinnedMediaMetadata(opened, targetMedia)) {
        await cancelMediaStream(opened)
        return false
    }

    const checksum = await readMediaStreamChecksum(opened.stream)
    return checksum.size === targetMedia.byteSize && checksum.sha256 === targetMedia.sha256
}

export async function openVerifiedPinnedMedia(
    mediaStore: ProviderMediaContentStore,
    projectId: string,
    targetMedia: PinnedMedia
): Promise<OpenedMediaContent> {
    if (!(await verifyPinnedMediaContent(mediaStore, projectId, targetMedia))) return null

    const opened = await mediaStore.openRepresentationContent(
        projectId,
        targetMedia.assetId,
        targetMedia.representationId
    )
    if (!matchesPinnedMediaMetadata(opened, targetMedia)) {
        await cancelMediaStream(opened)
        return null
    }
    return opened
}

function matchesPinnedMediaMetadata(
    opened: OpenedMediaContent,
    targetMedia: PinnedMedia
): opened is NonNullable<OpenedMediaContent> {
    return (
        opened !== null &&
        opened.representation.storeId === targetMedia.storeId &&
        opened.representation.objectKey === targetMedia.objectKey &&
        opened.size === targetMedia.byteSize &&
        opened.contentType === targetMedia.contentType &&
        opened.sha256 === targetMedia.sha256
    )
}

export async function cancelMediaStream(opened: OpenedMediaContent): Promise<void> {
    if (opened === null) return
    try {
        await opened.stream.cancel()
    } catch {
        // Preserve the metadata or checksum failure that caused the cancellation.
    }
}

async function readMediaStreamChecksum(
    stream: ReadableStream<Uint8Array>
): Promise<{ readonly size: number; readonly sha256: string }> {
    const hash = createHash('sha256')
    const reader = stream.getReader()
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
        }
    } catch (error) {
        try {
            await reader.cancel(error)
        } catch {
            // Preserve the original read failure.
        }
        throw error
    } finally {
        reader.releaseLock()
    }

    return { size, sha256: hash.digest('hex') }
}
