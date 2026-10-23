import { client, unwrap } from '@/lib/api-transport'
export const xApi = {
    async startXPublisherConnection(
        projectId: string,
        channelId: string,
        providerApplicationId?: string
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.x.connect.post(
                    providerApplicationId === undefined ? {} : { providerApplicationId }
                )
        )
    },
}
