import { expect, test } from 'bun:test'

import type { ProviderDefinition } from './contract'
import { createProviderRegistry, installedProviders, providerRegistry } from './registry'

const synthetic: ProviderDefinition = {
    id: 'synthetic',
    name: 'Synthetic',
    profileLabel: () => 'Synthetic profile',
    editor: 'plain',
    loadConnection: async () => ({ default: () => null }),
    accountLabel: connection => connection.externalAccountId,
    preview: { layout: 'message', accountDriven: false, sampleIdentity: false },
    fields: [
        {
            kind: 'provider:synthetic:choice',
            path: '/choice',
            label: () => 'Choice',
            supports: () => true,
            loadControl: async () => ({ default: () => null }),
            summarize: value => String(value),
        },
    ],
    textLimit: () => 42,
}

test('a synthetic provider adds connection, authoring and preview through one registration', async () => {
    const registry = createProviderRegistry([...installedProviders, synthetic])
    const selected = registry.forExecution({
        kind: 'built_in',
        contractId: 'synthetic',
    })
    expect(selected).toBe(synthetic)
    expect(await selected!.loadConnection()).toHaveProperty('default')
    expect(selected!.fields![0]!.summarize('chosen')).toBe('chosen')
    expect(selected!.textLimit!({})).toBe(42)
    expect(selected!.preview.layout).toBe('message')
    expect(providerRegistry.get('synthetic')).toBeUndefined()
    expect(registry.forExecution({ kind: 'manual' })).toBeUndefined()
    expect(registry.forExecution({ kind: 'declarative_http' })).toBeUndefined()
    expect(registry.get('uninstalled')).toBeUndefined()
})

test('registration rejects duplicate or blank identities before rendering', () => {
    expect(() => createProviderRegistry([synthetic, synthetic])).toThrow('unique')
    expect(() => createProviderRegistry([{ ...synthetic, id: ' ' }])).toThrow('nonblank')
})

test('all nine installed modules retain their native presentation and configuration', () => {
    expect(new Set(installedProviders.map(provider => provider.id)).size).toBe(9)
    expect(
        installedProviders
            .filter(provider => 'application' in provider)
            .map(provider => provider.id)
            .sort()
    ).toEqual(['bluesky', 'facebook', 'instagram', 'linkedin', 'x'])
    expect(
        providerRegistry.get('bluesky')!.comments!.linkAllowed('https://user@bsky.app/post', null)
    ).toBe(false)
    expect(
        providerRegistry
            .get('mastodon')!
            .comments!.linkAllowed('https://elsewhere.test/post', 'https://social.test')
    ).toBe(false)
    expect(providerRegistry.get('bluesky')!.comments!.count('👨‍👩‍👧‍👦')).toBe(1)
})
