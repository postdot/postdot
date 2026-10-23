import { api } from '@/lib/api'
import { MastodonConnectionDialog } from '@/providers/mastodon/connection-dialog'

import type { ProviderConnectionProps } from '../contract'

export default function Connection(props: ProviderConnectionProps) {
    return (
        <MastodonConnectionDialog
            channel={props.channel}
            disabled={props.disabled}
            reconnect={props.reconnect}
            onConnect={async (channelId, instanceUrl) => {
                const result = await api.startMastodonPublisherConnection(
                    props.channel.projectId,
                    channelId,
                    instanceUrl
                )
                window.location.assign(result.authorizationUrl)
            }}
        />
    )
}
