import { api } from '@/lib/api'
import { TelegramConnectionDialog } from '@/providers/telegram/connection-dialog'

import type { ProviderConnectionProps } from '../contract'

export default function Connection(props: ProviderConnectionProps) {
    return (
        <TelegramConnectionDialog
            channel={props.channel}
            disabled={props.disabled}
            reconnect={props.reconnect}
            onConnect={async (channelId, input) => {
                await api.connectTelegramPublisher(props.channel.projectId, channelId, input)
                return props.onConnected()
            }}
        />
    )
}
