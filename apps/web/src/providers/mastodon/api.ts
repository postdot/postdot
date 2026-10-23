import { client, unwrap } from '@/lib/api-transport'
export const mastodonApi = {
    async listLatestMastodonProviderAnalytics(
        projectId: string,
        publicationIds: readonly string[]
    ) {
        return unwrap(
            await client.api.projects({ projectId }).analytics.provider.mastodon.latest.get({
                query: { publicationIds: [...publicationIds] },
            })
        )
    },
    async collectMastodonProviderAnalytics(
        projectId: string,
        channelId: string,
        publicationId: string
    ) {
        return unwrap(
            await client.api.projects({ projectId }).analytics.provider.mastodon.collect.post({
                channelId,
                publicationId,
            })
        )
    },
    async startMastodonPublisherConnection(
        projectId: string,
        channelId: string,
        instanceUrl: string
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.mastodon.connect.post({ instanceUrl })
        )
    },
}
