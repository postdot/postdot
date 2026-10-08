import { expect, test } from 'bun:test'

import { getNativeEditorProfile, getNativePlatform } from './native-presentation'

test('native presentation follows explicit execution, not custom identity', () => {
    for (const contractId of ['x', 'discord', 'devto', 'linkedin', 'bluesky', 'mastodon']) {
        expect(getNativePlatform({ kind: 'built_in', contractId })).toBe(contractId)
    }
    expect(getNativePlatform({ kind: 'manual' })).toBe('custom')
    expect(getNativePlatform({ kind: 'declarative_http' })).toBe('custom')
    expect(getNativePlatform({ kind: 'built_in', contractId: 'unknown' })).toBe('custom')
    expect(getNativePlatform(undefined)).toBe('custom')
})

test('only supported native execution grants a rich editor dialect', () => {
    expect(getNativeEditorProfile({ kind: 'built_in', contractId: 'discord' })).toBe('discord')
    expect(getNativeEditorProfile({ kind: 'built_in', contractId: 'devto' })).toBe('article')
    expect(getNativeEditorProfile({ kind: 'built_in', contractId: 'x' })).toBe('plain')
    expect(getNativeEditorProfile({ kind: 'manual' })).toBe('plain')
})
