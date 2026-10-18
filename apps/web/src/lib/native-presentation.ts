import type { ChannelListItem } from '@/lib/api'

/** Profile identity never grants native rendering or authoring behavior. */
export function getNativePlatform(execution: ChannelListItem['execution'] | undefined) {
    if (execution?.kind !== 'built_in') return 'custom'
    switch (execution.contractId) {
        case 'x':
        case 'discord':
        case 'telegram':
        case 'facebook':
        case 'devto':
        case 'linkedin':
        case 'bluesky':
        case 'mastodon':
            return execution.contractId
        default:
            return 'custom'
    }
}

export function getNativeEditorProfile(execution: ChannelListItem['execution'] | undefined) {
    const platform = getNativePlatform(execution)
    return platform === 'discord' ? 'discord' : platform === 'devto' ? 'article' : 'plain'
}
