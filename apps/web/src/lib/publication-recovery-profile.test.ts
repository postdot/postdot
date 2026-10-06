import { expect, test } from 'bun:test'

import { recoveryProfileMatches } from './publication-recovery-profile'

test('legacy recovery stays usable before adoption, but never crosses an adopted profile', () => {
    expect(
        recoveryProfileMatches({}, { draft: { profileVersionId: 'v1' }, adoptionCount: 0 })
    ).toBe(true)
    expect(
        recoveryProfileMatches({}, { draft: { profileVersionId: 'v2' }, adoptionCount: 1 })
    ).toBe(false)
    expect(
        recoveryProfileMatches(
            { profileVersionId: 'v1' },
            { draft: { profileVersionId: 'v2' }, adoptionCount: 1 }
        )
    ).toBe(false)
    expect(
        recoveryProfileMatches(
            { profileVersionId: 'v2' },
            { draft: { profileVersionId: 'v2' }, adoptionCount: 2 }
        )
    ).toBe(true)
})
