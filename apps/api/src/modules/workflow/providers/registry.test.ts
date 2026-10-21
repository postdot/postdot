import { describe, expect, it } from 'bun:test'

import type { ExternalEffectOutcome } from '@postdot/core'

import { createBuiltInProviderRegistry, type BuiltInProviderAdapter } from './registry'

const published: ExternalEffectOutcome = {
    type: 'published',
    externalId: 'provider-publication-1',
}

function adapter(overrides: Partial<BuiltInProviderAdapter> = {}): BuiltInProviderAdapter {
    return {
        providerId: 'linkedin',
        contractId: 'linkedin',
        revision: 'member-post-v2',
        execute: async () => published,
        ...overrides,
    }
}

describe('built-in provider registry', () => {
    it('resolves only the exact provider and versioned execution identity', () => {
        const registered = adapter()
        const registry = createBuiltInProviderRegistry([registered])

        expect(
            registry.resolve({
                providerId: 'linkedin',
                kind: 'linkedin',
                execution: {
                    kind: 'built_in',
                    contractId: 'linkedin',
                    revision: 'member-post-v2',
                },
            })
        ).toBe(registered)

        expect(
            registry.resolve({
                providerId: 'linkedin',
                kind: 'linkedin',
                execution: {
                    kind: 'built_in',
                    contractId: 'linkedin',
                    revision: 'member-post-v1',
                },
            })
        ).toBeNull()
        expect(
            registry.resolve({
                providerId: 'other-provider',
                kind: 'other-provider',
                execution: {
                    kind: 'built_in',
                    contractId: 'linkedin',
                    revision: 'member-post-v2',
                },
            })
        ).toBeNull()
        expect(
            registry.resolve({
                providerId: 'linkedin',
                kind: 'linkedin',
                execution: { kind: 'manual' },
            })
        ).toBeNull()
    })

    it('rejects duplicate execution identities at composition time', () => {
        expect(() =>
            createBuiltInProviderRegistry([adapter(), adapter({ providerId: 'another-provider' })])
        ).toThrow('Duplicate built-in provider execution contract')
    })
})
