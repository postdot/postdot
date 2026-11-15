import { DomainInvariantError, requireNonBlank, type IdentityImageSource } from '@postdot/core'

import { defineTransaction, recordDatabaseCommitProject, type DatabaseHandle } from './client'
import {
    IdentityImageValidationError,
    processIdentityImage,
    type ProcessedIdentityImage,
    type StoredIdentityImage,
} from './identity-image-processing'
export * from './identity-image-processing'

export class IdentityImageAuthorizationError extends Error {
    readonly code = 'forbidden'
    constructor() {
        super('Resource management access changed; reload before editing')
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
            readonly authorize?: () => Promise<boolean>
            readonly websiteUrl?: string | null
            readonly preserveExplicitImage?: boolean
            readonly imageUrl: string | null
            readonly imageSource: IdentityImageSource | null
            readonly processedImage?: ProcessedIdentityImage | null
        }): Promise<boolean> => {
            const current = await loadProjectIdentityStatement.get(input.projectId)
            if (current === null) return false
            if (input.authorize && !(await input.authorize()))
                throw new IdentityImageAuthorizationError()
            if (input.processedImage) {
                await putProcessed(input.processedImage)
            }
            const timestamp = now()
            const updated = await updateProjectIdentityStatement.run(
                input.websiteUrl === undefined ? current.websiteUrl : input.websiteUrl,
                input.preserveExplicitImage &&
                    (current.imageSource === 'upload' || current.imageSource === 'url')
                    ? current.imageUrl
                    : input.imageUrl,
                input.preserveExplicitImage &&
                    (current.imageSource === 'upload' || current.imageSource === 'url')
                    ? current.imageSource
                    : input.imageSource,
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
            readonly authorize?: () => Promise<boolean>
            readonly websiteUrl?: string | null
            readonly preserveExplicitImage?: boolean
            readonly imageUrl: string | null
            readonly imageSource: IdentityImageSource | null
            readonly processedImage?: ProcessedIdentityImage | null
        }): Promise<boolean> => {
            const current = await loadWorkspaceIdentityStatement.get(input.workspaceId)
            if (current === null) return false
            if (input.authorize && !(await input.authorize()))
                throw new IdentityImageAuthorizationError()
            if (input.processedImage) {
                await putProcessed(input.processedImage)
            }
            const timestamp = now()
            const updated = await updateWorkspaceIdentityStatement.run(
                input.websiteUrl === undefined ? current.websiteUrl : input.websiteUrl,
                input.preserveExplicitImage &&
                    (current.imageSource === 'upload' || current.imageSource === 'url')
                    ? current.imageUrl
                    : input.imageUrl,
                input.preserveExplicitImage &&
                    (current.imageSource === 'upload' || current.imageSource === 'url')
                    ? current.imageSource
                    : input.imageSource,
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
            readonly authorize?: () => Promise<boolean>
            readonly projectId?: string
            readonly expectedRevision?: number
            readonly websiteUrl?: string | null
            readonly preserveExplicitImage?: boolean
            readonly imageUrl: string | null
            readonly imageSource: IdentityImageSource | null
            readonly processedImage?: ProcessedIdentityImage | null
        }): Promise<boolean> => {
            const current = await loadChannelIdentityStatement.get(input.channelId)
            if (current === null) return false
            if (input.authorize && !(await input.authorize()))
                throw new IdentityImageAuthorizationError()
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
                input.websiteUrl === undefined ? current.websiteUrl : input.websiteUrl,
                input.preserveExplicitImage &&
                    (current.imageSource === 'upload' || current.imageSource === 'url')
                    ? current.imageUrl
                    : input.imageUrl,
                input.preserveExplicitImage &&
                    (current.imageSource === 'upload' || current.imageSource === 'url')
                    ? current.imageSource
                    : input.imageSource,
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

        async references(sha256: string) {
            const url = `/api/identity-images/${sha256}`
            return await sql
                .statement<{
                    projectId: string | null
                    workspaceId: string | null
                    channelId: string | null
                }>(`
                select id as projectId, null as workspaceId, null as channelId from projects where image_url = ?1
                union select null, id, null from workspaces where image_url = ?1
                union select a.project_id, null, null from channels c join project_channel_attachments a on a.channel_id = c.id where c.image_url = ?1 and a.state = 'active'
                union select null, workspace_id, id from channels where image_url = ?1
            `)
                .all(url)
        },

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
            readonly authorize?: () => Promise<boolean>
            readonly websiteUrl: string | null
            readonly faviconBytes?: Uint8Array | null
            readonly faviconImage?: ProcessedIdentityImage
        }): Promise<boolean> {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const websiteUrl = normalizeIdentityWebsiteUrl(input.websiteUrl)
            const current = await loadProjectIdentityStatement.get(projectId)
            if (current === null) return false

            const processedImage =
                input.faviconImage ??
                (input.faviconBytes ? await processIdentityImage(input.faviconBytes) : null)
            const imageUrl = websiteUrl === null ? null : (processedImage?.imageUrl ?? null)
            const imageSource = imageUrl === null ? null : 'favicon'

            return await saveProjectIdentityTransaction.immediate({
                authorize: input.authorize,
                projectId,
                websiteUrl,
                preserveExplicitImage: true,
                imageUrl,
                imageSource,
                processedImage,
            })
        },

        async setProjectImage(input: {
            readonly projectId: string
            readonly authorize?: () => Promise<boolean>
            readonly bytes: Uint8Array
            readonly processedImage?: ProcessedIdentityImage
            readonly source: IdentityImageSource
        }): Promise<ProcessedIdentityImage | null> {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const current = await loadProjectIdentityStatement.get(projectId)
            if (current === null) return null
            const processed = input.processedImage ?? (await processIdentityImage(input.bytes))
            const saved = await saveProjectIdentityTransaction.immediate({
                authorize: input.authorize,
                projectId,
                imageUrl: processed.imageUrl,
                imageSource: input.source,
                processedImage: processed,
            })
            return saved ? processed : null
        },

        async removeProjectImage(
            projectId: string,
            authorize?: () => Promise<boolean>
        ): Promise<boolean> {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const current = await loadProjectIdentityStatement.get(normalizedProjectId)
            if (current === null) return false
            return await saveProjectIdentityTransaction.immediate({
                authorize,
                projectId: normalizedProjectId,
                imageUrl: null,
                imageSource: null,
            })
        },

        async setWorkspaceWebsite(input: {
            readonly workspaceId: string
            readonly authorize?: () => Promise<boolean>
            readonly websiteUrl: string | null
            readonly faviconBytes?: Uint8Array | null
            readonly faviconImage?: ProcessedIdentityImage
        }): Promise<boolean> {
            const workspaceId = requireNonBlank(input.workspaceId, 'workspaceId')
            const websiteUrl = normalizeIdentityWebsiteUrl(input.websiteUrl)
            const current = await loadWorkspaceIdentityStatement.get(workspaceId)
            if (current === null) return false

            const processedImage =
                input.faviconImage ??
                (input.faviconBytes ? await processIdentityImage(input.faviconBytes) : null)
            const imageUrl = websiteUrl === null ? null : (processedImage?.imageUrl ?? null)
            const imageSource = imageUrl === null ? null : 'favicon'

            return await saveWorkspaceIdentityTransaction.immediate({
                authorize: input.authorize,
                workspaceId,
                websiteUrl,
                preserveExplicitImage: true,
                imageUrl,
                imageSource,
                processedImage,
            })
        },

        async setWorkspaceImage(input: {
            readonly workspaceId: string
            readonly authorize?: () => Promise<boolean>
            readonly bytes: Uint8Array
            readonly processedImage?: ProcessedIdentityImage
            readonly source: IdentityImageSource
        }): Promise<ProcessedIdentityImage | null> {
            const workspaceId = requireNonBlank(input.workspaceId, 'workspaceId')
            const current = await loadWorkspaceIdentityStatement.get(workspaceId)
            if (current === null) return null
            const processed = input.processedImage ?? (await processIdentityImage(input.bytes))
            const saved = await saveWorkspaceIdentityTransaction.immediate({
                authorize: input.authorize,
                workspaceId,
                imageUrl: processed.imageUrl,
                imageSource: input.source,
                processedImage: processed,
            })
            return saved ? processed : null
        },

        async removeWorkspaceImage(
            workspaceId: string,
            authorize?: () => Promise<boolean>
        ): Promise<boolean> {
            const normalizedWorkspaceId = requireNonBlank(workspaceId, 'workspaceId')
            const current = await loadWorkspaceIdentityStatement.get(normalizedWorkspaceId)
            if (current === null) return false
            return await saveWorkspaceIdentityTransaction.immediate({
                authorize,
                workspaceId: normalizedWorkspaceId,
                imageUrl: null,
                imageSource: null,
            })
        },

        async setChannelWebsite(input: {
            readonly channelId: string
            readonly authorize?: () => Promise<boolean>
            readonly projectId?: string
            readonly expectedRevision?: number
            readonly websiteUrl: string | null
            readonly faviconBytes?: Uint8Array | null
            readonly faviconImage?: ProcessedIdentityImage
        }): Promise<boolean> {
            const channelId = requireNonBlank(input.channelId, 'channelId')
            const websiteUrl = normalizeIdentityWebsiteUrl(input.websiteUrl)
            const current = await loadChannelIdentityStatement.get(channelId)
            if (current === null) return false

            const processedImage =
                input.faviconImage ??
                (input.faviconBytes ? await processIdentityImage(input.faviconBytes) : null)
            const imageUrl = websiteUrl === null ? null : (processedImage?.imageUrl ?? null)
            const imageSource = imageUrl === null ? null : 'favicon'

            return await saveChannelIdentityTransaction.immediate({
                authorize: input.authorize,
                channelId,
                projectId: input.projectId,
                expectedRevision: input.expectedRevision ?? current.revision,
                websiteUrl,
                preserveExplicitImage: true,
                imageUrl,
                imageSource,
                processedImage,
            })
        },

        async setChannelImage(input: {
            readonly channelId: string
            readonly authorize?: () => Promise<boolean>
            readonly projectId?: string
            readonly expectedRevision?: number
            readonly bytes: Uint8Array
            readonly processedImage?: ProcessedIdentityImage
            readonly source: IdentityImageSource
        }): Promise<ProcessedIdentityImage | null> {
            const channelId = requireNonBlank(input.channelId, 'channelId')
            const current = await loadChannelIdentityStatement.get(channelId)
            if (current === null) return null
            const processed = input.processedImage ?? (await processIdentityImage(input.bytes))
            const saved = await saveChannelIdentityTransaction.immediate({
                authorize: input.authorize,
                channelId,
                projectId: input.projectId,
                expectedRevision: input.expectedRevision ?? current.revision,
                imageUrl: processed.imageUrl,
                imageSource: input.source,
                processedImage: processed,
            })
            return saved ? processed : null
        },

        async removeChannelImage(input: {
            readonly channelId: string
            readonly authorize?: () => Promise<boolean>
            readonly projectId?: string
            readonly expectedRevision?: number
        }): Promise<boolean> {
            const channelId = requireNonBlank(input.channelId, 'channelId')
            const current = await loadChannelIdentityStatement.get(channelId)
            if (current === null) return false
            return await saveChannelIdentityTransaction.immediate({
                authorize: input.authorize,
                channelId,
                projectId: input.projectId,
                expectedRevision: input.expectedRevision ?? current.revision,
                imageUrl: null,
                imageSource: null,
            })
        },
    }
}

export type IdentityImageStore = ReturnType<typeof createIdentityImageStore>
