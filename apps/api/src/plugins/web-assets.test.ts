import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Elysia } from 'elysia'

import { createAuthRoutes } from './auth'
import { createWebAssets } from './web-assets'

describe('Postdot web assets', () => {
    it('serves static files and falls back to the SPA for browser routes', async () => {
        await withAssetFixture(async directory => {
            const app = await createWebAssets(directory)

            const rootResponse = await app.handle(new Request('http://localhost/'))
            expect(rootResponse.status).toBe(200)
            expect(rootResponse.headers.get('content-type')).toContain('text/html')
            expect(await rootResponse.text()).toContain('<title>Postdot fixture</title>')

            const browserRouteResponse = await app.handle(new Request('http://localhost/dashboard'))
            expect(browserRouteResponse.status).toBe(200)
            expect(await browserRouteResponse.text()).toContain('<title>Postdot fixture</title>')

            const assetResponse = await app.handle(new Request('http://localhost/assets/app.js'))
            expect(assetResponse.status).toBe(200)
            expect(assetResponse.headers.get('content-type')).toContain('text/javascript')
            expect(await assetResponse.text()).toBe('console.log("fixture")')

            const unknownServerPathResponse = await app.handle(
                new Request('http://localhost/api/unknown')
            )
            expect(unknownServerPathResponse.status).toBe(404)

            const unknownReadinessPathResponse = await app.handle(
                new Request('http://localhost/ready/unknown')
            )
            expect(unknownReadinessPathResponse.status).toBe(404)

            const unknownAssetResponse = await app.handle(
                new Request('http://localhost/assets/missing.js')
            )
            expect(unknownAssetResponse.status).toBe(404)
        })
    })

    it('keeps mounted auth GET and POST routes ahead of the dashboard fallback', async () => {
        await withAssetFixture(async directory => {
            const auth = {
                handler: async (request: Request) =>
                    Response.json({
                        path: new URL(request.url).pathname,
                        method: request.method,
                        body: request.method === 'POST' ? await request.json() : null,
                    }),
            }
            const app = new Elysia()
                .use(createAuthRoutes(auth))
                .use(await createWebAssets(directory))

            const session = await app.handle(new Request('http://localhost/api/auth/get-session'))
            expect(session.status).toBe(200)
            expect(await session.json()).toEqual({
                path: '/api/auth/get-session',
                method: 'GET',
                body: null,
            })
            const signIn = await app.handle(
                new Request('http://localhost/api/auth/sign-in/email', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ email: 'operator@example.com' }),
                })
            )
            expect(signIn.status).toBe(200)
            expect(await signIn.json()).toEqual({
                path: '/api/auth/sign-in/email',
                method: 'POST',
                body: { email: 'operator@example.com' },
            })
            const dashboard = await app.handle(new Request('http://localhost/dashboard'))
            expect(dashboard.status).toBe(200)
            expect(await dashboard.text()).toContain('<title>Postdot fixture</title>')
        })
    })

    it('fails fast when the web build is missing', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postbot-web-assets-'))

        try {
            await expect(createWebAssets(directory)).rejects.toThrow('index.html')
        } finally {
            await rm(directory, { force: true, recursive: true })
        }
    })
})

async function withAssetFixture(run: (directory: string) => Promise<void>) {
    const directory = await mkdtemp(join(tmpdir(), 'postbot-web-assets-'))

    try {
        await mkdir(join(directory, 'assets'))
        await writeFile(
            join(directory, 'index.html'),
            '<!doctype html><html><head><title>Postdot fixture</title></head></html>'
        )
        await writeFile(join(directory, 'assets/app.js'), 'console.log("fixture")')
        await run(directory)
    } finally {
        await rm(directory, { force: true, recursive: true })
    }
}
