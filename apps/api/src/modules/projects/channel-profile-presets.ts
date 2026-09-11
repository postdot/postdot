import { blueskyChannelProfile } from '@herald/bluesky'
import { createManualChannelProfile, type ChannelProfilePreset } from '@herald/core'
import { devtoChannelProfile } from '@herald/devto'
import { discordChannelProfile } from '@herald/discord'
import { linkedinChannelProfile } from '@herald/linkedin'
import { mastodonChannelProfile } from '@herald/mastodon'
import { xChannelProfile } from '@herald/x'

function presetFor(profile: ChannelProfilePreset['profile']): ChannelProfilePreset {
    return {
        id: profile.id,
        version: profile.version,
        profile,
    }
}

/**
 * Composition-only catalog of the profiles currently shipped by Herald.
 * Provider packages remain the owners of the profile definitions; this module
 * only makes those definitions discoverable to the API and profile resolver.
 */
export const builtInChannelProfilePresets = [
    presetFor(createManualChannelProfile()),
    presetFor(linkedinChannelProfile),
    presetFor(blueskyChannelProfile),
    presetFor(mastodonChannelProfile),
    presetFor(discordChannelProfile),
    presetFor(devtoChannelProfile),
    presetFor(xChannelProfile),
] as const satisfies readonly ChannelProfilePreset[]

const builtInProfilesById = new Map(
    builtInChannelProfilePresets.map(preset => [preset.id, preset.profile] as const)
)

export function resolveBuiltInChannelProfile(id: string) {
    return builtInProfilesById.get(id)
}
