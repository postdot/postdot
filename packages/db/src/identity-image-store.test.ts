import { describe, expect, it } from 'bun:test'

import { createAccessStore } from './access-store'
import { closeDatabase, createDatabase, type DatabaseHandle } from './client'
import {
    createIdentityImageStore,
    IdentityImageValidationError,
    identityImageMaxBytes,
    identityImageMaxDimension,
    normalizeIdentityWebsiteUrl,
    processIdentityImage,
    sniffIdentityImageFormat,
} from './identity-image-store'
import { createManualStore } from './manual-store'
import {
    loadPortableMigrations,
    rollbackPortableMigration,
    runPortableMigrations,
} from './sql/migrator'
import { describeSchema } from './sql/schema-introspection'
import { closeTestDatabase, openTestDatabase } from './testing'

const onePixelPng = Uint8Array.from(
    Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
        'base64'
    )
)

const onePixelGif = Uint8Array.from(
    // cspell:disable-next-line
    Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
)

async function createLargePng(width: number, height: number): Promise<Uint8Array> {
    return new Uint8Array(
        await new Bun.Image(onePixelPng).resize(width, height, { fit: 'fill' }).png().bytes()
    )
}

async function createJpeg(width: number, height: number): Promise<Uint8Array> {
    return new Uint8Array(
        await new Bun.Image(onePixelPng).resize(width, height, { fit: 'fill' }).jpeg().bytes()
    )
}

async function createWebp(width: number, height: number): Promise<Uint8Array> {
    return new Uint8Array(
        await new Bun.Image(onePixelPng).resize(width, height, { fit: 'fill' }).webp().bytes()
    )
}

function createDibIco(width: number, height: number): Uint8Array {
    const rowStride = Math.ceil((width * 4) / 4) * 4
    const maskStride = Math.ceil(width / 32) * 4
    const xorSize = rowStride * height
    const andSize = maskStride * height
    const dibSize = 40 + xorSize + andSize
    const total = 6 + 16 + dibSize
    const out = new Uint8Array(total)
    const view = new DataView(out.buffer)

    // ICO directory header
    view.setUint16(0, 0, true)
    view.setUint16(2, 1, true)
    view.setUint16(4, 1, true)

    // ICO directory entry
    out[6] = width >= 256 ? 0 : width
    out[7] = height >= 256 ? 0 : height
    out[8] = 0
    out[9] = 0
    view.setUint16(10, 1, true)
    view.setUint16(12, 32, true)
    view.setUint32(14, dibSize, true)
    view.setUint32(18, 22, true)

    // Bitmap info header
    const dibOffset = 22
    view.setUint32(dibOffset, 40, true)
    view.setInt32(dibOffset + 4, width, true)
    view.setInt32(dibOffset + 8, height * 2, true)
    view.setUint16(dibOffset + 12, 1, true)
    view.setUint16(dibOffset + 14, 32, true)
    view.setUint32(dibOffset + 16, 0, true)
    view.setUint32(dibOffset + 20, xorSize, true)

    for (let i = 0; i < xorSize; i += 4) {
        out[dibOffset + 40 + i] = 0x40
        out[dibOffset + 40 + i + 1] = 0x80
        out[dibOffset + 40 + i + 2] = 0xc0
        out[dibOffset + 40 + i + 3] = 0xff
    }

    return out
}

async function seedOwner(database: DatabaseHandle, id = 'user-1') {
    await database.sql
        .statement('insert into "user" (id, name, email) values (?1, ?2, ?3)')
        .run(id, 'Owner', `${id}@postdot.local`)
}

