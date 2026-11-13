import { expect, test } from 'bun:test'

import {
    compareReleaseIdentities,
    readReleaseIdentity,
    readStudioBuildIdentity,
} from './release-identity'

const known = { version: '0.1.0-alpha.8', revision: 'a'.repeat(40) }
const unknown = { version: null, revision: null }

test('compares every known field without claiming compatibility for incomplete identities', () => {
    expect(compareReleaseIdentities(known, { ...known })).toBe('match')
    expect(compareReleaseIdentities(known, { ...known, version: '0.1.0-alpha.9' })).toBe('mismatch')
    expect(compareReleaseIdentities(known, { ...known, revision: 'b'.repeat(40) })).toBe('mismatch')
    expect(compareReleaseIdentities(known, { ...known, revision: `${'a'.repeat(39)}b` })).toBe(
        'mismatch'
    )
    expect(compareReleaseIdentities(known, unknown)).toBe('unknown')
    expect(compareReleaseIdentities(unknown, known)).toBe('unknown')
    expect(compareReleaseIdentities(unknown, unknown)).toBe('unknown')
    expect(compareReleaseIdentities(known, { ...known, version: null })).toBe('unknown')
    expect(
        compareReleaseIdentities(
            { ...known, version: null },
            { ...known, revision: 'b'.repeat(40) }
        )
    ).toBe('mismatch')
    expect(
        compareReleaseIdentities({ ...known, revision: null }, { ...known, version: '0.2.0' })
    ).toBe('mismatch')
})

test('validates public API and build metadata while keeping unversioned builds explicit', () => {
    expect(readReleaseIdentity(known)).toEqual(known)
    expect(readStudioBuildIdentity({})).toEqual(unknown)
    expect(readStudioBuildIdentity({ POSTDOT_VERSION: '', POSTDOT_REVISION: '' })).toEqual(unknown)
    expect(
        readStudioBuildIdentity({
            POSTDOT_VERSION: known.version,
            POSTDOT_REVISION: known.revision,
        })
    ).toEqual(known)
    expect(readStudioBuildIdentity({ POSTDOT_REVISION: known.revision })).toEqual({
        ...known,
        version: null,
    })
    for (const value of [
        null,
        {},
        { version: null },
        { version: 'latest', revision: null },
        { version: known.version, revision: 'short' },
    ])
        expect(() => readReleaseIdentity(value)).toThrow('Invalid build identity')
    expect(() => readStudioBuildIdentity({ POSTDOT_VERSION: 'not-a-version' })).toThrow(
        'Invalid build identity'
    )
})
