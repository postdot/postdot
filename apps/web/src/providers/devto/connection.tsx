import { api } from '@/lib/api'
import { DevtoConnectionDialog } from '@/providers/devto/connection-dialog'

import type { ProviderConnectionProps } from '../contract'

export default function Connection(props: ProviderConnectionProps) {
    return (
        <DevtoConnectionDialog
            channel={props.channel}
            disabled={props.disabled}
            reconnect={props.reconnect}
            onConnect={async (channelId, apiKey) => {
                await api.connectDevtoPublisher(props.channel.projectId, channelId, apiKey)
                return props.onConnected()
            }}
        />
    )
}
