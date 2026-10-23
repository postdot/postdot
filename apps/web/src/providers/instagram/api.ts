import { client, unwrap } from '@/lib/api-transport'
export const instagramApi = {
    /**
     * Start the direct Instagram professional account authorization. The
     * provider redirects to Instagram, so the caller sends the browser to the
     * returned URL and the shared callback completes the connection.
     */
    async startInstagramConnection(
        projectId: string,
        channelId: string,
        providerApplicationId?: string
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.instagram.connect.post(
                    providerApplicationId === undefined ? {} : { providerApplicationId }
                )
        )
    },
}
