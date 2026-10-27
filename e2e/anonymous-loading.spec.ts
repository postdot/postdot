import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
// cspell:words networkidle
import { gzipSync } from 'node:zlib'

import { expect, test } from '@playwright/test'

test('anonymous login loads no authenticated feature modules', async ({ page }, info) => {
    const scripts = new Set<string>()
    page.on('request', request => {
        if (request.resourceType() === 'script') scripts.add(new URL(request.url()).pathname)
    })
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    // Anonymous login has no SSE connection; wait for its initial scripts to settle.
    await page.waitForLoadState('networkidle')
    expect(
        [...scripts].filter(path =>
            /(?:\/providers\/registry\.|\/assets\/registry-)|dashboard-context|app-toaster/.test(
                path
            )
        )
    ).toEqual([])
    if (process.env.POSTDOT_E2E_PRODUCTION_WEB === 'true') {
        const assets = [...scripts].filter(
            path => path.startsWith('/assets/') && path.endsWith('.js')
        )
        expect(assets.length).toBeGreaterThan(0)
        const gzipBytes = (
            await Promise.all(
                assets.map(
                    async path => gzipSync(await readFile(join('apps/web/dist', path))).byteLength
                )
            )
        ).reduce((sum, size) => sum + size, 0)
        expect(gzipBytes).toBeLessThanOrEqual(180 * 1024)
        await info.attach('anonymous-script-footprint', {
            body: JSON.stringify(
                {
                    files: assets,
                    gzipBytes,
                    method: 'sum of individually gzipped requested JavaScript files; not measured wire transfer',
                },
                null,
                2
            ),
            contentType: 'application/json',
        })
    }
})
