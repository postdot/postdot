import type { WebApiRequests } from '@postdot/client'

import { client, unwrap } from '@/lib/api-transport'
export const devtoApi = {
    async listDevtoProviderAnalytics(
        projectId: string,
        options: WebApiRequests['listDevtoProviderAnalytics'] = {}
    ) {
        return unwrap(
            await client.api.projects({ projectId }).analytics.provider.devto.get({
                query: options,
            })
        )
    },
    async listLatestDevtoProviderAnalytics(projectId: string, publicationIds: readonly string[]) {
        return unwrap(
            await client.api.projects({ projectId }).analytics.provider.devto.latest.get({
                query: { publicationIds: [...publicationIds] },
            })
        )
    },
    async collectDevtoProviderAnalytics(
        projectId: string,
        channelId: string,
        publicationId: string
    ) {
        return unwrap(
            await client.api.projects({ projectId }).analytics.provider.devto.collect.post({
                channelId,
                publicationId,
            })
        )
    },
    async connectDevtoPublisher(projectId: string, channelId: string, apiKey: string) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.devto.connect.post({ apiKey })
        )
    },
}
