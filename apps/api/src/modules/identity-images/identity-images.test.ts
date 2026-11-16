import { describe, expect, it } from 'bun:test'

import { createAuth } from '@postdot/auth'
import { createAccessStore, createNotificationStore, identityImageMaxBytes } from '@postdot/db'
import { closeTestDatabase, openTestDatabase } from '@postdot/db/testing'

import { createApp } from '../../app'
import { createPublisherRuntime } from '../publishers/runtime'
import { createIdentityImageResolver, selectHtmlIconCandidates } from './resolver'

const baseURL = 'http://localhost:3000'
const secret = 'postdot-test-secret-with-at-least-32-characters'
const now = 1_800_000_000_000

const onePixelPng = Uint8Array.from(
    Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
        'base64'
    )
)

const altPixelPng = Uint8Array.from(
    Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
    )
)

async function makePngBytes(
    width: number,
    height: number,
    color = { r: 30, g: 120, b: 210 }
): Promise<Uint8Array> {
    const seed = color.r > 100 ? altPixelPng : onePixelPng
    return new Uint8Array(
        await new Bun.Image(seed).resize(width, height, { fit: 'fill' }).png().bytes()
    )
}

function wrapPngInIco(pngBytes: Uint8Array, width = 32, height = 32): Uint8Array {
    const ico = new Uint8Array(22 + pngBytes.byteLength)
    const view = new DataView(ico.buffer)
    view.setUint16(0, 0, true)
    view.setUint16(2, 1, true)
    view.setUint16(4, 1, true)
    ico[6] = width >= 256 ? 0 : width
    ico[7] = height >= 256 ? 0 : height
    ico[8] = 0
    ico[9] = 0
    view.setUint16(10, 1, true)
    view.setUint16(12, 32, true)
    view.setUint32(14, pngBytes.byteLength, true)
    view.setUint32(18, 22, true)
    ico.set(pngBytes, 22)
    return ico
}

async function createFixture(
    options: {
        readonly identityImageResolver?: ReturnType<typeof createIdentityImageResolver>
        readonly allowAdditionalSignups?: boolean
    } = {}
) {
    const database = (await openTestDatabase()).database
    const publisher = createPublisherRuntime(database, {
        apiOrigin: baseURL,
        webOrigin: 'http://localhost:5173',
        publisherEncryptionKey: new Uint8Array(32).fill(7),
        publisherEncryptionKeyId: 'test-v1',
    })
    const access = createAccessStore(database, { now: () => now })
    const auth = createAuth(database, {
        baseURL,
        secret,
        access,
        allowAdditionalSignups: options.allowAdditionalSignups ?? true,
    })
    const app = createApp({
        auth,
        access,
        database,
        publisher,
        identityImageResolver: options.identityImageResolver,
        manualStore: { now: () => now },
        notifications: createNotificationStore(database, { now: () => now + 1_000 }),
    })
    return { app, access, database }
}

