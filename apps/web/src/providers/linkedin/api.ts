import type { LinkedInConnectionDestination } from '@postdot/client'

import { client, unwrap } from '@/lib/api-transport'
export const linkedinApi = {
    async startLinkedInPublisherConnection(
        projectId: string,
        channelId: string,
        destination?: LinkedInConnectionDestination,
        providerApplicationId?: string
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.linkedin.connect.post({
                    ...(destination === undefined ? {} : { destination }),
                    ...(providerApplicationId === undefined ? {} : { providerApplicationId }),
                })
        )
    },
}
