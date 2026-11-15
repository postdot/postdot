import { createHash } from 'node:crypto'

import { DomainInvariantError, requireNonBlank, type IdentityImageSource } from '@postdot/core'

import { defineTransaction, recordDatabaseCommitProject, type DatabaseHandle } from './client'

export const identityImageMaxBytes = 2 * 1024 * 1024
export const identityImageMaxDimension = 256
export const identityImageMaxStoredBytes = 262_144
export const identityImageMaxPixels = 16_000_000

export type IdentityImageErrorCode =
    | 'identity_image_size'
    | 'identity_image_format'
    | 'identity_website_invalid'

export class IdentityImageValidationError extends Error {
    constructor(
        readonly code: IdentityImageErrorCode,
        message: string
    ) {
        super(message)
        this.name = 'IdentityImageValidationError'
    }
}

export type SniffedIdentityImageFormat =
    | 'image/png'
    | 'image/jpeg'
    | 'image/webp'
    | 'image/gif'
    | 'image/x-icon'

export interface ProcessedIdentityImage {
    readonly sha256: string
    readonly imageUrl: string
    readonly contentType: 'image/webp'
    readonly byteSize: number
    readonly width: number
    readonly height: number
    readonly bytes: Uint8Array
}

export interface StoredIdentityImage {
    readonly sha256: string
    readonly contentType: string
    readonly byteSize: number
    readonly width: number
    readonly height: number
    readonly bytes: Uint8Array
}

export function identityImageUrl(sha256: string): string {
    return `/api/identity-images/${sha256}`
}

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
    if (bytes.byteLength < offset + prefix.length) return false
    for (let index = 0; index < prefix.length; index += 1) {
        if (bytes[offset + index] !== prefix[index]) return false
    }
    return true
}

function looksLikeSvgOrXml(bytes: Uint8Array): boolean {
    const sample = new TextDecoder('utf-8', { fatal: false })
        .decode(bytes.subarray(0, Math.min(bytes.byteLength, 1_024)))
        .replace(/^\uFEFF/, '')
        .trimStart()
        .toLowerCase()
    return (
        sample.startsWith('<svg') ||
        sample.startsWith('<?xml') ||
        sample.startsWith('<!doctype svg') ||
        sample.includes('<svg')
    )
}

interface IcoEntry {
    readonly width: number
    readonly height: number
    readonly bitCount: number
    readonly bytesInRes: number
    readonly imageOffset: number
    readonly isPng: boolean
}

function parseIcoEntries(bytes: Uint8Array): readonly IcoEntry[] | null {
    if (bytes.byteLength < 22 || !startsWithBytes(bytes, [0x00, 0x00, 0x01, 0x00])) {
        return null
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const count = view.getUint16(4, true)
    if (count < 1 || count > 64 || bytes.byteLength < 6 + count * 16) {
        return null
    }
    const directoryEnd = 6 + count * 16
    const entries: IcoEntry[] = []
    for (let index = 0; index < count; index += 1) {
        const entryOffset = 6 + index * 16
        const rawWidth = bytes[entryOffset]!
        const rawHeight = bytes[entryOffset + 1]!
        const reserved = bytes[entryOffset + 3]!
        if (reserved !== 0) return null
        const bitCount = view.getUint16(entryOffset + 6, true)
        const bytesInRes = view.getUint32(entryOffset + 8, true)
        const imageOffset = view.getUint32(entryOffset + 12, true)
        if (
            bytesInRes < 16 ||
            imageOffset < directoryEnd ||
            imageOffset + bytesInRes > bytes.byteLength
        ) {
            return null
        }
        const isPng = startsWithBytes(
            bytes,
            [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
            imageOffset
        )
        entries.push({
            width: rawWidth === 0 ? 256 : rawWidth,
            height: rawHeight === 0 ? 256 : rawHeight,
            bitCount,
            bytesInRes,
            imageOffset,
            isPng,
        })
    }
    return entries
}

export function sniffIdentityImageFormat(bytes: Uint8Array): SniffedIdentityImageFormat {
    if (bytes.byteLength === 0) {
        throw new IdentityImageValidationError('identity_image_format', 'An image is required')
    }
    if (bytes.byteLength > identityImageMaxBytes) {
        throw new IdentityImageValidationError(
            'identity_image_size',
            'Image exceeds the 2 MB limit'
        )
    }
    if (looksLikeSvgOrXml(bytes)) {
        throw new IdentityImageValidationError(
            'identity_image_format',
            'SVG images are not supported; upload a PNG, JPEG, WebP, GIF, or ICO image'
        )
    }
    if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return 'image/png'
    }
    if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) {
        return 'image/jpeg'
    }
    if (
        startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        startsWithBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)
    ) {
        return 'image/webp'
    }
    if (
        startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
        startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    ) {
        return 'image/gif'
    }
    if (parseIcoEntries(bytes) !== null) {
        return 'image/x-icon'
    }
    throw new IdentityImageValidationError(
        'identity_image_format',
        'Unsupported image format; use PNG, JPEG, WebP, GIF, or ICO'
    )
}

