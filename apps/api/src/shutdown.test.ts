import { describe, expect, test } from 'bun:test'

import {
    createShutdownDependencies,
    createShutdownHandler,
    describeShutdownError,
    type ShutdownDependencies,
    type ShutdownExitCode,
} from './shutdown'

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

describe('createShutdownHandler', () => {
    test('drains before cleanup and exits 0 on the orderly path', async () => {
        const calls: string[] = []
        const outcome = recordOutcome()
        const handleShutdown = createShutdownHandler({
            ...baseDependencies(call => calls.push(call), outcome.exit),
            log: () => {},
        })

        await handleShutdown('SIGTERM')

        expect(calls).toEqual([
            'worker',
            'media',
            'notifications',
            'realtime',
            'observer',
            'server',
            'close',
            'release',
        ])
        expect(outcome.exitCode).toBe(0)
    })

    test('waits for an in-flight operation before touching cleanup resources', async () => {
        const calls: string[] = []
        const outcome = recordOutcome()
        let releaseWorker!: () => void
        const gate = new Promise<void>(resolve => {
            releaseWorker = resolve
        })
        const handleShutdown = createShutdownHandler({
            ...baseDependencies(call => calls.push(call), outcome.exit),
            stopWorker: () => {
                calls.push('worker')
                return gate
            },
            log: () => {},
        })

        const shutdown = handleShutdown('SIGTERM')
        await new Promise(resolve => setTimeout(resolve, 10))
        expect(calls).toEqual(['worker'])

        releaseWorker()
        await shutdown

        expect(calls).toEqual([
            'worker',
            'media',
            'notifications',
            'realtime',
            'observer',
            'server',
            'close',
            'release',
        ])
        expect(outcome.exitCode).toBe(0)
    })

    test('a drain failure skips later drains but still closes and releases', async () => {
        const calls: string[] = []
        const outcome = recordOutcome()
        const handleShutdown = createShutdownHandler({
            ...baseDependencies(call => calls.push(call), outcome.exit),
            stopWorker: () => {
                calls.push('worker')
                return Promise.reject(new Error('scheduler unavailable'))
            },
            log: () => {},
        })

        await handleShutdown('SIGTERM')

        expect(calls).toEqual(['worker', 'close', 'release'])
        expect(outcome.exitCode).toBe(1)
    })

    test('a database close failure still attempts the lock release and exits 2', async () => {
        const calls: string[] = []
        const outcome = recordOutcome()
        const handleShutdown = createShutdownHandler({
            ...baseDependencies(call => calls.push(call), outcome.exit),
            closeDatabase: () => {
                calls.push('close')
                throw new Error('database is busy')
            },
            log: () => {},
        })

        await handleShutdown('SIGTERM')

        expect(calls).toEqual([
            'worker',
            'media',
            'notifications',
            'realtime',
            'observer',
            'server',
            'close',
            'release',
        ])
        expect(outcome.exitCode).toBe(2)
    })

    test('a retained lock marker exits 2 without deleting anything else', async () => {
        const calls: string[] = []
        const outcome = recordOutcome()
        const handleShutdown = createShutdownHandler({
            ...baseDependencies(call => calls.push(call), outcome.exit),
            releaseRuntimeLock: () => {
                calls.push('release')
                return false
            },
            log: () => {},
        })

        await handleShutdown('SIGTERM')

        expect(calls).toEqual([
            'worker',
            'media',
            'notifications',
            'realtime',
            'observer',
            'server',
            'close',
            'release',
        ])
        expect(outcome.exitCode).toBe(2)
    })

    test('a throwing lock release exits 2', async () => {
        const calls: string[] = []
        const outcome = recordOutcome()
        const handleShutdown = createShutdownHandler({
            ...baseDependencies(call => calls.push(call), outcome.exit),
            releaseRuntimeLock: () => {
                calls.push('release')
                throw new Error('descriptor already closed')
            },
            log: () => {},
        })

        await handleShutdown('SIGTERM')

        expect(outcome.exitCode).toBe(2)
    })

    test('a second signal while draining is ignored', async () => {
        const calls: string[] = []
        const outcome = recordOutcome()
        const handleShutdown = createShutdownHandler({
            ...baseDependencies(call => calls.push(call), outcome.exit),
            log: () => {},
        })

        await Promise.all([handleShutdown('SIGTERM'), handleShutdown('SIGTERM')])

        expect(calls.filter(call => call === 'worker')).toHaveLength(1)
        expect(outcome.exitCalls).toBe(1)
        expect(outcome.exitCode).toBe(0)
    })
})

describe('createShutdownDependencies', () => {
    test('a step assigned after the handler exists is the step that drains', async () => {
        const calls: string[] = []
        const outcome = recordOutcome()
        const dependencies = createShutdownDependencies(() => {
            calls.push('release')
            return true
        }, outcome.exit)
        dependencies.log = () => {}
        const handleShutdown = createShutdownHandler(dependencies)

        dependencies.stopWorker = async () => {
            calls.push('worker')
        }
        dependencies.closeDatabase = () => {
            calls.push('close')
        }

        await handleShutdown('SIGTERM')

        expect(calls).toEqual(['worker', 'close', 'release'])
        expect(outcome.exitCode).toBe(0)
    })

    test('a resource that does not exist yet drains as a no-op', async () => {
        const calls: string[] = []
        const outcome = recordOutcome()
        const dependencies = createShutdownDependencies(() => {
            calls.push('release')
            return true
        }, outcome.exit)
        dependencies.log = () => {}
        const handleShutdown = createShutdownHandler(dependencies)

        await handleShutdown('SIGTERM')

        expect(calls).toEqual(['release'])
        expect(outcome.exitCode).toBe(0)
    })

    test('the runtime marker release reports the outcome it is given', async () => {
        const outcome = recordOutcome()
        const dependencies = createShutdownDependencies(() => false, outcome.exit)
        dependencies.log = () => {}
        const handleShutdown = createShutdownHandler(dependencies)

        await handleShutdown('SIGTERM')

        expect(outcome.exitCode).toBe(2)
    })
})

interface ShutdownOutcome {
    exitCode: ShutdownExitCode | undefined
    exitCalls: number
    readonly exit: (code: ShutdownExitCode) => void
}

function recordOutcome(): ShutdownOutcome {
    const outcome: ShutdownOutcome = {
        exitCode: undefined,
        exitCalls: 0,
        exit: code => {
            outcome.exitCalls += 1
            outcome.exitCode = code
        },
    }
    return outcome
}

function baseDependencies(
    record: (call: string) => void,
    exit: (code: ShutdownExitCode) => void
): ShutdownDependencies {
    return {
        stopWorker: async () => record('worker'),
        stopMediaMaintenance: async () => record('media'),
        stopNotificationProjection: () => record('notifications'),
        stopRealtime: () => record('realtime'),
        clearCommitObserver: () => record('observer'),
        stopServer: () => record('server'),
        closeDatabase: () => record('close'),
        releaseRuntimeLock: () => {
            record('release')
            return true
        },
        exit,
    }
}
