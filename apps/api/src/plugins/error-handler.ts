import { DomainInvariantError } from '@herald/core'
import { Elysia, NotFound, ValidationError } from 'elysia'

export function createErrorHandler() {
    return new Elysia({ name: 'herald-error-handler' }).error('global', ({ error, set }) => {
        if (error instanceof ValidationError) {
            set.status = 422
            return {
                error: {
                    code: 'validation_error',
                    message: 'The request does not match the expected shape',
                },
            }
        }

        if (error instanceof DomainInvariantError) {
            set.status = error.code === 'invalid_transition' ? 409 : 400
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

        set.status = 500
        return {
            error: {
                code: 'internal_error',
                message: 'The request could not be completed',
            },
        }
    })
}
