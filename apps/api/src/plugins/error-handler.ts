import { SQLiteError } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import { DomainInvariantError } from '@postdot/core'
import { CadenceConflictError, ResourceLifecycleError } from '@postdot/db'
import { MediaStoreError } from '@postdot/media'
import { Elysia, NotFound, ValidationError } from 'elysia'
import type { Logger } from 'pino'

type ResponseHeaders = Record<string, string | number | string[]>

export function createErrorHandler(logger?: Logger) {
    const loggedRequests = new WeakSet<Request>()
    const requestIds = new WeakMap<Request, string>()

    const app = new Elysia({ name: 'postdot-error-handler' })

    app.request(({ request, set }) => {
        if (logger === undefined) return

        const requestId = randomUUID()
        requestIds.set(request, requestId)
        set.headers['x-request-id'] = requestId
    })

    app.error('global', ({ error, request, path, route, set }) => {
        if (
            error instanceof ResourceLifecycleError ||
            (error instanceof SQLiteError && error.message === 'resource_read_only')
        ) {
            set.status = 409
            return {
                error: {
                    code: 'resource_read_only',
                    message: 'Resource retirement prevents this mutation',
                },
            }
        }
        if (error instanceof ValidationError) {
            set.status = 422
            return {
                error: {
                    code: 'validation_error',
                    message: 'The request does not match the expected shape',
                },
            }
        }

        if (error instanceof CadenceConflictError) {
            set.status = 409
            return {
                error: {
                    code: 'cadence_conflict',
                    message: error.message,
                    confirmation: error.confirmation,
                    warnings: error.warnings,
                },
            }
        }

        if (error instanceof DomainInvariantError) {
            set.status =
                error.code === 'invalid_transition' || error.code === 'write_conflict' ? 409 : 400
            return {
                error: {
                    code: error.code,
                    message: error.message,
                },
            }
        }

        if (error instanceof NotFound) {
            set.status = 404
            return {
                error: {
                    code: 'not_found',
                    message: 'The requested resource was not found',
                },
            }
        }

        if (error instanceof MediaStoreError) {
            const clientInputError =
                error.code === 'invalid_byte_limit' ||
                error.code === 'invalid_content_type' ||
                error.code === 'invalid_source' ||
                error.code === 'size_mismatch' ||
                error.code === 'write_limit_exceeded'
            set.status = clientInputError ? 400 : 500
            if (set.status >= 500) {
                logUnexpectedFailure(
                    logger,
                    request,
                    route ?? path,
                    set.status,
                    error,
                    set,
                    loggedRequests,
                    requestIds
                )
            }
            return {
                error: {
                    code: clientInputError ? error.code : 'media_storage_failure',
                    message: clientInputError
                        ? 'The media upload does not satisfy the storage constraints'
                        : 'Media storage is temporarily unavailable',
                },
            }
        }

        set.status = 500
        logUnexpectedFailure(
            logger,
            request,
            route ?? path,
            set.status,
            error,
            set,
            loggedRequests,
            requestIds
        )
        return {
            error: {
                code: 'internal_error',
                message: 'The request could not be completed',
            },
        }
    })

    app.afterResponse(({ request, path, route, set }) => {
        const status = typeof set.status === 'number' ? set.status : 200
        if (status < 500 || logger === undefined) return

        if (loggedRequests.has(request)) {
            loggedRequests.delete(request)
            return
        }

        logUnexpectedFailure(
            logger,
            request,
            route ?? path,
            status,
            undefined,
            set,
            loggedRequests,
            requestIds
        )
    })

    return app.as('global')
}

function logUnexpectedFailure(
    logger: Logger | undefined,
    request: Request,
    path: string,
    status: number,
    error: unknown,
    set: { headers: ResponseHeaders },
    loggedRequests: WeakSet<Request>,
    requestIds: WeakMap<Request, string>
): void {
    if (logger === undefined) return

    const requestId = requestIds.get(request) ?? randomUUID()
    requestIds.set(request, requestId)
    set.headers['x-request-id'] = requestId
    logger.error(
        {
            method: request.method,
            path,
            status,
            requestId,
            ...(error === undefined ? { errorType: 'HttpResponse' } : safeErrorDetails(error)),
        },
        'request failed'
    )
    loggedRequests.add(request)
}

function safeErrorType(error: unknown): string {
    if (!(error instanceof Error)) return typeof error

    const name = error.constructor.name
    return /^[A-Za-z_$][\w$]{0,63}$/.test(name) ? name : 'Error'
}

function safeErrorDetails(error: unknown): {
    readonly errorType: string
    readonly errorStack?: string
} {
    if (!(error instanceof Error)) return { errorType: typeof error }

    const stack = error.stack?.split('\n').slice(1, 13).join('\n')
    return {
        errorType: safeErrorType(error),
        ...(stack === undefined || stack.length === 0 ? {} : { errorStack: stack }),
    }
}
