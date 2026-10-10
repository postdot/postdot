import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRecoveryHold, readRecoveryHold, acquireRuntimeQuiescenceLock } from '@herald/db'

import { runMaintenanceCommand } from './maintenance'
import { createRecoveryService, recoveryBlocksRequest } from './recovery'

test('loads a durable hold and starts suspended runtimes once after acknowledgement', () => {
    const root = mkdtempSync(join(tmpdir(), 'herald-runtime-recovery-'))
    const filename = join(root, 'database.sqlite')
    try {
        const hold = createRecoveryHold(filename, 'restore')
        let starts = 0
        const recovery = createRecoveryService(filename, () => {
            starts++
        })
        expect(recovery.held()).toBe(true)
        expect(starts).toBe(0)
        expect(() => recovery.resume('stale')).toThrow()
        expect(starts).toBe(0)
        recovery.resume(hold.token)
        expect(starts).toBe(1)
        expect(recovery.held()).toBe(false)
        expect(readRecoveryHold(filename)).toBeNull()
        expect(() => recovery.resume(hold.token)).toThrow()
        expect(starts).toBe(1)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test('offline recovery requires a stopped runtime and explicit resumption consent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'herald-offline-recovery-'))
    const filename = join(root, 'database.sqlite')
    try {
        const lock = acquireRuntimeQuiescenceLock(filename, 'server')
        try {
            await expect(
                runMaintenanceCommand(['recovery', 'hold', '--database', filename])
            ).rejects.toThrow('already held')
            expect(readRecoveryHold(filename)).toBeNull()
        } finally {
            lock.release()
        }
        await runMaintenanceCommand(['recovery', 'hold', '--database', filename])
        expect(readRecoveryHold(filename)?.reason).toBe('external_restore')
        await expect(
            runMaintenanceCommand(['recovery', 'resume', '--database', filename])
        ).rejects.toThrow('--confirm')
        expect(readRecoveryHold(filename)).not.toBeNull()
        await runMaintenanceCommand(['recovery', 'resume', '--confirm', '--database', filename])
        expect(readRecoveryHold(filename)).toBeNull()
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test('permits inspection and login but blocks mutating and OAuth callback requests', () => {
    const request = (path: string, method = 'GET') =>
        new Request(`http://herald.local${path}`, { method })
    expect(recoveryBlocksRequest(request('/api/projects'))).toBe(false)
    expect(recoveryBlocksRequest(request('/api/auth/sign-in/email', 'POST'))).toBe(false)
    expect(recoveryBlocksRequest(request('/api/settings/recovery/resume', 'POST'))).toBe(false)
    expect(recoveryBlocksRequest(request('/api/projects', 'POST'))).toBe(true)
    expect(recoveryBlocksRequest(request('/api/projects/p/publications/cancel', 'PATCH'))).toBe(
        true
    )
    expect(recoveryBlocksRequest(request('/api/oauth/bluesky/callback?code=old'))).toBe(true)
    expect(recoveryBlocksRequest(request('/api/auth/verify-email?token=old'))).toBe(true)
})
