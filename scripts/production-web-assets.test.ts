import { describe, expect, it } from 'bun:test'

import { verifyProductionDashboard } from './production-web-assets'

const dashboardHtml = `<!doctype html>
<html><head><title>Postdot</title>
<script type="module" src="/assets/app.js"></script>
<link rel="modulepreload" href="/assets/runtime.js">
<link rel="stylesheet" href="/assets/app.css">
</head><body><div id="root"></div></body></html>`

describe('production dashboard asset verification', () => {
    it('requests the dashboard shell and every referenced local built asset', async () => {
        const requests: string[] = []
        const responses = new Map([
            [
                '/assets/app.js',
                new Response('import "./runtime.js"', { headers: javascriptHeaders }),
            ],
            ['/assets/runtime.js', new Response('export {}', { headers: javascriptHeaders })],
            [
                '/assets/app.css',
                new Response('body { color: red }', { headers: stylesheetHeaders }),
            ],
        ])

        const result = await verifyProductionDashboard('http://localhost:3000', async url => {
            requests.push(url.pathname)
            if (url.pathname === '/') {
                return new Response(dashboardHtml, { headers: { 'content-type': 'text/html' } })
            }
            return responses.get(url.pathname) ?? new Response('Not Found', { status: 404 })
        })

        expect(result).toEqual({ assetCount: 3, javascriptCount: 2, stylesheetCount: 1 })
        expect(requests).toEqual(['/', '/assets/app.js', '/assets/runtime.js', '/assets/app.css'])
    })

    it('rejects a missing referenced asset instead of accepting an SPA fallback', async () => {
        await expect(
            verifyProductionDashboard('http://localhost:3000', async url => {
                if (url.pathname === '/') {
                    return new Response(dashboardHtml, { headers: { 'content-type': 'text/html' } })
                }
                if (url.pathname === '/assets/runtime.js') {
                    return new Response('Not Found', { status: 404 })
                }
                return new Response('asset', {
                    headers: url.pathname.endsWith('.css') ? stylesheetHeaders : javascriptHeaders,
                })
            })
        ).rejects.toThrow('Dashboard asset /assets/runtime.js returned HTTP 404')
    })

    it('rejects an entrypoint that is not the Postdot dashboard shell', async () => {
        await expect(
            verifyProductionDashboard(
                'http://localhost:3000',
                async () =>
                    new Response('<html><title>Other app</title></html>', {
                        headers: { 'content-type': 'text/html' },
                    })
            )
        ).rejects.toThrow('Dashboard shell is missing the Postdot title or application root')
    })
})

const javascriptHeaders = { 'content-type': 'text/javascript; charset=utf-8' }
const stylesheetHeaders = { 'content-type': 'text/css; charset=utf-8' }
