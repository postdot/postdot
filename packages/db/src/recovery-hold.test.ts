import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRecoveryHold, readRecoveryHold, releaseRecoveryHold } from './recovery-hold'

test('persists a recovery hold across database replacement and requires its current acknowledgement', () => {
    const root = mkdtempSync(join(tmpdir(), 'postbot-recovery-'))
    const filename = join(root, 'database.sqlite')
    try {
        expect(readRecoveryHold(filename)).toBeNull()
        const hold = createRecoveryHold(filename, 'restore')
        writeFileSync(filename, 'replacement database')
        expect(readRecoveryHold(filename)).toEqual(hold)
        expect(createRecoveryHold(filename, 'external_restore')).toEqual(hold)
        expect(() => releaseRecoveryHold(filename, 'stale-token')).toThrow()
        expect(readRecoveryHold(filename)).toEqual(hold)
        const replacement = createRecoveryHold(filename, 'restore', true)
        expect(replacement.token).not.toBe(hold.token)
        expect(() => releaseRecoveryHold(filename, hold.token)).toThrow()
        releaseRecoveryHold(filename, replacement.token)
        expect(readRecoveryHold(filename)).toBeNull()
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test('fails closed on damaged or unreadable marker content', () => {
    const root = mkdtempSync(join(tmpdir(), 'postbot-recovery-'))
    const filename = join(root, 'database.sqlite')
    try {
        const marker = `${filename}.recovery.json`
        writeFileSync(marker, '{bad')
        expect(() => readRecoveryHold(filename)).toThrow()
        expect(() => createRecoveryHold(filename, 'restore')).toThrow()
        expect(readFileSync(marker, 'utf8')).toBe('{bad')
        writeFileSync(marker, 'null')
        expect(() => readRecoveryHold(filename)).toThrow()
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})
