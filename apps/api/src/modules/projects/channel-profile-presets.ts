import { blueskyChannelProfile } from '@postdot/bluesky'
import { createManualChannelProfile, type ChannelProfilePreset } from '@postdot/core'
import { devtoChannelProfile } from '@postdot/devto'
import { discordChannelProfile } from '@postdot/discord'
import { facebookChannelProfile } from '@postdot/facebook'
import { instagramChannelProfile } from '@postdot/instagram'
import { linkedinChannelProfile } from '@postdot/linkedin'
import { mastodonChannelProfile } from '@postdot/mastodon'
import { telegramChannelProfile } from '@postdot/telegram'
import { xChannelProfile } from '@postdot/x'

function presetFor(profile: ChannelProfilePreset['profile']): ChannelProfilePreset {
    return {
        id: profile.id,
        version: profile.version,
        profile,
    }
}

/**
 * Composition-only catalog of the profiles currently shipped by Postdot.
 * Provider packages remain the owners of the profile definitions; this module
 * only makes those definitions discoverable to the API and profile resolver.
 */
export const builtInChannelProfilePresets = [
    presetFor(createManualChannelProfile()),
    presetFor(linkedinChannelProfile),
    presetFor(blueskyChannelProfile),
    presetFor(mastodonChannelProfile),
    presetFor(discordChannelProfile),
    presetFor(telegramChannelProfile),
    presetFor(facebookChannelProfile),
    presetFor(instagramChannelProfile),
    presetFor(devtoChannelProfile),
    presetFor(xChannelProfile),
] as const satisfies readonly ChannelProfilePreset[]

const builtInProfilesById = new Map(
    builtInChannelProfilePresets.map(preset => [preset.id, preset.profile] as const)
)

export function resolveBuiltInChannelProfile(id: string) {
    return builtInProfilesById.get(id)
}