function icoDibToBmp(entryBytes: Uint8Array): Uint8Array | null {
    if (entryBytes.byteLength < 40) return null
    const view = new DataView(entryBytes.buffer, entryBytes.byteOffset, entryBytes.byteLength)
    const headerSize = view.getUint32(0, true)
    if (headerSize !== 40) return null
    const dibWidth = view.getInt32(4, true)
    const dibHeight = view.getInt32(8, true)
    const planes = view.getUint16(12, true)
    const bpp = view.getUint16(14, true)
    const compression = view.getUint32(16, true)
    const clrUsed = view.getUint32(32, true)

    const actualHeight = Math.abs(dibHeight) / 2
    if (
        dibWidth <= 0 ||
        dibWidth > 512 ||
        actualHeight <= 0 ||
        actualHeight > 512 ||
        !Number.isInteger(actualHeight) ||
        planes !== 1 ||
        compression !== 0 ||
        ![1, 4, 8, 24, 32].includes(bpp)
    ) {
        return null
    }
    const paletteColors = bpp <= 8 ? (clrUsed > 0 ? clrUsed : 1 << bpp) : 0
    if (paletteColors < 0 || paletteColors > 256) return null
    const paletteBytes = paletteColors * 4
    const xorRowStride = Math.floor((dibWidth * bpp + 31) / 32) * 4
    const xorBytes = xorRowStride * actualHeight
    const copyBytes = 40 + paletteBytes + xorBytes
    if (copyBytes > entryBytes.byteLength) return null

    const bmpSize = 14 + copyBytes
    const bmp = new Uint8Array(bmpSize)
    const bmpView = new DataView(bmp.buffer)
    bmp[0] = 0x42
    bmp[1] = 0x4d
    bmpView.setUint32(2, bmpSize, true)
    bmpView.setUint32(10, 14 + 40 + paletteBytes, true)
    bmp.set(entryBytes.subarray(0, copyBytes), 14)
    bmpView.setInt32(14 + 8, dibHeight < 0 ? -actualHeight : actualHeight, true)
    bmpView.setUint32(14 + 20, xorBytes, true)
    return bmp
}

function selectIcoDecodableBuffers(bytes: Uint8Array): readonly Uint8Array[] {
    const entries = parseIcoEntries(bytes)
    if (!entries || entries.length === 0) return []
    const sorted = [...entries].sort((left, right) => {
        const leftMeetsMin = Math.min(left.width, left.height) >= 32 ? 1 : 0
        const rightMeetsMin = Math.min(right.width, right.height) >= 32 ? 1 : 0
        if (leftMeetsMin !== rightMeetsMin) return rightMeetsMin - leftMeetsMin
        const leftDim = Math.min(256, Math.max(left.width, left.height))
        const rightDim = Math.min(256, Math.max(right.width, right.height))
        if (leftDim !== rightDim) return rightDim - leftDim
        if (left.bitCount !== right.bitCount) return right.bitCount - left.bitCount
        if (left.isPng !== right.isPng) return left.isPng ? -1 : 1
        return right.bytesInRes - left.bytesInRes
    })
    const buffers: Uint8Array[] = []
    for (const entry of sorted) {
        const slice = bytes.subarray(entry.imageOffset, entry.imageOffset + entry.bytesInRes)
        if (entry.isPng) {
            buffers.push(slice)
        } else {
            const bmp = icoDibToBmp(slice)
            if (bmp !== null) buffers.push(bmp)
        }
    }
    return buffers
}

