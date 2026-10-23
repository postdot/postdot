import { api } from '@/lib/api'
import { DiscordConnectionDialog } from '@/providers/discord/connection-dialog'

import type { ProviderConnectionProps } from '../contract'

export default function Connection(props: ProviderConnectionProps) {
    return (
        <DiscordConnectionDialog
            channel={props.channel}
            disabled={props.disabled}
            reconnect={props.reconnect}
            onConnect={async (channelId, input) => {
                await api.connectDiscordPublisher(props.channel.projectId, channelId, input)
                return props.onConnected()
            }}
        />
    )
}
