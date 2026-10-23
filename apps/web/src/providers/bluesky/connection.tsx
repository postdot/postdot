import { api } from '@/lib/api'
import { BlueskyConnectionDialog } from '@/providers/bluesky/connection-dialog'

import type { ProviderConnectionProps } from '../contract'

export default function Connection(props: ProviderConnectionProps) {
    return (
        <BlueskyConnectionDialog
            channel={props.channel}
            disabled={props.disabled}
            reconnect={props.reconnect}
            providerApplications={props.applications}
            providerApplicationId={props.applicationId}
            onProviderApplicationChange={props.onApplicationChange}
            onConnect={async (channelId, handle, applicationId) => {
                const result = await api.startBlueskyPublisherConnection(
                    props.channel.projectId,
                    channelId,
                    handle,
                    applicationId
                )
                window.location.assign(result.authorizationUrl)
            }}
        />
    )
}