describe('identity image migration and store', () => {
    it('applies and rolls back 0004_identity_images cleanly', async () => {
        const database = createDatabase(':memory:')
        try {
            const migrations = loadPortableMigrations()
            const before0004 = migrations.slice(0, -1)
            const migration0004 = migrations.at(-1)!
            expect(migration0004.name).toBe('identity_images')

            await runPortableMigrations(database, before0004)
            const schemaBefore = await describeSchema(database)

            await runPortableMigrations(database, migrations)
            const schemaAfter = await describeSchema(database)
            expect(schemaAfter.tables.identity_images).toBeDefined()
            expect(schemaAfter.tables.projects?.columns.website_url).toBeDefined()
            expect(schemaAfter.tables.workspaces?.columns.image_url).toBeDefined()
            expect(schemaAfter.tables.channels?.columns.image_source).toBeDefined()

            await rollbackPortableMigration(database, migration0004)
            const schemaRolledBack = await describeSchema(database)
            expect(schemaRolledBack).toEqual(schemaBefore)
        } finally {
            closeDatabase(database)
        }
    })

    it('sniffs, resizes to a square <= 256 px, and re-encodes PNG, JPEG, WebP, GIF, and ICO while rejecting SVG and oversized inputs', async () => {
        const largePng = await createLargePng(600, 320)
        expect(sniffIdentityImageFormat(largePng)).toBe('image/png')
        const processedPng = await processIdentityImage(largePng)
        expect(processedPng.contentType).toBe('image/webp')
        expect(processedPng.width).toBe(identityImageMaxDimension)
        expect(processedPng.height).toBe(identityImageMaxDimension)
        expect(processedPng.imageUrl).toBe(`/api/identity-images/${processedPng.sha256}`)

        const jpeg = await createJpeg(64, 48)
        expect(sniffIdentityImageFormat(jpeg)).toBe('image/jpeg')
        const processedJpeg = await processIdentityImage(jpeg)
        expect(processedJpeg.width).toBe(64)
        expect(processedJpeg.height).toBe(64)

        const webp = await createWebp(40, 40)
        expect(sniffIdentityImageFormat(webp)).toBe('image/webp')
        expect((await processIdentityImage(webp)).contentType).toBe('image/webp')

        expect(sniffIdentityImageFormat(onePixelGif)).toBe('image/gif')
        expect((await processIdentityImage(onePixelGif)).width).toBe(1)

        const dibIco = createDibIco(32, 32)
        expect(sniffIdentityImageFormat(dibIco)).toBe('image/x-icon')
        const processedIco = await processIdentityImage(dibIco)
        expect(processedIco.width).toBe(32)
        expect(processedIco.height).toBe(32)
        expect(processedIco.contentType).toBe('image/webp')

        const svgBytes = new TextEncoder().encode(
            '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"></svg>'
        )
        expect(() => sniffIdentityImageFormat(svgBytes)).toThrow(IdentityImageValidationError)
        try {
            sniffIdentityImageFormat(svgBytes)
        } catch (error) {
            expect((error as IdentityImageValidationError).code).toBe('identity_image_format')
        }

        const oversized = new Uint8Array(identityImageMaxBytes + 1)
        oversized.set(onePixelPng, 0)
        expect(() => sniffIdentityImageFormat(oversized)).toThrow(IdentityImageValidationError)
        try {
            sniffIdentityImageFormat(oversized)
        } catch (error) {
            expect((error as IdentityImageValidationError).code).toBe('identity_image_size')
        }
    })

    it('normalizes website URLs and rejects non-HTTP(S) schemes or credentials', () => {
        expect(normalizeIdentityWebsiteUrl('example.com/blog')).toBe('https://example.com/blog')
        expect(normalizeIdentityWebsiteUrl('https://postdot.example/')).toBe(
            'https://postdot.example/'
        )
        expect(normalizeIdentityWebsiteUrl('   ')).toBeNull()
        expect(normalizeIdentityWebsiteUrl(null)).toBeNull()
        expect(() => normalizeIdentityWebsiteUrl('javascript:alert(1)')).toThrow(
            IdentityImageValidationError
        )
        expect(() => normalizeIdentityWebsiteUrl('https://user:pass@example.com')).toThrow(
            IdentityImageValidationError
        )
    })

    it('sets and clears websiteUrl and identity images per project, workspace, and channel with deduplicated storage cleanup', async () => {
        const { database } = await openTestDatabase()
        try {
            await seedOwner(database, 'user-1')
            const accessStore = createAccessStore(database)
            await accessStore.claimFirstAccount({ userId: 'user-1' })
            const workspace = (await accessStore.getDefaultWorkspace())!
            expect(workspace.websiteUrl).toBeNull()
            expect(workspace.imageUrl).toBeNull()
            expect(workspace.imageSource).toBeNull()

            const manualStore = createManualStore(database)
            const { project } = await manualStore.createProject({
                name: 'Editorial',
                workspaceId: workspace.id,
                subjectId: 'user-1',
                displayName: 'Owner',
            })
            expect(project.websiteUrl).toBeNull()
            expect(project.imageUrl).toBeNull()
            expect(project.imageSource).toBeNull()

            const channel = (await manualStore.createChannel({
                projectId: project.id,
                subjectId: 'user-1',
                name: 'Company Blog',
            }))!
            expect(channel.websiteUrl).toBeNull()
            expect(channel.imageUrl).toBeNull()
            expect(channel.imageSource).toBeNull()

            const identityStore = createIdentityImageStore(database)
            const faviconBytes = await createLargePng(48, 48)
            const uploadedBytes = await createJpeg(128, 128)

            // 1. Set project website with resolved favicon
            expect(
                await identityStore.setProjectWebsite({
                    projectId: project.id,
                    websiteUrl: 'https://blog.example.com',
                    faviconBytes,
                })
            ).toBe(true)

            let updatedProject = (await manualStore.listProjects('user-1'))[0]!
            expect(updatedProject.websiteUrl).toBe('https://blog.example.com/')
            expect(updatedProject.imageSource).toBe('favicon')
            expect(updatedProject.imageUrl).toMatch(/^\/api\/identity-images\/[0-9a-f]{64}$/)
            const faviconSha = updatedProject.imageUrl!.split('/').at(-1)!
            expect(await identityStore.open(faviconSha)).not.toBeNull()

            // 2. Upload an explicit project image -> overrides favicon
            const uploaded = await identityStore.setProjectImage({
                projectId: project.id,
                bytes: uploadedBytes,
                source: 'upload',
            })
            expect(uploaded).not.toBeNull()
            updatedProject = (await manualStore.getProject(project.id))!
            expect(updatedProject.imageUrl).toBe(uploaded!.imageUrl)
            expect(updatedProject.imageSource).toBe('upload')
            // Previous favicon is unreferenced and cleaned up automatically
            expect(await identityStore.open(faviconSha)).toBeNull()

            // 3. Updating website when explicit image is set preserves explicit image
            await identityStore.setProjectWebsite({
                projectId: project.id,
                websiteUrl: 'https://news.example.com',
                faviconBytes,
            })
            updatedProject = (await manualStore.getProject(project.id))!
            expect(updatedProject.websiteUrl).toBe('https://news.example.com/')
            expect(updatedProject.imageUrl).toBe(uploaded!.imageUrl)
            expect(updatedProject.imageSource).toBe('upload')

            // 4. Removing project image clears imageUrl/imageSource and deletes unreferenced blob
            expect(await identityStore.removeProjectImage(project.id)).toBe(true)
            updatedProject = (await manualStore.getProject(project.id))!
            expect(updatedProject.imageUrl).toBeNull()
            expect(updatedProject.imageSource).toBeNull()
            expect(await identityStore.open(uploaded!.sha256)).toBeNull()

            // 5. Workspace website and image
            await identityStore.setWorkspaceWebsite({
                workspaceId: workspace.id,
                websiteUrl: 'https://workspace.example.com',
                faviconBytes,
            })
            let updatedWorkspace = (await accessStore.getWorkspace(workspace.id))!
            expect(updatedWorkspace.websiteUrl).toBe('https://workspace.example.com/')
            expect(updatedWorkspace.imageSource).toBe('favicon')
            expect(updatedWorkspace.imageUrl).not.toBeNull()

            await identityStore.setWorkspaceWebsite({
                workspaceId: workspace.id,
                websiteUrl: null,
            })
            updatedWorkspace = (await accessStore.getWorkspace(workspace.id))!
            expect(updatedWorkspace.websiteUrl).toBeNull()
            expect(updatedWorkspace.imageUrl).toBeNull()
            expect(updatedWorkspace.imageSource).toBeNull()

            // 6. Channel website and image (bumps revision)
            await identityStore.setChannelWebsite({
                channelId: channel.id,
                projectId: project.id,
                expectedRevision: channel.revision,
                websiteUrl: 'https://social.example.com/@postdot',
                faviconBytes,
            })
            let updatedChannel = (await manualStore.listChannels(project.id, 'user-1'))![0]!
            expect(updatedChannel.websiteUrl).toBe('https://social.example.com/@postdot')
            expect(updatedChannel.imageSource).toBe('favicon')
            expect(updatedChannel.revision).toBe(channel.revision + 1)

            await identityStore.removeChannelImage({
                channelId: channel.id,
                projectId: project.id,
                expectedRevision: updatedChannel.revision,
            })
            updatedChannel = (await manualStore.listChannels(project.id, 'user-1'))![0]!
            expect(updatedChannel.imageUrl).toBeNull()
            expect(updatedChannel.imageSource).toBeNull()
            expect(updatedChannel.websiteUrl).toBe('https://social.example.com/@postdot')
            expect(updatedChannel.revision).toBe(channel.revision + 2)
        } finally {
            await closeTestDatabase(database)
        }
    })
})
