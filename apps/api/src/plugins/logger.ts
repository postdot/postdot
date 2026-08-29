import { Elysia } from 'elysia'
import pino, { type DestinationStream, type Logger } from 'pino'

import type { HeraldLoggingConfig } from '../config'

const levelNames: Record<number, string> = {
    10: 'TRACE',
    20: 'DEBUG',
    30: 'INFO',
    40: 'WARN',
    50: 'ERROR',
    60: 'FATAL',
}

interface LogRecord {
    readonly level?: unknown
    readonly time?: unknown
    readonly msg?: unknown
    readonly [key: string]: unknown
}

export function createRequestLogger(options: HeraldLoggingConfig | undefined, logger?: Logger) {
    if (options?.enabled !== true) {
        return new Elysia({ name: 'herald-request-logger-disabled' })
    }

    const requestLogger = logger ?? createHeraldLogger(options)

    const requestStartTimes = new WeakMap<Request, number>()
    const failedRequests = new WeakSet<Request>()

    return new Elysia({ name: 'herald-request-logger' })
        .decorate('log', requestLogger)
        .request(({ request }) => {
            requestStartTimes.set(request, performance.now())
        })
        .afterResponse(({ request, path, set }) => {
            if (failedRequests.has(request)) {
                failedRequests.delete(request)
                return
            }

            const status = typeof set.status === 'number' ? set.status : 200
            const fields = requestFields(
                request,
                path,
                status,
                requestDuration(request, requestStartTimes)
            )

            if (status >= 500) {
                requestLogger.error(fields, 'request completed')
            } else if (status >= 400) {
                requestLogger.warn(fields, 'request completed')
            } else {
                requestLogger.info(fields, 'request completed')
            }
        })
        .error('global', ({ request, path, set, error }) => {
            failedRequests.add(request)

            const status = typeof set.status === 'number' ? set.status : 500
            requestLogger.error(
                {
                    ...requestFields(
                        request,
                        path,
                        status,
                        requestDuration(request, requestStartTimes)
                    ),
                    err: error,
                },
                'request failed'
            )
        })
        .as('global')
}

export function createHeraldLogger(options: HeraldLoggingConfig): Logger {
    const loggerOptions = {
        base: null,
        level: options.level,
        name: 'herald-api',
        timestamp: pino.stdTimeFunctions.isoTime,
    }

    return options.pretty ? pino(loggerOptions, createPrettyStream()) : pino(loggerOptions)
}

function requestFields(request: Request, path: string, status: number, durationMs: number) {
    return {
        method: request.method,
        path,
        status,
        durationMs,
    }
}

function requestDuration(request: Request, requestStartTimes: WeakMap<Request, number>): number {
    const startedAt = requestStartTimes.get(request)
    requestStartTimes.delete(request)
    if (startedAt === undefined) return 0

    const duration = performance.now() - startedAt
    return Math.round(duration * 100) / 100
}

function createPrettyStream(): DestinationStream {
    return {
        write(line) {
            try {
                process.stdout.write(formatPrettyLog(JSON.parse(line) as LogRecord))
            } catch {
                process.stdout.write(line)
            }
        },
    }
}

function formatPrettyLog(record: LogRecord): string {
    const timestamp = typeof record.time === 'string' ? record.time : new Date().toISOString()
    const level = typeof record.level === 'number' ? (levelNames[record.level] ?? 'LOG') : 'LOG'
    const message = typeof record.msg === 'string' ? record.msg : ''
    const fields = Object.entries(record)
        .filter(([key]) => key !== 'level' && key !== 'time' && key !== 'msg')
        .map(([key, value]) => `${key}=${formatValue(value)}`)
        .join(' ')

    return `${timestamp} ${level.padEnd(5)} ${message}${fields === '' ? '' : ` ${fields}`}\n`
}

function formatValue(value: unknown): string {
    if (typeof value === 'string') return JSON.stringify(value)
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
        return String(value)
    }

    try {
        return JSON.stringify(value)
    } catch {
        return '[unserializable]'
    }
}
