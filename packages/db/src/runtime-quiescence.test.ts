import { describe, expect, it } from 'bun:test'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { acquireRuntimeQuiescenceLock } from './runtime-quiescence'

const isRoot = typeof process.geteuid === 'function' && process.geteuid() === 0

describe('runtime quiescence lock', () => {
    it('allows one owner and blocks concurrent server, restore, or recovery owners', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postdot-runtime-lock-'))
        const databasePath = join(directory, 'postdot.sqlite')

        try {
            const serverLock = acquireRuntimeQuiescenceLock(databasePath, 'server')
            expect(serverLock.owner).toBe('server')
            expect(() => acquireRuntimeQuiescenceLock(databasePath, 'restore')).toThrow(
                'runtime lock'
            )
            expect(() => acquireRuntimeQuiescenceLock(databasePath, 'recovery')).toThrow(
                'runtime lock'
            )

            serverLock.release()
            expect(existsSync(serverLock.lockFilename)).toBe(false)

            const restoreLock = acquireRuntimeQuiescenceLock(databasePath, 'restore')
            expect(restoreLock.owner).toBe('restore')
            expect(restoreLock.release()).toBe(true)

            const recoveryLock = acquireRuntimeQuiescenceLock(databasePath, 'recovery')
            expect(recoveryLock.owner).toBe('recovery')
            expect(() => acquireRuntimeQuiescenceLock(databasePath, 'server')).toThrow(
                'runtime lock'
            )
            recoveryLock.release()
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('does not reclaim a stale marker automatically', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postdot-runtime-lock-'))
        const databasePath = join(directory, 'postdot.sqlite')
        const lockPath = `${databasePath}.runtime.lock`

        try {
            writeFileSync(
                lockPath,
                JSON.stringify({
                    version: 1,
                    owner: 'server',
                    pid: 999_999,
                    host: 'test-host',
                    acquiredAt: new Date(0).toISOString(),
                    token: 'stale-marker',
                })
            )

            expect(() => acquireRuntimeQuiescenceLock(databasePath, 'restore')).toThrow(
                'already held'
            )
            expect(existsSync(lockPath)).toBe(true)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('rejects in-memory databases because they have no coordination path', () => {
        expect(() => acquireRuntimeQuiescenceLock(':memory:', 'server')).toThrow(
            'filesystem-backed database'
        )
    })

    it('reports a successful release and removes the marker', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postdot-runtime-lock-'))
        const databasePath = join(directory, 'postdot.sqlite')

        try {
            const serverLock = acquireRuntimeQuiescenceLock(databasePath, 'server')
            expect(serverLock.release()).toBe(true)
            expect(existsSync(serverLock.lockFilename)).toBe(false)
            expect(serverLock.release()).toBe(true)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('reports success when the marker is already gone', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postdot-runtime-lock-'))
        const databasePath = join(directory, 'postdot.sqlite')

        try {
            const serverLock = acquireRuntimeQuiescenceLock(databasePath, 'server')
            unlinkSync(serverLock.lockFilename)

            expect(serverLock.release()).toBe(true)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('does not remove a foreign marker and reports it as retained', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postdot-runtime-lock-'))
        const databasePath = join(directory, 'postdot.sqlite')
        const lockPath = `${databasePath}.runtime.lock`

        try {
            const serverLock = acquireRuntimeQuiescenceLock(databasePath, 'server')
            writeFileSync(
                lockPath,
                JSON.stringify({ version: 1, owner: 'server', token: 'foreign-token' })
            )

            expect(serverLock.release()).toBe(false)
            expect(existsSync(lockPath)).toBe(true)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('keeps reporting a retained marker on repeated calls without retrying removal', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postdot-runtime-lock-'))
        const databasePath = join(directory, 'postdot.sqlite')
        const lockPath = `${databasePath}.runtime.lock`
        const foreignMarker = JSON.stringify({
            version: 1,
            owner: 'server',
            token: 'foreign-token',
        })

        try {
            const serverLock = acquireRuntimeQuiescenceLock(databasePath, 'server')
            writeFileSync(lockPath, foreignMarker)

            expect(serverLock.release()).toBe(false)
            expect(serverLock.release()).toBe(false)
            expect(existsSync(lockPath)).toBe(true)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('does not remove an unreadable marker and reports it as retained', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postdot-runtime-lock-'))
        const databasePath = join(directory, 'postdot.sqlite')
        const lockPath = `${databasePath}.runtime.lock`

        try {
            const serverLock = acquireRuntimeQuiescenceLock(databasePath, 'server')
            writeFileSync(lockPath, 'not-json{{{')

            expect(serverLock.release()).toBe(false)
            expect(existsSync(lockPath)).toBe(true)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    // Root bypasses directory permissions, so the denial below only applies to
    // ordinary operator and CI users.
    it.if(!isRoot)('reports a retained marker when the directory denies removal', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postdot-runtime-lock-'))
        const databasePath = join(directory, 'postdot.sqlite')
        const lockPath = `${databasePath}.runtime.lock`

        try {
            const serverLock = acquireRuntimeQuiescenceLock(databasePath, 'server')
            await chmod(directory, 0o500)

            expect(serverLock.release()).toBe(false)
            expect(existsSync(lockPath)).toBe(true)
        } finally {
            await chmod(directory, 0o700)
            await rm(directory, { recursive: true, force: true })
        }
    })
})
