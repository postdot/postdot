import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { adoptLegacyDatabaseName } from './legacy-database-name'
import { acquireRuntimeQuiescenceLock } from './runtime-quiescence'

function withDirectory(run: (directory: string) => void) {
    const directory = mkdtempSync(join(tmpdir(), 'postdot-legacy-name-'))
    try {
        run(directory)
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
}

test('adopts the pre-rename database and its companions under the default name', () => {
    withDirectory(directory => {
        for (const suffix of ['', '-wal', '-shm', '.recovery.json'])
            writeFileSync(join(directory, `postbot.sqlite${suffix}`), `legacy${suffix}`)

        const lock = acquireRuntimeQuiescenceLock(join(directory, 'postdot.sqlite'), 'server')
        lock.release()

        expect(readFileSync(join(directory, 'postdot.sqlite'), 'utf8')).toBe('legacy')
        expect(readFileSync(join(directory, 'postdot.sqlite-wal'), 'utf8')).toBe('legacy-wal')
        expect(readFileSync(join(directory, 'postdot.sqlite.recovery.json'), 'utf8')).toBe(
            'legacy.recovery.json'
        )
        expect(existsSync(join(directory, 'postbot.sqlite'))).toBe(false)
    })
})

test('never replaces an existing database, custom names or a held legacy lock', () => {
    withDirectory(directory => {
        writeFileSync(join(directory, 'postbot.sqlite'), 'legacy')
        writeFileSync(join(directory, 'postdot.sqlite'), 'current')
        expect(adoptLegacyDatabaseName(join(directory, 'postdot.sqlite'))).toBe(false)
        expect(readFileSync(join(directory, 'postdot.sqlite'), 'utf8')).toBe('current')

        expect(adoptLegacyDatabaseName(join(directory, 'custom.sqlite'))).toBe(false)
        expect(existsSync(join(directory, 'custom.sqlite'))).toBe(false)
    })
    withDirectory(directory => {
        writeFileSync(join(directory, 'postbot.sqlite'), 'legacy')
        writeFileSync(join(directory, 'postbot.sqlite.runtime.lock'), '{}')
        expect(() => adoptLegacyDatabaseName(join(directory, 'postdot.sqlite'))).toThrow('is held')
        expect(existsSync(join(directory, 'postbot.sqlite'))).toBe(true)
    })
})
