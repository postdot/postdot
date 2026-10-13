import { describe, expect, it } from 'bun:test'

import { Elysia, NotFound } from 'elysia'
import pino from 'pino'

import { createErrorHandler } from './error-handler'
import { createRequestLogger } from './logger'

const logging = {
    enabled: true,
    level: 'info' as const,
    pretty: false,
}

describe('Postbot request logger', () => {
    it('logs successful requests with status and duration', async () => {
        const records: Array<Record<string, unknown>> = []
        const logger = pino(
            { base: null, level: 'info', timestamp: false },
            { write: line => records.push(JSON.parse(line) as Record<string, unknown>) }
        )
        const app = new Elysia()
            .use(createRequestLogger(logging, logger))
            .get('/health', () => ({ status: 'ok' }))

        const response = await app.handle(new Request('http://localhost/health'))

        expect(response.status).toBe(200)
        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({
            method: 'GET',
            path: '/health',
            status: 200,
            msg: 'request completed',
        })
        expect(records[0]?.durationMs).toBeNumber()
    })

    it('logs unexpected failures once with a request id and no raw error message', async () => {
        const records: Array<Record<string, unknown>> = []
        const logger = pino(
            { base: null, level: 'info', timestamp: false },
            { write: line => records.push(JSON.parse(line) as Record<string, unknown>) }
        )
        const app = new Elysia()
            .use(createErrorHandler(logger))
            .use(createRequestLogger(logging, logger))
            .get('/api/media/public/:token', () => {
                throw new Error('credential=must-not-be-logged')
            })

        const response = await app.handle(
            new Request('http://localhost/api/media/public/signed-secret-token')
        )

        expect(response.status).toBe(500)
        expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({
            method: 'GET',
            path: '/api/media/public/:token',
            status: 500,
            msg: 'request failed',
            requestId: response.headers.get('x-request-id'),
            errorType: 'Error',
        })
        expect(JSON.stringify(records[0])).not.toContain('credential=must-not-be-logged')
        expect(JSON.stringify(records[0])).not.toContain('signed-secret-token')
        expect(records[0]).not.toHaveProperty('err')
        expect(records[0]).toHaveProperty('errorStack')
    })

    it('logs returned server errors once with a correlated response header', async () => {
        const records: Array<Record<string, unknown>> = []
        const logger = pino(
            { base: null, level: 'info', timestamp: false },
            { write: line => records.push(JSON.parse(line) as Record<string, unknown>) }
        )
        const app = new Elysia()
            .use(createErrorHandler(logger))
            .use(createRequestLogger(logging, logger))
            .get('/unavailable', ({ set }) => {
                set.status = 503
                return { error: 'service unavailable' }
            })

        const response = await app.handle(new Request('http://localhost/unavailable'))

        expect(response.status).toBe(503)
        expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({
            method: 'GET',
            path: '/unavailable',
            status: 503,
            requestId: response.headers.get('x-request-id'),
            errorType: 'HttpResponse',
            msg: 'request failed',
        })
        expect(JSON.stringify(records[0])).not.toContain('service unavailable')
    })

    it('does not emit expected client errors at the production error threshold', async () => {
        const records: Array<Record<string, unknown>> = []
        const logger = pino(
            { base: null, level: 'error', timestamp: false },
            { write: line => records.push(JSON.parse(line) as Record<string, unknown>) }
        )
        const app = new Elysia()
            .use(createErrorHandler())
            .use(createRequestLogger({ enabled: true, level: 'error', pretty: false }, logger))
            .get('/missing', () => {
                throw new NotFound()
            })
            .get('/health', () => ({ status: 'ok' }))

        const response = await app.handle(new Request('http://localhost/missing'))
        const healthResponse = await app.handle(new Request('http://localhost/health'))

        expect(response.status).toBe(404)
        expect(healthResponse.status).toBe(200)
        expect(records).toHaveLength(0)
    })

    it('does not register request hooks when logging is disabled', async () => {
        const records: Array<Record<string, unknown>> = []
        const logger = pino(
            { base: null, level: 'info', timestamp: false },
            { write: line => records.push(JSON.parse(line) as Record<string, unknown>) }
        )
        const app = new Elysia()
            .use(createRequestLogger({ enabled: false, level: 'silent', pretty: false }, logger))
            .get('/health', () => ({ status: 'ok' }))

        await app.handle(new Request('http://localhost/health'))

        expect(records).toHaveLength(0)
    })
})