async function signUpWithUser(app: ReturnType<typeof createApp>, email = 'owner@postdot.local') {
    const response = await app.handle(
        new Request(`${baseURL}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                origin: baseURL,
            },
            body: JSON.stringify({
                email,
                name: email.split('@')[0] ?? 'User',
                password: 'correct-horse-battery-staple',
            }),
        })
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { user: { id: string } }
    return {
        cookie: response.headers.get('set-cookie')?.split(';', 1)[0] ?? '',
        userId: body.user.id,
    }
}

async function signUp(app: ReturnType<typeof createApp>, email = 'owner@postdot.local') {
    const { cookie } = await signUpWithUser(app, email)
    return cookie
}

async function jsonRequest(
    app: ReturnType<typeof createApp>,
    path: string,
    cookie: string,
    init: RequestInit = {}
) {
    const headers = new Headers(init.headers)
    if (cookie) headers.set('cookie', cookie)
    if (init.body !== undefined && !headers.has('content-type')) {
        headers.set('content-type', 'application/json')
    }
    return app.handle(
        new Request(`${baseURL}${path}`, {
            ...init,
            headers,
        })
    )
}

describe('selectHtmlIconCandidates', () => {
    it('prefers the largest raster icon >= 32 px and skips SVG links', () => {
        const html = `
            <!doctype html>
            <html>
            <head>
                <link rel="icon" type="image/svg+xml" href="/favicon.svg" sizes="any">
                <link rel="icon" type="image/png" sizes="16x16" href="/icon-16.png">
                <link rel="apple-touch-icon" sizes="180x180" href="/apple-180.png">
                <link rel="shortcut icon" sizes="64x64" href="https://cdn.example.com/icon-64.png">
                <link rel="icon" sizes="32x32" href="/icon-32.png">
            </head>
            <body></body>
            </html>
        `
        const candidates = selectHtmlIconCandidates(html, new URL('https://example.com/blog/post'))
        expect(candidates.map(item => item.url.toString())).toEqual([
            'https://example.com/apple-180.png',
            'https://cdn.example.com/icon-64.png',
            'https://example.com/icon-32.png',
            'https://example.com/icon-16.png',
        ])
    })
})

describe('website favicon resolution', () => {
    it.each([true, false])(
        'reads icon links from a large HTML prefix (truncated: %s)',
        async bodyTruncated => {
            const requests: string[] = []
            const html = new TextEncoder().encode(
                '<html><head><link rel="icon" sizes="32x32" href="/head.png"></head><body>' +
                    ' '.repeat(512 * 1024) +
                    '<link rel="icon" sizes="256x256" href="/beyond-limit.png"></body></html>'
            )
            const resolver = createIdentityImageResolver({
                fetcher: async input => {
                    const url = input.toString()
                    requests.push(url)
                    if (url === 'https://large.example.com/')
                        return {
                            status: 200,
                            headers: {
                                'content-type': 'text/html',
                                'content-length': String(html.byteLength),
                            },
                            body: bodyTruncated ? html.subarray(0, 512 * 1024) : html,
                            bodyTruncated,
                        }
                    return {
                        status: 200,
                        headers: {
                            'content-type': 'image/png',
                            'content-length': String(onePixelPng.byteLength),
                        },
                        body: onePixelPng,
                        bodyTruncated: false,
                    }
                },
            })
            const icon = await resolver.resolveWebsiteFavicon('https://large.example.com')
            expect(icon.bytes.byteLength).toBeGreaterThan(0)
            expect(requests).toEqual([
                'https://large.example.com/',
                'https://large.example.com/head.png',
            ])
        }
    )

    it('reports no favicon when every candidate, including the fallback, is oversized', async () => {
        const requests: string[] = []
        const resolver = createIdentityImageResolver({
            fetcher: async input => {
                const url = input.toString()
                requests.push(url)
                return url === 'https://oversized.example.com/'
                    ? {
                          status: 200,
                          headers: { 'content-type': 'text/html' },
                          body: new TextEncoder().encode(
                              '<head><link rel="icon" href="/icon.png"></head>'
                          ),
                          bodyTruncated: false,
                      }
                    : {
                          status: 200,
                          headers: { 'content-type': 'image/png' },
                          body: new Uint8Array(identityImageMaxBytes + 1),
                          bodyTruncated: true,
                      }
            },
        })
        await expect(
            resolver.resolveWebsiteFavicon('https://oversized.example.com')
        ).rejects.toMatchObject({
            code: 'identity_favicon_not_found',
            status: 422,
        })
        expect(requests).toEqual([
            'https://oversized.example.com/',
            'https://oversized.example.com/icon.png',
            'https://oversized.example.com/favicon.ico',
        ])
    })
})

describe('identity image and website API routes', () => {
    it('uploads, imports from URL, resolves favicons from HTML and /favicon.ico, and serves immutable WebP across projects, workspaces, and channels', async () => {
        const icon16 = await makePngBytes(16, 16, { r: 200, g: 50, b: 50 })
        const icon64 = await makePngBytes(64, 64, { r: 40, g: 180, b: 90 })
        const uploadedPng = await makePngBytes(400, 300, { r: 90, g: 60, b: 210 })
        const faviconIco = wrapPngInIco(
            await makePngBytes(32, 32, { r: 240, g: 140, b: 20 }),
            32,
            32
        )

        const resolver = createIdentityImageResolver({
            fetcher: async input => {
                const url = new URL(typeof input === 'string' ? input : input.toString())
                if (url.toString() === 'https://blog.example.com/') {
                    const html = `
                        <html><head>
                            <link rel="icon" href="/favicon.svg" type="image/svg+xml">
                            <link rel="icon" sizes="16x16" href="/icon-16.png">
                            <link rel="apple-touch-icon" sizes="64x64" href="/icon-64.png">
                        </head></html>
                    `
                    return {
                        status: 200,
                        headers: { 'content-type': 'text/html; charset=utf-8' },
                        body: new TextEncoder().encode(html),
                        bodyTruncated: false,
                    }
                }
                if (url.toString() === 'https://blog.example.com/icon-64.png') {
                    return {
                        status: 200,
                        headers: { 'content-type': 'image/png' },
                        body: icon64,
                        bodyTruncated: false,
                    }
                }
                if (url.toString() === 'https://blog.example.com/icon-16.png') {
                    return {
                        status: 200,
                        headers: { 'content-type': 'image/png' },
                        body: icon16,
                        bodyTruncated: false,
                    }
                }
                if (url.toString() === 'https://ico-fallback.example.com/') {
                    return {
                        status: 200,
                        headers: { 'content-type': 'text/html' },
                        body: new TextEncoder().encode(
                            '<html><head><title>No links</title></head></html>'
                        ),
                        bodyTruncated: false,
                    }
                }
                if (url.toString() === 'https://ico-fallback.example.com/favicon.ico') {
                    return {
                        status: 200,
                        headers: { 'content-type': 'image/x-icon' },
                        body: faviconIco,
                        bodyTruncated: false,
                    }
                }
                if (url.toString() === 'https://no-icon.example.com/') {
                    return {
                        status: 200,
                        headers: { 'content-type': 'text/html' },
                        body: new TextEncoder().encode('<html><head></head></html>'),
                        bodyTruncated: false,
                    }
                }
                if (url.toString() === 'https://cdn.example.com/brand.png') {
                    return {
                        status: 200,
                        headers: { 'content-type': 'image/png' },
                        body: uploadedPng,
                        bodyTruncated: false,
                    }
                }
                return {
                    status: 404,
                    headers: { 'content-type': 'text/plain' },
                    body: new TextEncoder().encode('Not found'),
                    bodyTruncated: false,
                }
            },
        })

        const { app, database } = await createFixture({ identityImageResolver: resolver })
        try {
            const cookie = await signUp(app)

            // 1. Create a project and set its website -> resolves 64x64 icon from HTML
            const createProjRes = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Editorial Project' }),
            })
            expect(createProjRes.status).toBe(201)
            const { project } = (await createProjRes.json()) as {
                project: {
                    id: string
                    workspaceId: string
                    websiteUrl: string | null
                    imageUrl: string | null
                    imageSource: string | null
                }
            }
            expect(project.websiteUrl).toBeNull()
            expect(project.imageUrl).toBeNull()
            expect(project.imageSource).toBeNull()

            const setWebsiteRes = await jsonRequest(
                app,
                `/api/projects/${project.id}/website`,
                cookie,
                {
                    method: 'PUT',
                    body: JSON.stringify({ websiteUrl: 'blog.example.com' }),
                }
            )
            expect(setWebsiteRes.status).toBe(200)
            const websiteBody = (await setWebsiteRes.json()) as {
                project: {
                    websiteUrl: string | null
                    imageUrl: string | null
                    imageSource: string | null
                }
                warning: string | null
            }
            expect(websiteBody.warning).toBeNull()
            expect(websiteBody.project.websiteUrl).toBe('https://blog.example.com/')
            expect(websiteBody.project.imageSource).toBe('favicon')
            expect(websiteBody.project.imageUrl).toMatch(/^\/api\/identity-images\/[a-f0-9]{64}$/)

            // Serve the stored identity image with immutable cache headers
            const imgRes = await jsonRequest(app, websiteBody.project.imageUrl!, cookie)
            expect(imgRes.status).toBe(200)
            expect(imgRes.headers.get('content-type')).toBe('image/webp')
            expect(imgRes.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
            expect(imgRes.headers.get('x-content-type-options')).toBe('nosniff')
            expect(imgRes.headers.get('vary')).toBe('Cookie, Authorization')
            const servedBytes = new Uint8Array(await imgRes.arrayBuffer())
            const servedMeta = await new Bun.Image(servedBytes).metadata()
            expect(servedMeta.width).toBe(64)
            expect(servedMeta.height).toBe(64)

            // 2. Upload a multipart image to the project (400x300 -> resized to 256x256 square)
            const form = new FormData()
            form.set('file', new File([uploadedPng], 'logo.png', { type: 'image/png' }))
            const uploadRes = await app.handle(
                new Request(`${baseURL}/api/projects/${project.id}/image`, {
                    method: 'POST',
                    headers: { cookie },
                    body: form,
                })
            )
            expect(uploadRes.status).toBe(200)
            const uploadedBody = (await uploadRes.json()) as {
                project: {
                    imageUrl: string | null
                    imageSource: string | null
                    websiteUrl: string | null
                }
            }
            expect(uploadedBody.project.imageSource).toBe('upload')
            expect(uploadedBody.project.websiteUrl).toBe('https://blog.example.com/')
            const uploadedImgRes = await jsonRequest(app, uploadedBody.project.imageUrl!, cookie)
            expect(uploadedImgRes.status).toBe(200)
            const uploadedServedMeta = await new Bun.Image(
                new Uint8Array(await uploadedImgRes.arrayBuffer())
            ).metadata()
            expect(uploadedServedMeta.width).toBe(256)
            expect(uploadedServedMeta.height).toBe(256)

            // 3. Switch back to the website's icon explicitly
            const useFaviconRes = await jsonRequest(
                app,
                `/api/projects/${project.id}/image/favicon`,
                cookie,
                { method: 'POST' }
            )
            expect(useFaviconRes.status).toBe(200)
            expect(
                ((await useFaviconRes.json()) as { project: { imageSource: string | null } })
                    .project.imageSource
            ).toBe('favicon')

            // 4. Remove the project image
            const removeImgRes = await jsonRequest(
                app,
                `/api/projects/${project.id}/image`,
                cookie,
                { method: 'DELETE' }
            )
            expect(removeImgRes.status).toBe(200)
            const removedBody = (await removeImgRes.json()) as {
                project: {
                    imageUrl: string | null
                    imageSource: string | null
                    websiteUrl: string | null
                }
            }
            expect(removedBody.project.imageUrl).toBeNull()
            expect(removedBody.project.imageSource).toBeNull()
            expect(removedBody.project.websiteUrl).toBe('https://blog.example.com/')

            // 5. Workspace website fallback to /favicon.ico and image from URL
            const wsWebsiteRes = await jsonRequest(
                app,
                `/api/workspaces/${project.workspaceId}/website`,
                cookie,
                {
                    method: 'PUT',
                    body: JSON.stringify({ websiteUrl: 'https://ico-fallback.example.com' }),
                }
            )
            expect(wsWebsiteRes.status).toBe(200)
            const wsBody = (await wsWebsiteRes.json()) as {
                workspace: {
                    websiteUrl: string | null
                    imageUrl: string | null
                    imageSource: string | null
                }
            }
            expect(wsBody.workspace.websiteUrl).toBe('https://ico-fallback.example.com/')
            expect(wsBody.workspace.imageSource).toBe('favicon')
            expect(wsBody.workspace.imageUrl).toMatch(/^\/api\/identity-images\/[a-f0-9]{64}$/)

            const wsUrlRes = await jsonRequest(
                app,
                `/api/workspaces/${project.workspaceId}/image/url`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ url: 'https://cdn.example.com/brand.png' }),
                }
            )
            expect(wsUrlRes.status).toBe(200)
            expect(
                ((await wsUrlRes.json()) as { workspace: { imageSource: string | null } }).workspace
                    .imageSource
            ).toBe('url')

            // 6. Channel website with missing icon leaves monogram and reports plain-words warning
            const createChannelRes = await jsonRequest(
                app,
                `/api/projects/${project.id}/channels`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Community Blog' }),
                }
            )
            expect(createChannelRes.status).toBe(201)
            const { channel } = (await createChannelRes.json()) as {
                channel: { id: string; revision: number }
            }

            const chanNoIconRes = await jsonRequest(
                app,
                `/api/projects/${project.id}/channels/${channel.id}/website`,
                cookie,
                {
                    method: 'PUT',
                    body: JSON.stringify({
                        websiteUrl: 'https://no-icon.example.com',
                        expectedRevision: channel.revision,
                    }),
                }
            )
            expect(chanNoIconRes.status).toBe(200)
            const chanNoIconBody = (await chanNoIconRes.json()) as {
                channel: {
                    websiteUrl: string | null
                    imageUrl: string | null
                    imageSource: string | null
                    revision: number
                }
                warning: string | null
            }
            expect(chanNoIconBody.channel.websiteUrl).toBe('https://no-icon.example.com/')
            expect(chanNoIconBody.channel.imageUrl).toBeNull()
            expect(chanNoIconBody.channel.imageSource).toBeNull()
            expect(chanNoIconBody.warning).toContain('No supported icon')

            // Stale expectedRevision is rejected with 409
            const staleRes = await jsonRequest(
                app,
                `/api/projects/${project.id}/channels/${channel.id}/website`,
                cookie,
                {
                    method: 'PUT',
                    body: JSON.stringify({
                        websiteUrl: 'https://blog.example.com',
                        expectedRevision: channel.revision,
                    }),
                }
            )
            expect(staleRes.status).toBe(409)
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('refuses oversized files, SVG/unsupported formats, invalid URLs, and unauthorized callers', async () => {
        const oversizedBytes = new Uint8Array(identityImageMaxBytes + 1024)
        oversizedBytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
        const svgBytes = new TextEncoder().encode(
            '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"></svg>'
        )

        const resolver = createIdentityImageResolver({
            fetcher: async input => {
                const url = new URL(typeof input === 'string' ? input : input.toString())
                if (url.toString() === 'https://cdn.example.com/huge.png') {
                    return {
                        status: 200,
                        headers: { 'content-type': 'image/png' },
                        body: oversizedBytes,
                        bodyTruncated: true,
                    }
                }
                if (url.toString() === 'https://cdn.example.com/vector.svg') {
                    return {
                        status: 200,
                        headers: { 'content-type': 'image/svg+xml' },
                        body: svgBytes,
                        bodyTruncated: false,
                    }
                }
                return {
                    status: 404,
                    headers: { 'content-type': 'text/plain' },
                    body: new Uint8Array(0),
                    bodyTruncated: false,
                }
            },
        })

        const { app, access, database } = await createFixture({ identityImageResolver: resolver })
        try {
            const ownerCookie = await signUp(app, 'owner@postdot.local')

            const createProjRes = await jsonRequest(app, '/api/projects', ownerCookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Guarded Project' }),
            })
            const { project } = (await createProjRes.json()) as {
                project: { id: string; workspaceId: string }
            }

            const { cookie: viewerCookie, userId: viewerUserId } = await signUpWithUser(
                app,
                'viewer@postdot.local'
            )
            await access.grantProjectUserAccess({
                projectId: project.id,
                userId: viewerUserId,
                role: 'viewer',
            })
            await database.sql
                .statement('update member set role = ?1 where user_id = ?2')
                .run('member', viewerUserId)

            // Unauthenticated requests -> 401
            expect(
                (
                    await jsonRequest(app, `/api/projects/${project.id}/website`, '', {
                        method: 'PUT',
                        body: JSON.stringify({ websiteUrl: 'https://example.com' }),
                    })
                ).status
            ).toBe(401)

            // Viewer cannot mutate project website or image -> 403
            expect(
                (
                    await jsonRequest(app, `/api/projects/${project.id}/website`, viewerCookie, {
                        method: 'PUT',
                        body: JSON.stringify({ websiteUrl: 'https://example.com' }),
                    })
                ).status
            ).toBe(403)
            expect(
                (
                    await jsonRequest(app, `/api/projects/${project.id}/image`, viewerCookie, {
                        method: 'DELETE',
                    })
                ).status
            ).toBe(403)

            // Non-admin cannot mutate workspace website -> 403
            expect(
                (
                    await jsonRequest(
                        app,
                        `/api/workspaces/${project.workspaceId}/website`,
                        viewerCookie,
                        {
                            method: 'PUT',
                            body: JSON.stringify({ websiteUrl: 'https://example.com' }),
                        }
                    )
                ).status
            ).toBe(403)

            // Invalid schemes -> 400
            expect(
                (
                    await jsonRequest(app, `/api/projects/${project.id}/website`, ownerCookie, {
                        method: 'PUT',
                        body: JSON.stringify({ websiteUrl: 'ftp://example.com' }),
                    })
                ).status
            ).toBe(400)
            expect(
                (
                    await jsonRequest(app, `/api/projects/${project.id}/image/url`, ownerCookie, {
                        method: 'POST',
                        body: JSON.stringify({ url: 'javascript:alert(1)' }),
                    })
                ).status
            ).toBe(400)

            // Use website icon when no website is set -> 400
            expect(
                (
                    await jsonRequest(
                        app,
                        `/api/projects/${project.id}/image/favicon`,
                        ownerCookie,
                        { method: 'POST' }
                    )
                ).status
            ).toBe(400)

            // Oversized upload -> 413
            const hugeForm = new FormData()
            hugeForm.set('file', new File([oversizedBytes], 'huge.png', { type: 'image/png' }))
            const hugeUploadRes = await app.handle(
                new Request(`${baseURL}/api/projects/${project.id}/image`, {
                    method: 'POST',
                    headers: { cookie: ownerCookie },
                    body: hugeForm,
                })
            )
            expect(hugeUploadRes.status).toBe(413)

            // Oversized remote URL -> 413
            const hugeUrlRes = await jsonRequest(
                app,
                `/api/projects/${project.id}/image/url`,
                ownerCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ url: 'https://cdn.example.com/huge.png' }),
                }
            )
            expect(hugeUrlRes.status).toBe(413)

            // SVG upload -> 415
            const svgForm = new FormData()
            svgForm.set('file', new File([svgBytes], 'icon.svg', { type: 'image/svg+xml' }))
            const svgUploadRes = await app.handle(
                new Request(`${baseURL}/api/projects/${project.id}/image`, {
                    method: 'POST',
                    headers: { cookie: ownerCookie },
                    body: svgForm,
                })
            )
            expect(svgUploadRes.status).toBe(415)

            // SVG remote URL -> 415
            const svgUrlRes = await jsonRequest(
                app,
                `/api/projects/${project.id}/image/url`,
                ownerCookie,
                {
                    method: 'POST',
                    body: JSON.stringify({ url: 'https://cdn.example.com/vector.svg' }),
                }
            )
            expect(svgUrlRes.status).toBe(415)
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('refuses direct and redirected private destinations for both website and image URL routes', async () => {
        const pngBytes = await makePngBytes(32, 32)
        const blockedServer = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch() {
                return new Response(pngBytes, {
                    headers: { 'content-type': 'image/png' },
                })
            },
        })
        const allowedRedirectServer = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch(request) {
                const url = new URL(request.url)
                if (url.pathname === '/redirect-private') {
                    return new Response(null, {
                        status: 302,
                        headers: {
                            location: `http://127.0.0.1:${blockedServer.port}/secret.png`,
                        },
                    })
                }
                if (url.pathname === '/page-with-private-icon') {
                    return new Response(
                        `<html><head><link rel="icon" href="http://127.0.0.1:${blockedServer.port}/secret.png"></head></html>`,
                        { headers: { 'content-type': 'text/html' } }
                    )
                }
                return new Response('Not found', { status: 404 })
            },
        })

        // Allow only allowedRedirectServer.port; blockedServer.port remains denied by policy.
        const resolver = createIdentityImageResolver({
            privateDestinations: [
                {
                    kind: 'cidr',
                    cidr: '127.0.0.1/32',
                    port: allowedRedirectServer.port ?? 0,
                    schemes: ['http'],
                },
            ],
        })
        const { app, database } = await createFixture({ identityImageResolver: resolver })

        try {
            const cookie = await signUp(app)
            const createProjRes = await jsonRequest(app, '/api/projects', cookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Outbound Policy Project' }),
            })
            const { project } = (await createProjRes.json()) as { project: { id: string } }

            // Direct private destination refused for website
            const directWebsiteRes = await jsonRequest(
                app,
                `/api/projects/${project.id}/website`,
                cookie,
                {
                    method: 'PUT',
                    body: JSON.stringify({
                        websiteUrl: `http://127.0.0.1:${blockedServer.port}/`,
                    }),
                }
            )
            expect(directWebsiteRes.status).toBe(422)
            expect(
                ((await directWebsiteRes.json()) as { error: { code: string } }).error.code
            ).toBe('identity_network_policy_denied')

            // Redirect to private destination refused for website
            const redirectWebsiteRes = await jsonRequest(
                app,
                `/api/projects/${project.id}/website`,
                cookie,
                {
                    method: 'PUT',
                    body: JSON.stringify({
                        websiteUrl: `http://127.0.0.1:${allowedRedirectServer.port}/redirect-private`,
                    }),
                }
            )
            expect(redirectWebsiteRes.status).toBe(422)
            expect(
                ((await redirectWebsiteRes.json()) as { error: { code: string } }).error.code
            ).toBe('identity_network_policy_denied')

            // Website HTML linking to a private icon destination is refused
            const privateIconWebsiteRes = await jsonRequest(
                app,
                `/api/projects/${project.id}/website`,
                cookie,
                {
                    method: 'PUT',
                    body: JSON.stringify({
                        websiteUrl: `http://127.0.0.1:${allowedRedirectServer.port}/page-with-private-icon`,
                    }),
                }
            )
            expect(privateIconWebsiteRes.status).toBe(422)
            expect(
                ((await privateIconWebsiteRes.json()) as { error: { code: string } }).error.code
            ).toBe('identity_network_policy_denied')

            // Direct private destination refused for image URL
            const directImgUrlRes = await jsonRequest(
                app,
                `/api/projects/${project.id}/image/url`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        url: `http://127.0.0.1:${blockedServer.port}/secret.png`,
                    }),
                }
            )
            expect(directImgUrlRes.status).toBe(422)
            expect(((await directImgUrlRes.json()) as { error: { code: string } }).error.code).toBe(
                'identity_network_policy_denied'
            )

            // Redirect to private destination refused for image URL
            const redirectImgUrlRes = await jsonRequest(
                app,
                `/api/projects/${project.id}/image/url`,
                cookie,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        url: `http://127.0.0.1:${allowedRedirectServer.port}/redirect-private`,
                    }),
                }
            )
            expect(redirectImgUrlRes.status).toBe(422)
            expect(
                ((await redirectImgUrlRes.json()) as { error: { code: string } }).error.code
            ).toBe('identity_network_policy_denied')
        } finally {
            await blockedServer.stop(true)
            await allowedRedirectServer.stop(true)
            await closeTestDatabase(database)
        }
    })
})

