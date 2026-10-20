import type { Channel } from '@/lib/api'

export type ChannelIdentityPeer = Pick<Channel, 'id' | 'name' | 'profileId' | 'createdAt'>

export function channelVariant(channelId: string, channels: readonly ChannelIdentityPeer[]) {
    const channel = channels.find(item => item.id === channelId)
    if (
        channel === undefined ||
        ![
            'linkedin',
            'x',
            'bluesky',
            'mastodon',
            'discord',
            'telegram',
            'devto',
            'facebook',
            'instagram',
        ].includes(channel.profileId)
    )
        return undefined
    const peers = channels
        .filter(item => item.profileId === channel.profileId)
        .toSorted(
            (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)
        )
    if (peers.length < 2) return undefined
    return alphabeticVariant(peers.findIndex(item => item.id === channelId))
}

export function alphabeticVariant(index: number): string {
    let value = index + 1
    let label = ''
    while (value > 0) {
        value -= 1
        label = String.fromCharCode(65 + (value % 26)) + label
        value = Math.floor(value / 26)
    }
    return label
}

export function suggestChannelName(
    base: string,
    names: readonly string[],
    startingVariant = 0
): string {
    const used = new Set(names.map(name => name.trim().toLocaleLowerCase()))
    if (startingVariant === 0 && !used.has(base.toLocaleLowerCase())) return base
    let index = Math.max(1, startingVariant)
    while (used.has(`${base} ${alphabeticVariant(index)}`.toLocaleLowerCase())) index += 1
    return `${base} ${alphabeticVariant(index)}`
}

export function channelNameExists(name: string, names: readonly string[]): boolean {
    const normalized = name.trim().toLocaleLowerCase()
    return normalized !== '' && names.some(value => value.trim().toLocaleLowerCase() === normalized)
}
