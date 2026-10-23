import type { WebApiRequests } from '@postdot/client'

import { client, unwrap } from '@/lib/api-transport'
export const discordApi = {
    async connectDiscordPublisher(
        projectId: string,
        channelId: string,
        input: WebApiRequests['connectDiscordPublisher']
    ) {
        return unwrap(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.discord.connect.post(input)
        )
    },
}
