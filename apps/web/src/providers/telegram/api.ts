import type { WebApiRequests } from '@postdot/client'

import { client, unwrap } from '@/lib/api-transport'
export const telegramApi = {
    async connectTelegramPublisher(
        projectId: string,
        channelId: string,
        input: WebApiRequests['connectTelegramPublisher']
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.telegram.connect.post(input)
        )
    },
}
