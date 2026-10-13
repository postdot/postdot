import type { PublisherConnectionPolicy } from '@postbot/db'
import { isDiscordChannelId } from '@postbot/discord'

export const discordPublisherConnectionPolicy: PublisherConnectionPolicy = {
    validateDestination: destination =>
        destination.type === 'channel' &&
        isDiscordChannelId(destination.id.trim()) &&
        (destination.name === null || destination.name.trim().length > 0),
}