it('ignores commented and scripted icon markup and resolves the document base and entities', () => {
    const candidates = selectHtmlIconCandidates(
        `<!doctype html><head>
        <!-- <link rel="icon" href="http://127.0.0.1/private"> -->
        <script>const example = '<link rel="icon" href="/fake.png">'</script>
        <base href="/assets/">
        <link rel="icon" sizes="64x64" href="brand.png?a=1&amp;b=2">
        <link rel="icon" type="image/svg+xml" href="script.svg">
    </head>`,
        new URL('https://example.com/blog')
    )
    expect(candidates.map(item => item.url.href)).toEqual([
        'https://example.com/assets/brand.png?a=1&b=2',
    ])
})

it('checks live channel management, scopes image reads, and validates base64 uploads', async () => {
    const { app, access, database } = await createFixture()
    try {
        const owner = await signUpWithUser(app)
        const outsider = await signUpWithUser(app, 'image-outsider@postdot.local')
        await database.sql
            .statement("update member set role = 'member' where user_id = ?")
            .run(outsider.userId)
        const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) })
        const { project } = (await (
            await jsonRequest(app, '/api/projects', owner.cookie, post({ name: 'Identity scope' }))
        ).json()) as { project: { id: string } }
        const { channel } = (await (
            await jsonRequest(
                app,
                `/api/projects/${project.id}/channels`,
                owner.cookie,
                post({ name: 'Custom site' })
            )
        ).json()) as { channel: { id: string; revision: number } }
        const path = `/api/projects/${project.id}/channels/${channel.id}`
        const { project: image } = (await (
            await jsonRequest(
                app,
                `/api/projects/${project.id}/image`,
                owner.cookie,
                post({ base64: Buffer.from(onePixelPng).toString('base64') })
            )
        ).json()) as { project: { imageUrl: string } }
        expect((await jsonRequest(app, image.imageUrl, outsider.cookie)).status).toBe(404)
        const channelUpload = await jsonRequest(
            app,
            `${path}/image`,
            owner.cookie,
            post({ base64: Buffer.from(altPixelPng).toString('base64') })
        )
        expect(channelUpload.status).toBe(200)
        const channelImage = (await channelUpload.json()) as { channel: { imageUrl: string } }
        expect(
            (await jsonRequest(app, channelImage.channel.imageUrl, outsider.cookie)).status
        ).toBe(404)
        const { project: otherProject } = (await (
            await jsonRequest(
                app,
                '/api/projects',
                owner.cookie,
                post({ name: 'Other image scope' })
            )
        ).json()) as { project: { id: string } }
        const { token } = (await (
            await jsonRequest(
                app,
                '/api/api-keys',
                owner.cookie,
                post({
                    name: 'Other project reader',
                    projectIds: [otherProject.id],
                    capabilities: ['project:read'],
                })
            )
        ).json()) as { token: string }
        expect(
            (
                await jsonRequest(app, image.imageUrl, '', {
                    headers: { authorization: `Bearer ${token}` },
                })
            ).status
        ).toBe(404)

        expect(
            (await jsonRequest(app, '/api/identity-images/../../secret', owner.cookie)).status
        ).not.toBe(200)
        const corrupt = await jsonRequest(
            app,
            `/api/projects/${project.id}/image`,
            owner.cookie,
            post({ base64: 'AA==junk' })
        )
        expect(corrupt.status).toBe(400)
        await access.grantProjectUserAccess({
            projectId: project.id,
            userId: outsider.userId,
            role: 'viewer',
        })
        expect(
            (
                await jsonRequest(
                    app,
                    `/api/projects/${project.id}/image`,
                    outsider.cookie,
                    post({ base64: Buffer.from(onePixelPng).toString('base64') })
                )
            ).status
        ).toBe(403)
        await access.grantProjectUserAccess({
            projectId: project.id,
            userId: outsider.userId,
            role: 'editor',
        })
        // Workspace management owns this channel; an editor grant alone grants no management.
        await database.sql
            .statement('delete from channel_managers where channel_id = ?')
            .run(channel.id)
        for (const [suffix, init] of [
            ['/website', { method: 'PUT', body: JSON.stringify({ websiteUrl: null }) }],
            ['/image', post({ base64: Buffer.from(onePixelPng).toString('base64') })],
            ['/image/url', post({ url: 'https://example.com/image.png' })],
            ['/image/favicon', { method: 'POST' }],
            ['/image', { method: 'DELETE' }],
        ] as const) {
            expect((await jsonRequest(app, `${path}${suffix}`, outsider.cookie, init)).status).toBe(
                404
            )
        }
        const stale = await jsonRequest(
            app,
            `${path}/image?expectedRevision=999`,
            owner.cookie,
            post({ base64: Buffer.from(onePixelPng).toString('base64') })
        )
        expect(stale.status).toBe(409)
        const spoofed = await app.handle(
            new Request(`${baseURL}/api/projects/${project.id}/image`, {
                method: 'POST',
                headers: { cookie: owner.cookie, 'content-type': 'image/png' },
                body: '<svg onload="alert(1)"></svg>',
            })
        )
        expect(spoofed.status).toBe(415)
    } finally {
        await closeTestDatabase(database)
    }
})

it('bounds the complete remote fetch even when DNS or a fetcher does not observe cancellation', async () => {
    const resolver = createIdentityImageResolver({
        requestTimeoutMs: 10,
        fetcher: () => new Promise(() => {}),
    })
    await Promise.all([
        expect(resolver.fetchImageFromUrl('https://example.com/logo.png')).rejects.toMatchObject({
            code: 'identity_remote_unavailable',
        }),
        expect(resolver.resolveWebsiteFavicon('https://example.com')).rejects.toMatchObject({
            code: 'identity_remote_unavailable',
        }),
    ])
})
