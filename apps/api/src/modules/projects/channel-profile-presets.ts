import { createManualChannelProfile, type ChannelProfilePreset } from '@postdot/core'

import { serverProviders } from '../../providers/registry'

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
    ...serverProviders.map(provider => presetFor(provider.profile)),
] as const satisfies readonly ChannelProfilePreset[]

const builtInProfilesById = new Map(
    builtInChannelProfilePresets.map(preset => [preset.id, preset.profile] as const)
)

export function resolveBuiltInChannelProfile(id: string) {
    return builtInProfilesById.get(id)
}
