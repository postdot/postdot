import { blueskyChannelProfile } from '@postbot/bluesky'
import { createManualChannelProfile, type ChannelProfilePreset } from '@postbot/core'
import { devtoChannelProfile } from '@postbot/devto'
import { discordChannelProfile } from '@postbot/discord'
import { facebookChannelProfile } from '@postbot/facebook'
import { instagramChannelProfile } from '@postbot/instagram'
import { linkedinChannelProfile } from '@postbot/linkedin'
import { mastodonChannelProfile } from '@postbot/mastodon'
import { telegramChannelProfile } from '@postbot/telegram'
import { xChannelProfile } from '@postbot/x'

function presetFor(profile: ChannelProfilePreset['profile']): ChannelProfilePreset {
    return {
        id: profile.id,
        version: profile.version,
        profile,
    }
}

/**
 * Composition-only catalog of the profiles currently shipped by Postbot.
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
