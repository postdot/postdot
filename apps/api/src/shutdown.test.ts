import { describe, expect, test } from 'bun:test'

import { describeShutdownError } from './shutdown'

describe('describeShutdownError', () => {
    test('keeps the failing step alongside the error name', () => {
        const details = describeShutdownError('server-stop', new TypeError('socket closed'))

        expect(details).toEqual({
            step: 'server-stop',
            name: 'TypeError',
            message: 'socket closed',
        })
    })

    test('redacts bearer material and secret assignments', () => {
        const details = describeShutdownError(
            'worker-stop',
            new Error(
                'provider call failed with Bearer secret-token and client_secret=access-token'
            )
        )

        expect(details.message).toBe(
            'provider call failed with Bearer [redacted] and client_secret=[redacted]'
        )
    })

    test('collapses whitespace and bounds the message length', () => {
        const details = describeShutdownError(
            'database-close',
            new Error(`first\n\tsecond  third${'!'.repeat(600)}`)
        )

        expect(details.message).toBe(`first second third${'!'.repeat(482)}`)
        expect(details.message.length).toBeLessThanOrEqual(500)
    })

    test('preserves concrete error subclass names', () => {
        class DatabaseCloseError extends Error {}
        const details = describeShutdownError(
            'database-close',
            new DatabaseCloseError('unable to close')
        )

        expect(details.name).toBe('DatabaseCloseError')
    })

    test('handles non-Error failures without leaking values', () => {
        const details = describeShutdownError('worker-stop', 'Bearer raw-string-failure')

        expect(details).toEqual({
            step: 'worker-stop',
            name: 'UnknownError',
            message: 'The shutdown step did not provide an Error instance',
        })
    })
})
