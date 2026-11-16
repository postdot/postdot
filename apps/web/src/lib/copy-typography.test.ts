import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const messagesDirectory = join(import.meta.dir, '../../messages')

// Owner rule (2026-11-16): people do not type em or en dashes, so Studio copy never uses them.
// Use a period, a colon, a comma or a plain hyphen instead.
const forbiddenDash = /[–—]/

describe('Studio copy typography', () => {
    for (const file of readdirSync(messagesDirectory).filter(name => name.endsWith('.json'))) {
        test(`${file} has no em or en dash`, () => {
            const catalog = JSON.parse(
                readFileSync(join(messagesDirectory, file), 'utf8')
            ) as Record<string, unknown>
            const offending = Object.entries(catalog)
                .filter(([, value]) => typeof value === 'string' && forbiddenDash.test(value))
                .map(([key]) => key)
            expect(offending).toEqual([])
        })
    }
})
