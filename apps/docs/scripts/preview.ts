/// <reference types="bun" />

import { stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

// Local review of the static export; production hosting remains a static host.
const previewRoot = resolve(import.meta.dir, '../out')
if (!(await Bun.file(resolve(previewRoot, 'index.html')).exists())) {
    throw new Error('Build the documentation workspace before starting its preview.')
}
const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 5174,
    async fetch(request) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return new Response('Method not allowed', {
                status: 405,
                headers: { Allow: 'GET, HEAD' },
            })
        }
        const url = new URL(request.url)
        let pathname: string
        try {
            pathname = decodeURIComponent(url.pathname)
        } catch {
            return new Response('Bad path', { status: 400 })
        }
        if (pathname.includes('\0')) return new Response('Bad path', { status: 400 })
        let path = resolve(previewRoot, `.${pathname}`)
        if (path !== previewRoot && !path.startsWith(`${previewRoot}${sep}`)) {
            return new Response('Not found', { status: 404 })
        }
        try {
            if ((await stat(path)).isDirectory()) {
                if (!url.pathname.endsWith('/')) {
                    url.pathname += '/'
                    return Response.redirect(url.href, 308)
                }
                path = resolve(path, 'index.html')
            }
        } catch {
            /* Missing paths use the exported not-found page below. */
        }
        let file = Bun.file(path)
        let status = 200
        if (!(await file.exists())) {
            file = Bun.file(resolve(previewRoot, '404.html'))
            status = 404
        }
        const contentType =
            status === 200 && pathname.replace(/\/$/, '') === '/api/search'
                ? 'application/json; charset=utf-8'
                : file.type
        return new Response(request.method === 'HEAD' ? null : file, {
            status,
            headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
        })
    },
})
console.info(`Postbot static preview: ${server.url}`)
