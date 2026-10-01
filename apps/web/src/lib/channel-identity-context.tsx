import { createContext, useContext, type Context, type ReactNode } from 'react'

import { channelVariant, type ChannelIdentityPeer } from '@/lib/channel-identity'

const ChannelIdentities =
    (import.meta.hot?.data.channelIdentities as
        | Context<readonly ChannelIdentityPeer[]>
        | undefined) ?? createContext<readonly ChannelIdentityPeer[]>([])
if (import.meta.hot) import.meta.hot.data.channelIdentities = ChannelIdentities

export function ChannelIdentityProvider({
    channels,
    children,
}: {
    readonly channels: readonly ChannelIdentityPeer[]
    readonly children: ReactNode
}) {
    return <ChannelIdentities value={channels}>{children}</ChannelIdentities>
}

export function useChannelVariant(channelId: string) {
    return channelVariant(channelId, useContext(ChannelIdentities))
}

export function useChannelIdentityPeers() {
    return useContext(ChannelIdentities)
}
