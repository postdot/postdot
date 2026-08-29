import { describe, expect, it } from 'bun:test'

import { Elysia } from 'elysia'
import pino from 'pino'

import { createRequestLogger } from './logger'

const logging = {
    enabled: true,
    level: 'info' as const,
    pretty: false,
}

describe('Herald request logger', () => {
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

    it('logs failed requests once with the error details', async () => {
        const records: Array<Record<string, unknown>> = []
        const logger = pino(
            { base: null, level: 'info', timestamp: false },
            { write: line => records.push(JSON.parse(line) as Record<string, unknown>) }
        )
        const app = new Elysia().use(createRequestLogger(logging, logger)).get('/failure', () => {
            throw new Error('expected failure')
        })

        const response = await app.handle(new Request('http://localhost/failure'))

        expect(response.status).toBe(500)
        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({
            method: 'GET',
            path: '/failure',
            status: 500,
            msg: 'request failed',
            err: { message: 'expected failure' },
        })
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
