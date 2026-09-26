import { describe, expect, it } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { acquireRuntimeQuiescenceLock } from './runtime-quiescence'

describe('runtime quiescence lock', () => {
    it('allows one owner and blocks concurrent server, restore, or recovery owners', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'herald-runtime-lock-'))
        const databasePath = join(directory, 'herald.sqlite')

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
            restoreLock.release()

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
        const directory = await mkdtemp(join(tmpdir(), 'herald-runtime-lock-'))
        const databasePath = join(directory, 'herald.sqlite')
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
})