let processingQueue = Promise.resolve()

export async function processIdentityImage(bytes: Uint8Array): Promise<ProcessedIdentityImage> {
    const format = sniffIdentityImageFormat(bytes)
    const candidates = format === 'image/x-icon' ? selectIcoDecodableBuffers(bytes) : [bytes]
    if (candidates.length === 0) {
        throw new IdentityImageValidationError(
            'identity_image_format',
            'ICO file does not contain a supported raster icon'
        )
    }

    const previous = processingQueue
    let release!: () => void
    processingQueue = new Promise<void>(resolve => {
        release = resolve
    })
    await previous
    try {
        for (const candidate of candidates) {
            try {
                const metadata = await new Bun.Image(candidate).metadata()
                if (
                    !Number.isSafeInteger(metadata.width) ||
                    !Number.isSafeInteger(metadata.height) ||
                    metadata.width <= 0 ||
                    metadata.height <= 0 ||
                    metadata.width * metadata.height > identityImageMaxPixels
                ) {
                    continue
                }
                const side = Math.max(
                    1,
                    Math.min(identityImageMaxDimension, Math.max(metadata.width, metadata.height))
                )
                const encoded = new Uint8Array(
                    await new Bun.Image(candidate)
                        .resize(side, side, { fit: 'fill' })
                        .webp({ quality: 85 })
                        .bytes()
                )
                if (encoded.byteLength === 0 || encoded.byteLength > identityImageMaxStoredBytes) {
                    continue
                }
                const sha256 = createHash('sha256').update(encoded).digest('hex')
                return {
                    sha256,
                    imageUrl: identityImageUrl(sha256),
                    contentType: 'image/webp',
                    byteSize: encoded.byteLength,
                    width: side,
                    height: side,
                    bytes: encoded,
                }
            } catch {
                continue
            }
        }
        throw new IdentityImageValidationError(
            'identity_image_format',
            'Image could not be decoded'
        )
    } finally {
        release()
    }
}

