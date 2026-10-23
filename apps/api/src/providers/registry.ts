import { blueskyModule, createBlueskyAdapters } from './bluesky/module'
import { createBlueskyRuntime, type BlueskyRuntimeOptions } from './bluesky/runtime'
import { devtoModule, createDevtoAdapters } from './devto/module'
import { discordModule, createDiscordAdapters } from './discord/module'
import { facebookModule, createFacebookAdapters } from './facebook/module'
import { createFacebookRuntime, type FacebookRuntimeOptions } from './facebook/runtime'
import { instagramModule, createInstagramAdapters } from './instagram/module'
import { createInstagramRuntime, type InstagramRuntimeOptions } from './instagram/runtime'
import { linkedinModule, createLinkedinAdapters } from './linkedin/module'
import { createLinkedInRuntime, type LinkedInRuntimeOptions } from './linkedin/runtime'
import { mastodonModule, createMastodonAdapters } from './mastodon/module'
import { createMastodonRuntime, type MastodonRuntimeOptions } from './mastodon/runtime'
import type { ProviderRuntimeContext } from './runtime-context'
import { telegramModule, createTelegramAdapters } from './telegram/module'
import { xModule, createXAdapters } from './x/module'
import { createXRuntime, type XRuntimeOptions } from './x/runtime'
export const serverProviders = [
    linkedinModule,
    blueskyModule,
    mastodonModule,
    discordModule,
    telegramModule,
    facebookModule,
    instagramModule,
    devtoModule,
    xModule,
] as const
export const providerApplicationPolicies = serverProviders.flatMap(provider =>
    'application' in provider ? [provider.application] : []
)
export const providerApplicationIds = providerApplicationPolicies.map(policy => policy.id)

export const providerCommentPolicies = serverProviders.flatMap(provider =>
    'comments' in provider ? [provider.comments] : []
)
export const providerCommentIds = providerCommentPolicies.map(policy => policy.id)
export function commentPolicy(id: string | undefined) {
    return providerCommentPolicies.find(policy => policy.id === id)
}

export const publisherConnectionPolicies = Object.fromEntries(
    serverProviders.map(provider => [provider.id, provider.connection])
)
export type ProviderRuntimeOptions = LinkedInRuntimeOptions &
    BlueskyRuntimeOptions &
    MastodonRuntimeOptions &
    XRuntimeOptions &
    FacebookRuntimeOptions &
    InstagramRuntimeOptions
export function createProviderRuntime(context: ProviderRuntimeContext) {
    return {
        ...createLinkedInRuntime(context),
        ...createBlueskyRuntime(context),
        ...createMastodonRuntime(context),
        ...createXRuntime(context),
        ...createFacebookRuntime(context),
        ...createInstagramRuntime(context),
    }
}
export type ProviderApplicationId = (typeof providerApplicationPolicies)[number]['id']

export const providerWorkerFactories = [
    createLinkedinAdapters,
    createBlueskyAdapters,
    createMastodonAdapters,
    createXAdapters,
    createDiscordAdapters,
    createTelegramAdapters,
    createFacebookAdapters,
    createInstagramAdapters,
    createDevtoAdapters,
] as const
