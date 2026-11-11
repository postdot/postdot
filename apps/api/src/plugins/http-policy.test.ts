import { describe, expect, it } from 'bun:test'

import { Elysia } from 'elysia'

import { createHttpPolicy } from './http-policy'

describe('instance HTTP policy', () => {
    const app = new Elysia()
        .use(createHttpPolicy(async (request): Promise<Response> => app.handle(request)))
        .get('/health', () => ({ status: 'ok' }))
        .get('/ready', ({ status }) => status(503, 'Unavailable'))
        .get('/private', ({ request, status }) =>
            request.headers.get('authorization') === 'Bearer fixture'
                ? 'private'
                : status(401, 'Unauthorized')
        )
        .get('/redirect', () => Response.redirect('http://localhost/health', 302))
        .get('/failure', () => {
            throw new Error('fixture')
        })
        .post('/write', () => 'written')

    it('preserves GET status and headers with an empty HEAD body', async () => {
        for (const path of [
            '/health',
            '/ready',
            '/private',
            '/redirect',
            '/missing',
            '/failure',
            '/robots.txt',
            '/write',
        ]) {
            const get = await app.handle(new Request(`http://localhost${path}`))
            const head = await app.handle(
                new Request(`http://localhost${path}`, { method: 'HEAD' })
            )
            expect(head.status).toBe(get.status)
            expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'))
            expect(head.headers.get('location')).toBe(get.headers.get('location'))
            expect(head.headers.get('x-robots-tag')).toBe('noindex, nofollow')
            expect(await head.text()).toBe('')
        }
        const head = await app.handle(
            new Request('http://localhost/private', {
                method: 'HEAD',
                headers: { authorization: 'Bearer fixture' },
            })
        )
        expect(head.status).toBe(200)
    })

    it('applies the policy through the native Bun listener', async () => {
        const server = app.listen({ port: 0, hostname: '127.0.0.1' })
        try {
            const response = await fetch(`http://127.0.0.1:${server.server!.port}/health`, {
                method: 'HEAD',
            })
            expect(response.status).toBe(200)
            expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
            expect(await response.text()).toBe('')
        } finally {
            await server.stop()
        }
    })

    it('disallows crawling and marks successful and error responses', async () => {
        const robots = await app.handle(new Request('http://localhost/robots.txt'))
        expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n')
        expect(robots.headers.get('content-type')).toContain('text/plain')
        for (const path of ['/health', '/ready', '/private', '/missing', '/failure']) {
            const response = await app.handle(new Request(`http://localhost${path}`))
            expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
        }
    })
})
