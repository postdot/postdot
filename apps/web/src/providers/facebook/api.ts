import type { WebApiRequests } from '@postdot/client'

import { client, unwrap } from '@/lib/api-transport'
export const facebookApi = {
    async startFacebookPublisherConnection(
        projectId: string,
        channelId: string,
        providerApplicationId?: string
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.facebook.connect.post({ providerApplicationId })
        )
    },
    async listFacebookPages(
        projectId: string,
        channelId: string,
        selection: string,
        after?: string
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.facebook.pages.get({ query: { selection, after } })
        )
    },
    async selectFacebookPage(
        projectId: string,
        channelId: string,
        input: WebApiRequests['selectFacebookPage']
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.facebook.select.post(input)
        )
    },
}
