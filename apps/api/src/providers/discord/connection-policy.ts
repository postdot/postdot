import type { PublisherConnectionPolicy } from '@postdot/db'
import { isDiscordChannelId } from '@postdot/discord'

export const discordPublisherConnectionPolicy: PublisherConnectionPolicy = {
    validateDestination: destination =>
        destination.type === 'channel' &&
        isDiscordChannelId(destination.id.trim()) &&
        (destination.name === null || destination.name.trim().length > 0),
}
