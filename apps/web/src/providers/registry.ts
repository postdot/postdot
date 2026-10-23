import type { ChannelListItem } from '@/lib/api'

import { blueskyProvider } from './bluesky/definition'
import type { ProviderDefinition } from './contract'
import { devtoProvider } from './devto/definition'
import { discordProvider } from './discord/definition'
import { facebookProvider } from './facebook/definition'
import { instagramProvider } from './instagram/definition'
import { linkedinProvider } from './linkedin/definition'
import { mastodonProvider } from './mastodon/definition'
import { telegramProvider } from './telegram/definition'
import { xProvider } from './x/definition'

export const installedProviders = [
    linkedinProvider,
    blueskyProvider,
    mastodonProvider,
    xProvider,
    discordProvider,
    telegramProvider,
    facebookProvider,
    instagramProvider,
    devtoProvider,
] as const
export type BuiltInProviderId = (typeof installedProviders)[number]['id']

export function createProviderRegistry(definitions: readonly ProviderDefinition[]) {
    const byId = new Map<string, ProviderDefinition>()
    for (const definition of definitions) {
        if (!definition.id.trim() || byId.has(definition.id))
            throw new Error('Provider identities must be nonblank and unique')
        byId.set(definition.id, definition)
    }
    return {
        get: (id: string | undefined) => (id === undefined ? undefined : byId.get(id)),
        forExecution: (execution: ChannelListItem['execution'] | undefined) =>
            execution?.kind === 'built_in' ? byId.get(execution.contractId) : undefined,
    }
}
export const providerRegistry = createProviderRegistry(installedProviders)

export function providerForProfile(profile: unknown) {
    if (typeof profile !== 'object' || profile === null || !('execution' in profile))
        return undefined
    const execution = profile.execution
    return typeof execution === 'object' &&
        execution !== null &&
        'kind' in execution &&
        execution.kind === 'built_in' &&
        'contractId' in execution &&
        typeof execution.contractId === 'string'
        ? providerRegistry.get(execution.contractId)
        : undefined
}
export function providerField(kind: string) {
    return installedProviders
        .flatMap(provider => providerRegistry.get(provider.id)?.fields ?? [])
        .find(field => field.kind === kind)
}

export function providerTextRule(algorithm: string | null | undefined) {
    return installedProviders
        .map(provider => providerRegistry.get(provider.id)?.text)
        .find(text => text?.algorithm === algorithm)
}