export function normalizeIdentityWebsiteUrl(rawUrl: string | null | undefined): string | null {
    if (rawUrl === null || rawUrl === undefined) return null
    const trimmed = rawUrl.trim()
    if (trimmed.length === 0) return null
    if (trimmed.length > 2_048) {
        throw new IdentityImageValidationError(
            'identity_website_invalid',
            'Website URL must be at most 2,048 characters'
        )
    }
    const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`
    let parsed: URL
    try {
        parsed = new URL(candidate)
    } catch {
        throw new IdentityImageValidationError(
            'identity_website_invalid',
            'Website URL must be a valid HTTP or HTTPS URL'
        )
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new IdentityImageValidationError(
            'identity_website_invalid',
            'Website URL must use HTTP or HTTPS'
        )
    }
    if (parsed.username !== '' || parsed.password !== '') {
        throw new IdentityImageValidationError(
            'identity_website_invalid',
            'Website URL cannot include credentials'
        )
    }
    if (parsed.hostname.trim().length === 0) {
        throw new IdentityImageValidationError(
            'identity_website_invalid',
            'Website URL must include a hostname'
        )
    }
    return parsed.toString()
}

export interface IdentityImageStoreOptions {
    readonly now?: () => number
}

interface StoredIdentityImageRow {
    readonly sha256: string
    readonly contentType: string
    readonly byteSize: number
    readonly width: number
    readonly height: number
    readonly bytes: Uint8Array
}

interface CurrentIdentityFieldsRow {
    readonly id: string
    readonly websiteUrl: string | null
    readonly imageUrl: string | null
    readonly imageSource: IdentityImageSource | null
}

interface ChannelIdentityRow extends CurrentIdentityFieldsRow {
    readonly revision: number
}

export function createIdentityImageStore(
    database: DatabaseHandle,
    options: IdentityImageStoreOptions = {}
) {
    const sql = database.sql
    const now = options.now ?? Date.now

    const getStoredImageStatement = sql.statement<StoredIdentityImageRow, [sha256: string]>(`
        select sha256,
               content_type as contentType,
               byte_size as byteSize,
               width,
               height,
               bytes
        from identity_images
        where sha256 = ?1
    `)
    const insertStoredImageStatement = sql.statement<
        void,
        [
            sha256: string,
            contentType: string,
            byteSize: number,
            width: number,
            height: number,
            bytes: Uint8Array,
            createdAt: number,
        ]
    >(`
        insert into identity_images (
            sha256,
            content_type,
            byte_size,
            width,
            height,
            bytes,
            created_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        on conflict (sha256) do nothing
    `)
    const deleteUnreferencedImagesStatement = sql.statement<void, []>(`
        delete from identity_images
        where not exists (
            select 1 from projects where projects.image_url = '/api/identity-images/' || identity_images.sha256
        )
        and not exists (
            select 1 from workspaces where workspaces.image_url = '/api/identity-images/' || identity_images.sha256
        )
        and not exists (
            select 1 from channels where channels.image_url = '/api/identity-images/' || identity_images.sha256
        )
    `)
    const loadProjectIdentityStatement = sql.statement<
        CurrentIdentityFieldsRow,
        [projectId: string]
    >(`
        select id,
               website_url as websiteUrl,
               image_url as imageUrl,
               image_source as imageSource
        from projects
        where id = ?1
    `)
    const updateProjectIdentityStatement = sql.statement<
        { readonly changes: number },
        [
            websiteUrl: string | null,
            imageUrl: string | null,
            imageSource: IdentityImageSource | null,
            updatedAt: number,
            projectId: string,
        ]
    >(`
        update projects
        set website_url = ?1,
            image_url = ?2,
            image_source = ?3,
            updated_at = ?4
        where id = ?5
    `)
    const loadWorkspaceIdentityStatement = sql.statement<
        CurrentIdentityFieldsRow,
        [workspaceId: string]
    >(`
        select id,
               website_url as websiteUrl,
               image_url as imageUrl,
               image_source as imageSource
        from workspaces
        where id = ?1
    `)
    const updateWorkspaceIdentityStatement = sql.statement<
        { readonly changes: number },
        [
            websiteUrl: string | null,
            imageUrl: string | null,
            imageSource: IdentityImageSource | null,
            updatedAt: number,
            workspaceId: string,
        ]
    >(`
        update workspaces
        set website_url = ?1,
            image_url = ?2,
            image_source = ?3,
            updated_at = ?4
        where id = ?5
    `)
    const loadChannelIdentityStatement = sql.statement<ChannelIdentityRow, [channelId: string]>(`
        select id,
               website_url as websiteUrl,
               image_url as imageUrl,
               image_source as imageSource,
               revision
        from channels
        where id = ?1
    `)
    const updateChannelIdentityStatement = sql.statement<
        { readonly changes: number },
        [
            websiteUrl: string | null,
            imageUrl: string | null,
            imageSource: IdentityImageSource | null,
            updatedAt: number,
            channelId: string,
            expectedRevision: number,
        ]
    >(`
        update channels
        set website_url = ?1,
            image_url = ?2,
            image_source = ?3,
            updated_at = ?4,
            revision = revision + 1
        where id = ?5
          and revision = ?6
    `)
    const listAttachedProjectsForChannelStatement = sql.statement<
        { readonly projectId: string },
        [channelId: string]
    >(`
        select project_id as projectId
        from project_channel_attachments
        where channel_id = ?1
          and state = 'active'
    `)

    async function cleanupUnreferenced(): Promise<void> {
        const timestamp = now()
        if (
            await sql
                .statement('select 1 from media_backup_fences where expires_at > ?1')
                .get(timestamp)
        ) {
            return
        }
        await deleteUnreferencedImagesStatement.run()
    }

    async function putProcessed(processed: ProcessedIdentityImage): Promise<void> {
        await insertStoredImageStatement.run(
            processed.sha256,
            processed.contentType,
            processed.byteSize,
            processed.width,
            processed.height,
            new Uint8Array(processed.bytes),
            now()
        )
    }

    async function recordChannelCommit(
        channelId: string,
        contextProjectId?: string
    ): Promise<void> {
        if (contextProjectId) {
            recordDatabaseCommitProject(database, contextProjectId)
        }
        for (const attached of await listAttachedProjectsForChannelStatement.all(channelId)) {
            recordDatabaseCommitProject(database, attached.projectId)
        }
    }

    const saveProjectIdentityTransaction = defineTransaction(
        database,
        async (input: {
            readonly projectId: string
            readonly websiteUrl: string | null
            readonly imageUrl: string | null
            readonly imageSource: IdentityImageSource | null
            readonly processedImage?: ProcessedIdentityImage | null
        }): Promise<boolean> => {
            const current = await loadProjectIdentityStatement.get(input.projectId)
            if (current === null) return false
            if (input.processedImage) {
                await putProcessed(input.processedImage)
            }
            const timestamp = now()
            const updated = await updateProjectIdentityStatement.run(
                input.websiteUrl,
                input.imageUrl,
                input.imageSource,
                timestamp,
                input.projectId
            )
            if (updated.changes !== 1) return false
            recordDatabaseCommitProject(database, input.projectId)
            await cleanupUnreferenced()
            return true
        }
    )

    const saveWorkspaceIdentityTransaction = defineTransaction(
        database,
        async (input: {
            readonly workspaceId: string
            readonly websiteUrl: string | null
            readonly imageUrl: string | null
            readonly imageSource: IdentityImageSource | null
            readonly processedImage?: ProcessedIdentityImage | null
        }): Promise<boolean> => {
            const current = await loadWorkspaceIdentityStatement.get(input.workspaceId)
            if (current === null) return false
            if (input.processedImage) {
                await putProcessed(input.processedImage)
            }
            const timestamp = now()
            const updated = await updateWorkspaceIdentityStatement.run(
                input.websiteUrl,
                input.imageUrl,
                input.imageSource,
                timestamp,
                input.workspaceId
            )
            if (updated.changes !== 1) return false
            await cleanupUnreferenced()
            return true
        }
    )

    const saveChannelIdentityTransaction = defineTransaction(
        database,
        async (input: {
            readonly channelId: string
            readonly projectId?: string
            readonly expectedRevision?: number
            readonly websiteUrl: string | null
            readonly imageUrl: string | null
            readonly imageSource: IdentityImageSource | null
            readonly processedImage?: ProcessedIdentityImage | null
        }): Promise<boolean> => {
            const current = await loadChannelIdentityStatement.get(input.channelId)
            if (current === null) return false
            if (input.expectedRevision !== undefined) {
                if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
                    throw new DomainInvariantError(
                        'invalid_input',
                        'expectedRevision must be a positive safe integer'
                    )
                }
                if (current.revision !== input.expectedRevision) {
                    throw new DomainInvariantError(
                        'write_conflict',
                        `Channel ${input.channelId} is no longer at revision ${input.expectedRevision}`
                    )
                }
            }
            if (input.processedImage) {
                await putProcessed(input.processedImage)
            }
            const timestamp = now()
            const updated = await updateChannelIdentityStatement.run(
                input.websiteUrl,
                input.imageUrl,
                input.imageSource,
                timestamp,
                input.channelId,
                current.revision
            )
            if (updated.changes !== 1) {
                throw new DomainInvariantError(
                    'write_conflict',
                    `Channel ${input.channelId} changed during update`
                )
            }
            await recordChannelCommit(input.channelId, input.projectId)
            await cleanupUnreferenced()
            return true
        }
    )

    return {
        cleanupUnreferenced,

        async open(sha256: string): Promise<StoredIdentityImage | null> {
            const normalized = sha256.trim().toLowerCase()
            if (!/^[0-9a-f]{64}$/.test(normalized)) return null
            const row = await getStoredImageStatement.get(normalized)
            if (row === null) return null
            return {
                sha256: row.sha256,
                contentType: row.contentType,
                byteSize: Number(row.byteSize),
                width: Number(row.width),
                height: Number(row.height),
                bytes: new Uint8Array(row.bytes),
            }
        },

        async getProjectIdentity(projectId: string): Promise<CurrentIdentityFieldsRow | null> {
            return await loadProjectIdentityStatement.get(requireNonBlank(projectId, 'projectId'))
        },

        async getWorkspaceIdentity(workspaceId: string): Promise<CurrentIdentityFieldsRow | null> {
            return await loadWorkspaceIdentityStatement.get(
                requireNonBlank(workspaceId, 'workspaceId')
            )
        },

        async getChannelIdentity(channelId: string): Promise<ChannelIdentityRow | null> {
            return await loadChannelIdentityStatement.get(requireNonBlank(channelId, 'channelId'))
        },

        async setProjectWebsite(input: {
            readonly projectId: string
            readonly websiteUrl: string | null
            readonly faviconBytes?: Uint8Array | null
        }): Promise<boolean> {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const websiteUrl = normalizeIdentityWebsiteUrl(input.websiteUrl)
            const current = await loadProjectIdentityStatement.get(projectId)
            if (current === null) return false

            const hasExplicitImage =
                current.imageSource === 'upload' || current.imageSource === 'url'
            let imageUrl = current.imageUrl
            let imageSource = current.imageSource
            let processedImage: ProcessedIdentityImage | null = null

            if (websiteUrl === null) {
                if (!hasExplicitImage) {
                    imageUrl = null
                    imageSource = null
                }
            } else if (!hasExplicitImage) {
                if (input.faviconBytes) {
                    processedImage = await processIdentityImage(input.faviconBytes)
                    imageUrl = processedImage.imageUrl
                    imageSource = 'favicon'
                } else if (input.faviconBytes === null) {
                    imageUrl = null
                    imageSource = null
                }
            }

            return await saveProjectIdentityTransaction.immediate({
                projectId,
                websiteUrl,
                imageUrl,
                imageSource,
                processedImage,
            })
        },

        async setProjectImage(input: {
            readonly projectId: string
            readonly bytes: Uint8Array
            readonly source: IdentityImageSource
        }): Promise<ProcessedIdentityImage | null> {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const current = await loadProjectIdentityStatement.get(projectId)
            if (current === null) return null
            const processed = await processIdentityImage(input.bytes)
            const saved = await saveProjectIdentityTransaction.immediate({
                projectId,
                websiteUrl: current.websiteUrl,
                imageUrl: processed.imageUrl,
                imageSource: input.source,
                processedImage: processed,
            })
            return saved ? processed : null
        },

        async removeProjectImage(projectId: string): Promise<boolean> {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const current = await loadProjectIdentityStatement.get(normalizedProjectId)
            if (current === null) return false
            return await saveProjectIdentityTransaction.immediate({
                projectId: normalizedProjectId,
                websiteUrl: current.websiteUrl,
                imageUrl: null,
                imageSource: null,
            })
        },

        async setWorkspaceWebsite(input: {
            readonly workspaceId: string
            readonly websiteUrl: string | null
            readonly faviconBytes?: Uint8Array | null
        }): Promise<boolean> {
            const workspaceId = requireNonBlank(input.workspaceId, 'workspaceId')
            const websiteUrl = normalizeIdentityWebsiteUrl(input.websiteUrl)
            const current = await loadWorkspaceIdentityStatement.get(workspaceId)
            if (current === null) return false

            const hasExplicitImage =
                current.imageSource === 'upload' || current.imageSource === 'url'
            let imageUrl = current.imageUrl
            let imageSource = current.imageSource
            let processedImage: ProcessedIdentityImage | null = null

            if (websiteUrl === null) {
                if (!hasExplicitImage) {
                    imageUrl = null
                    imageSource = null
                }
            } else if (!hasExplicitImage) {
                if (input.faviconBytes) {
                    processedImage = await processIdentityImage(input.faviconBytes)
                    imageUrl = processedImage.imageUrl
                    imageSource = 'favicon'
                } else if (input.faviconBytes === null) {
                    imageUrl = null
                    imageSource = null
                }
            }

            return await saveWorkspaceIdentityTransaction.immediate({
                workspaceId,
                websiteUrl,
                imageUrl,
                imageSource,
                processedImage,
            })
        },

        async setWorkspaceImage(input: {
            readonly workspaceId: string
            readonly bytes: Uint8Array
            readonly source: IdentityImageSource
        }): Promise<ProcessedIdentityImage | null> {
            const workspaceId = requireNonBlank(input.workspaceId, 'workspaceId')
            const current = await loadWorkspaceIdentityStatement.get(workspaceId)
            if (current === null) return null
            const processed = await processIdentityImage(input.bytes)
            const saved = await saveWorkspaceIdentityTransaction.immediate({
                workspaceId,
                websiteUrl: current.websiteUrl,
                imageUrl: processed.imageUrl,
                imageSource: input.source,
                processedImage: processed,
            })
            return saved ? processed : null
        },

        async removeWorkspaceImage(workspaceId: string): Promise<boolean> {
            const normalizedWorkspaceId = requireNonBlank(workspaceId, 'workspaceId')
            const current = await loadWorkspaceIdentityStatement.get(normalizedWorkspaceId)
            if (current === null) return false
            return await saveWorkspaceIdentityTransaction.immediate({
                workspaceId: normalizedWorkspaceId,
                websiteUrl: current.websiteUrl,
                imageUrl: null,
                imageSource: null,
            })
        },

        async setChannelWebsite(input: {
            readonly channelId: string
            readonly projectId?: string
            readonly expectedRevision?: number
            readonly websiteUrl: string | null
            readonly faviconBytes?: Uint8Array | null
        }): Promise<boolean> {
            const channelId = requireNonBlank(input.channelId, 'channelId')
            const websiteUrl = normalizeIdentityWebsiteUrl(input.websiteUrl)
            const current = await loadChannelIdentityStatement.get(channelId)
            if (current === null) return false

            const hasExplicitImage =
                current.imageSource === 'upload' || current.imageSource === 'url'
            let imageUrl = current.imageUrl
            let imageSource = current.imageSource
            let processedImage: ProcessedIdentityImage | null = null

            if (websiteUrl === null) {
                if (!hasExplicitImage) {
                    imageUrl = null
                    imageSource = null
                }
            } else if (!hasExplicitImage) {
                if (input.faviconBytes) {
                    processedImage = await processIdentityImage(input.faviconBytes)
                    imageUrl = processedImage.imageUrl
                    imageSource = 'favicon'
                } else if (input.faviconBytes === null) {
                    imageUrl = null
                    imageSource = null
                }
            }

            return await saveChannelIdentityTransaction.immediate({
                channelId,
                projectId: input.projectId,
                expectedRevision: input.expectedRevision,
                websiteUrl,
                imageUrl,
                imageSource,
                processedImage,
            })
        },

        async setChannelImage(input: {
            readonly channelId: string
            readonly projectId?: string
            readonly expectedRevision?: number
            readonly bytes: Uint8Array
            readonly source: IdentityImageSource
        }): Promise<ProcessedIdentityImage | null> {
            const channelId = requireNonBlank(input.channelId, 'channelId')
            const current = await loadChannelIdentityStatement.get(channelId)
            if (current === null) return null
            const processed = await processIdentityImage(input.bytes)
            const saved = await saveChannelIdentityTransaction.immediate({
                channelId,
                projectId: input.projectId,
                expectedRevision: input.expectedRevision,
                websiteUrl: current.websiteUrl,
                imageUrl: processed.imageUrl,
                imageSource: input.source,
                processedImage: processed,
            })
            return saved ? processed : null
        },

        async removeChannelImage(input: {
            readonly channelId: string
            readonly projectId?: string
            readonly expectedRevision?: number
        }): Promise<boolean> {
            const channelId = requireNonBlank(input.channelId, 'channelId')
            const current = await loadChannelIdentityStatement.get(channelId)
            if (current === null) return false
            return await saveChannelIdentityTransaction.immediate({
                channelId,
                projectId: input.projectId,
                expectedRevision: input.expectedRevision,
                websiteUrl: current.websiteUrl,
                imageUrl: null,
                imageSource: null,
            })
        },
    }
}

export type IdentityImageStore = ReturnType<typeof createIdentityImageStore>
