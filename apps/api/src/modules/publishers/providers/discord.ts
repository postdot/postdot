import type { PublisherConnectionPolicy } from '@herald/db'
import { isDiscordChannelId } from '@herald/discord'

export const discordPublisherConnectionPolicy: PublisherConnectionPolicy = {
    validateDestination: destination =>
        destination.type === 'channel' &&
        isDiscordChannelId(destination.id.trim()) &&
        (destination.name === null || destination.name.trim().length > 0),
}
