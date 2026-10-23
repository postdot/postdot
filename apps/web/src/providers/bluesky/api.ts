import type { WebApiRequests } from '@postdot/client'

import { client, unwrap } from '@/lib/api-transport'
export const blueskyApi = {
    async listBlueskyProviderAnalytics(
        projectId: string,
        options: WebApiRequests['listBlueskyProviderAnalytics'] = {}
    ) {
        return unwrap(
            await client.api.projects({ projectId }).analytics.provider.bluesky.get({
                query: options,
            })
        )
    },
    async listLatestBlueskyProviderAnalytics(projectId: string, publicationIds: readonly string[]) {
        return unwrap(
            await client.api.projects({ projectId }).analytics.provider.bluesky.latest.get({
                query: { publicationIds: [...publicationIds] },
            })
        )
    },
    async collectBlueskyProviderAnalytics(
        projectId: string,
        channelId: string,
        publicationId: string
    ) {
        return unwrap(
            await client.api.projects({ projectId }).analytics.provider.bluesky.collect.post({
                channelId,
                publicationIds: [publicationId],
            })
        )
    },
    async startBlueskyPublisherConnection(
        projectId: string,
        channelId: string,
        handle: string,
        providerApplicationId?: string
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.bluesky.connect.post({
                    handle,
                    ...(providerApplicationId === undefined ? {} : { providerApplicationId }),
                })
        )
    },
}
