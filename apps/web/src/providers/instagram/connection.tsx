import { OAuthConnectionDialog } from '@/components/oauth-connection-dialog'
import { api } from '@/lib/api'

import type { ProviderConnectionProps } from '../contract'

export default function Connection(props: ProviderConnectionProps) {
    return (
        <OAuthConnectionDialog
            channel={props.channel}
            provider="Instagram"
            disabled={props.disabled}
            reconnect={props.reconnect}
            applications={props.applications}
            applicationId={props.applicationId}
            onApplicationChange={props.onApplicationChange}
            onConnect={async () => {
                const result = await api.startInstagramConnection(
                    props.channel.projectId,
                    props.channel.id,
                    props.applicationId
                )
                window.location.assign(result.url)
            }}
        />
    )
}
