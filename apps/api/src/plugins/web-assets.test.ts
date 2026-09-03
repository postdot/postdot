import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createWebAssets } from './web-assets'

describe('Herald web assets', () => {
    it('serves static files and falls back to the SPA for browser routes', async () => {
        await withAssetFixture(async directory => {
            const app = await createWebAssets(directory)

            const rootResponse = await app.handle(new Request('http://localhost/'))
            expect(rootResponse.status).toBe(200)
            expect(rootResponse.headers.get('content-type')).toContain('text/html')
            expect(await rootResponse.text()).toContain('<title>Herald fixture</title>')

            const browserRouteResponse = await app.handle(new Request('http://localhost/dashboard'))
            expect(browserRouteResponse.status).toBe(200)
            expect(await browserRouteResponse.text()).toContain('<title>Herald fixture</title>')

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

    it('fails fast when the web build is missing', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'herald-web-assets-'))

        try {
            await expect(createWebAssets(directory)).rejects.toThrow('index.html')
        } finally {
            await rm(directory, { force: true, recursive: true })
        }
    })
})

async function withAssetFixture(run: (directory: string) => Promise<void>) {
    const directory = await mkdtemp(join(tmpdir(), 'herald-web-assets-'))

    try {
        await mkdir(join(directory, 'assets'))
        await writeFile(
            join(directory, 'index.html'),
            '<!doctype html><html><head><title>Herald fixture</title></head></html>'
        )
        await writeFile(join(directory, 'assets/app.js'), 'console.log("fixture")')
        await run(directory)
    } finally {
        await rm(directory, { force: true, recursive: true })
    }
}
