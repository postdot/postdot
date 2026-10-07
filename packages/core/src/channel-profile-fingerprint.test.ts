import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import { fingerprintChannelProfile } from './channel-profile'
import { createManualChannelProfile } from './profile-presets'

const digest = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`

function profile() {
    return JSON.parse(JSON.stringify(createManualChannelProfile()))
}

describe('channel profile fingerprints', () => {
    test('ignores supplied fingerprints and object insertion order without mutating input', () => {
        const original = profile()
        const before = structuredClone(original)
        const reordered = Object.fromEntries(Object.entries(original).reverse())
        reordered.contentSchema = Object.fromEntries(
            Object.entries(original.contentSchema).reverse()
        )
        reordered.profileHash = 'untrusted'
        reordered.schemaHash = 'untrusted'
        const result = fingerprintChannelProfile(original, digest)
        expect(result).toEqual(fingerprintChannelProfile(reordered as typeof original, digest))
        expect(result.schemaHash).toMatch(/^sha256:[a-f0-9]{64}$/)
        expect(result.profileHash).toMatch(/^sha256:[a-f0-9]{64}$/)
        expect(original).toEqual(before)
    })

    test('schema changes alter both fingerprints', () => {
        const original = profile()
        const changed = structuredClone(original)
        changed.contentSchema.properties.body.maxLength = 800
        const before = fingerprintChannelProfile(original, digest)
        const after = fingerprintChannelProfile(changed, digest)
        expect(after.schemaHash).not.toBe(before.schemaHash)
        expect(after.profileHash).not.toBe(before.profileHash)
    })

    test('covers bindings, capabilities, execution, identity, origin and version in the complete fingerprint', () => {
        const original = profile()
        const before = fingerprintChannelProfile(original, digest)
        const changes = [
            { fieldBindings: [...original.fieldBindings].reverse() },
            { capabilities: { ...original.capabilities, revision: 'changed' } },
            { execution: { kind: 'manual', revision: 'changed' } },
            { id: 'different' },
            { origin: 'custom' },
            { version: 2 },
        ]
        for (const change of changes) {
            const after = fingerprintChannelProfile({ ...original, ...change }, digest)
            expect(after.schemaHash).toBe(before.schemaHash)
            expect(after.profileHash).not.toBe(before.profileHash)
        }
    })

    test('rejects non-JSON input rather than silently dropping it', () => {
        const original = profile()
        original.extra = undefined
        expect(() => fingerprintChannelProfile(original, digest)).toThrow('only JSON values')
        original.extra = original
        expect(() => fingerprintChannelProfile(original, digest)).toThrow('cycles')
    })
})
